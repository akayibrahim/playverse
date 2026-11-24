import { KEYS, redis, todayUTC } from "@/lib/leaderboard";

/**
 * NEXUS global leaderboard.
 *   GET  /api/scores?board=daily|all&id=<playerId>  → top 10 + caller's rank
 *   POST /api/scores {id, name, score, time, kills, board, date}
 * Scores come from the client, so this only filters implausible values and rate-limits.
 */

const ID_RE = /^[a-z0-9]{12,32}$/;

function boardKey(board: string, date?: string) {
  return board === "daily" ? KEYS.daily(date ?? todayUTC()) : KEYS.all;
}

function cleanName(raw: unknown) {
  const s = String(raw ?? "")
    .replace(/[^\p{L}\p{N} _.\-]/gu, "")
    .trim()
    .slice(0, 16);
  return s.length >= 2 ? s : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const board = url.searchParams.get("board") === "daily" ? "daily" : "all";
  const date = url.searchParams.get("date") ?? todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "bad date" }, { status: 400 });
  const id = url.searchParams.get("id") ?? "";
  const key = boardKey(board, date);
  try {
    const [range, rank, score, total] = (await redis([
      ["ZREVRANGE", key, 0, 9, "WITHSCORES"],
      ["ZREVRANK", key, ID_RE.test(id) ? id : "_"],
      ["ZSCORE", key, ID_RE.test(id) ? id : "_"],
      ["ZCARD", key],
    ])) as [string[], number | null, string | null, number];
    const ids: string[] = [];
    const scores: number[] = [];
    for (let i = 0; i < range.length; i += 2) {
      ids.push(range[i]);
      scores.push(Number(range[i + 1]));
    }
    const names = ids.length ? ((await redis([["HMGET", KEYS.names, ...ids]]))[0] as (string | null)[]) : [];
    return Response.json({
      board,
      date,
      total,
      top: ids.map((pid, i) => ({ name: names[i] ?? "OPERATOR", score: scores[i], you: pid === id })),
      you: rank === null ? null : { rank: rank + 1, score: Number(score) },
    });
  } catch (err) {
    console.error("[scores] GET failed", err);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const name = cleanName(body.name);
  const score = Math.floor(Number(body.score));
  const time = Number(body.time);
  const kills = Math.floor(Number(body.kills));
  const board = body.board === "daily" ? "daily" : "all";
  const date = String(body.date ?? "");

  if (!ID_RE.test(id) || !name) return Response.json({ error: "bad player" }, { status: 400 });
  // Plausibility: a full run takes time, and points scale with kills and objectives.
  const plausible =
    Number.isFinite(score) &&
    score > 0 &&
    score <= 8000 &&
    time >= 15 &&
    time <= 3600 &&
    kills >= 0 &&
    kills <= 40 &&
    score <= 2600 + kills * 260;
  if (!plausible) return Response.json({ error: "rejected" }, { status: 422 });
  // Daily runs must be for today (UTC, ±1 day for time zones / midnight runs).
  if (board === "daily" && ![todayUTC(-1), todayUTC(), todayUTC(1)].includes(date)) {
    return Response.json({ error: "stale daily" }, { status: 422 });
  }

  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  try {
    const [hits] = (await redis([
      ["INCR", KEYS.rate(ip)],
      ["EXPIRE", KEYS.rate(ip), 60],
    ])) as [number, number];
    if (hits > 12) return Response.json({ error: "slow down" }, { status: 429 });

    const key = boardKey(board, date);
    const cmds: (string | number)[][] = [
      ["ZADD", key, "GT", score, id],
      ["HSET", KEYS.names, id, name],
    ];
    if (board === "daily") cmds.push(["EXPIRE", key, 60 * 60 * 24 * 14]);
    cmds.push(["ZREVRANK", key, id], ["ZCARD", key], ["ZSCORE", key, id]);
    const out = await redis(cmds);
    const n = out.length;
    const rank = out[n - 3] as number | null;
    return Response.json({
      ok: true,
      board,
      rank: rank === null ? null : rank + 1,
      total: out[n - 2] as number,
      best: Number(out[n - 1]),
    });
  } catch (err) {
    console.error("[scores] POST failed", err);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}

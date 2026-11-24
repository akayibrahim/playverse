/**
 * Global leaderboard on Upstash Redis (REST API, no SDK).
 * Env is injected by the Vercel ↔ Upstash integration; both naming schemes are accepted.
 * Without credentials in development an in-memory store is used so the UI can be tested.
 */

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

export const leaderboardConfigured = !!(URL_ && TOKEN);

type Cmd = (string | number)[];
type Reply = { result?: unknown; error?: string };

// ---- dev fallback ---------------------------------------------------------
const mem = { z: new Map<string, Map<string, number>>(), h: new Map<string, string>(), c: new Map<string, number>() };
function memExec(cmd: Cmd): unknown {
  const [op, key, ...a] = cmd.map(String);
  const z = () => {
    if (!mem.z.has(key)) mem.z.set(key, new Map());
    return mem.z.get(key)!;
  };
  const sorted = () => [...z().entries()].sort((x, y) => y[1] - x[1]);
  switch (op) {
    case "ZADD": {
      const [, score, member] = a; // GT score member
      const cur = z().get(member);
      if (cur === undefined || Number(score) > cur) z().set(member, Number(score));
      return 1;
    }
    case "ZREVRANGE":
      return sorted()
        .slice(Number(a[0]), Number(a[1]) + 1)
        .flatMap(([m, s]) => [m, String(s)]);
    case "ZREVRANK": {
      const i = sorted().findIndex(([m]) => m === a[0]);
      return i < 0 ? null : i;
    }
    case "ZSCORE":
      return z().has(a[0]) ? String(z().get(a[0])) : null;
    case "ZCARD":
      return z().size;
    case "HSET":
      mem.h.set(a[0], a[1]);
      return 1;
    case "HMGET":
      return a.map((id) => mem.h.get(id) ?? null);
    case "INCR":
      mem.c.set(key, (mem.c.get(key) ?? 0) + 1);
      return mem.c.get(key);
    default:
      return 1;
  }
}

export async function redis(cmds: Cmd[]): Promise<unknown[]> {
  if (!leaderboardConfigured) {
    if (process.env.NODE_ENV === "production") throw new Error("leaderboard not configured");
    return cmds.map(memExec);
  }
  const res = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const out = (await res.json()) as Reply[];
  return out.map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

export const KEYS = {
  all: "nexus:lb:all",
  daily: (date: string) => `nexus:lb:d:${date}`,
  names: "nexus:names",
  rate: (ip: string) => `nexus:rl:${ip}`,
};

export function todayUTC(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

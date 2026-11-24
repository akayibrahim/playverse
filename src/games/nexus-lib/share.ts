/**
 * NEXUS 2100 — shareable result card (1200×630 PNG, the Open Graph aspect).
 * Drawn on a 2D canvas over a still of the final frame; shared with the Web Share API
 * where files are supported, otherwise downloaded / copied.
 */

export type CardData = {
  op: string;
  district: string;
  mode: string;
  success: boolean;
  grade: string;
  score: number;
  best: boolean;
  time: string;
  kills: number;
  headshots: number;
  accuracy: number;
  rank: string;
  rankIndex: number;
  medals: { icon: string; name: string; n: number }[];
  stars: boolean[];
  date: string;
  url: string;
  callsign: string;
};

const W = 1200;
const H = 630;

function fonts(el: Element) {
  const cs = getComputedStyle(el);
  const sans = cs.getPropertyValue("--sans").trim() || "system-ui, sans-serif";
  const mono = cs.getPropertyValue("--mono").trim() || "ui-monospace, monospace";
  return { sans, mono };
}

function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: "left" | "right" = "left") {
  // letter-spaced uppercase labels (canvas letterSpacing isn't everywhere yet)
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  w -= spacing;
  let cx = align === "right" ? x - w : x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  return w;
}

export async function renderCard(shot: HTMLCanvasElement | null, d: CardData, fontEl: Element): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const { sans, mono } = fonts(fontEl);
  const C = "#6ff2e3";
  const A = "#ffb547";
  const R = "#ff4d5c";

  // backdrop: final frame, cover-fit, pushed right
  ctx.fillStyle = "#05060f";
  ctx.fillRect(0, 0, W, H);
  if (shot && shot.width > 0) {
    const s = Math.max(W / shot.width, H / shot.height) * 1.04;
    const dw = shot.width * s;
    const dh = shot.height * s;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(shot, W - dw + 40, (H - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
  }
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "rgba(4,8,14,0.97)");
  g.addColorStop(0.42, "rgba(4,8,14,0.88)");
  g.addColorStop(0.75, "rgba(4,8,14,0.25)");
  g.addColorStop(1, "rgba(4,8,14,0.1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const v = ctx.createLinearGradient(0, H * 0.55, 0, H);
  v.addColorStop(0, "rgba(4,8,14,0)");
  v.addColorStop(1, "rgba(4,8,14,0.85)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  // scanlines
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  // frame
  ctx.strokeStyle = "rgba(111,242,227,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.fillStyle = C;
  for (const [x, y, dx, dy] of [
    [18, 18, 1, 1],
    [W - 18, 18, -1, 1],
    [18, H - 18, 1, -1],
    [W - 18, H - 18, -1, -1],
  ]) {
    ctx.fillRect(x, y - (dy < 0 ? 4 : 0), 34 * dx, 4);
    ctx.fillRect(x - (dx < 0 ? 4 : 0), y, 4, 34 * dy);
  }

  const L = 64;
  ctx.textBaseline = "alphabetic";
  // header
  ctx.fillStyle = C;
  ctx.font = `500 15px ${mono}`;
  spaced(ctx, `PLAYVERSE // ${d.mode}`, L, 74, 4.5);
  ctx.fillStyle = "#f4f9fb";
  ctx.font = `800 58px ${sans}`;
  ctx.fillText("NEXUS", L, 134);
  const nw = ctx.measureText("NEXUS ").width;
  ctx.fillStyle = C;
  ctx.fillText("2100", L + nw, 134);
  ctx.fillStyle = "#c9d7df";
  ctx.font = `500 16px ${mono}`;
  spaced(ctx, `${d.district} · ${d.op}`, L, 166, 3);

  // result line
  ctx.fillStyle = d.success ? C : R;
  ctx.font = `600 15px ${mono}`;
  spaced(ctx, d.success ? "MISSION COMPLETE" : "OPERATOR KIA", L, 214, 4);

  // grade + score
  ctx.fillStyle = d.success ? C : R;
  ctx.font = `800 118px ${sans}`;
  ctx.fillText(d.grade, L - 4, 322);
  const gw = ctx.measureText(d.grade).width;
  ctx.fillStyle = "#f4f9fb";
  ctx.font = `800 76px ${sans}`;
  ctx.fillText(d.score.toLocaleString("en-US"), L + gw + 26, 300);
  ctx.fillStyle = d.best ? A : "#7c91a1";
  ctx.font = `600 14px ${mono}`;
  spaced(ctx, d.best ? "★ NEW PERSONAL BEST" : "SCORE", L + gw + 30, 326, 3.5);

  // stats
  const stats: [string, string][] = [
    [d.time, "TIME"],
    [String(d.kills), "KILLS"],
    [String(d.headshots), "HEADSHOTS"],
    [`${Math.round(d.accuracy * 100)}%`, "ACCURACY"],
  ];
  stats.forEach(([val, lab], i) => {
    const x = L + i * 132;
    ctx.fillStyle = "rgba(111,242,227,0.5)";
    ctx.fillRect(x, 362, 2, 52);
    ctx.fillStyle = "#f4f9fb";
    ctx.font = `700 30px ${sans}`;
    ctx.fillText(val, x + 14, 392);
    ctx.fillStyle = "#7c91a1";
    ctx.font = `500 12px ${mono}`;
    spaced(ctx, lab, x + 14, 412, 2.5);
  });

  // stars
  let sx = L;
  ctx.font = `700 26px ${sans}`;
  d.stars.forEach((on) => {
    ctx.fillStyle = on ? A : "rgba(255,255,255,0.18)";
    ctx.fillText("★", sx, 470);
    sx += 32;
  });
  // rank chip
  ctx.fillStyle = "#7c91a1";
  ctx.font = `500 13px ${mono}`;
  spaced(ctx, `RANK ${d.rankIndex + 1} · ${d.rank}`, sx + 14, 464, 3);

  // medals
  let mx = L;
  ctx.font = `600 13px ${mono}`;
  for (const m of d.medals.slice(0, 4)) {
    const label = `${m.icon} ${m.name}${m.n > 1 ? ` ×${m.n}` : ""}`;
    const w = ctx.measureText(label).width + label.length * 1.5 + 22;
    if (mx + w > W * 0.62) break;
    ctx.fillStyle = "rgba(255,181,71,0.12)";
    ctx.fillRect(mx, 494, w, 30);
    ctx.strokeStyle = "rgba(255,181,71,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + 0.5, 494.5, w - 1, 29);
    ctx.fillStyle = "#ffd59a";
    spaced(ctx, label, mx + 11, 514, 1.5);
    mx += w + 8;
  }

  // footer
  ctx.fillStyle = "#cfe3ea";
  ctx.font = `600 15px ${mono}`;
  spaced(ctx, `${d.callsign} · ${d.date}`, L, H - 52, 3);
  ctx.fillStyle = C;
  ctx.font = `600 15px ${mono}`;
  spaced(ctx, `PLAY FREE ▸ ${d.url.replace(/^https?:\/\//, "").toUpperCase()}`, W - 64, H - 52, 2.5, "right");

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}

export async function shareCard(blob: Blob, text: string, url: string): Promise<"shared" | "cancelled" | "unsupported"> {
  const file = new File([blob], "nexus-2100.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "NEXUS 2100", text: `${text} ${url}` });
      return "shared";
    } catch (err) {
      return (err as DOMException)?.name === "AbortError" ? "cancelled" : "unsupported";
    }
  }
  return "unsupported";
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function copyImage(blob: Blob) {
  try {
    const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (!CI || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new CI({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

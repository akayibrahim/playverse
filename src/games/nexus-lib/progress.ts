/**
 * NEXUS 2100 — meta progression: XP / rank, unlockable attachments, stars, medals.
 * Stored locally (no account needed).
 */

const KEY = "playverse:nexusProgress";

export const RANKS = [
  { name: "RECRUIT", xp: 0 },
  { name: "PRIVATE", xp: 1500 },
  { name: "CORPORAL", xp: 3500 },
  { name: "SERGEANT", xp: 6000 },
  { name: "STAFF SGT", xp: 9000 },
  { name: "LIEUTENANT", xp: 13000 },
  { name: "CAPTAIN", xp: 18000 },
  { name: "MAJOR", xp: 24000 },
  { name: "COLONEL", xp: 31000 },
  { name: "COMMANDER", xp: 40000 },
];

export type Slot = "optic" | "muzzle" | "mag" | "visor";

export type Item = { id: string; name: string; desc: string; rank: number };

export const ITEMS: Record<Slot, Item[]> = {
  optic: [
    { id: "dot", name: "RED DOT", desc: "Fast, clean sight picture", rank: 0 },
    { id: "holo", name: "HOLO 3X", desc: "Tighter ADS zoom · −40% ADS spread", rank: 3 },
  ],
  muzzle: [
    { id: "none", name: "BARE", desc: "Standard muzzle", rank: 0 },
    { id: "comp", name: "COMPENSATOR", desc: "−35% recoil", rank: 4 },
    { id: "supp", name: "SUPPRESSOR", desc: "Shots barely alert patrols · −8% damage", rank: 6 },
  ],
  mag: [
    { id: "std", name: "STANDARD 30", desc: "30 rounds", rank: 0 },
    { id: "ext", name: "EXTENDED 40", desc: "40 rounds · +0.25s reload", rank: 2 },
  ],
  visor: [
    { id: "cyan", name: "CYAN", desc: "Factory issue", rank: 0 },
    { id: "amber", name: "AMBER", desc: "Cosmetic", rank: 1 },
    { id: "violet", name: "VIOLET", desc: "Cosmetic", rank: 5 },
    { id: "gold", name: "GOLD", desc: "Cosmetic · elite", rank: 8 },
  ],
};

export const VISOR_COLORS: Record<string, number> = {
  cyan: 0x6ff2e3,
  amber: 0xffb547,
  violet: 0xb48cff,
  gold: 0xffd86b,
};

export const STARS = [
  { id: "complete", label: "Complete the operation" },
  { id: "fast", label: "Finish in under 4:00" },
  { id: "squad", label: "No squadmate goes down" },
];

export const MEDALS: Record<string, { name: string; xp: number; icon: string }> = {
  double: { name: "DOUBLE KILL", xp: 100, icon: "Ⅱ" },
  triple: { name: "TRIPLE KILL", xp: 250, icon: "Ⅲ" },
  headhunter: { name: "HEADHUNTER", xp: 200, icon: "◎" },
  ghost: { name: "GHOST", xp: 120, icon: "◌" },
  marksman: { name: "MARKSMAN", xp: 120, icon: "⌖" },
  untouchable: { name: "UNTOUCHABLE", xp: 300, icon: "◇" },
  lifesaver: { name: "LIFESAVER", xp: 150, icon: "✚" },
  clutch: { name: "CLUTCH", xp: 400, icon: "⚡" },
  giantslayer: { name: "GIANT SLAYER", xp: 200, icon: "▲" },
  countersniper: { name: "COUNTER-SNIPER", xp: 200, icon: "✦" },
  skeet: { name: "SKEET SHOOTER", xp: 120, icon: "✈" },
};

export type Progress = {
  xp: number;
  stars: Record<string, boolean>;
  medals: Record<string, number>;
  runs: number;
  wins: number;
  equip: Record<Slot, string>;
};

const DEFAULT: Progress = {
  xp: 0,
  stars: {},
  medals: {},
  runs: 0,
  wins: 0,
  equip: { optic: "dot", muzzle: "none", mag: "std", visor: "cyan" },
};

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT);
    const p = JSON.parse(raw) as Partial<Progress>;
    return { ...structuredClone(DEFAULT), ...p, equip: { ...DEFAULT.equip, ...(p.equip ?? {}) } };
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage disabled */
  }
}

export function rankOf(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i];
  const next = RANKS[i + 1];
  return {
    index: i,
    name: cur.name,
    into: xp - cur.xp,
    span: next ? next.xp - cur.xp : 1,
    pct: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1,
    next: next?.name ?? null,
  };
}

export function unlockedBetween(fromRank: number, toRank: number): Item[] {
  const out: Item[] = [];
  for (const slot of Object.keys(ITEMS) as Slot[]) {
    for (const it of ITEMS[slot]) if (it.rank > fromRank && it.rank <= toRank) out.push(it);
  }
  return out;
}

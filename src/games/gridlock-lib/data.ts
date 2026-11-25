/**
 * GRIDLOCK — static game data: district map, enemy paths, tower & enemy tables, wave generator.
 * Pure data + math, no three.js, so the balance can be reasoned about (and bot-tested) in isolation.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ map
export const PITCH = 48; // avenue spacing
export const AVE_W = 12; // avenue width
export const BLOCK = 36; // block width
export const LOT = 16; // building footprint
export const MAP_HALF = 130;
export const CORE_HP = 20;
export const TOTAL_WAVES = 20;

export type V2 = { x: number; z: number };
export type Path = { id: number; color: number; name: string; pts: V2[]; cum: number[]; len: number; gate: V2 };

const RAW_PATHS: Array<{ name: string; color: number; pts: Array<[number, number]> }> = [
  { name: "WEST GATE", color: 0x35f0ff, pts: [[-130, -96], [-96, -96], [-96, 48], [-48, 48], [-48, 0], [0, 0]] },
  { name: "EAST GATE", color: 0xff3fc8, pts: [[130, 96], [96, 96], [96, -48], [48, -48], [48, 0], [0, 0]] },
  { name: "SOUTH GATE", color: 0xffb547, pts: [[-48, 130], [-48, 96], [48, 96], [48, 48], [0, 48], [0, 0]] },
];
// stop short of the core centre so units stack around the reactor, not inside it
export const CORE_R = 5;

export function buildPaths(): Path[] {
  return RAW_PATHS.map((r, id) => {
    const pts = r.pts.map(([x, z]) => ({ x, z }));
    // end the lane at the reactor rim
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    pts[pts.length - 1] = { x: b.x - (dx / l) * CORE_R, z: b.z - (dz / l) * CORE_R };
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return { id, color: r.color, name: r.name, pts, cum, len: cum[cum.length - 1], gate: pts[0] };
  });
}

/** Position + heading at distance d along a path (clamped). */
export function pathAt(p: Path, d: number, out: { x: number; z: number; dx: number; dz: number }) {
  const dd = Math.max(0, Math.min(p.len, d));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < dd) i++;
  const a = p.pts[i - 1];
  const b = p.pts[i];
  const seg = p.cum[i] - p.cum[i - 1];
  const t = seg > 0 ? (dd - p.cum[i - 1]) / seg : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.dx = seg > 0 ? (b.x - a.x) / seg : 0;
  out.dz = seg > 0 ? (b.z - a.z) / seg : 1;
  return out;
}

export type Lot = { x: number; z: number; h: number; plaza: boolean; pad: boolean; padIndex: number; tone: number };
export type Pad = { index: number; x: number; z: number; h: number; plaza: boolean; costMul: number; rangeMul: number };

function distToSeg(px: number, pz: number, a: V2, b: V2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}
export function distToPaths(x: number, z: number, paths: Path[]) {
  let best = 1e9;
  for (const p of paths)
    for (let i = 1; i < p.pts.length; i++) best = Math.min(best, distToSeg(x, z, p.pts[i - 1], p.pts[i]));
  return best;
}

const BLOCK_C = [-72, -24, 24, 72];
const PLAZAS = new Set(["15,15", "-15,15", "15,-15", "-15,-15", "63,15", "-63,-15", "15,-63", "-15,63", "-63,-63", "63,63"]);

export function buildLots(paths: Path[]): { lots: Lot[]; pads: Pad[] } {
  const rng = mulberry32(1337);
  const lots: Lot[] = [];
  const pads: Pad[] = [];
  for (const bx of BLOCK_C)
    for (const bz of BLOCK_C)
      for (const ox of [-9, 9])
        for (const oz of [-9, 9]) {
          const x = bx + ox;
          const z = bz + oz;
          const plaza = PLAZAS.has(`${x},${z}`);
          const r = rng();
          const h = plaza ? 0 : Math.round(5 + Math.pow(r, 1.5) * 15);
          const near = distToPaths(x, z, paths);
          const pad = plaza || near < 29;
          const lot: Lot = { x, z, h, plaza, pad, padIndex: -1, tone: rng() };
          if (pad) {
            lot.padIndex = pads.length;
            pads.push({
              index: pads.length,
              x,
              z,
              h,
              plaza,
              costMul: 1 + h * 0.012,
              rangeMul: 1 + h * 0.015, // +15% per 10 m
            });
          }
          lots.push(lot);
        }
  return { lots, pads };
}

// ------------------------------------------------------------------ towers
export type TowerId = "pulse" | "arc" | "emp" | "rail" | "flak";
export type TargetMode = "first" | "strong" | "close";
export type TierStats = {
  dmg: number;
  rate: number; // shots (or pulses) per second
  range: number;
  chain?: number; // arc jumps
  splash?: number; // flak radius
  slow?: number; // emp slowdown fraction
  slowT?: number;
  vuln?: number; // emp: extra damage taken
  pierce?: number; // pulse: armour ignored
  burst?: number; // flak shells per volley
  stun?: number; // arc overload
  label?: string;
  blurb?: string;
};
export type TowerDef = {
  id: TowerId;
  name: string;
  color: number;
  css: string;
  key: string;
  cost: number;
  air: boolean;
  ground: boolean;
  desc: string;
  tiers: TierStats[]; // [T1, T2]
  branches: [TierStats, TierStats]; // T3 A / B
  upCost: [number, number, number]; // T2, T3a, T3b cost
};

export const TOWERS: Record<TowerId, TowerDef> = {
  pulse: {
    id: "pulse",
    name: "PULSE",
    color: 0x35f0ff,
    css: "#35f0ff",
    key: "1",
    cost: 60,
    air: true,
    ground: true,
    desc: "Cheap rapid-fire cannon. Hits ground and air.",
    tiers: [
      { dmg: 6, rate: 4, range: 20 },
      { dmg: 9, rate: 5, range: 23 },
    ],
    branches: [
      { dmg: 10, rate: 9, range: 24, label: "OVERCLOCK", blurb: "Double rate of fire" },
      { dmg: 30, rate: 3.6, range: 28, pierce: 9, label: "PIERCER", blurb: "Armour-piercing slugs, +range" },
    ],
    upCost: [70, 130, 140],
  },
  arc: {
    id: "arc",
    name: "ARC",
    color: 0xb98bff,
    css: "#b98bff",
    key: "2",
    cost: 110,
    air: false,
    ground: true,
    desc: "Tesla coil. Lightning chains between ground enemies.",
    tiers: [
      { dmg: 18, rate: 0.95, range: 18, chain: 3 },
      { dmg: 26, rate: 1.05, range: 20, chain: 4 },
    ],
    branches: [
      { dmg: 30, rate: 1.2, range: 22, chain: 8, label: "STORM", blurb: "Chains to 8 targets" },
      { dmg: 90, rate: 0.9, range: 21, chain: 4, stun: 0.7, label: "OVERLOAD", blurb: "Huge bolts that stun" },
    ],
    upCost: [100, 150, 160],
  },
  emp: {
    id: "emp",
    name: "EMP",
    color: 0x6aa8ff,
    css: "#6aa8ff",
    key: "3",
    cost: 90,
    air: false,
    ground: true,
    desc: "Pulse that slows ground units and strips shields. No damage.",
    tiers: [
      { dmg: 0, rate: 0.45, range: 17, slow: 0.4, slowT: 2.2 },
      { dmg: 0, rate: 0.5, range: 20, slow: 0.5, slowT: 2.6 },
    ],
    branches: [
      { dmg: 0, rate: 0.55, range: 22, slow: 0.7, slowT: 3.2, label: "CRYO", blurb: "Near-freeze, long duration" },
      { dmg: 0, rate: 0.5, range: 22, slow: 0.5, slowT: 3, vuln: 0.35, label: "DISRUPTOR", blurb: "Targets take +35% damage" },
    ],
    upCost: [90, 140, 140],
  },
  rail: {
    id: "rail",
    name: "RAIL",
    color: 0xff5a7a,
    css: "#ff5a7a",
    key: "4",
    cost: 220,
    air: true,
    ground: true,
    desc: "Very long range piercing beam. Slow, picks the strongest target.",
    tiers: [
      { dmg: 130, rate: 0.33, range: 46 },
      { dmg: 210, rate: 0.37, range: 52 },
    ],
    branches: [
      { dmg: 480, rate: 0.34, range: 58, label: "GAUSS", blurb: "Colossal slug damage" },
      { dmg: 190, rate: 0.75, range: 54, label: "RAPID", blurb: "Twice the rate of fire" },
    ],
    upCost: [200, 260, 260],
  },
  flak: {
    id: "flak",
    name: "FLAK",
    color: 0xffb547,
    css: "#ffb547",
    key: "5",
    cost: 100,
    air: true,
    ground: false,
    desc: "Anti-air burst cannon with splash. Air targets only.",
    tiers: [
      { dmg: 24, rate: 1.4, range: 28, splash: 6 },
      { dmg: 36, rate: 1.7, range: 32, splash: 7 },
    ],
    branches: [
      { dmg: 62, rate: 1.9, range: 36, splash: 10, label: "SKYBURNER", blurb: "Bigger blast, heavy hits" },
      { dmg: 30, rate: 1.9, range: 34, splash: 7, burst: 3, label: "BARRAGE", blurb: "Three shells per volley" },
    ],
    upCost: [90, 140, 140],
  },
};
export const TOWER_ORDER: TowerId[] = ["pulse", "arc", "emp", "rail", "flak"];

/** Stats for a tower at tier (1..3) with branch (0/1 for tier 3). */
export function towerStats(id: TowerId, tier: number, branch: number): TierStats {
  const d = TOWERS[id];
  if (tier >= 3) return d.branches[branch] ?? d.branches[0];
  return d.tiers[tier - 1];
}
export function upgradeCost(id: TowerId, tier: number, branch: number): number {
  const d = TOWERS[id];
  if (tier === 1) return d.upCost[0];
  if (tier === 2) return d.upCost[1 + branch];
  return 0;
}

// ------------------------------------------------------------------ enemies
export type EnemyId = "skitter" | "walker" | "hover" | "shield" | "splitter" | "boss";
export type EnemyDef = {
  id: EnemyId;
  name: string;
  hp: number;
  speed: number;
  armor: number;
  reward: number;
  leak: number;
  air: boolean;
  radius: number;
  color: number;
  score: number;
};
export const ENEMIES: Record<EnemyId, EnemyDef> = {
  skitter: { id: "skitter", name: "SKITTER", hp: 20, speed: 7, armor: 0, reward: 3, leak: 1, air: false, radius: 1.3, color: 0xff4d5c, score: 10 },
  walker: { id: "walker", name: "WALKER", hp: 150, speed: 3.9, armor: 4, reward: 11, leak: 2, air: false, radius: 2.3, color: 0xffb547, score: 30 },
  hover: { id: "hover", name: "HOVER", hp: 62, speed: 5.4, armor: 0, reward: 9, leak: 2, air: true, radius: 1.8, color: 0xff3fc8, score: 25 },
  shield: { id: "shield", name: "SHIELD", hp: 190, speed: 3.4, armor: 2, reward: 20, leak: 3, air: false, radius: 2.4, color: 0x6aa8ff, score: 50 },
  splitter: { id: "splitter", name: "SPLITTER", hp: 170, speed: 4.2, armor: 1, reward: 13, leak: 2, air: false, radius: 2.1, color: 0xb6ff4d, score: 40 },
  boss: { id: "boss", name: "JUGGERNAUT", hp: 3400, speed: 2.5, armor: 8, reward: 160, leak: 8, air: false, radius: 5.5, color: 0xff2a3a, score: 400 },
};
export const SHIELD_R = 13;
export const STOMP_R = 30;

export type Group = { type: EnemyId; count: number; gap: number; delay: number; gate: number };
export type WaveDef = { n: number; groups: Group[]; hpMul: number; rewardMul: number; boss: boolean; total: number; gatesUsed: number[]; note: string };

export function hpMulFor(w: number) {
  const k = w - 1;
  return 1 + 0.085 * k + 0.0042 * k * k + (w > 20 ? 0.12 * (w - 20) : 0);
}

export function waveDef(w: number): WaveDef {
  const gates = w >= 10 ? 3 : 2;
  const g = (i: number) => i % gates;
  const groups: Group[] = [];
  const add = (type: EnemyId, count: number, gap: number, delay: number, gate: number) => {
    if (count > 0) groups.push({ type, count: Math.round(count), gap, delay, gate });
  };
  let note = "";
  const sk = 6 + Math.floor(w * 1.7);
  if (w === 4) {
    note = "SWARM";
    add("skitter", 18, 0.38, 0, 0);
    add("skitter", 18, 0.38, 1, 1);
  } else if (w === 9 || w === 14 || w === 19) {
    note = "AIR RAID";
    const n = 8 + Math.floor((w - 9) * 1.3) * 1;
    for (let k = 0; k < gates; k++) add("hover", n / gates + 2, 0.9, k * 0.6, k);
    add("skitter", 8 + w, 0.6, 2, g(0));
  } else {
    for (let k = 0; k < gates; k++) add("skitter", sk / gates, Math.max(0.35, 0.9 - w * 0.02), k * 0.5, k);
    if (w >= 3) for (let k = 0; k < gates; k++) add("walker", (Math.floor((w - 1) * 0.85) + 1) / gates + (k === 0 ? 0.4 : 0), 2.4, 3 + k, k);
    if (w >= 5) for (let k = 0; k < gates; k++) add("hover", (Math.ceil((w - 3) * 0.8)) / gates, 1.7, 6 + k, k);
    if (w >= 6) add("splitter", Math.floor((w - 3) / 2.4), 3, 8, g(w));
    if (w >= 7) add("shield", Math.floor((w - 4) / 2.2), 3.2, 10, g(w + 1));
  }
  if (w === 10 || w === 20 || (w > 20 && (w - 20) % 5 === 0)) {
    note = "JUGGERNAUT";
    add("boss", 1 + (w > 20 ? Math.floor((w - 15) / 10) : 0), 6, 14, w === 20 ? 2 : 0);
  }
  let total = 0;
  const used = new Set<number>();
  for (const x of groups) {
    total += x.count;
    used.add(x.gate);
  }
  return { n: w, groups, hpMul: hpMulFor(w), rewardMul: 1 + 0.025 * (w - 1), boss: groups.some((x) => x.type === "boss"), total, gatesUsed: [...used].sort(), note };
}

export const START_CREDITS = 260;
export const BUILD_TIME = 28; // seconds before the next wave auto-starts
export const SELL_RATE = 0.7;

export function waveClearBonus(w: number) {
  return 45 + w * 6;
}
export function stars(integrity: number) {
  return integrity >= 18 ? 3 : integrity >= 10 ? 2 : integrity >= 1 ? 1 : 0;
}

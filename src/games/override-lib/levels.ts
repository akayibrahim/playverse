/**
 * OVERRIDE — the three handcrafted floors of Halden Tower.
 * Layouts are built from rectangle ops on a 2 m grid (cell units everywhere: x,z in cells, 1 = 2 m).
 * Auto-walls are generated around every open cell; glass rects turn wall cells into windows.
 */

export const CELL = 2;
export type V2 = [number, number];

export type CamDef = { id: string; x: number; z: number; y: number; yaw: number; sweep: number; period: number; range: number; fov: number; phase?: number };
export type RobotDef = { id: string; route: V2[]; speed: number; pause: number; mode: "loop" | "pingpong"; start?: number };
export type LaserDef = { id: string; a: V2; b: V2; y0: number; y1: number; box?: string; pulse?: [number, number, number] };
export type JunctionDef = { id: string; x: number; z: number; y: number; face: number; off: number };
export type DoorDef = { id: string; cells: V2[]; axis: "x" | "z" };
export type ScannerDef = { id: string; a: V2; b: V2 };
export type PropDef = { t: string; x: number; z: number; w?: number; d?: number; h?: number; rot?: number; c?: string };
export type SignDef = { text: string; x: number; z: number; y: number; face: number; w: number; h: number; color: string; sub?: string };
export type Step =
  | { go: [number, number, number?]; fast?: boolean }
  | { hack: string }
  | { wait: number }
  | { ride: string }
  | { exit: true }
  | { jackTo: string }
  | { until: string }
  | { near: [string, number, number, number] } // wait until robot id is within r cells of (x,z)
  | { clear: [number, number, number] }; // wait until point (cells x,z, metres y) is unseen right now

export type Theme = {
  name: string;
  sky: number; // fog / background
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  accent: number; // neon trim
  accent2: number;
  lightCol: number;
  lightI: number;
  floorCol: string;
  floorKind: "stone" | "raised" | "gloss";
  wallCol: string;
  ceilCol: string;
  altitude: number; // metres above street
  fog: number;
};

export type FloorDef = {
  n: number;
  id: string;
  code: string; // 12F
  name: string;
  tagline: string;
  teaches: string;
  par: number; // seconds
  parHacks: number;
  theme: Theme;
  W: number;
  H: number;
  grid: string[]; // ' ' void, '.' floor, '~' vent, 'a' atrium glass floor, '#' wall, 'g' glass wall
  ceil: (cx: number, cz: number, ch: string) => number;
  start: V2;
  startYaw: number;
  core: V2;
  extract: V2;
  extractFace: number;
  extractPane: V2; // glass cell that breaches
  cams: CamDef[];
  robots: RobotDef[];
  lasers: LaserDef[];
  junctions: JunctionDef[];
  doors: DoorDef[];
  scanners: ScannerDef[];
  chargers: { x: number; z: number; face: number }[];
  checkpoints: V2[];
  props: PropDef[];
  signs: SignDef[];
  lights: { x: number; z: number; c?: number; i?: number; w?: number; d?: number }[];
  objectives: string[];
  hints: { at: V2; r: number; text: string; once: string }[];
  solution: Step[];
};

class Grid {
  g: string[][];
  W: number;
  H: number;
  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.g = Array.from({ length: H }, () => Array.from({ length: W }, () => " "));
  }
  fill(x0: number, z0: number, x1: number, z1: number, ch = ".") {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.g[z][x] = ch;
  }
  cells(list: V2[], ch = "~") {
    for (const [x, z] of list) this.g[z][x] = ch;
  }
  finish(glass: [number, number, number, number][]) {
    const open = (x: number, z: number) => x >= 0 && z >= 0 && x < this.W && z < this.H && ".~a".includes(this.g[z][x]);
    const out = this.g.map((r) => r.slice());
    for (let z = 0; z < this.H; z++)
      for (let x = 0; x < this.W; x++) {
        if (this.g[z][x] !== " ") continue;
        let near = false;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (open(x + dx, z + dz)) near = true;
        if (near) out[z][x] = "#";
      }
    for (const [x0, z0, x1, z1] of glass) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (out[z]?.[x] === "#") out[z][x] = "g";
    return out.map((r) => r.join(""));
  }
}

function racks(list: PropDef[], x0: number, z0: number, x1: number, z1: number) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) list.push({ t: "rack", x: x + 0.5, z: z + 0.5, w: 1, d: 1, h: 2.5 });
}
const rect = (x0: number, z0: number, x1: number, z1: number): [number, number, number, number] => [x0, z0, x1, z1];
const mid = (a: number, b: number) => (a + b) / 2;
const TAU = 360;
void TAU;

// =====================================================================================================
// FLOOR 1 — LOBBY / 12F
// =====================================================================================================
function floor1(): FloorDef {
  const W = 33;
  const H = 22;
  const g = new Grid(W, H);
  g.fill(1, 3, 9, 16); // lobby hall
  g.fill(10, 8, 19, 10); // east corridor
  g.fill(20, 5, 30, 12); // core room
  g.fill(11, 1, 17, 5); // north office
  g.fill(14, 6, 15, 7);
  g.fill(13, 13, 17, 18); // south office
  g.fill(14, 11, 15, 12);
  g.fill(10, 15, 12, 15, "~"); // vent: hall -> south office
  g.fill(20, 17, 30, 19); // records room
  g.fill(18, 18, 19, 18);
  g.cells([[21, 16], [21, 15], [22, 15], [23, 15], [24, 15], [24, 14], [24, 13]], "~"); // vent: records -> core room
  const grid = g.finish([rect(0, 2, 0, 17), rect(1, 2, 9, 2), rect(31, 4, 31, 13), rect(20, 4, 30, 4), rect(10, 0, 18, 0), rect(12, 19, 18, 19), rect(19, 20, 31, 20)]);

  const props: PropDef[] = [
    // reception
    { t: "counter", x: 5, z: 7.5, w: 5, d: 1.1, h: 1.1, rot: 0, c: "#2a2a34" },
    { t: "screen", x: 5, z: 7.2, w: 1.0, h: 0.5 },
    { t: "pillar", x: 3, z: 11, w: 0.9, d: 0.9, h: 5 },
    { t: "pillar", x: 7, z: 11, w: 0.9, d: 0.9, h: 5 },
    { t: "pillar", x: 3, z: 4.6, w: 0.9, d: 0.9, h: 5 },
    { t: "pillar", x: 7.4, z: 4.6, w: 0.9, d: 0.9, h: 5 },
    { t: "sofa", x: 2.2, z: 14.4, w: 2.2, d: 0.9, h: 0.8, rot: 0, c: "#3a2a44" },
    { t: "sofa", x: 7.4, z: 14.6, w: 2.2, d: 0.9, h: 0.8, rot: 0, c: "#3a2a44" },
    { t: "plant", x: 1.6, z: 3.6, w: 0.9, d: 0.9, h: 1.4 },
    { t: "plant", x: 8.6, z: 15.3, w: 0.9, d: 0.9, h: 1.4 },
    { t: "table", x: 5, z: 14.7, w: 1.4, d: 0.9, h: 0.45 },
    // offices
    { t: "desk", x: 13, z: 2.2, w: 2.2, d: 1.0, h: 0.85, rot: 0 },
    { t: "desk", x: 16, z: 2.2, w: 2.2, d: 1.0, h: 0.85, rot: 0 },
    { t: "desk", x: 13, z: 4.4, w: 2.2, d: 1.0, h: 0.85, rot: 180 },
    { t: "desk", x: 16, z: 4.4, w: 2.2, d: 1.0, h: 0.85, rot: 180 },
    { t: "desk", x: 16.4, z: 15.3, w: 2.2, d: 1.0, h: 0.85, rot: 0 },
    { t: "desk", x: 16.2, z: 17.3, w: 2.2, d: 1.0, h: 0.85, rot: 180 },
    { t: "crate", x: 13.8, z: 17.6, w: 0.9, d: 0.9, h: 0.9 },
    { t: "ac", x: 29.4, z: 18.6, w: 1.1, d: 0.7, h: 1.2 },
    // records room
    { t: "rack", x: 22.5, z: 18.5, w: 1, d: 1, h: 2.5 },
    { t: "rack", x: 25.5, z: 18.5, w: 1, d: 1, h: 2.5 },
    { t: "rack", x: 28.5, z: 18.5, w: 1, d: 1, h: 2.5 },
    // core room
    { t: "desk", x: 22.4, z: 10.4, w: 2.4, d: 1.0, h: 0.85, rot: 0 },
    { t: "desk", x: 25.5, z: 6.2, w: 2.4, d: 1.0, h: 0.85, rot: 0 },
    { t: "crate", x: 29.4, z: 6.0, w: 0.9, d: 0.9, h: 0.9 },
    { t: "pillar", x: 24, z: 8.5, w: 0.8, d: 0.8, h: 4.2 },
  ];
  const signs: SignDef[] = [
    { text: "HALDEN", sub: "CORPORATION · EST. 2061", x: 4.9, z: 2.1, y: 3.1, face: 90, w: 6.2, h: 1.7, color: "#fb7185" },
    { text: "RESTRICTED", sub: "AUTHORISED PERSONNEL", x: 19.9, z: 9, y: 2.4, face: 180, w: 0.1, h: 0.1, color: "#ffb547" },
    { text: "DATA VAULT", sub: "LEVEL 12 · CORE ACCESS", x: 21.5, z: 4.95, y: 2.5, face: 90, w: 4.4, h: 1.1, color: "#35f0ff" },
  ];
  return {
    n: 1,
    id: "lobby",
    code: "12F",
    name: "LOBBY",
    tagline: "Cameras and vents. Learn to fly, hide and jack in.",
    teaches: "HACK CAMERAS",
    par: 150,
    parHacks: 3,
    theme: {
      name: "lobby",
      sky: 0x0b0716,
      hemiSky: 0x9fa6ff,
      hemiGround: 0x2a1830,
      hemiI: 0.9,
      accent: 0xfb7185,
      accent2: 0x35f0ff,
      lightCol: 0xffe2c0,
      lightI: 1.0,
      floorCol: "#1b1a22",
      floorKind: "stone",
      wallCol: "#2b2733",
      ceilCol: "#16141c",
      altitude: 44,
      fog: 0x120a22,
    },
    W,
    H,
    grid,
    ceil: (x, z) => (x <= 9 && z >= 3 && z <= 16 ? 5 : x >= 20 && z <= 12 ? 4.2 : 3.6),
    start: [2.5, 15.2],
    startYaw: 0,
    core: [27.5, 8.5],
    extract: [30.3, 8.5],
    extractFace: 0,
    extractPane: [31, 8],
    cams: [
      { id: "c1", x: 9.2, z: 3.4, y: 4.5, yaw: 135, sweep: 38, period: 8, range: 19, fov: 27 },
      { id: "c2", x: 10.5, z: 8.35, y: 3.2, yaw: 18, sweep: 26, period: 6.5, range: 19, fov: 24, phase: 0.3 },
      { id: "c3", x: 25.5, z: 5.3, y: 3.8, yaw: 90, sweep: 30, period: 7.5, range: 14, fov: 25 },
      { id: "c4", x: 30.2, z: 11.7, y: 3.8, yaw: 222, sweep: 22, period: 6, range: 17, fov: 24, phase: 0.55 },
      { id: "c5", x: 13.5, z: 13.5, y: 3.1, yaw: 45, sweep: 30, period: 7, range: 14, fov: 26 },
      { id: "c6", x: 30.3, z: 17.5, y: 3.1, yaw: 178, sweep: 18, period: 6, range: 18, fov: 25, phase: 0.2 },
    ],
    robots: [],
    lasers: [],
    junctions: [],
    doors: [],
    scanners: [],
    chargers: [
      { x: 1.2, z: 13.6, face: 0 },
      { x: 17.8, z: 16.2, face: 180 },
      { x: 21.3, z: 18.6, face: 90 },
    ],
    checkpoints: [[9.5, 9.5], [20.5, 9]],
    props,
    signs,
    lights: [],
    objectives: ["Cross the lobby unseen", "Reach the data vault", "Download the core (hold E)", "Exfiltrate through the window"],
    hints: [
      { at: [2.5, 15.2], r: 99, text: "WASD to fly · SPACE / CTRL up & down · mouse to look", once: "fly" },
      { at: [6, 12], r: 3, text: "Cameras see in cones. Aim at one and HOLD E to hack it", once: "cam" },
      { at: [10.5, 15.5], r: 2.2, text: "Vents are drone-only shortcuts", once: "vent" },
    ],
    solution: [
      // vent route: hall -> vent -> south office (jack c5) -> records -> vent -> core room; jack c4, hop to c3, download
      { go: [2.5, 16.3, 1.1] },
      { go: [8.6, 16.4, 1.1] },
      { go: [9.6, 15.5, 0.75] },
      { go: [12.6, 15.5, 0.7] },
      { go: [13.6, 15.5, 1.0] },
      { hack: "c5" },
      { exit: true },
      { go: [14.5, 16.6, 1.2] },
      { go: [14.5, 18.4, 1.2] },
      { go: [18.6, 18.4, 1.2] },
      { go: [20.6, 18.0, 1.0] },
      { go: [21.5, 17.0, 0.75] },
      { go: [21.5, 15.5, 0.7] },
      { go: [24.5, 15.5, 0.7] },
      { go: [24.5, 12.6, 0.8] },
      { go: [28.8, 12.6, 1.0] },
      { go: [28.8, 11.5, 1.0] },
      { hack: "c4" },
      { hack: "c3" },
      { exit: true },
      { go: [28.6, 10.2, 1.2], fast: true },
      { until: "core" },
      { go: [29.8, 8.5, 1.2], fast: true },
      { until: "done" },
    ],
  };
}

// =====================================================================================================
// FLOOR 2 — SERVER FARM / 48F
// =====================================================================================================
function floor2(): FloorDef {
  const W = 37;
  const H = 26;
  const g = new Grid(W, H);
  g.fill(1, 19, 6, 24); // maintenance bay
  g.fill(7, 20, 7, 21);
  g.fill(8, 3, 30, 22); // server hall
  g.fill(31, 11, 31, 12); // door cells
  g.fill(32, 7, 34, 16); // vault
  const grid = g.finish([rect(8, 2, 30, 2), rect(8, 23, 30, 23), rect(0, 18, 0, 25), rect(35, 6, 35, 17), rect(1, 25, 6, 25)]);
  const props: PropDef[] = [];
  racks(props, 11, 4, 12, 9);
  racks(props, 11, 13, 12, 21);
  racks(props, 17, 4, 18, 9);
  racks(props, 17, 13, 18, 21);
  racks(props, 23, 4, 24, 9);
  racks(props, 23, 13, 24, 21);
  props.push(
    { t: "crate", x: 2.2, z: 20.4, w: 0.9, d: 0.9, h: 0.9 },
    { t: "crate", x: 2.2, z: 21.4, w: 0.9, d: 0.9, h: 0.9 },
    { t: "desk", x: 4.6, z: 23.2, w: 2.2, d: 1.0, h: 0.85, rot: 0 },
    { t: "ac", x: 28.6, z: 3.8, w: 1.1, d: 0.7, h: 1.2 },
    { t: "ac", x: 29.6, z: 21.2, w: 1.1, d: 0.7, h: 1.2 },
    { t: "pillar", x: 9, z: 12, w: 0.8, d: 0.8, h: 4.4 },
    { t: "pillar", x: 29, z: 6, w: 0.8, d: 0.8, h: 4.4 },
    { t: "pillar", x: 29, z: 17, w: 0.8, d: 0.8, h: 4.4 },
    { t: "desk", x: 33, z: 9.2, w: 1.6, d: 0.9, h: 0.85, rot: 90 },
  );
  const signs: SignDef[] = [
    { text: "SERVER FARM", sub: "HALDEN COMPUTE · LEVEL 48", x: 14.5, z: 3.05, y: 3.3, face: 90, w: 6, h: 1.2, color: "#35f0ff" },
    { text: "VAULT 48-A", sub: "BADGE REQUIRED", x: 30.9, z: 9.8, y: 3.0, face: 180, w: 2.6, h: 0.8, color: "#fb7185" },
    { text: "MAINTENANCE", sub: "BAY 3", x: 3.5, z: 19.05, y: 2.8, face: 90, w: 2.6, h: 0.7, color: "#ffb547" },
  ];
  return {
    n: 2,
    id: "servers",
    code: "48F",
    name: "SERVER FARM",
    tagline: "Patrol robots in the aisles. Ride one through a badge door.",
    teaches: "RIDE ROBOTS",
    par: 200,
    parHacks: 3,
    theme: {
      name: "servers",
      sky: 0x050a14,
      hemiSky: 0x6aa8ff,
      hemiGround: 0x101c30,
      hemiI: 0.85,
      accent: 0x35f0ff,
      accent2: 0xfb7185,
      lightCol: 0xa8d4ff,
      lightI: 1.0,
      floorCol: "#141a24",
      floorKind: "raised",
      wallCol: "#1d2430",
      ceilCol: "#0d1118",
      altitude: 190,
      fog: 0x061426,
    },
    W,
    H,
    grid,
    ceil: (x, z) => (x >= 8 && x <= 30 && z >= 3 && z <= 22 ? 4.6 : 3.6),
    start: [2.5, 21.5],
    startYaw: 0,
    core: [33.0, 14.5],
    extract: [34.3, 9.6],
    extractFace: 0,
    extractPane: [35, 9],
    cams: [
      { id: "c1", x: 8.4, z: 3.5, y: 4.2, yaw: 48, sweep: 34, period: 8, range: 22, fov: 26 },
      { id: "c2", x: 27.6, z: 21.6, y: 4.2, yaw: 252, sweep: 26, period: 7, range: 20, fov: 26, phase: 0.4 },
      { id: "c3", x: 32.5, z: 16.4, y: 3.2, yaw: 272, sweep: 36, period: 6.5, range: 16, fov: 26, phase: 0.1 },
    ],
    robots: [
      { id: "r1", route: [[9.5, 11.5], [29.5, 11.5]], speed: 1.9, pause: 1.6, mode: "pingpong" },
      { id: "r2", route: [[14.5, 4.5], [14.5, 20.5], [20.5, 20.5], [20.5, 4.5]], speed: 1.7, pause: 0.8, mode: "loop", start: 1 },
      { id: "r3", route: [[27.5, 5.5], [27.5, 17.5]], speed: 1.5, pause: 2.2, mode: "pingpong" },
    ],
    lasers: [],
    junctions: [],
    doors: [{ id: "vault", cells: [[31, 11], [31, 12]], axis: "z" }],
    scanners: [{ id: "scan", a: [32.0, 11], b: [32.0, 13] }],
    chargers: [
      { x: 1.2, z: 22.5, face: 0 },
      { x: 8.2, z: 5.5, face: 0 },
      { x: 30.8, z: 20, face: 180 },
    ],
    checkpoints: [[9.5, 20.5], [24.5, 11.5]],
    props,
    signs,
    lights: [],
    objectives: ["Cross the server hall", "Hack a robot and ride it to the vault door", "Download the core", "Exfiltrate through the window"],
    hints: [
      { at: [9, 20.5], r: 3, text: "Racks block sight lines — fly low behind them. Robots are hackable too", once: "rack" },
      { at: [26, 11.5], r: 4, text: "Hack a robot (HOLD E) to RIDE it. Riders open badge doors", once: "ride" },
    ],
    solution: [
      // along the south windows, jack c2, ride r3 from its feed through the badge door past the scanner
      { go: [2.5, 21.5, 1.0] },
      { go: [7.5, 21.0, 1.0] },
      { go: [9.5, 22.4, 0.8] },
      { go: [24.6, 22.4, 0.8] },
      { near: ["r3", 27.5, 6, 1.2] },
      { near: ["r3", 27.5, 12.5, 0.8] },
      { hack: "c2" },
      { hack: "r3" },
      { go: [27.5, 11.5] },
      { go: [30.2, 11.6] },
      { go: [33.0, 12.0] },
      { go: [33.0, 13.0] },
      { exit: true },
      { wait: 0.3 },
      { hack: "c3" },
      { exit: true },
      { go: [34.4, 13.4, 1.3], fast: true },
      { until: "core" },
      { go: [34.3, 9.6, 1.2], fast: true },
      { until: "done" },
    ],
  };
}

// =====================================================================================================
// FLOOR 3 — THE CORE / 96F
// =====================================================================================================
function floor3(): FloorDef {
  const W = 40;
  const H = 28;
  const g = new Grid(W, H);
  g.fill(1, 11, 6, 16); // arrival suite
  g.fill(7, 12, 7, 14);
  g.fill(8, 4, 28, 23, "a"); // atrium
  g.fill(8, 12, 28, 14, "."); // glass bridge deck
  g.fill(29, 12, 29, 14); // laser doorway
  g.fill(30, 9, 37, 18); // executive suite
  // north service corridor
  g.fill(3, 1, 4, 10);
  g.fill(5, 1, 34, 2);
  g.fill(35, 1, 36, 2);
  g.fill(35, 3, 36, 5);
  g.fill(35, 6, 36, 6); // badge door row
  g.fill(35, 7, 36, 8);
  // south vent
  const v: V2[] = [];
  for (let z = 17; z <= 25; z++) v.push([3, z]);
  for (let x = 4; x <= 36; x++) v.push([x, 25]);
  for (let z = 19; z <= 24; z++) v.push([36, z]);
  g.cells(v, "~");
  const grid = g.finish([rect(0, 10, 0, 17), rect(5, 0, 34, 0), rect(8, 3, 28, 3), rect(8, 24, 28, 24), rect(38, 8, 38, 19), rect(30, 8, 34, 8), rect(30, 19, 37, 19)]);
  const props: PropDef[] = [];
  for (const [x, z] of [[12, 8], [18, 8], [24, 8], [12, 19], [18, 19], [24, 19]]) props.push({ t: "pillar", x: x + 0.5, z: z + 0.5, w: 1.1, d: 1.1, h: 12 });
  props.push(
    { t: "desk", x: 3.4, z: 13.4, w: 2.4, d: 1.1, h: 0.85, rot: 90 },
    { t: "sofa", x: 5.4, z: 15.2, w: 2.2, d: 0.9, h: 0.8, rot: 0, c: "#2a1a30" },
    { t: "plant", x: 1.6, z: 15.4, w: 0.9, d: 0.9, h: 1.4 },
    { t: "table", x: 33.6, z: 11.0, w: 3.2, d: 1.2, h: 0.75 },
    { t: "table", x: 33.6, z: 16.4, w: 3.2, d: 1.2, h: 0.75 },
    { t: "sofa", x: 31.4, z: 17.4, w: 2.2, d: 0.9, h: 0.8, rot: 0, c: "#2a1a30" },
    { t: "plant", x: 37, z: 9.6, w: 0.9, d: 0.9, h: 1.4 },
    { t: "plant", x: 30.8, z: 9.8, w: 0.9, d: 0.9, h: 1.4 },
    { t: "crate", x: 9.4, z: 22.4, w: 0.9, d: 0.9, h: 0.9 },
  );
  const signs: SignDef[] = [
    { text: "EXECUTIVE FLOOR", sub: "LEVEL 96 · HALDEN CORP", x: 2.1, z: 11.05, y: 2.8, face: 90, w: 4.4, h: 1.0, color: "#fb7185" },
    { text: "CORE ACCESS", sub: "CLEARANCE OMEGA", x: 30.0, z: 12.05, y: 3.35, face: 90, w: 3.8, h: 0.8, color: "#fb7185" },
  ];
  return {
    n: 3,
    id: "core",
    code: "96F",
    name: "THE CORE",
    tagline: "Lasers, cameras and robots over a glass atrium.",
    teaches: "COMBINE EVERYTHING",
    par: 260,
    parHacks: 5,
    theme: {
      name: "core",
      sky: 0x0a0410,
      hemiSky: 0xff8fb0,
      hemiGround: 0x241028,
      hemiI: 0.8,
      accent: 0xfb7185,
      accent2: 0xb06bff,
      lightCol: 0xffb6c8,
      lightI: 1.0,
      floorCol: "#0e0d14",
      floorKind: "gloss",
      wallCol: "#1f1626",
      ceilCol: "#0c0a12",
      altitude: 380,
      fog: 0x14081c,
    },
    W,
    H,
    grid,
    ceil: (x, z, ch) => (ch === "a" || (x >= 8 && x <= 28 && z >= 4 && z <= 23) ? 12 : 4.2),
    start: [2.5, 13.5],
    startYaw: 0,
    core: [34.0, 13.5],
    extract: [37.2, 13.5],
    extractFace: 0,
    extractPane: [38, 13],
    cams: [
      { id: "a1", x: 8.4, z: 4.4, y: 10.5, yaw: 40, sweep: 34, period: 9, range: 30, fov: 24 },
      { id: "a2", x: 28.4, z: 22.6, y: 10.5, yaw: 225, sweep: 34, period: 9, range: 30, fov: 24, phase: 0.5 },
      { id: "a3", x: 28.4, z: 4.4, y: 10.5, yaw: 150, sweep: 30, period: 8, range: 26, fov: 24, phase: 0.25 },
      { id: "s1", x: 30.4, z: 9.4, y: 3.8, yaw: 40, sweep: 30, period: 7, range: 16, fov: 26 },
      { id: "s2", x: 37.5, z: 17.6, y: 3.8, yaw: 222, sweep: 28, period: 6.5, range: 16, fov: 26, phase: 0.6 },
      { id: "n1", x: 18.5, z: 1.5, y: 3.4, yaw: 0, sweep: 14, period: 6, range: 14, fov: 24 },
    ],
    robots: [
      { id: "r1", route: [[9.5, 13.5], [27.5, 13.5]], speed: 1.8, pause: 1.4, mode: "pingpong" },
      { id: "r2", route: [[27.5, 13.5], [9.5, 13.5]], speed: 1.6, pause: 2.0, mode: "pingpong", start: 0 },
      { id: "r3", route: [[31.5, 16], [36, 16], [36, 10.5], [31.5, 10.5]], speed: 1.5, pause: 1.0, mode: "loop" },
      { id: "r4", route: [[26, 1.5], [34, 1.5]], speed: 1.4, pause: 1.8, mode: "pingpong" },
    ],
    lasers: [
      { id: "lA", a: [29.5, 12], b: [29.5, 15], y0: 0, y1: 4.2, box: "jA" },
      { id: "lN1", a: [11.5, 1], b: [11.5, 3], y0: 0, y1: 3.6, pulse: [2.0, 1.8, 0] },
      { id: "lN2", a: [23.5, 1], b: [23.5, 3], y0: 0, y1: 3.6, box: "jN" },
    ],
    junctions: [
      { id: "jA", x: 28.2, z: 10.2, y: 1.3, face: 0, off: 9 },
      { id: "jN", x: 20.5, z: 2.7, y: 1.3, face: 270, off: 9 },
    ],
    doors: [{ id: "north", cells: [[35, 6], [36, 6]], axis: "x" }],
    scanners: [],
    chargers: [
      { x: 1.2, z: 12.4, face: 0 },
      { x: 27.8, z: 12.2, face: 180 },
      { x: 34, z: 3.6, face: 90 },
      { x: 14, z: 25.45, face: 270 },
    ],
    checkpoints: [[7.5, 13.5], [28.6, 13.5], [34, 4.5]],
    props,
    signs,
    lights: [],
    objectives: ["Cross the atrium unseen", "Disable the laser door or find another route", "Download the core", "Exfiltrate through the executive window"],
    hints: [
      { at: [7.5, 13.5], r: 3, text: "Fly high: camera cones point down. Robots patrol the glass bridge", once: "bridge" },
      { at: [27, 11], r: 4, text: "Hack the junction box to cut the laser door for a few seconds", once: "laser" },
    ],
    solution: [
      // arrival suite -> south vent loop under the atrium -> executive suite -> core -> window
      { go: [2.5, 14.5, 0.8] },
      { go: [3.5, 16.0, 0.75] },
      { go: [3.5, 17.5, 0.7] },
      { go: [3.5, 25.5, 0.7] },
      { go: [36.5, 25.5, 0.7] },
      { go: [36.5, 19.5, 0.7] },
      { go: [36.5, 18.0, 0.9] },
      { hack: "s2" },
      { hack: "s1" },
      { exit: true },
      { wait: 0.4 },
      { go: [35.0, 15.5, 1.2] },
      { go: [34.0, 14.2, 1.3], fast: true },
      { until: "core" },
      { go: [37.2, 13.5, 1.3], fast: true },
      { until: "done" },
    ],
  };
}
void mid;
void TAU;

let cache: FloorDef[] | null = null;
export function floors(): FloorDef[] {
  if (!cache) cache = [floor1(), floor2(), floor3()];
  return cache;
}
export const GRADE_THRESH = { S: 6000, A: 4500, B: 3000 };
export function gradeOf(score: number) {
  return score >= GRADE_THRESH.S ? "S" : score >= GRADE_THRESH.A ? "A" : score >= GRADE_THRESH.B ? "B" : "C";
}

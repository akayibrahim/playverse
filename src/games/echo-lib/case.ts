/**
 * ECHO — Case 01 "The Councillor". Everything here is a pure function of loop time, so the
 * whole street can be rewound, scrubbed and replayed exactly.
 *
 * Coordinates match the District 07 boulevard used by LONGSHOT: road |x| < 6.2, sidewalks
 * |x| 7–9.5, the sniper nest at z ≈ 47 looking toward −z. The councillor speaks from a holo-stage
 * on the closed road at z ≈ −5; the crowd gathers between z 1 and 9.
 */

export const LOOP = 90;
export const KILL_T = 85;
export const AIM_T = 82.4;

/** [time, x, z, facing?] — piecewise-linear; facing (radians, 0 = +z) only for standing keys. */
export type Key = [number, number, number, number?];

export type Role = "vip" | "guard" | "suspect" | "courier" | "civ" | "crowd";

export type Actor = {
  id: string;
  role: Role;
  coat: number;
  coatName: string;
  /** LED rim colour of the umbrella (null = none) */
  rim: number | null;
  rimName?: string;
  /** umbrella folded away from this time on */
  umbrellaUntil?: number;
  keys: Key[];
  visor?: number;
};

export type ClueEvent = {
  id: string;
  title: string;
  t0: number;
  t1: number;
  actors: string[];
  place: string;
  text: string;
  hint: string;
};

const RED = 0xff3b4e;
const S = Math.PI; // facing toward −z (the stage / far end)
const N = 0; // facing +z (toward the nest)

export const CASE_TITLE = "THE COUNCILLOR";

export const ACTORS: Actor[] = [
  {
    id: "vip",
    role: "vip",
    coat: 0xd8d2c4,
    coatName: "IVORY COAT",
    rim: null,
    visor: 0xffd27a,
    keys: [
      [0, 0.2, -72],
      [36, 0.2, -72],
      [63, 0, -6.2],
      [64.5, 0, -5.6, N],
      [LOOP, 0, -5.6, N],
    ],
  },
  {
    id: "g1",
    role: "guard",
    coat: 0x23262c,
    coatName: "GUARD",
    rim: null,
    keys: [
      [0, -1.6, -73.2],
      [36, -1.6, -73.2],
      [63, -1.6, -7.4],
      [65, -2.4, -6.6, N],
      [LOOP, -2.4, -6.6, N],
    ],
  },
  {
    id: "g2",
    role: "guard",
    coat: 0x23262c,
    coatName: "GUARD",
    rim: null,
    keys: [
      [0, 1.7, -73.2],
      [36, 1.7, -73.2],
      [63, 1.7, -7.4],
      [65, 2.5, -6.6, N],
      [LOOP, 2.5, -6.6, N],
    ],
  },
  {
    // the assassin
    id: "olive",
    role: "suspect",
    coat: 0x5f6a3a,
    coatName: "OLIVE COAT",
    rim: RED,
    rimName: "RED",
    umbrellaUntil: 44,
    keys: [
      [0, 8.0, 18],
      [23.6, 8.4, -4.6],
      [27.4, 8.4, -4.6, S],
      [40, 9.0, 5.6],
      [50.5, 9.0, 5.6, -Math.PI / 2],
      [62, 4.4, 3.4],
      [62.8, 4.4, 3.4, S],
      [86.2, 4.4, 3.4, S],
      [90, 8.6, -4.5],
    ],
  },
  {
    // second link in the chain
    id: "navy",
    role: "suspect",
    coat: 0x24324f,
    coatName: "NAVY COAT",
    rim: RED,
    rimName: "RED",
    keys: [
      [0, -8.4, -3],
      [12.8, -7.9, -27.0],
      [15.2, -7.9, -27.0, Math.PI / 2],
      [25.4, 7.6, -5.6],
      [26.8, 7.6, -5.6, Math.PI / 2],
      [75, 8.2, -62],
      [LOOP, 8.2, -62],
    ],
  },
  {
    // walks through the first handoff — the obvious wrong answer
    id: "maroon",
    role: "suspect",
    coat: 0x5a2630,
    coatName: "MAROON COAT",
    rim: RED,
    rimName: "RED",
    keys: [
      [0, -7.3, -13.5],
      [56, -7.3, -70],
      [LOOP, -7.3, -70],
    ],
  },
  {
    // the red herring: bolts for the stage, then just films it
    id: "tan",
    role: "suspect",
    coat: 0x8a6e4a,
    coatName: "TAN COAT",
    rim: RED,
    rimName: "RED",
    keys: [
      [0, -8.7, 12, -Math.PI / 2],
      [51.5, -8.7, 12, -Math.PI / 2],
      [55.6, -3.0, 6.6],
      [56.4, -3.0, 6.6, S],
      [LOOP, -3.0, 6.6, S],
    ],
  },
  {
    id: "courier",
    role: "courier",
    coat: 0x3c3f44,
    coatName: "LONG GREY COAT",
    rim: null,
    keys: [
      [0, -7.7, -50],
      [12.6, -7.7, -28.4],
      [15.6, -7.7, -28.4, Math.PI / 2],
      [52, -7.9, 18],
      [62, -8.0, 36],
      [LOOP, -8.0, 36],
    ],
  },
];

/** Who has the amber case when. After 48 s it lies under the awning. */
export const CASE_HOLDERS: Array<[number, string]> = [
  [0, "courier"],
  [14.4, "navy"],
  [26.1, "olive"],
  [48, "ground"],
];
export const CASE_GROUND: [number, number] = [9.35, 6.3];
export const PISTOL_FROM = 48;

export const EVENTS: ClueEvent[] = [
  {
    id: "handoff",
    title: "THE HANDOFF",
    t0: 12.2,
    t1: 16.2,
    actors: ["courier", "navy"],
    place: "NORTH LAMP · LEFT SIDEWALK",
    text: "The grey-coated courier passes an amber case to someone with a RED umbrella — a NAVY coat.",
    hint: "Something changes hands at the left-side lamp, about 0:12.",
  },
  {
    id: "switch",
    title: "THE SWITCH",
    t0: 24.6,
    t1: 27.6,
    actors: ["navy", "olive"],
    place: "ALLEY MOUTH · RIGHT SIDE",
    text: "NAVY coat crosses the road and hands the case on at the alley mouth — to an OLIVE coat, also under a red umbrella.",
    hint: "The case moves again by the right-side alley, around 0:25.",
  },
  {
    id: "awning",
    title: "UNDER THE AWNING",
    t0: 43.4,
    t1: 49.5,
    actors: ["olive"],
    place: "RIGHT SIDEWALK · NEON AWNING",
    text: "OLIVE coat folds the umbrella, opens the case and pockets something compact and dark. The case is left behind.",
    hint: "Someone stops under the right-side awning around 0:45.",
  },
  {
    id: "runner",
    title: "THE RUNNER",
    t0: 51.4,
    t1: 57,
    actors: ["tan"],
    place: "LEFT SIDEWALK → STAGE",
    text: "A TAN coat with a red umbrella sprints for the stage… and then just stands filming it. Jumpy — or a fan?",
    hint: "Someone breaks into a run toward the stage near 0:52.",
  },
  {
    id: "aim",
    title: "THE SHOT",
    t0: AIM_T,
    t1: KILL_T,
    actors: ["olive"],
    place: "CROWD · RIGHT OF THE STAGE",
    text: "A raised arm in the crowd, right of the stage. OLIVE coat — umbrella gone — fires at 1:25.",
    hint: "Watch the crowd right before 1:25.",
  },
];

/** Bystanders: deterministic sidewalk walkers + people who gather for the speech. */
const PALETTE_RIM = [0x35f0ff, 0xff3fc8, 0xffb547, 0x9a5cff, 0x7dffb0];
const RIM_NAMES = ["CYAN", "PINK", "AMBER", "VIOLET", "GREEN"];
const COATS: Array<[number, string]> = [
  [0x4a3c2f, "BROWN COAT"],
  [0x2f3a4a, "SLATE COAT"],
  [0x5c5f63, "GREY COAT"],
  [0x3d2c3a, "PLUM COAT"],
  [0x22303a, "TEAL COAT"],
  [0x6b5a45, "CAMEL COAT"],
  [0x1e1f24, "BLACK COAT"],
  [0x4b4f3a, "KHAKI COAT"],
];

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildBystanders(count: number, crowd: number): Actor[] {
  const r = mulberry(9001);
  const out: Actor[] = [];
  for (let i = 0; i < count; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (7.2 + r() * 1.7);
    const dir = r() < 0.5 ? 1 : -1;
    const speed = 0.95 + r() * 0.45;
    const z0 = dir > 0 ? -70 + r() * 40 : 38 - r() * 40;
    const z1 = Math.max(-72, Math.min(40, z0 + dir * speed * LOOP));
    const tEnd = Math.abs(z1 - z0) / speed;
    const [coat, coatName] = COATS[Math.floor(r() * COATS.length)];
    const ri = Math.floor(r() * PALETTE_RIM.length);
    const umb = r() < 0.8;
    const keys: Key[] = [[0, x, z0]];
    // some stop at a shop front for a few seconds
    if (r() < 0.35 && tEnd > 30) {
      const tm = 10 + r() * (tEnd - 25);
      const zm = z0 + dir * speed * tm;
      keys.push([tm, x, zm], [tm + 5 + r() * 6, x, zm, side < 0 ? -Math.PI / 2 : Math.PI / 2]);
      const t2 = keys[keys.length - 1][0];
      const rem = LOOP - t2;
      const z2 = Math.max(-72, Math.min(40, zm + dir * speed * rem));
      keys.push([t2 + Math.abs(z2 - zm) / speed, x, z2]);
    } else keys.push([Math.min(LOOP, tEnd), x, z1]);
    if (keys[keys.length - 1][0] < LOOP) keys.push([LOOP, keys[keys.length - 1][1], keys[keys.length - 1][2]]);
    out.push({ id: `b${i}`, role: "civ", coat, coatName, rim: umb ? PALETTE_RIM[ri] : null, rimName: umb ? RIM_NAMES[ri] : undefined, keys });
  }
  // the audience: arrive 48–62 s, watch, scatter after the shot
  for (let i = 0; i < crowd; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    let tx = -4.6 + col * 2.2 + (r() - 0.5) * 0.8;
    const tz = 1.6 + row * 1.9 + (r() - 0.5) * 0.6;
    if (Math.abs(tx - 4.4) < 1.0 && Math.abs(tz - 3.4) < 1.0) tx -= 1.4; // leave the assassin's spot
    const fromSide = tx < 0 ? -1 : 1;
    const sx = fromSide * 8 + (r() - 0.5);
    const sz = tz + 8 + r() * 18;
    const tArrive = 50 + r() * 12;
    const walk = Math.hypot(tx - sx, tz - sz) / 1.2;
    const [coat, coatName] = COATS[Math.floor(r() * COATS.length)];
    const ri = Math.floor(r() * PALETTE_RIM.length);
    const umb = r() < 0.65;
    const fx = tx + fromSide * (7 + r() * 4);
    const fz = tz + 10 + r() * 14;
    out.push({
      id: `c${i}`,
      role: "crowd",
      coat,
      coatName,
      rim: umb ? PALETTE_RIM[ri] : null,
      rimName: umb ? RIM_NAMES[ri] : undefined,
      keys: [
        [0, sx, sz, fromSide < 0 ? Math.PI / 2 : -Math.PI / 2],
        [tArrive - walk, sx, sz, fromSide < 0 ? Math.PI / 2 : -Math.PI / 2],
        [tArrive, tx, tz],
        [tArrive + 0.6, tx, tz, S + (r() - 0.5) * 0.4],
        [KILL_T + 0.5 + r() * 0.6, tx, tz, S],
        [KILL_T + 4.5, fx, fz],
        [LOOP, fx, fz],
      ],
    });
  }
  return out;
}

/** Sampled state of an actor at loop time t. */
export function sampleKeys(keys: Key[], t: number) {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= t) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const span = Math.max(1e-6, b[0] - a[0]);
  const k = Math.max(0, Math.min(1, (t - a[0]) / span));
  const x = a[1] + (b[1] - a[1]) * k;
  const z = a[2] + (b[2] - a[2]) * k;
  const dx = b[1] - a[1];
  const dz = b[2] - a[2];
  const segLen = Math.hypot(dx, dz);
  const speed = t >= a[0] && t <= b[0] ? segLen / span : 0;
  let face: number;
  if (speed > 0.05) face = Math.atan2(dx, dz);
  else {
    // explicit facing on the key, else the last walking direction
    face = (b[3] ?? a[3]) as number;
    if (face === undefined || Number.isNaN(face)) {
      let j = i;
      face = 0;
      while (j > 0) {
        const p = keys[j - 1];
        const q = keys[j];
        if (Math.hypot(q[1] - p[1], q[2] - p[2]) > 0.05) {
          face = Math.atan2(q[1] - p[1], q[2] - p[2]);
          break;
        }
        j--;
      }
    }
  }
  // distance walked so far (drives the walk-cycle phase deterministically)
  let dist = 0;
  for (let j = 0; j < i; j++) dist += Math.hypot(keys[j + 1][1] - keys[j][1], keys[j + 1][2] - keys[j][2]);
  dist += segLen * k;
  return { x, z, speed, face, dist };
}

export function caseHolderAt(t: number) {
  let h = CASE_HOLDERS[0][1];
  for (const [tt, who] of CASE_HOLDERS) if (t >= tt) h = who;
  return h;
}

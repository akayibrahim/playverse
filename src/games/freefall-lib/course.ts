/**
 * FREEFALL: seeded course generation (pure data, no THREE). Same seed → identical course.
 *
 * A descending centre line (the "ideal dive") is integrated from the Spire lip down to the landing pad.
 * Rings sit on that line; the city is a grid of towers whose heights obey the line: sparse spires up
 * high, a walled canyon in the middle, an open street canyon at the bottom. Props (bridges, billboards,
 * cranes, maglev, traffic, drone swarms) are generated per chunk on demand.
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
export function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Axis-aligned-in-local-space box with a yaw (for bridges, billboards). */
export type Box = {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  c: number; // cos(yaw)
  s: number; // sin(yaw)
};
export type Ring = { x: number; y: number; z: number; tx: number; ty: number; tz: number; r: number; i: number; s: number };
export type Tower = { x: number; z: number; w: number; d: number; h: number; chunk: number; sign: number; face: number };

export const START_Y = 1990;
export const SPIRE_HALF = 30;
export const CHUNK_SAMPLES = 24; // 240 m of path per chunk
export const DS = 10;

export type Course = {
  seed: number;
  psi0: number;
  start: { x: number; y: number; z: number; psi: number };
  spire: { cx: number; cz: number; half: number; top: number };
  N: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  plen: number;
  rings: Ring[];
  pad: { x: number; z: number; r: number };
  towers: Tower[];
  chunkCount: number;
  corridor: (i: number) => number;
};

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function boxOf(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0): Box {
  return { cx, cy, cz, hx, hy, hz, c: Math.cos(yaw), s: Math.sin(yaw) };
}

/** Signed distance from a point to a (yawed) box surface. Negative = inside. */
export function boxDist(b: Box, x: number, y: number, z: number): number {
  const dx = x - b.cx;
  const dz = z - b.cz;
  const lx = dx * b.c - dz * b.s;
  const lz = dx * b.s + dz * b.c;
  const ly = y - b.cy;
  const qx = Math.abs(lx) - b.hx;
  const qy = Math.abs(ly) - b.hy;
  const qz = Math.abs(lz) - b.hz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const out = Math.hypot(ox, oy, oz);
  return out > 0 ? out : Math.max(qx, qy, qz);
}

export function generateCourse(seed: number): Course {
  const rng = mulberry32(seed ^ 0x51f15e);
  const psi0 = Math.floor(rng() * 4) * (Math.PI / 2);
  const A1 = 0.75 + rng() * 0.4;
  const L1 = 560 + rng() * 300;
  const P1 = rng() * 6.28;
  const A2 = 0.14 + rng() * 0.2;
  const L2 = 240 + rng() * 120;
  const P2 = rng() * 6.28;
  const sgn = rng() < 0.5 ? -1 : 1;

  // spire + start point
  const f0x = Math.sin(psi0);
  const f0z = -Math.cos(psi0);
  const spire = { cx: -f0x * SPIRE_HALF, cz: -f0z * SPIRE_HALF, half: SPIRE_HALF, top: START_Y };
  const sx = f0x * 5;
  const sz = f0z * 5;

  // ----- centre line
  const xs: number[] = [sx];
  const ys: number[] = [START_Y + 1];
  const zs: number[] = [sz];
  let x = sx;
  let y = START_Y + 1;
  let z = sz;
  let l = 0;
  let guard = 0;
  while (y > 0.5 && guard++ < 2000) {
    const fade = sstep(40, 320, y); // heading settles into the final approach
    const psi = psi0 + sgn * fade * (A1 * Math.sin(l / L1 + P1) + A2 * Math.sin(l / L2 + P2) - A1 * Math.sin(P1) - A2 * Math.sin(P2)) ;
    // horizontal metres per metre of drop: steep in the upper spires, long canyon, short street
    const ratio = 1.05 + 0.55 * sstep(1200, 900, y) - 0.4 * sstep(420, 230, y);
    x += Math.sin(psi) * DS;
    z += -Math.cos(psi) * DS;
    y -= DS / ratio;
    l += DS;
    xs.push(x);
    ys.push(Math.max(0, y));
    zs.push(z);
  }
  const N = xs.length;
  const px = Float32Array.from(xs);
  const py = Float32Array.from(ys);
  const pz = Float32Array.from(zs);
  const pad = { x: px[N - 1], z: pz[N - 1], r: 27 };

  // cumulative length
  const cum = new Float32Array(N);
  for (let i = 1; i < N; i++) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1], pz[i] - pz[i - 1]);
  const plen = cum[N - 1];

  // ----- rings
  const rings: Ring[] = [];
  const spacing = 92;
  const lastRingS = plen - 150;
  let ri = 0;
  for (let s = 100; s <= lastRingS; s += spacing) {
    let i = 1;
    while (i < N - 1 && cum[i] < s) i++;
    const a = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const rx = px[i - 1] + (px[i] - px[i - 1]) * a;
    const ry = py[i - 1] + (py[i] - py[i - 1]) * a;
    const rz = pz[i - 1] + (pz[i] - pz[i - 1]) * a;
    const j = Math.min(N - 1, i + 1);
    let tx = px[j] - px[i - 1];
    let ty = py[j] - py[i - 1];
    let tz = pz[j] - pz[i - 1];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const prog = s / plen;
    rings.push({ x: rx, y: ry, z: rz, tx, ty, tz, r: 15 - prog * 6.5, i: ri++, s });
  }

  // corridor half-width by sample
  const corridor = (i: number) => {
    const yy = py[Math.min(N - 1, Math.max(0, i))];
    if (yy > 1150) return 95;
    if (yy > 300) return 52 + 14 * Math.sin(i * 0.13 + P1);
    return 36 + 18 * sstep(120, 0, yy);
  };

  // ----- towers on a grid, filtered against the centre line
  const towers: Tower[] = [];
  let minX = 1e9;
  let maxX = -1e9;
  let minZ = 1e9;
  let maxZ = -1e9;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, px[i]);
    maxX = Math.max(maxX, px[i]);
    minZ = Math.min(minZ, pz[i]);
    maxZ = Math.max(maxZ, pz[i]);
  }
  const PAD = 650;
  const CELL = 46;
  const x0 = Math.floor((minX - PAD) / CELL) * CELL;
  const x1 = maxX + PAD;
  const z0 = Math.floor((minZ - PAD) / CELL) * CELL;
  const z1 = maxZ + PAD;
  const chunkCount = Math.ceil(N / CHUNK_SAMPLES);
  for (let gx = x0; gx <= x1; gx += CELL) {
    for (let gz = z0; gz <= z1; gz += CELL) {
      const r = mulberry32(hash2(Math.round(gx) + seed, Math.round(gz) ^ seed));
      const cx = gx + (r() - 0.5) * 8;
      const cz = gz + (r() - 0.5) * 8;
      const w = 18 + r() * 18;
      const d = 18 + r() * 18;
      // keep the spire clear
      if (Math.abs(cx - spire.cx) < SPIRE_HALF + w * 0.5 + 6 && Math.abs(cz - spire.cz) < SPIRE_HALF + d * 0.5 + 6) continue;
      // nearest centre-line sample
      let best = 1e12;
      let bi = 0;
      for (let i = 0; i < N; i++) {
        const dd = (px[i] - cx) * (px[i] - cx) + (pz[i] - cz) * (pz[i] - cz);
        if (dd < best) {
          best = dd;
          bi = i;
        }
      }
      const dist = Math.sqrt(best);
      const yp = py[bi];
      const cor = corridor(bi) + Math.max(w, d) * 0.55;
      const roll = r();
      const roll2 = r();
      const roll3 = r();
      // skyline noise (big, slow) + local variance
      const sk = 0.5 + 0.5 * Math.sin(cx * 0.0031 + P1) * Math.cos(cz * 0.0027 + P2);
      let h = 24 + 260 * roll * roll * (0.55 + sk) + 40 * roll2;
      const padD = Math.hypot(cx - pad.x, cz - pad.z);
      if (padD < 78) continue; // plaza
      if (dist < cor) {
        if (yp < 270) continue; // open street
        h = Math.min(h, yp - 20 - roll2 * 20);
        if (h < 12) continue;
      } else if (dist < cor + 80 && yp < 1200 && yp > 25) {
        // canyon wall
        h = Math.max(h, yp + 38 + roll2 * 150 * (0.5 + sk));
      } else if (yp > 1100 && dist > cor + 12 && roll3 < (dist < 420 ? 0.22 : 0.07)) {
        // supertall spires piercing the cloud deck around the upper dive
        // flanking spires may rise above the dive line, close ones stay below it; none block the jump view
        h = Math.max(h, yp - 330 + roll2 * 400);
        h = Math.min(h, dist < 240 ? yp - 45 : yp + 70, bi < 14 ? START_Y - 140 : 2060);
      } else if (yp > 1150) {
        h = Math.min(h, 220);
      }
      const spire2 = h > 700;
      const ww = spire2 ? 20 + r() * 12 : w;
      const dd2 = spire2 ? 20 + r() * 12 : d;
      const chunk = Math.min(chunkCount - 1, Math.floor(bi / CHUNK_SAMPLES));
      const sign = roll3 < 0.5 && dist < cor + 140 && h > 60 ? Math.floor(r() * 6) + 1 : 0;
      // face the sign toward the line
      const ddx = px[bi] - cx;
      const ddz = pz[bi] - cz;
      const face = Math.abs(ddx) > Math.abs(ddz) ? (ddx > 0 ? 0 : 1) : ddz > 0 ? 2 : 3;
      towers.push({ x: cx, z: cz, w: ww, d: dd2, h, chunk, sign, face });
    }
  }
  return {
    seed,
    psi0,
    start: { x: sx, y: START_Y, z: sz, psi: psi0 },
    spire,
    N,
    px,
    py,
    pz,
    plen,
    rings,
    pad,
    towers,
    chunkCount,
    corridor,
  };
}

// ------------------------------------------------------------------- chunk props
export type DarkPiece = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number };
export type NeonPiece = DarkPiece & { color: number };
export type HoloPiece = { x: number; y: number; z: number; w: number; h: number; ry: number; color: number; seed: number };
export type Lane = { x: number; y: number; z: number; dx: number; dz: number; len: number; speed: number; n: number; color: number; phase: number };
export type Swarm = { x: number; y: number; z: number; rad: number; n: number; speed: number; color: number; phase: number };
export type Train = { x: number; y: number; z: number; dx: number; dz: number; len: number; speed: number; cars: number; phase: number };
export type ChunkSpec = {
  index: number;
  dark: DarkPiece[];
  neon: NeonPiece[];
  holo: HoloPiece[];
  colliders: Box[];
  lanes: Lane[];
  swarms: Swarm[];
  trains: Train[];
};

const NEON = [0xff3fc8, 0x35f0ff, 0xffb547, 0x9a5cff, 0x7dffb0, 0x38bdf8];

export function genChunk(c: Course, index: number): ChunkSpec {
  const r = mulberry32(hash2(c.seed, 1000 + index));
  const spec: ChunkSpec = { index, dark: [], neon: [], holo: [], colliders: [], lanes: [], swarms: [], trains: [] };
  const i0 = index * CHUNK_SAMPLES;
  const i1 = Math.min(c.N - 1, i0 + CHUNK_SAMPLES - 1);
  const at = (i: number) => ({ x: c.px[i], y: c.py[i], z: c.pz[i] });
  const tangentYaw = (i: number) => {
    const a = Math.max(0, i - 2);
    const b = Math.min(c.N - 1, i + 2);
    return Math.atan2(c.px[b] - c.px[a], -(c.pz[b] - c.pz[a]));
  };
  const addBridge = (i: number, dy: number, hw: number) => {
    const p = at(i);
    const psi = tangentYaw(i);
    const ry = -psi; // box x-axis across the corridor: local x → world (cos ψ, sin ψ)
    const half = hw + 26;
    const y = p.y + dy;
    spec.dark.push({ x: p.x, y, z: p.z, sx: half * 2, sy: 5, sz: 12, ry });
    spec.neon.push({ x: p.x, y: y - 2.7, z: p.z, sx: half * 2 - 4, sy: 0.35, sz: 8, ry, color: NEON[Math.floor(r() * NEON.length)] });
    spec.neon.push({ x: p.x, y: y + 2.7, z: p.z, sx: half * 2 - 4, sy: 0.25, sz: 0.5, ry, color: 0x9fdcff });
    spec.colliders.push(boxOf(p.x, y, p.z, half, 2.5, 6, ry));
  };
  for (let k = 0; k < 2; k++) {
    const i = i0 + 4 + Math.floor(r() * (CHUNK_SAMPLES - 8));
    if (i >= c.N - 14) continue;
    const yp = c.py[i];
    if (yp > 1200 || yp < 200) continue;
    const hw = c.corridor(i);
    addBridge(i, (r() < 0.5 ? -1 : 1) * (30 + r() * 22), hw);
  }
  // billboards on the canyon walls
  for (let k = 0; k < 3; k++) {
    const i = i0 + Math.floor(r() * CHUNK_SAMPLES);
    if (i >= c.N - 10) continue;
    const yp = c.py[i];
    if (yp > 1200 || yp < 60) continue;
    const hw = c.corridor(i);
    const side = r() < 0.5 ? -1 : 1;
    const psi = tangentYaw(i);
    const rx = Math.cos(psi);
    const rz = Math.sin(psi);
    const off = side * (hw - 6);
    const x = c.px[i] + rx * off;
    const z = c.pz[i] + rz * off;
    const y = yp + (r() - 0.35) * 40;
    const ry = -psi;
    const w = 20 + r() * 10;
    const h = 11 + r() * 6;
    const color = NEON[Math.floor(r() * NEON.length)];
    spec.holo.push({ x, y, z, w, h, ry: ry + Math.PI / 2 + (side > 0 ? Math.PI : 0), color, seed: Math.floor(r() * 1000) });
    spec.colliders.push(boxOf(x, y, z, 0.7, h / 2, w / 2, ry));
    // frame strut under the panel
    spec.dark.push({ x, y: y - h / 2 - 1.2, z, sx: 1.2, sy: 2.4, sz: w * 0.8, ry });
  }
  // cranes on low roofs inside the corridor
  for (const t of c.towers) {
    if (t.chunk !== index || r() > 0.05) continue;
    const bi = Math.min(c.N - 1, i0 + Math.floor(CHUNK_SAMPLES / 2));
    void bi;
    const top = t.h;
    // only if clearly below the line nearby
    let nearest = 1e9;
    let yl = 0;
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(c.px[i] - t.x, c.pz[i] - t.z);
      if (d < nearest) {
        nearest = d;
        yl = c.py[i];
      }
    }
    if (nearest > c.corridor(i0) + 10 || yl - top < 70) continue;
    const mast = 34;
    spec.dark.push({ x: t.x, y: top + mast / 2, z: t.z, sx: 2.6, sy: mast, sz: 2.6, ry: 0 });
    spec.dark.push({ x: t.x + 9, y: top + mast + 1, z: t.z, sx: 34, sy: 1.8, sz: 1.8, ry: 0 });
    spec.neon.push({ x: t.x + 24, y: top + mast - 0.5, z: t.z, sx: 1, sy: 1, sz: 1, ry: 0, color: 0xff2a3c });
    spec.colliders.push(boxOf(t.x, top + mast / 2, t.z, 1.3, mast / 2, 1.3), boxOf(t.x + 9, top + mast + 1, t.z, 17, 0.9, 0.9));
  }
  // maglev line across the corridor + train
  {
    const i = i0 + 6 + Math.floor(r() * (CHUNK_SAMPLES - 12));
    const yp = c.py[Math.min(i, c.N - 1)];
    if (i < c.N - 20 && yp < 1100 && yp > 330 && r() < 0.75) {
      const p = at(i);
      const psi = tangentYaw(i);
      const hw = c.corridor(i);
      const dy = (r() < 0.5 ? -1 : 1) * (36 + r() * 30);
      const half = hw + 40;
      const ry = -psi;
      const dx = Math.cos(psi);
      const dz = Math.sin(psi);
      spec.dark.push({ x: p.x, y: p.y + dy, z: p.z, sx: half * 2, sy: 1.8, sz: 3.6, ry });
      spec.neon.push({ x: p.x, y: p.y + dy - 1.05, z: p.z, sx: half * 2, sy: 0.18, sz: 3.7, ry, color: 0x35f0ff });
      spec.colliders.push(boxOf(p.x, p.y + dy, p.z, half, 0.9, 1.8, ry));
      spec.trains.push({ x: p.x, y: p.y + dy + 2.9, z: p.z, dx, dz, len: half * 2, speed: 30 + r() * 20, cars: 4, phase: r() });
    }
  }
  // flying traffic lanes crossing the line
  for (let k = 0; k < 2; k++) {
    const i = i0 + 2 + Math.floor(r() * (CHUNK_SAMPLES - 4));
    if (i >= c.N - 6) continue;
    const p = at(i);
    if (p.y < 70) continue;
    const psi = tangentYaw(i);
    const dirSgn = r() < 0.5 ? 1 : -1;
    spec.lanes.push({
      x: p.x,
      y: p.y + (r() - 0.5) * 24,
      z: p.z,
      dx: Math.cos(psi) * dirSgn,
      dz: Math.sin(psi) * dirSgn,
      len: 320,
      speed: 26 + r() * 22,
      n: 9,
      color: NEON[Math.floor(r() * NEON.length)],
      phase: r(),
    });
  }
  // drone swarm orbiting near the line
  if (r() < 0.8) {
    const i = i0 + 3 + Math.floor(r() * (CHUNK_SAMPLES - 6));
    if (i < c.N - 8 && c.py[i] > 90) {
      const p = at(i);
      const psi = tangentYaw(i);
      const off = (r() < 0.5 ? -1 : 1) * (10 + r() * 14);
      spec.swarms.push({
        x: p.x + Math.cos(psi) * off,
        y: p.y + (r() - 0.5) * 12,
        z: p.z + Math.sin(psi) * off,
        rad: 16 + r() * 10,
        n: 16,
        speed: 0.7 + r() * 0.7,
        color: r() < 0.5 ? 0xff4d5c : 0xffb547,
        phase: r() * 6.28,
      });
    }
  }
  return spec;
}

/** Stable fingerprint of a course (determinism check). */
export function courseHash(c: Course): number {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => {
    h = Math.imul(h ^ (Math.round(v * 10) | 0), 16777619) >>> 0;
  };
  mix(c.N);
  for (const r of c.rings) {
    mix(r.x);
    mix(r.y);
    mix(r.z);
  }
  for (const t of c.towers) {
    mix(t.x);
    mix(t.z);
    mix(t.h);
  }
  for (let i = 0; i < c.chunkCount; i++) {
    const s = genChunk(c, i);
    mix(s.dark.length * 7 + s.colliders.length * 3 + s.holo.length);
    for (const b of s.colliders) mix(b.cx + b.cz + b.cy);
  }
  return h >>> 0;
}

export function dailySeed(d = new Date()): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

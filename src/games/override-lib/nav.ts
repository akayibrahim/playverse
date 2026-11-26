/** OVERRIDE — grid queries: collision heights, line of sight, robot pathfinding. */
import { CELL, type FloorDef, type PropDef, type V2 } from "./levels";

export const VENT_H = 1.3;
export const WALL = 99;
export type Box = { x0: number; x1: number; z0: number; z1: number; h: number };

/** world-space footprint of a prop, matching how world.ts draws it */
export function propBox(p: PropDef): Box | null {
  if (p.t === "screen" || p.t === "sign") return null;
  let w = (p.w ?? 1) * CELL;
  let d = (p.d ?? 1) * CELL;
  const h = p.h ?? 1;
  if (p.t === "desk") {
    w = Math.min(w, 2.4);
    d = Math.min(d, 1.1);
  } else if (p.t === "crate") w = d = 0.95;
  else if (p.t === "rack") w = d = CELL * 0.9;
  else if (p.t === "plant") w = d = 0.7;
  const rot = (((p.rot ?? 0) % 180) + 180) % 180;
  if (rot > 45 && rot < 135) [w, d] = [d, w];
  const x = p.x * CELL;
  const z = p.z * CELL;
  return { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h };
}

export class Nav {
  W: number;
  H: number;
  ch: string[];
  ceil: Float32Array;
  block: Float32Array; // prop blocker height (0 = none, WALL = full)
  doorAt = new Map<number, number>(); // cell index -> door index
  doorOpen: boolean[] = [];

  constructor(public def: FloorDef) {
    this.W = def.W;
    this.H = def.H;
    this.ch = def.grid;
    this.ceil = new Float32Array(this.W * this.H);
    this.block = new Float32Array(this.W * this.H);
    for (let z = 0; z < this.H; z++)
      for (let x = 0; x < this.W; x++) {
        const c = this.ch[z][x];
        this.ceil[z * this.W + x] = c === "~" ? VENT_H : this.isOpenCh(c) ? def.ceil(x, z, c) : 0;
        if (!this.isOpenCh(c)) this.block[z * this.W + x] = WALL;
      }
    for (const p of def.props) {
      // a prop blocks the cells whose central half it overlaps (keeps thin props from eating whole 2 m cells)
      const bx = propBox(p);
      if (!bx) continue;
      const q = CELL * 0.25;
      const x0 = Math.floor(bx.x0 / CELL);
      const x1 = Math.floor(bx.x1 / CELL);
      const z0 = Math.floor(bx.z0 / CELL);
      const z1 = Math.floor(bx.z1 / CELL);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          if (!this.inb(x, z)) continue;
          if (bx.x1 <= x * CELL + q || bx.x0 >= (x + 1) * CELL - q || bx.z1 <= z * CELL + q || bx.z0 >= (z + 1) * CELL - q) continue;
          this.block[z * this.W + x] = Math.max(this.block[z * this.W + x], bx.h);
        }
    }
    def.doors.forEach((d, i) => {
      this.doorOpen[i] = false;
      for (const [x, z] of d.cells) this.doorAt.set(z * this.W + x, i);
    });
    for (const p of def.props) {
      const b = propBox(p);
      if (b) this.boxes.push(b);
    }
  }
  /** real prop footprints in world metres (drone collision is exact; robots/LOS use the coarse cell grid) */
  boxes: Box[] = [];
  /** highest prop top under (x,z) that the drone (bottom at y) could rest on */
  groundAt(x: number, z: number, y: number, r = 0) {
    let g = 0;
    for (const b of this.boxes) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r && b.h > g && y >= b.h - 0.3) g = b.h;
    return g;
  }
  /** a closed door / wall cell (full height) */
  solidCell(x: number, z: number) {
    return !this.open(x, z) || this.hb(x, z) >= WALL;
  }
  isOpenCh(c: string) {
    return c === "." || c === "~" || c === "a";
  }
  inb(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.W && z < this.H;
  }
  open(x: number, z: number) {
    return this.inb(x, z) && this.isOpenCh(this.ch[z][x]);
  }
  vent(x: number, z: number) {
    return this.inb(x, z) && this.ch[z][x] === "~";
  }
  /** blocker height of a cell right now (doors included) */
  hb(x: number, z: number) {
    if (!this.inb(x, z)) return WALL;
    const i = z * this.W + x;
    const di = this.doorAt.get(i);
    if (di !== undefined && !this.doorOpen[di]) return WALL;
    return this.block[i];
  }
  ceilAtCell(x: number, z: number) {
    return this.inb(x, z) ? this.ceil[z * this.W + x] : 0;
  }
  ceilAt(wx: number, wz: number) {
    return this.ceilAtCell(Math.floor(wx / CELL), Math.floor(wz / CELL));
  }
  /** world point inside solid geometry? (used by camera collision) */
  solidAt(x: number, y: number, z: number) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    if (!this.open(cx, cz)) return true;
    if (y > this.ceilAtCell(cx, cz) - 0.05) return true;
    if (y < -0.05) return true;
    if (this.hb(cx, cz) >= WALL) return true;
    for (const b of this.boxes) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y < b.h) return true;
    return false;
  }
  /** line of sight between two world points (heights respected) */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const steps = Math.ceil(len / 0.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + dx * t;
      const z = az + dz * t;
      const y = ay + (by - ay) * t;
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      if (!this.open(cx, cz)) return false;
      if (this.hb(cx, cz) > y) return false;
      if (y > this.ceilAtCell(cx, cz) + 0.1) return false;
    }
    return true;
  }
  /** distance along a horizontal ray until a wall (for the cone fans) */
  rayDist(x: number, z: number, dx: number, dz: number, maxD: number, y = 1.4) {
    const step = 0.4;
    for (let d = step; d <= maxD; d += step) {
      const px = x + dx * d;
      const pz = z + dz * d;
      const cx = Math.floor(px / CELL);
      const cz = Math.floor(pz / CELL);
      if (!this.open(cx, cz) || this.hb(cx, cz) > y) return d - step * 0.5;
    }
    return maxD;
  }
  walkable(x: number, z: number) {
    if (!this.open(x, z) || this.vent(x, z)) return false;
    if (this.ch[z][x] === "a") return false;
    return this.block[z * this.W + x] < 0.01;
  }
  doorIndex(x: number, z: number) {
    return this.doorAt.get(z * this.W + x);
  }
  /** BFS over walkable cells (8-neighbour, no corner cutting). Returns waypoint list in cell units. */
  path(from: V2, to: V2, allowClosedDoors = false): V2[] | null {
    const sx = Math.floor(from[0]);
    const sz = Math.floor(from[1]);
    let tx = Math.floor(to[0]);
    let tz = Math.floor(to[1]);
    const ok = (x: number, z: number) => {
      if (!this.walkable(x, z)) return false;
      const di = this.doorAt.get(z * this.W + x);
      return di === undefined || this.doorOpen[di] || allowClosedDoors;
    };
    if (!ok(tx, tz)) {
      // nearest walkable
      let best = 1e9;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) if (ok(tx + dx, tz + dz) && dx * dx + dz * dz < best) {
          best = dx * dx + dz * dz;
          tx += 0;
          tz += 0;
          to = [tx + dx + 0.5, tz + dz + 0.5];
        }
      if (best >= 1e9) return null;
      tx = Math.floor(to[0]);
      tz = Math.floor(to[1]);
    }
    const W = this.W;
    const prev = new Int32Array(W * this.H).fill(-2);
    const q: number[] = [sz * W + sx];
    prev[sz * W + sx] = -1;
    const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let found = false;
    for (let qi = 0; qi < q.length && !found; qi++) {
      const c = q[qi];
      const cx = c % W;
      const cz = (c / W) | 0;
      for (const [dx, dz] of N8) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!ok(nx, nz) || prev[nz * W + nx] !== -2) continue;
        if (dx && dz && (!ok(cx + dx, cz) || !ok(cx, cz + dz))) continue;
        prev[nz * W + nx] = c;
        q.push(nz * W + nx);
        if (nx === tx && nz === tz) {
          found = true;
          break;
        }
      }
    }
    if (!found && !(sx === tx && sz === tz)) return null;
    const out: V2[] = [];
    let c = tz * W + tx;
    while (c >= 0 && prev[c] !== -2) {
      out.push([(c % W) + 0.5, ((c / W) | 0) + 0.5]);
      c = prev[c];
    }
    out.reverse();
    // keep exact destination
    if (out.length) out[out.length - 1] = [to[0], to[1]];
    return out;
  }
}

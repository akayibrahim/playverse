/** OVERRIDE — tiny geometry accumulator (quads, boxes, cylinders) used to merge the whole interior per material. */
import * as THREE from "three";

export class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  useColor = false;

  /** quad from centre + half-vectors u,v (normal = u × v). Optional explicit uv rect. */
  face(cx: number, cy: number, cz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, uv?: [number, number, number, number], c?: [number, number, number]) {
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const b = this.pos.length / 3;
    const [u0, v0, u1, v1] = uv ?? [0, 0, 1, 1];
    const pts: [number, number, number, number, number][] = [
      [cx - ux - vx, cy - uy - vy, cz - uz - vz, u0, v0],
      [cx + ux - vx, cy + uy - vy, cz + uz - vz, u1, v0],
      [cx + ux + vx, cy + uy + vy, cz + uz + vz, u1, v1],
      [cx - ux + vx, cy - uy + vy, cz - uz + vz, u0, v1],
    ];
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(p[3], p[4]);
      if (c) {
        this.col.push(c[0], c[1], c[2]);
        this.useColor = true;
      }
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  /** box centred at (cx,cy,cz), size (sx,sy,sz), rotated about Y (degrees) */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotDeg = 0, c?: [number, number, number]) {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const a = (rotDeg * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const R = (x: number, z: number): [number, number] => [x * ca + z * sa, -x * sa + z * ca];
    const f = (ox: number, oy: number, oz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number) => {
      const [rox, roz] = R(ox, oz);
      const [rux, ruz] = R(ux, uz);
      const [rvx, rvz] = R(vx, vz);
      this.face(cx + rox, cy + oy, cz + roz, rux, uy, ruz, rvx, vy, rvz, undefined, c);
    };
    f(hx, 0, 0, 0, 0, -hz, 0, hy, 0);
    f(-hx, 0, 0, 0, 0, hz, 0, hy, 0);
    f(0, hy, 0, hx, 0, 0, 0, 0, -hz);
    f(0, -hy, 0, hx, 0, 0, 0, 0, hz);
    f(0, 0, hz, hx, 0, 0, 0, hy, 0);
    f(0, 0, -hz, -hx, 0, 0, 0, hy, 0);
  }

  /** vertical cylinder (no caps below) */
  cyl(cx: number, cy: number, cz: number, r: number, h: number, seg = 12, rTop = r, caps = true, c?: [number, number, number]) {
    const b0 = this.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a);
      const z = Math.sin(a);
      for (const [rr, y, v] of [[r, 0, 0], [rTop, h, 1]] as const) {
        this.pos.push(cx + x * rr, cy + y, cz + z * rr);
        this.nor.push(x, 0, z);
        this.uv.push(i / seg, v);
        if (c) {
          this.col.push(c[0], c[1], c[2]);
          this.useColor = true;
        }
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = b0 + i * 2;
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    if (caps) {
      const bt = this.pos.length / 3;
      this.pos.push(cx, cy + h, cz);
      this.nor.push(0, 1, 0);
      this.uv.push(0.5, 0.5);
      if (c) this.col.push(c[0], c[1], c[2]);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        this.pos.push(cx + Math.cos(a) * rTop, cy + h, cz + Math.sin(a) * rTop);
        this.nor.push(0, 1, 0);
        this.uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
        if (c) this.col.push(c[0], c[1], c[2]);
      }
      for (let i = 0; i < seg; i++) this.idx.push(bt, bt + 2 + i, bt + 1 + i);
    }
  }

  get empty() {
    return this.idx.length === 0;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useColor && this.col.length === this.pos.length) g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

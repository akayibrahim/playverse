/**
 * Walk colliders for big kit structures: instead of the whole AABB (which walls off the open space
 * between truss legs), rasterise the triangles that exist at body height and merge them into boxes.
 */
import * as THREE from "three";

/** World-XZ occupancy of an object's triangles in the body-height slab, merged into boxes. */
export const FOOT_LO = 0.15;
export const FOOT_TOP = 2.1;
export function footprintBoxes(obj: THREE.Object3D, box: THREE.Box3) {
  const CELL = 0.25;
  const x0 = box.min.x - CELL;
  const z0 = box.min.z - CELL;
  const nx = Math.ceil((box.max.x - box.min.x) / CELL) + 3;
  const nz = Math.ceil((box.max.z - box.min.z) / CELL) + 3;
  const grid = new Uint8Array(nx * nz);
  const mark = (x: number, z: number) => {
    const i = Math.floor((x - x0) / CELL);
    const k = Math.floor((z - z0) / CELL);
    if (i >= 0 && k >= 0 && i < nx && k < nz) grid[k * nx + i] = 1;
  };
  const seg = (ax: number, az: number, bx: number, bz: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.4)));
    for (let s = 0; s <= n; s++) mark(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n);
  };
  const levels = [0.3, 0.7, 1.1, 1.5, 1.9];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const tri = [a, b, c];
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const idx = mesh.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      for (let v = 0; v < 3; v++) tri[v].fromBufferAttribute(pos, idx ? idx.getX(t + v) : t + v).applyMatrix4(mesh.matrixWorld);
      const lo = Math.min(a.y, b.y, c.y);
      const hi = Math.max(a.y, b.y, c.y);
      if (hi < FOOT_LO || lo > FOOT_TOP) continue;
      if (lo >= FOOT_LO && hi <= FOOT_TOP) {
        // wholly inside the slab: fill it (edges + a few interior rows)
        seg(a.x, a.z, b.x, b.z);
        seg(b.x, b.z, c.x, c.z);
        seg(c.x, c.z, a.x, a.z);
        const n = Math.ceil(Math.max(a.distanceTo(b), a.distanceTo(c)) / (CELL * 0.5));
        for (let s = 1; s < n; s++) {
          const f = s / n;
          seg(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, a.x + (c.x - a.x) * f, a.z + (c.z - a.z) * f);
        }
        continue;
      }
      // straddles the slab: slice it at a few heights
      for (const L of levels) {
        if (L < lo || L > hi) continue;
        const pts: number[] = [];
        for (let e = 0; e < 3; e++) {
          const p = tri[e];
          const q = tri[(e + 1) % 3];
          if ((p.y - L) * (q.y - L) > 0 || p.y === q.y) continue;
          const f = (L - p.y) / (q.y - p.y);
          pts.push(p.x + (q.x - p.x) * f, p.z + (q.z - p.z) * f);
        }
        if (pts.length >= 4) seg(pts[0], pts[1], pts[2], pts[3]);
        else if (pts.length === 2) mark(pts[0], pts[1]);
      }
    }
  });
  // fill enclosed pockets (hollow ground floors you can't get into anyway)
  const out = new Uint8Array(nx * nz);
  const stack: number[] = [];
  for (let i = 0; i < nx; i++) stack.push(i, (nz - 1) * nx + i);
  for (let k = 0; k < nz; k++) stack.push(k * nx, k * nx + nx - 1);
  while (stack.length) {
    const j = stack.pop()!;
    if (out[j] || grid[j]) continue;
    out[j] = 1;
    const i = j % nx;
    const k = (j - i) / nx;
    if (i > 0) stack.push(j - 1);
    if (i < nx - 1) stack.push(j + 1);
    if (k > 0) stack.push(j - nx);
    if (k < nz - 1) stack.push(j + nx);
  }
  for (let j = 0; j < grid.length; j++) if (!out[j]) grid[j] = 1;
  // greedy merge into rectangles
  const boxes: THREE.Box3[] = [];
  const top = Math.min(box.max.y, FOOT_TOP + 0.3);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      if (!grid[k * nx + i]) continue;
      let w = 1;
      while (i + w < nx && grid[k * nx + i + w]) w++;
      let h = 1;
      grow: while (k + h < nz) {
        for (let q = 0; q < w; q++) if (!grid[(k + h) * nx + i + q]) break grow;
        h++;
      }
      for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) grid[(k + r) * nx + i + q] = 0;
      boxes.push(new THREE.Box3(new THREE.Vector3(x0 + i * CELL, 0, z0 + k * CELL), new THREE.Vector3(x0 + (i + w) * CELL, top, z0 + (k + h) * CELL)));
    }
  }
  return boxes;
}

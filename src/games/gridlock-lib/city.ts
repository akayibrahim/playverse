/** GRIDLOCK — District 07 scenery: window-shader towers, the painted ground, neon, rooftop clutter. */
import * as THREE from "three";
import { AVE_W, LOT, mulberry32, type Lot, type Path } from "./data";

export type Reg = {
  G: <X extends THREE.BufferGeometry>(g: X) => X;
  M: <X extends THREE.Material>(m: X) => X;
  T: <X extends THREE.Texture>(t: X) => X;
};

/** Instanced tower material with a procedural lit-window grid (one draw call for the whole skyline). */
export function towerMaterial(reg: Reg) {
  const m = reg.M(new THREE.MeshStandardMaterial({ color: 0x161a26, roughness: 0.5, metalness: 0.55 }));
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vSeed;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4; wn = mat3(instanceMatrix) * wn;
          vSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.027;
        #else
          vSeed = 0.0;
        #endif
        vWP = (modelMatrix * wp4).xyz; vWN = normalize(mat3(modelMatrix) * wn);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWP; varying vec3 vWN; varying float vSeed;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 n = normalize(vWN);
          if (abs(n.y) < 0.5) {
            float hx = abs(n.x) > 0.5 ? vWP.z : vWP.x;
            vec2 g = vec2(hx / 1.8, vWP.y / 2.6);
            vec2 cell = floor(g);
            vec2 f = fract(g);
            float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.2, f.y) * step(f.y, 0.8);
            float hsh = h21(cell + vSeed * 17.0);
            float lit = step(0.7, hsh) * (0.5 + 0.5 * h21(cell.yx + 3.1));
            float band = h21(vec2(floor(vWP.y / 22.0), vSeed));
            vec3 col = hsh > 0.975 ? vec3(1.0, 0.25, 0.8) : hsh > 0.94 ? vec3(0.3, 0.9, 1.0) : mix(vec3(1.0, 0.7, 0.4), vec3(0.7, 0.85, 1.0), band);
            float px = length(fwidth(g));
            float far = smoothstep(0.25, 0.75, px);
            vec3 near = col * win * lit;
            vec3 avg = mix(vec3(1.0, 0.7, 0.4), vec3(0.7, 0.85, 1.0), band) * 0.1;
            totalEmissiveRadiance += mix(near, avg * 0.8, far) * 0.8;
            diffuseColor.rgb *= mix(1.0, 0.7, win);
          } else if (n.y > 0.5) {
            vec2 rg = abs(fract(vWP.xz / 3.0) - 0.5);
            float line = step(0.46, max(rg.x, rg.y));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.12, 0.17), 0.6);
            totalEmissiveRadiance += vec3(0.05, 0.1, 0.12) * line * 0.5;
          }
        }`,
      );
  };
  m.customProgramCacheKey = () => "gl-tower";
  return m;
}

function paintGround(lots: Lot[], paths: Path[], rng: () => number) {
  const S = 2048;
  const W = 300;
  const k = S / W;
  const px = (x: number) => (x + W / 2) * k;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    return c;
  };
  const col = mk();
  const rough = mk();
  const c = col.getContext("2d")!;
  const r = rough.getContext("2d")!;
  // base: concrete everywhere
  c.fillStyle = "#171c26";
  c.fillRect(0, 0, S, S);
  r.fillStyle = "rgb(150,150,150)";
  r.fillRect(0, 0, S, S);
  const ax = [-96, -48, 0, 48, 96];
  const strip = (x0: number, z0: number, x1: number, z1: number, w: number) => {
    const X = Math.min(x0, x1) - (x0 === x1 ? w / 2 : 0);
    const Z = Math.min(z0, z1) - (z0 === z1 ? w / 2 : 0);
    const WW = Math.abs(x1 - x0) + (x0 === x1 ? w : 0);
    const HH = Math.abs(z1 - z0) + (z0 === z1 ? w : 0);
    return [px(X), px(Z), WW * k, HH * k] as const;
  };
  // avenues: asphalt
  c.fillStyle = "#080a10";
  r.fillStyle = "rgb(92,92,92)";
  const E = 102;
  for (const a of ax) {
    for (const [x0, z0, x1, z1] of [
      [-E, a, E, a],
      [a, -E, a, E],
    ]) {
      const s = strip(x0, z0, x1, z1, AVE_W);
      c.fillRect(...s);
      r.fillRect(...s);
    }
  }
  // gate corridors out to the map edge
  for (const p of paths) {
    const a = p.pts[0];
    const b = p.pts[1];
    const s = strip(a.x, a.z, b.x, b.z, AVE_W);
    c.fillRect(...s);
    r.fillRect(...s);
  }
  // asphalt grain
  for (let i = 0; i < 26000; i++) {
    c.fillStyle = rng() < 0.5 ? "rgba(255,255,255,.025)" : "rgba(0,0,0,.18)";
    c.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 1 + rng() * 3);
  }
  // puddles: glossy blobs + faint reflection tint
  for (let i = 0; i < 230; i++) {
    const x = (rng() - 0.5) * 200;
    const z = (rng() - 0.5) * 200;
    const rr = (1.5 + rng() * 5) * k;
    const g = r.createRadialGradient(px(x), px(z), 0, px(x), px(z), rr);
    g.addColorStop(0, "rgba(10,10,10,1)");
    g.addColorStop(1, "rgba(10,10,10,0)");
    r.fillStyle = g;
    r.fillRect(px(x) - rr, px(z) - rr, rr * 2, rr * 2);
  }
  // lane markings
  c.lineCap = "butt";
  for (const a of ax) {
    c.strokeStyle = "rgba(255,181,71,.34)";
    c.lineWidth = 0.3 * k;
    c.setLineDash([3.2 * k, 3.2 * k]);
    c.beginPath();
    c.moveTo(px(-E), px(a));
    c.lineTo(px(E), px(a));
    c.moveTo(px(a), px(-E));
    c.lineTo(px(a), px(E));
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = "rgba(180,200,220,.13)";
    c.lineWidth = 0.22 * k;
    for (const o of [-AVE_W / 2 + 0.7, AVE_W / 2 - 0.7]) {
      c.beginPath();
      c.moveTo(px(-E), px(a + o));
      c.lineTo(px(E), px(a + o));
      c.moveTo(px(a + o), px(-E));
      c.lineTo(px(a + o), px(E));
      c.stroke();
    }
  }
  // clear markings in intersections, add zebra crossings
  for (const ix of ax)
    for (const iz of ax) {
      c.fillStyle = "#080a10";
      c.fillRect(px(ix - 6), px(iz - 6), 12 * k, 12 * k);
      c.fillStyle = "rgba(210,225,240,.16)";
      for (let s = -5; s <= 5; s += 1.6) {
        c.fillRect(px(ix + s) - 0.4 * k, px(iz - 6) - 2.4 * k, 0.8 * k, 2.2 * k);
        c.fillRect(px(ix + s) - 0.4 * k, px(iz + 6) + 0.2 * k, 0.8 * k, 2.2 * k);
        c.fillRect(px(ix - 6) - 2.4 * k, px(iz + s) - 0.4 * k, 2.2 * k, 0.8 * k);
        c.fillRect(px(ix + 6) + 0.2 * k, px(iz + s) - 0.4 * k, 2.2 * k, 0.8 * k);
      }
    }
  // curbs along avenue edges
  c.strokeStyle = "rgba(90,110,140,.35)";
  c.lineWidth = 0.35 * k;
  for (const a of ax)
    for (const o of [-AVE_W / 2, AVE_W / 2]) {
      c.beginPath();
      c.moveTo(px(-E), px(a + o));
      c.lineTo(px(E), px(a + o));
      c.moveTo(px(a + o), px(-E));
      c.lineTo(px(a + o), px(E));
      c.stroke();
    }
  // plaza lots: paved squares with a green trim
  for (const l of lots) {
    if (!l.plaza) continue;
    const x0 = px(l.x - LOT / 2);
    const z0 = px(l.z - LOT / 2);
    c.fillStyle = "#1f2733";
    c.fillRect(x0, z0, LOT * k, LOT * k);
    c.strokeStyle = "rgba(120,150,180,.18)";
    c.lineWidth = 1;
    for (let i = 0; i <= LOT; i += 2) {
      c.beginPath();
      c.moveTo(x0 + i * k, z0);
      c.lineTo(x0 + i * k, z0 + LOT * k);
      c.moveTo(x0, z0 + i * k);
      c.lineTo(x0 + LOT * k, z0 + i * k);
      c.stroke();
    }
    c.strokeStyle = "rgba(74,222,128,.75)";
    c.lineWidth = 0.35 * k;
    c.strokeRect(x0 + 0.5 * k, z0 + 0.5 * k, (LOT - 1) * k, (LOT - 1) * k);
    r.fillStyle = "rgb(110,110,110)";
    r.fillRect(x0, z0, LOT * k, LOT * k);
  }
  // reactor plaza disc
  const cg = c.createRadialGradient(px(0), px(0), 0, px(0), px(0), 15 * k);
  cg.addColorStop(0, "#102a1c");
  cg.addColorStop(0.7, "#0b1a14");
  cg.addColorStop(1, "rgba(8,10,16,0)");
  c.fillStyle = cg;
  c.beginPath();
  c.arc(px(0), px(0), 15 * k, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(74,222,128,.55)";
  c.lineWidth = 0.3 * k;
  for (const rr of [8.5, 11, 13.5]) {
    c.beginPath();
    c.arc(px(0), px(0), rr * k, 0, Math.PI * 2);
    c.stroke();
  }
  return { col, rough };
}

export function buildGround(reg: Reg, lots: Lot[], paths: Path[], aniso: number) {
  const { col, rough } = paintGround(lots, paths, mulberry32(99));
  const map = reg.T(new THREE.CanvasTexture(col));
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = aniso;
  const rmap = reg.T(new THREE.CanvasTexture(rough));
  rmap.anisotropy = aniso;
  const mat = reg.M(new THREE.MeshStandardMaterial({ map, roughnessMap: rmap, roughness: 1, metalness: 0.25 }));
  const mesh = new THREE.Mesh(reg.G(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2)), mat);
  return mesh;
}

export type CityOut = { group: THREE.Group; roofY: (lot: Lot) => number };

export function buildCity(reg: Reg, lots: Lot[], paths: Path[], mobile: boolean): CityOut {
  const group = new THREE.Group();
  const rng = mulberry32(4242);
  const box = reg.G(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const towerMat = towerMaterial(reg);
  const dummy = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const mats: THREE.Matrix4[] = [];
  const add = (x: number, y: number, z: number, w: number, h: number, d: number) => mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d)));
  // inner lots
  const clutter: THREE.Matrix4[] = [];
  const neonStrips: Array<{ m: THREE.Matrix4; c: number }> = [];
  const NEON = [0xff3fc8, 0x35f0ff, 0xffb547, 0x9a5cff, 0x4ade80, 0xff4d5c];
  for (const l of lots) {
    if (l.plaza) continue;
    add(l.x, 0, l.z, LOT - 0.4, l.h, LOT - 0.4);
    // rooftop clutter (AC units / tanks), kept off the pad centre
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const sx = 1 + rng() * 2.2;
      const sz = 1 + rng() * 2.2;
      const ox = (rng() < 0.5 ? -1 : 1) * (5.6 + rng() * 1.4);
      const oz = (rng() < 0.5 ? -1 : 1) * (5.6 + rng() * 1.4);
      clutter.push(new THREE.Matrix4().compose(new THREE.Vector3(l.x + ox, l.h, l.z + oz), q, new THREE.Vector3(sx, 0.7 + rng() * 1.4, sz)));
    }
    // neon edge strip on the roofline
    const c = NEON[Math.floor(rng() * NEON.length)];
    const side = Math.floor(rng() * 4);
    const hl = (LOT - 0.4) / 2 + 0.1;
    const horiz = side < 2;
    const sgn = side % 2 === 0 ? -1 : 1;
    neonStrips.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(l.x + (horiz ? 0 : sgn * hl), l.h + 0.1, l.z + (horiz ? sgn * hl : 0)), q, new THREE.Vector3(horiz ? LOT - 0.4 : 0.3, 0.35, horiz ? 0.3 : LOT - 0.4)), c });
    // vertical neon edge on tall buildings
    if (l.h > 15 && rng() < 0.6) {
      const sx = rng() < 0.5 ? -1 : 1;
      const sz2 = rng() < 0.5 ? -1 : 1;
      neonStrips.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(l.x + sx * hl, 0.5, l.z + sz2 * hl), q, new THREE.Vector3(0.3, l.h - 0.5, 0.3)), c });
    }
  }
  // outer skyline
  const corridors = paths.map((p) => ({ x0: Math.min(p.pts[0].x, p.pts[1].x), x1: Math.max(p.pts[0].x, p.pts[1].x), z0: Math.min(p.pts[0].z, p.pts[1].z), z1: Math.max(p.pts[0].z, p.pts[1].z) }));
  const step = mobile ? 30 : 24;
  for (let gx = -270; gx <= 270; gx += step) {
    for (let gz = -270; gz <= 270; gz += step) {
      if (Math.abs(gx) < 112 && Math.abs(gz) < 112) continue;
      const x = gx + (rng() - 0.5) * 8;
      const z = gz + (rng() - 0.5) * 8;
      const w = 14 + rng() * 10;
      const d = 14 + rng() * 10;
      let blocked = false;
      for (const k of corridors) if (x + w / 2 + 3 > k.x0 - 8 && x - w / 2 - 3 < k.x1 + 8 && z + d / 2 + 3 > k.z0 - 8 && z - d / 2 - 3 < k.z1 + 8 && (k.x1 - k.x0 > 0 ? true : true)) blocked = true;
      // only the stretch outside the grid matters for the corridors
      if (blocked && Math.abs(x) < 112 && Math.abs(z) < 112) blocked = false;
      if (blocked) continue;
      const dist = Math.hypot(x, z);
      const h = 26 + rng() * 60 + Math.min(1, dist / 280) * rng() * 70;
      add(x, 0, z, w, h, d);
      if (rng() < 0.4) {
        const c = NEON[Math.floor(rng() * NEON.length)];
        neonStrips.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x + w / 2, 0.5, z + d / 2), q, new THREE.Vector3(0.5, h - 0.5, 0.5)), c });
      }
    }
  }
  const towers = new THREE.InstancedMesh(box, towerMat, mats.length);
  mats.forEach((m, i) => towers.setMatrixAt(i, m));
  towers.instanceMatrix.needsUpdate = true;
  group.add(towers);
  const clutterMat = reg.M(new THREE.MeshStandardMaterial({ color: 0x252b38, roughness: 0.6, metalness: 0.6 }));
  const cl = new THREE.InstancedMesh(box, clutterMat, clutter.length);
  clutter.forEach((m, i) => cl.setMatrixAt(i, m));
  group.add(cl);
  const neonMat = reg.M(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const neon = new THREE.InstancedMesh(box, neonMat, neonStrips.length);
  const cc = new THREE.Color();
  neonStrips.forEach((s, i) => {
    neon.setMatrixAt(i, s.m);
    neon.setColorAt(i, cc.setHex(s.c).multiplyScalar(1.7));
  });
  group.add(neon);
  void dummy;
  return { group, roofY: (l) => l.h };
}

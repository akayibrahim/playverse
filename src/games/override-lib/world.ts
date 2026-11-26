/** OVERRIDE — builds a floor's interior (merged per material), the neon city outside and the light fixtures. */
import * as THREE from "three";
import { triplanar, type PbrSet } from "../nexus-lib/surface";
import { CELL, type FloorDef } from "./levels";
import { Mesher } from "./mesher";
import { Nav, VENT_H } from "./nav";

export type Track = {
  G: <X extends THREE.BufferGeometry>(g: X) => X;
  M: <X extends THREE.Material>(m: X) => X;
  T: <X extends THREE.Texture>(t: X) => X;
};
export type Fixture = { x: number; y: number; z: number; color: THREE.Color; i: number; on: boolean; r: number };
export type World = {
  group: THREE.Group;
  city: THREE.Group;
  fixtures: Fixture[];
  glassTex: THREE.CanvasTexture[];
  breach: { mesh: THREE.Mesh | null };
  ceilMesh: { mesh: THREE.Mesh | null };
  lightAt(x: number, z: number): number;
  update(dt: number, t: number, center: THREE.Vector3): void;
  setExtract(on: boolean): void;
  uniforms: { uTime: { value: number } };
};

function hex(n: number) {
  return `#${n.toString(16).padStart(6, "0")}`;
}
function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

export function makeTextures(def: FloorDef, T: Track["T"], aniso: number) {
  const th = def.theme;
  const rnd = rngOf(def.n * 977);
  // ---- floor (2 m tile)
  const [fc, f] = canvas(256, 256);
  f.fillStyle = th.floorCol;
  f.fillRect(0, 0, 256, 256);
  if (th.floorKind === "stone") {
    for (let i = 0; i < 38; i++) {
      f.strokeStyle = `rgba(255,${200 + rnd() * 40},${200 + rnd() * 40},${0.02 + rnd() * 0.05})`;
      f.lineWidth = 1 + rnd() * 2;
      f.beginPath();
      f.moveTo(rnd() * 256, rnd() * 256);
      f.bezierCurveTo(rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256);
      f.stroke();
    }
    f.strokeStyle = "rgba(251,113,133,.5)";
    f.lineWidth = 2;
    f.strokeRect(1, 1, 254, 254);
    f.strokeStyle = "rgba(0,0,0,.6)";
    f.strokeRect(4, 4, 248, 248);
  } else if (th.floorKind === "raised") {
    // raised-floor perforated tiles, 4x4 per 2 m
    for (let ty = 0; ty < 4; ty++)
      for (let tx = 0; tx < 4; tx++) {
        f.fillStyle = (tx + ty) % 2 ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.12)";
        f.fillRect(tx * 64, ty * 64, 64, 64);
        f.fillStyle = "rgba(120,180,255,.10)";
        if ((tx * 3 + ty * 5) % 7 === 0)
          for (let py = 0; py < 6; py++) for (let px = 0; px < 6; px++) f.fillRect(tx * 64 + 10 + px * 8, ty * 64 + 10 + py * 8, 4, 4);
      }
    f.strokeStyle = "rgba(100,170,255,.35)";
    f.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      f.beginPath();
      f.moveTo(i * 64, 0);
      f.lineTo(i * 64, 256);
      f.moveTo(0, i * 64);
      f.lineTo(256, i * 64);
      f.stroke();
    }
  } else {
    f.strokeStyle = "rgba(251,113,133,.35)";
    f.lineWidth = 2;
    f.strokeRect(2, 2, 252, 252);
    f.strokeStyle = "rgba(176,107,255,.18)";
    f.lineWidth = 1;
    f.beginPath();
    f.moveTo(128, 0);
    f.lineTo(128, 256);
    f.moveTo(0, 128);
    f.lineTo(256, 128);
    f.stroke();
  }
  const floorTex = T(new THREE.CanvasTexture(fc));
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.anisotropy = aniso;

  // ---- wall (3 m tile): panels with seams + dado + top stripe
  const [wc, w] = canvas(256, 256);
  w.fillStyle = th.wallCol;
  w.fillRect(0, 0, 256, 256);
  const grd = w.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "rgba(255,255,255,.06)");
  grd.addColorStop(1, "rgba(0,0,0,.22)");
  w.fillStyle = grd;
  w.fillRect(0, 0, 256, 256);
  w.strokeStyle = "rgba(0,0,0,.55)";
  w.lineWidth = 3;
  w.strokeRect(0, 0, 256, 256);
  w.strokeStyle = "rgba(255,255,255,.07)";
  w.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    w.beginPath();
    w.moveTo(i * 64, 0);
    w.lineTo(i * 64, 256);
    w.stroke();
  }
  w.fillStyle = "rgba(0,0,0,.28)";
  w.fillRect(0, 214, 256, 42); // dado
  w.fillStyle = hex(th.accent) + "55";
  w.fillRect(0, 213, 256, 2);
  const wallTex = T(new THREE.CanvasTexture(wc));
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.anisotropy = aniso;

  // ---- ceiling
  const [cc, c] = canvas(128, 128);
  c.fillStyle = th.ceilCol;
  c.fillRect(0, 0, 128, 128);
  c.strokeStyle = "rgba(255,255,255,.13)";
  c.lineWidth = 2;
  c.strokeRect(1, 1, 126, 126);
  c.beginPath();
  c.moveTo(64, 0);
  c.lineTo(64, 128);
  c.moveTo(0, 64);
  c.lineTo(128, 64);
  c.stroke();
  c.fillStyle = "rgba(255,255,255,.07)";
  for (let i = 0; i < 4; i++) for (let k = 0; k < 5; k++) c.fillRect(12 + (i % 2) * 64 + k * 9, 12 + Math.floor(i / 2) * 64, 4, 40);
  const ceilTex = T(new THREE.CanvasTexture(cc));
  ceilTex.colorSpace = THREE.SRGBColorSpace;
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;

  // ---- glass droplets (3 m tile)
  const [gc, g] = canvas(256, 512);
  g.fillStyle = "rgba(170,200,255,.07)";
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 256;
    const y = rnd() * 512;
    const len = 20 + rnd() * 90;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, "rgba(220,235,255,0)");
    gr.addColorStop(0.85, `rgba(220,235,255,${0.12 + rnd() * 0.18})`);
    gr.addColorStop(1, "rgba(240,248,255,.5)");
    g.fillStyle = gr;
    g.fillRect(x, y, 1.4, len);
    g.beginPath();
    g.arc(x + 0.7, y + len, 1.6 + rnd() * 2, 0, 7);
    g.fillStyle = "rgba(235,245,255,.42)";
    g.fill();
  }
  for (let i = 0; i < 160; i++) {
    g.beginPath();
    g.arc(rnd() * 256, rnd() * 512, 0.8 + rnd() * 2.2, 0, 7);
    g.fillStyle = `rgba(230,242,255,${0.1 + rnd() * 0.25})`;
    g.fill();
  }
  const dropTex = T(new THREE.CanvasTexture(gc));
  dropTex.colorSpace = THREE.SRGBColorSpace;
  dropTex.wrapS = dropTex.wrapT = THREE.RepeatWrapping;

  // ---- rack LEDs (blink handled in shader)
  const [rc, r] = canvas(128, 256);
  r.fillStyle = "#0a0e16";
  r.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 16; i++) {
    r.fillStyle = "#12182a";
    r.fillRect(6, 6 + i * 15.5, 116, 12);
    r.fillStyle = "rgba(255,255,255,.06)";
    for (let k = 0; k < 14; k++) r.fillRect(14 + k * 4, 9 + i * 15.5, 2, 6);
  }
  const rackTex = T(new THREE.CanvasTexture(rc));
  rackTex.colorSpace = THREE.SRGBColorSpace;
  // emissive map: LED dots
  const [ec, e] = canvas(128, 256);
  e.fillStyle = "#000";
  e.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 16; i++)
    for (let k = 0; k < 6; k++) {
      const pick = rnd();
      e.fillStyle = pick < 0.55 ? "#35f0ff" : pick < 0.8 ? "#7dffb0" : pick < 0.92 ? "#ffb547" : "#ff4d5c";
      e.fillRect(92 + k * 5, 9 + i * 15.5, 3, 6);
    }
  const rackEmis = T(new THREE.CanvasTexture(ec));
  rackEmis.colorSpace = THREE.SRGBColorSpace;

  // ---- soft radial for light pools
  const [pc, p] = canvas(128, 128);
  const pg = p.createRadialGradient(64, 64, 2, 64, 64, 64);
  pg.addColorStop(0, "rgba(255,255,255,.9)");
  pg.addColorStop(0.35, "rgba(255,255,255,.34)");
  pg.addColorStop(1, "rgba(255,255,255,0)");
  p.fillStyle = pg;
  p.fillRect(0, 0, 128, 128);
  const poolTex = T(new THREE.CanvasTexture(pc));

  // ---- shaft grid (atrium)
  const [sc, s] = canvas(256, 256);
  s.fillStyle = "#05030a";
  s.fillRect(0, 0, 256, 256);
  s.strokeStyle = "rgba(255,90,140,.7)";
  s.lineWidth = 2;
  s.strokeRect(0, 0, 256, 256);
  s.strokeStyle = "rgba(176,107,255,.35)";
  s.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    s.beginPath();
    s.moveTo(i * 32, 0);
    s.lineTo(i * 32, 256);
    s.moveTo(0, i * 32);
    s.lineTo(256, i * 32);
    s.stroke();
  }
  const shaftTex = T(new THREE.CanvasTexture(sc));
  shaftTex.colorSpace = THREE.SRGBColorSpace;
  shaftTex.wrapS = shaftTex.wrapT = THREE.RepeatWrapping;

  // ---- vent duct ribs
  const [dc, d] = canvas(128, 128);
  d.fillStyle = "#3a4048";
  d.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 16) {
    d.fillStyle = "rgba(0,0,0,.45)";
    d.fillRect(i, 0, 3, 128);
    d.fillStyle = "rgba(255,255,255,.12)";
    d.fillRect(i + 3, 0, 1, 128);
  }
  const ductTex = T(new THREE.CanvasTexture(dc));
  ductTex.colorSpace = THREE.SRGBColorSpace;
  ductTex.wrapS = ductTex.wrapT = THREE.RepeatWrapping;
  return { floorTex, wallTex, ceilTex, dropTex, rackTex, rackEmis, poolTex, shaftTex, ductTex };
}

export function signTexture(text: string, sub: string | undefined, color: string, w: number, h: number) {
  const [c, x] = canvas(Math.round(w * 160), Math.round(h * 160));
  const W = c.width;
  const H = c.height;
  x.fillStyle = "rgba(6,4,10,.92)";
  x.fillRect(0, 0, W, H);
  x.strokeStyle = color;
  x.lineWidth = 4;
  x.strokeRect(4, 4, W - 8, H - 8);
  x.fillStyle = color;
  x.shadowColor = color;
  x.shadowBlur = 18;
  x.textAlign = "center";
  x.textBaseline = "middle";
  const fs = sub ? H * 0.42 : H * 0.55;
  x.font = `800 ${fs}px system-ui, sans-serif`;
  while (x.measureText(text).width > W * 0.88 && fs > 8) x.font = `800 ${(parseFloat(x.font.match(/(\d+(\.\d+)?)px/)![1]) - 2)}px system-ui, sans-serif`;
  x.fillText(text, W / 2, sub ? H * 0.38 : H / 2);
  if (sub) {
    x.shadowBlur = 8;
    x.font = `500 ${H * 0.15}px ui-monospace, monospace`;
    x.fillStyle = "#e8e0f0";
    x.fillText(sub, W / 2, H * 0.74);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(def: FloorDef, nav: Nav, tr: Track, pbr: { metal: PbrSet; concrete: PbrSet }, aniso: number, mobile: boolean): World {
  const { G, M, T } = tr;
  const th = def.theme;
  const rnd = rngOf(def.n * 131 + 7);
  const group = new THREE.Group();
  const tex = makeTextures(def, T, aniso);
  const uniforms = { uTime: { value: 0 } };
  const accent = new THREE.Color(th.accent);
  const accent2 = new THREE.Color(th.accent2);

  // ------------------------------------------------------------------ materials
  const wallMat = M(new THREE.MeshStandardMaterial({ map: tex.wallTex, color: 0xffffff, roughness: 0.7, metalness: 0.15 }));
  triplanar(wallMat, pbr.metal, { tile: 4, albedo: 0.18, chroma: 0.0, normal: 0.25, rough: [0.35, 0.7], metal: [0.1, 0.4], grime: 0.15 });
  const floorMat = M(
    new THREE.MeshStandardMaterial({ map: tex.floorTex, color: 0xffffff, roughness: 0.22, metalness: 0.4, transparent: true, opacity: th.floorKind === "gloss" ? 0.8 : 0.86 }),
  );
  triplanar(floorMat, pbr.concrete, { tile: 6, albedo: 0.12, chroma: 0.0, normal: 0.12, rough: [0.12, 0.4], metal: [0.2, 0.5], grime: 0.0 });
  floorMat.envMapIntensity = 0.12;
  wallMat.envMapIntensity = 0.35;
  const ceilMat = M(new THREE.MeshStandardMaterial({ map: tex.ceilTex, color: 0xffffff, roughness: 0.7, metalness: 0.2, emissiveMap: tex.ceilTex, emissive: 0xffffff, emissiveIntensity: 0.35 }));
  const ductMat = M(new THREE.MeshStandardMaterial({ map: tex.ductTex, color: 0xffffff, roughness: 0.5, metalness: 0.7 }));
  const shaftMat = M(new THREE.MeshBasicMaterial({ map: tex.shaftTex, color: 0xffffff, fog: false }));
  const glassFloorMat = M(new THREE.MeshStandardMaterial({ color: 0x6a8cc8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.2, depthWrite: false }));
  const glassMat = M(new THREE.MeshStandardMaterial({ map: tex.dropTex, color: 0xcfe2ff, roughness: 0.08, metalness: 0.3, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const trimMat = M(new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.4, metalness: 0.8 }));
  // the "basement" box below each glossy floor: hides the city below and backs the mirrored glows
  const voidMat = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(th.fog).multiplyScalar(0.35), fog: false }));
  const darkMat = M(new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.55, metalness: 0.4 }));
  const woodMat = M(new THREE.MeshStandardMaterial({ color: 0x4a3a34, roughness: 0.45, metalness: 0.1 }));
  const fabricMat = M(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0 }));
  const metalMat = M(new THREE.MeshStandardMaterial({ color: 0x8a909c, roughness: 0.35, metalness: 0.85 }));
  const leafMat = M(new THREE.MeshStandardMaterial({ color: 0x1f6a46, roughness: 0.8, emissive: 0x03140c }));
  const crateMat = M(new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.6, metalness: 0.5 }));
  const rackMat = M(new THREE.MeshStandardMaterial({ map: tex.rackTex, emissiveMap: tex.rackEmis, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.6 }));
  rackMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nfloat rkH(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        { vec2 cell = floor(vEmissiveMapUv * vec2(26.0, 16.0)); float b = rkH(cell + floor(uTime * (1.2 + rkH(cell) * 3.0))); totalEmissiveRadiance *= mix(0.15, 1.5, step(0.35, b)); }`,
      );
  };
  rackMat.customProgramCacheKey = () => "ov-rack";
  const glowMats = new Map<string, THREE.MeshBasicMaterial>();
  const glowMat = (c: THREE.Color, k = 2.4) => {
    const key = `${c.getHexString()}:${k}`;
    let m = glowMats.get(key);
    if (!m) {
      m = M(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), toneMapped: false }));
      glowMats.set(key, m);
    }
    return m;
  };
  const mesherFor = new Map<THREE.Material, Mesher>();
  const mz = (m: THREE.Material) => {
    let r = mesherFor.get(m);
    if (!r) {
      r = new Mesher();
      mesherFor.set(m, r);
    }
    return r;
  };
  const mirror = new Map<THREE.Material, Mesher>(); // emissive stuff mirrored below the floor = cheap reflections
  const mm = (m: THREE.Material) => {
    let r = mirror.get(m);
    if (!r) {
      r = new Mesher();
      mirror.set(m, r);
    }
    return r;
  };
  const glow = (c: THREE.Color, k: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rot = 0, mir = true) => {
    const m = glowMat(c, k);
    mz(m).box(cx, cy, cz, sx, sy, sz, rot);
    if (mir) mm(glowMat(c, k * 0.4)).box(cx, -cy, cz, sx, sy, sz, rot);
  };

  // ------------------------------------------------------------------ shell
  const wallFace = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, m: THREE.Material, mesh?: Mesher) => {
    const mx = (ax + bx) / 2;
    const mzz = (az + bz) / 2;
    const hl = Math.hypot(bx - ax, bz - az) / 2;
    const hy = (y1 - y0) / 2;
    // u runs along the edge so that u × v = (nx, 0, nz)
    const ux = nz === 0 ? 0 : nz > 0 ? hl : -hl; // (0,0,±1)
    const uz = nx === 0 ? 0 : nx > 0 ? -hl : hl;
    const alongA = nx === 0 ? ax : az;
    const alongB = nx === 0 ? bx : bz;
    // -X normal: u=(0,0,hz); +X: u=(0,0,-hz); +Z: u=(hx,0,0); -Z: u=(-hx,0,0)
    const m2 = mesh ?? mz(m);
    const lo = Math.min(alongA, alongB) / 3;
    const hi = Math.max(alongA, alongB) / 3;
    const flip = (nx !== 0 ? (uz > 0 ? 1 : -1) : ux > 0 ? 1 : -1) < 0 ? [hi, lo] : [lo, hi];
    m2.face(mx, (y0 + y1) / 2, mzz, ux, 0, uz, 0, hy, 0, [flip[0], y0 / 3, flip[1], y1 / 3]);
  };
  const hasGlass = (x: number, z: number) => nav.inb(x, z) && nav.ch[z][x] === "g";
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const fixtures: Fixture[] = [];
  const lightCol = new THREE.Color(th.lightCol);

  for (let z = 0; z < nav.H; z++)
    for (let x = 0; x < nav.W; x++) {
      const c = nav.ch[z][x];
      if (!nav.isOpenCh(c)) continue;
      const wx0 = x * CELL;
      const wz0 = z * CELL;
      const cx = wx0 + CELL / 2;
      const cz = wz0 + CELL / 2;
      const ceil = nav.ceilAtCell(x, z);
      const vent = c === "~";
      const atr = c === "a";
      // floor
      if (atr) {
        mz(glassFloorMat).face(cx, 0, cz, CELL / 2, 0, 0, 0, 0, -CELL / 2, [0, 0, 1, 1]);
      } else {
        mz(vent ? ductMat : floorMat).face(cx, 0, cz, CELL / 2, 0, 0, 0, 0, -CELL / 2, [wx0 / 2, wz0 / 2, wx0 / 2 + 1, wz0 / 2 + 1]);
        if (!vent) mz(voidMat).face(cx, -Math.min(ceil, 8) - 0.05, cz, CELL / 2, 0, 0, 0, 0, -CELL / 2);
      }
      // ceiling (normal down)
      if (!atr || true) {
        mz(vent ? ductMat : ceilMat).face(cx, ceil, cz, CELL / 2, 0, 0, 0, 0, CELL / 2, [wx0 / 2, wz0 / 2, wx0 / 2 + 1, wz0 / 2 + 1]);
      }
      // walls
      for (const [dx, dz] of dirs) {
        const nxc = x + dx;
        const nzc = z + dz;
        const nOpen = nav.open(nxc, nzc);
        const ex0 = dx === 1 ? wx0 + CELL : wx0;
        const ez0 = dz === 1 ? wz0 + CELL : wz0;
        const [ax, az, bx, bz] = dx !== 0 ? [ex0, wz0, ex0, wz0 + CELL] : [wx0, ez0, wx0 + CELL, ez0];
        if (!nOpen) {
          const glass = hasGlass(nxc, nzc);
          const mat = vent ? ductMat : glass ? glassMat : wallMat;
          wallFace(ax, az, bx, bz, 0, ceil, -dx, -dz, mat);
          if (atr) {
            // shaft below the glass floor
            wallFace(ax, az, bx, bz, -16, 0, -dx, -dz, shaftMat);
          }
          if (!vent && !glass) {
            // baseboard + neon strip
            const off = 0.02;
            const bxm = (ax + bx) / 2 - dx * off;
            const bzm = (az + bz) / 2 - dz * off;
            const along = dx !== 0 ? [0.06, 0.24, CELL] : [CELL, 0.24, 0.06];
            mz(trimMat).box(bxm - dx * 0.03, 0.12, bzm - dz * 0.03, along[0], along[1], along[2]);
            glow(accent, 2.0, bxm - dx * 0.035, 0.3, bzm - dz * 0.035, dx !== 0 ? 0.03 : CELL, 0.04, dx !== 0 ? CELL : 0.03);
            if (ceil < 8) glow(accent2, 1.2, bxm - dx * 0.03, ceil - 0.2, bzm - dz * 0.03, dx !== 0 ? 0.03 : CELL, 0.03, dx !== 0 ? CELL : 0.03, 0, false);
          }
          if (glass && !vent) {
            // mullions every cell edge + sill
            const bxm = (ax + bx) / 2;
            const bzm = (az + bz) / 2;
            mz(trimMat).box(bxm, ceil / 2, bzm, dx !== 0 ? 0.12 : 0.14, ceil, dx !== 0 ? 0.14 : 0.12);
            mz(trimMat).box(bxm - dx * 0.0, 0.1, bzm, dx !== 0 ? 0.22 : CELL, 0.2, dx !== 0 ? CELL : 0.22);
          }
        } else if (dx + dz > 0 || dx === 1 || dz === 1) {
          // step between differing ceilings: handled below from the high side only
        }
        if (!vent && !atr) {
          // mirrored basement walls
          const deep = Math.min(ceil, 8) + 0.05;
          const nFloor = nOpen && nav.ch[nzc][nxc] === ".";
          if (!nFloor) wallFace(ax, az, bx, bz, -deep, 0, -dx, -dz, voidMat);
          else {
            const nd = Math.min(nav.ceilAtCell(nxc, nzc), 8) + 0.05;
            if (nd < deep - 0.01) wallFace(ax, az, bx, bz, -deep, -nd, -dx, -dz, voidMat);
          }
        }
        if (nOpen) {
          const ho = nav.ceilAtCell(nxc, nzc);
          if (ho < ceil - 0.01) {
            // bulkhead from lower neighbour ceiling up to ours, facing into this (higher) cell
            wallFace(ax, az, bx, bz, ho, ceil, -dx, -dz, vent ? ductMat : wallMat);
          }
        }
      }
      void atr;
    }

  // bridge edge strips + glass railings (floor 3)
  for (let z = 0; z < nav.H; z++)
    for (let x = 0; x < nav.W; x++) {
      if (nav.ch[z][x] !== ".") continue;
      for (const [dx, dz] of dirs) {
        if (nav.inb(x + dx, z + dz) && nav.ch[z + dz][x + dx] === "a") {
          const ex = (x + 0.5 + dx * 0.5) * CELL;
          const ez = (z + 0.5 + dz * 0.5) * CELL;
          glow(accent, 2.6, ex - dx * 0.06, 0.05, ez - dz * 0.06, dx !== 0 ? 0.08 : CELL, 0.05, dx !== 0 ? CELL : 0.08);
          mz(glassMat).box(ex - dx * 0.06, 0.55, ez - dz * 0.06, dx !== 0 ? 0.03 : CELL, 1.1, dx !== 0 ? CELL : 0.03);
          mz(trimMat).box(ex - dx * 0.06, 1.1, ez - dz * 0.06, dx !== 0 ? 0.07 : CELL, 0.06, dx !== 0 ? CELL : 0.07);
        }
      }
    }

  // atrium shaft floor (deep)
  let hasAtrium = false;
  for (const row of nav.ch) if (row.includes("a")) hasAtrium = true;
  if (hasAtrium) {
    const sm = mz(shaftMat);
    sm.face(nav.W * CELL * 0.5, -16, nav.H * CELL * 0.5, nav.W * CELL * 0.5, 0, 0, 0, 0, -nav.H * CELL * 0.5, [0, 0, nav.W / 2, nav.H / 2]);
  }

  // ------------------------------------------------------------------ fixtures
  const taken: [number, number][] = [];
  const spacing = 3.0;
  for (let z = 0; z < nav.H; z++)
    for (let x = 0; x < nav.W; x++) {
      const c = nav.ch[z][x];
      if (c !== ".") continue;
      const ceil = nav.ceilAtCell(x, z);
      const inAtrium = ceil > 8;
      const sp = inAtrium ? 4.2 : spacing;
      if (taken.some(([tx, tz]) => Math.hypot(tx - (x + 0.5), tz - (z + 0.5)) < sp)) continue;
      if (nav.block[z * nav.W + x] > 0.01) continue;
      taken.push([x + 0.5, z + 0.5]);
      const on = rnd() > 0.14;
      const col = lightCol.clone();
      if (rnd() < 0.22) col.lerp(accent2, 0.55);
      const y = inAtrium ? 4.4 : ceil - 0.06;
      fixtures.push({ x: (x + 0.5) * CELL, y, z: (z + 0.5) * CELL, color: col, i: th.lightI * (inAtrium ? 1.4 : 1), on, r: inAtrium ? 15 : 11 });
    }
  const poolMesh = new Mesher();
  for (const f of fixtures) {
    const dim = f.on ? 1 : 0.08;
    const m = glowMat(f.color, 2.3 * dim);
    if (f.y > 4.2 && f.y < 5) {
      // pendant over the glass bridge
      mz(trimMat).box(f.x, (f.y + 12) / 2, f.z, 0.03, 12 - f.y, 0.03);
      mz(m).box(f.x, f.y, f.z, 1.6, 0.12, 0.5);
    } else {
      mz(m).box(f.x, f.y, f.z, 1.7, 0.08, 0.38);
      mz(trimMat).box(f.x, f.y + 0.03, f.z, 1.84, 0.05, 0.5);
    }
    if (f.on) {
      const s = 2.1;
      poolMesh.face(f.x, 0.035, f.z, s, 0, 0, 0, 0, -s, [0, 0, 1, 1], [f.color.r * 0.2, f.color.g * 0.2, f.color.b * 0.2]);
    }
  }
  const poolMat = M(
    new THREE.MeshBasicMaterial({ map: tex.poolTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
  );
  mz(poolMat); // register
  mesherFor.set(poolMat, poolMesh);

  // ------------------------------------------------------------------ props
  const rgb = (hexStr: string): [number, number, number] => {
    const c = new THREE.Color(hexStr);
    return [c.r, c.g, c.b];
  };
  for (const p of def.props) {
    const x = p.x * CELL;
    const z = p.z * CELL;
    const w = (p.w ?? 1) * CELL;
    const d = (p.d ?? 1) * CELL;
    const h = p.h ?? 1;
    const rot = p.rot ?? 0;
    const rr = (rot * Math.PI) / 180;
    const rx = (lx: number, lz: number) => x + lx * Math.cos(rr) + lz * Math.sin(rr);
    const rz = (lx: number, lz: number) => z - lx * Math.sin(rr) + lz * Math.cos(rr);
    switch (p.t) {
      case "desk": {
        const dw = Math.min(w, 2.4);
        const dd = Math.min(d, 1.1);
        mz(woodMat).box(x, h, z, dw, 0.06, dd, rot);
        mz(trimMat).box(rx(-dw / 2 + 0.06, 0), h / 2, rz(-dw / 2 + 0.06, 0), 0.05, h, dd - 0.1, rot);
        mz(trimMat).box(rx(dw / 2 - 0.06, 0), h / 2, rz(dw / 2 - 0.06, 0), 0.05, h, dd - 0.1, rot);
        mz(darkMat).box(rx(0, -dd * 0.28), h + 0.3, rz(0, -dd * 0.28), 0.62, 0.38, 0.04, rot);
        const sc = rnd() > 0.5 ? accent2 : accent;
        glow(sc, 1.4, rx(0, -dd * 0.28 + 0.025), h + 0.3, rz(0, -dd * 0.28 + 0.025), 0.56, 0.32, 0.01, rot, false);
        mz(darkMat).box(rx(0, dd * 0.05), h + 0.045, rz(0, dd * 0.05), 0.4, 0.02, 0.14, rot);
        break;
      }
      case "counter": {
        mz(darkMat).box(x, h / 2, z, w, h, d, rot);
        mz(metalMat).box(x, h + 0.04, z, w + 0.1, 0.08, d + 0.1, rot);
        glow(accent, 2.4, rx(0, d / 2 + 0.01), 0.55, rz(0, d / 2 + 0.01), w * 0.92, 0.06, 0.02, rot);
        glow(accent, 1.4, rx(0, d / 2 + 0.01), 0.1, rz(0, d / 2 + 0.01), w * 0.98, 0.04, 0.02, rot);
        break;
      }
      case "screen": {
        const sx = (p.w ?? 1) * 1.1;
        mz(darkMat).box(x, 1.6, z, sx, (p.h ?? 0.5) * 1.1 + 0.06, 0.08);
        glow(accent2, 1.6, x, 1.6, z + 0.045, sx - 0.08, (p.h ?? 0.5) * 1.1 - 0.02, 0.01, 0, false);
        break;
      }
      case "sofa": {
        const col = rgb(p.c ?? "#3a2a44");
        mz(fabricMat).box(x, 0.28, z, w, 0.5, d, rot, col);
        mz(fabricMat).box(rx(0, -d / 2 + 0.14), 0.62, rz(0, -d / 2 + 0.14), w, 0.55, 0.26, rot, col);
        mz(fabricMat).box(rx(-w / 2 + 0.12, 0), 0.5, rz(-w / 2 + 0.12, 0), 0.24, 0.5, d, rot, col);
        mz(fabricMat).box(rx(w / 2 - 0.12, 0), 0.5, rz(w / 2 - 0.12, 0), 0.24, 0.5, d, rot, col);
        break;
      }
      case "plant": {
        mz(darkMat).cyl(x, 0, z, 0.32, 0.5, 10, 0.26);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          mz(leafMat).box(x + Math.cos(a) * 0.22, 0.95 + (i % 3) * 0.12, z + Math.sin(a) * 0.22, 0.34, 0.6, 0.06, (-a * 180) / Math.PI + 20 * (i % 2));
        }
        mz(leafMat).box(x, 1.15, z, 0.1, 0.7, 0.1, 0);
        break;
      }
      case "table": {
        mz(woodMat).box(x, h, z, w, 0.06, d, rot);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) mz(trimMat).box(rx(sx * (w / 2 - 0.1), sz * (d / 2 - 0.1)), h / 2, rz(sx * (w / 2 - 0.1), sz * (d / 2 - 0.1)), 0.05, h, 0.05);
        glow(accent2, 1.6, x, h + 0.035, z, w * 0.3, 0.01, d * 0.5, rot, false);
        break;
      }
      case "pillar": {
        mz(wallMat).box(x, h / 2, z, w, h, d, 0);
        glow(accent, 2.2, x, 1.0, z, w + 0.04, 0.05, d + 0.04, 0, false);
        glow(accent, 1.6, x, Math.min(h, nav.ceilAt(x, z)) - 0.4, z, w + 0.04, 0.05, d + 0.04, 0, false);
        mz(trimMat).box(x, 0.15, z, w + 0.1, 0.3, d + 0.1);
        break;
      }
      case "rack": {
        const s = CELL * 0.9;
        mz(rackMat).box(x, h / 2, z, s, h, s);
        glow(accent2, 1.5, x, h + 0.01, z, s * 0.8, 0.02, s * 0.8, 0, false);
        break;
      }
      case "crate": {
        mz(crateMat).box(x, h / 2, z, 0.95, h, 0.95, rot);
        glow(new THREE.Color(0xffb547), 1.4, x, h * 0.5, z, 0.97, 0.05, 0.97, rot, false);
        glow(new THREE.Color(0xffb547), 1.4, x, h * 0.2, z, 0.97, 0.03, 0.97, rot, false);
        break;
      }
      case "ac": {
        mz(metalMat).box(x, h / 2, z, w, h, d, rot);
        mz(darkMat).box(rx(0, d / 2), h * 0.55, rz(0, d / 2), w * 0.8, h * 0.6, 0.04, rot);
        glow(accent2, 1.6, rx(w * 0.3, d / 2 + 0.03), h * 0.9, rz(w * 0.3, d / 2 + 0.03), 0.08, 0.05, 0.01, rot, false);
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ signs (own emissive textures)
  const signMeshes: THREE.Mesh[] = [];
  for (const s of def.signs) {
    if (s.w < 0.5) continue;
    const t = T(signTexture(s.text, s.sub, s.color, s.w, s.h));
    t.anisotropy = aniso;
    const mat = M(new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) }));
    const geo = G(new THREE.PlaneGeometry(s.w, s.h));
    const m = new THREE.Mesh(geo, mat);
    const a = (s.face * Math.PI) / 180;
    m.position.set(s.x * CELL, s.y, s.z * CELL);
    m.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
    m.position.x += Math.cos(a) * 0.04;
    m.position.z += Math.sin(a) * 0.04;
    group.add(m);
    signMeshes.push(m);
  }

  // ------------------------------------------------------------------ commit meshers
  const ceilMesh: { mesh: THREE.Mesh | null } = { mesh: null };
  const addMeshers = (src: Map<THREE.Material, Mesher>, parent: THREE.Object3D, extra?: (m: THREE.Mesh, mat: THREE.Material) => void) => {
    for (const [mat, ms] of src) {
      if (ms.empty) continue;
      const mesh = new THREE.Mesh(G(ms.geometry()), mat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (mat === glassMat || mat === glassFloorMat || mat === poolMat) mesh.renderOrder = mat === poolMat ? 2 : 3;
      if (mat === floorMat) mesh.renderOrder = 1;
      extra?.(mesh, mat);
      if (mat === ceilMat && parent === group) ceilMesh.mesh = mesh;
      parent.add(mesh);
    }
  };
  addMeshers(mesherFor, group);
  addMeshers(mirror, group);

  // ------------------------------------------------------------------ city outside
  const city = buildCity(def, tr, rnd, mobile);

  // ------------------------------------------------------------------ extraction pane
  const breach: { mesh: THREE.Mesh | null } = { mesh: null };
  {
    const [px, pz] = def.extractPane;
    const geo = G(new THREE.PlaneGeometry(CELL, def.ceil(Math.floor(def.extract[0]), Math.floor(def.extract[1]), ".") - 0.2));
    const mat = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(th.accent).multiplyScalar(0.0), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const m = new THREE.Mesh(geo, mat);
    const ex = def.extract[0] * CELL;
    const ez = def.extract[1] * CELL;
    // pane sits on the wall edge nearest the extraction point
    const dirx = px + 0.5 - def.extract[0];
    const dirz = pz + 0.5 - def.extract[1];
    if (Math.abs(dirx) > Math.abs(dirz)) {
      m.position.set(dirx > 0 ? px * CELL : (px + 1) * CELL, 1.9, ez);
      m.rotation.y = Math.PI / 2;
    } else {
      m.position.set(ex, 1.9, dirz > 0 ? pz * CELL : (pz + 1) * CELL);
    }
    group.add(m);
    breach.mesh = m;
  }

  // ------------------------------------------------------------------ runtime
  const glassTex = [tex.dropTex];
  return {
    group,
    city,
    fixtures,
    glassTex,
    breach,
    ceilMesh,
    uniforms,
    lightAt(x: number, z: number) {
      let s = 0.28;
      for (const f of fixtures) {
        if (!f.on) continue;
        const d = Math.hypot(f.x - x, f.z - z);
        if (d < 8) s += (1 - d / 8) * (1 - d / 8) * 0.9 * f.i;
      }
      return Math.min(1.9, s);
    },
    setExtract(on: boolean) {
      const m = breach.mesh?.material as THREE.MeshBasicMaterial | undefined;
      if (!m) return;
      m.opacity = on ? 0.28 : 0;
      m.color.copy(accent).multiplyScalar(on ? 2.2 : 0);
    },
    update(dt: number, t: number, center: THREE.Vector3) {
      uniforms.uTime.value = t;
      tex.dropTex.offset.y -= dt * 0.018;
      city.userData.update?.(dt, t, center);
    },
  };
  void accent2;
  void VENT_H;
}

// =========================================================================================
// City
// =========================================================================================
function buildCity(def: FloorDef, tr: Track, rnd: () => number, mobile: boolean) {
  const { G, M, T } = tr;
  const th = def.theme;
  const city = new THREE.Group();
  const A = th.altitude;
  const cx = (def.W * CELL) / 2;
  const cz = (def.H * CELL) / 2;
  const fog = new THREE.Color(th.fog);
  const mat = M(
    new THREE.ShaderMaterial({
      uniforms: { uFog: { value: fog }, uDens: { value: 0.0042 }, uTime: { value: 0 } },
      vertexShader: `
        attribute vec3 iData; varying vec3 vP; varying vec3 vN; varying vec3 vD; varying float vDepth;
        void main(){
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vP = position * sc + vec3(0.0, sc.y*0.5, 0.0); vN = normal; vD = iData;
          vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0); vDepth = -mv.z;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform vec3 uFog; uniform float uDens; uniform float uTime; varying vec3 vP; varying vec3 vN; varying vec3 vD; varying float vDepth;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main(){
          vec3 col = vec3(0.018,0.02,0.035) * (0.5 + vD.x);
          if (abs(vN.y) < 0.5) {
            vec2 uv = abs(vN.x) > 0.5 ? vec2(vP.z, vP.y) : vec2(vP.x, vP.y);
            vec2 q = uv / vec2(3.0, 3.6); vec2 cell = floor(q); vec2 f = fract(q);
            float m = step(0.2,f.x)*step(f.x,0.8)*step(0.22,f.y)*step(f.y,0.72);
            float r = h(cell + vD.x*91.0 + floor(vN.x*3.0+vN.z*7.0));
            float lit = step(1.0 - vD.z, r);
            vec3 wc = mix(vec3(1.0,0.74,0.46), mix(vec3(0.35,0.8,1.0), vec3(1.0,0.3,0.75), step(0.5, vD.y)), step(0.72, h(cell + 3.1)));
            col += wc * lit * m * (0.55 + 1.2*h(cell + 7.7));
            col += vec3(0.5,0.1,0.35) * smoothstep(0.0, 8.0, 8.0 - vP.y) * 0.0;
          } else { col += vec3(0.05,0.03,0.08) * step(0.5, vD.y); }
          float f = 1.0 - exp(-uDens*uDens*vDepth*vDepth);
          gl_FragColor = vec4(mix(col, uFog, f), 1.0);
        }`,
    }),
  );
  const geo = G(new THREE.BoxGeometry(1, 1, 1));
  const N = mobile ? 150 : 280;
  const data = new Float32Array(N * 3);
  const inst = new THREE.InstancedMesh(geo, mat, N);
  inst.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const bw = def.W * CELL;
  const bh = def.H * CELL;
  let n = 0;
  let guard = 0;
  while (n < N && guard++ < 4000) {
    const ang = rnd() * Math.PI * 2;
    const rad = 38 + Math.pow(rnd(), 0.8) * 420;
    const x = cx + Math.cos(ang) * rad * 1.15;
    const z = cz + Math.sin(ang) * rad;
    const w = 14 + rnd() * 34;
    const d = 14 + rnd() * 34;
    // keep out of the tower footprint
    if (x + w / 2 > -22 && x - w / 2 < bw + 22 && z + d / 2 > -22 && z - d / 2 < bh + 22) continue;
    const maxH = Math.min(520, 30 + rnd() * rnd() * 520 + rad * 0.25);
    const hgt = Math.max(30, maxH);
    m4.compose(new THREE.Vector3(x, -A + hgt / 2, z), q, new THREE.Vector3(w, hgt, d));
    inst.setMatrixAt(n, m4);
    data[n * 3] = rnd();
    data[n * 3 + 1] = rnd();
    data[n * 3 + 2] = 0.22 + rnd() * 0.5;
    n++;
  }
  inst.count = n;
  geo.setAttribute("iData", new THREE.InstancedBufferAttribute(data, 3));
  city.add(inst);

  // billboards
  const bbTexts = ["HALDEN", "NEO·KAI", "AXIOM", "VANTA", "DRIFT"];
  const bbCols = ["#fb7185", "#35f0ff", "#ffb547", "#b06bff", "#7dffb0"];
  for (let i = 0; i < 7; i++) {
    const k = i % bbTexts.length;
    const t = T(signTexture(bbTexts[k], undefined, bbCols[k], 6, 2.4));
    const bm = M(new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(1.8, 1.8, 1.8), fog: true }));
    const mesh = new THREE.Mesh(G(new THREE.PlaneGeometry(26, 10.4)), bm);
    const ang = (i / 7) * Math.PI * 2 + rnd() * 0.5;
    const rad = 90 + rnd() * 150;
    mesh.position.set(cx + Math.cos(ang) * rad, -A + 40 + rnd() * Math.min(260, A + 80), cz + Math.sin(ang) * rad);
    mesh.lookAt(cx, mesh.position.y, cz);
    city.add(mesh);
  }

  // traffic
  const TN = mobile ? 40 : 90;
  const tpos = new Float32Array(TN * 3);
  const tcol = new Float32Array(TN * 3);
  const tvel: THREE.Vector3[] = [];
  const palette = [new THREE.Color(0xfb7185), new THREE.Color(0x35f0ff), new THREE.Color(0xffd0a0), new THREE.Color(0xb06bff)];
  for (let i = 0; i < TN; i++) {
    const lane = Math.floor(rnd() * 6);
    const y = -A + 24 + lane * 22 + rnd() * 6;
    const axis = lane % 2;
    const sp = (14 + rnd() * 26) * (rnd() > 0.5 ? 1 : -1);
    tpos[i * 3] = cx + (rnd() - 0.5) * 700;
    tpos[i * 3 + 1] = y;
    tpos[i * 3 + 2] = cz + (rnd() - 0.5) * 700;
    tvel.push(new THREE.Vector3(axis ? 0 : sp, 0, axis ? sp : 0));
    const c = palette[Math.floor(rnd() * palette.length)];
    tcol[i * 3] = c.r * 2.4;
    tcol[i * 3 + 1] = c.g * 2.4;
    tcol[i * 3 + 2] = c.b * 2.4;
  }
  const tg = G(new THREE.BufferGeometry());
  tg.setAttribute("position", new THREE.BufferAttribute(tpos, 3));
  tg.setAttribute("color", new THREE.BufferAttribute(tcol, 3));
  const dotC = document.createElement("canvas");
  dotC.width = dotC.height = 32;
  const dctx = dotC.getContext("2d")!;
  const rg = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.4, "rgba(255,255,255,.4)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  dctx.fillStyle = rg;
  dctx.fillRect(0, 0, 32, 32);
  const dotTex = T(new THREE.CanvasTexture(dotC));
  const tmat = M(new THREE.PointsMaterial({ size: 4.5, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, sizeAttenuation: true }));
  const traffic = new THREE.Points(tg, tmat);
  traffic.frustumCulled = false;
  city.add(traffic);

  // rain streaks outside
  const RN = mobile ? 300 : 700;
  const rpos = new Float32Array(RN * 6);
  const rg2 = G(new THREE.BufferGeometry());
  rg2.setAttribute("position", new THREE.BufferAttribute(rpos, 3));
  const rmat = M(new THREE.LineBasicMaterial({ color: 0x9ab4e0, transparent: true, opacity: 0.35, depthWrite: false }));
  const rain = new THREE.LineSegments(rg2, rmat);
  rain.frustumCulled = false;
  const rseed: Float32Array = new Float32Array(RN * 3);
  for (let i = 0; i < RN; i++) {
    rseed[i * 3] = (rnd() - 0.5) * 160;
    rseed[i * 3 + 1] = rnd() * 90 - 30;
    rseed[i * 3 + 2] = (rnd() - 0.5) * 160;
  }
  city.add(rain);

  city.userData.update = (dt: number, t: number, center: THREE.Vector3) => {
    mat.uniforms.uTime.value = t;
    for (let i = 0; i < TN; i++) {
      tpos[i * 3] += tvel[i].x * dt;
      tpos[i * 3 + 2] += tvel[i].z * dt;
      if (tpos[i * 3] - cx > 380) tpos[i * 3] -= 760;
      if (tpos[i * 3] - cx < -380) tpos[i * 3] += 760;
      if (tpos[i * 3 + 2] - cz > 380) tpos[i * 3 + 2] -= 760;
      if (tpos[i * 3 + 2] - cz < -380) tpos[i * 3 + 2] += 760;
    }
    (tg.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    for (let i = 0; i < RN; i++) {
      rseed[i * 3 + 1] -= 46 * dt;
      if (rseed[i * 3 + 1] < -30) rseed[i * 3 + 1] += 90;
      let x = center.x + rseed[i * 3];
      const y = center.y + rseed[i * 3 + 1];
      let z = center.z + rseed[i * 3 + 2];
      if (x > -1 && x < bw + 1 && z > -1 && z < bh + 1) {
        // never rain indoors: push the streak out past the nearest facade
        const dl = x + 1, dr = bw + 1 - x, dt = z + 1, db = bh + 1 - z;
        const m = Math.min(dl, dr, dt, db);
        if (m === dl) x = -1.5 - (rseed[i * 3] & 7);
        else if (m === dr) x = bw + 1.5 + (rseed[i * 3] & 7);
        else if (m === dt) z = -1.5 - (rseed[i * 3 + 2] & 7);
        else z = bh + 1.5 + (rseed[i * 3 + 2] & 7);
      }
      rpos[i * 6] = x;
      rpos[i * 6 + 1] = y;
      rpos[i * 6 + 2] = z;
      rpos[i * 6 + 3] = x - 0.15;
      rpos[i * 6 + 4] = y + 1.4;
      rpos[i * 6 + 5] = z;
    }
    (rg2.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };
  return city;
}

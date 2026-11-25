/** GRIDLOCK — procedural tower models, enemy meshes and the reactor core. */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TOWERS, type TowerId } from "./data";
import type { Reg } from "./city";

export type TowerModel = {
  root: THREE.Group;
  aim: THREE.Object3D; // yaw
  pitch: THREE.Object3D | null;
  muzzle: THREE.Object3D;
  spin: THREE.Object3D | null;
  orb: THREE.Mesh | null;
  marks: THREE.Mesh[];
  halo: THREE.Mesh;
  disabledRing: THREE.Mesh;
  setTier(tier: number, branch: number): void;
};

const glowMat = (reg: Reg, color: number, k = 1.8) => reg.M(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false }));

export function createTowerKit(reg: Reg, turretSrc: THREE.Object3D | null) {
  const dark = reg.M(new THREE.MeshStandardMaterial({ color: 0x3a465c, roughness: 0.4, metalness: 0.75 }));
  const mid = reg.M(new THREE.MeshStandardMaterial({ color: 0x6c7b96, roughness: 0.34, metalness: 0.8 }));
  const trim = reg.M(new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 0.6, metalness: 0.5 }));
  const glows = {} as Record<TowerId, THREE.MeshBasicMaterial>;
  for (const id of Object.keys(TOWERS) as TowerId[]) glows[id] = glowMat(reg, TOWERS[id].color, 1.15);
  const white = glowMat(reg, 0xffffff, 1.0);
  const warn = glowMat(reg, 0xff4d5c, 1.3);
  const cyl = (rt: number, rb: number, h: number, seg = 20) => reg.G(new THREE.CylinderGeometry(rt, rb, h, seg));
  const tor = (r: number, t: number, seg = 28) => reg.G(new THREE.TorusGeometry(r, t, 8, seg));
  const box = (w: number, h: number, d: number) => reg.G(new THREE.BoxGeometry(w, h, d));
  const sph = (r: number, ws = 16, hs = 12) => reg.G(new THREE.SphereGeometry(r, ws, hs));
  const baseGeo = cyl(2.7, 3.1, 0.55);
  const baseRing = tor(2.75, 0.1, 40);
  const markGeo = box(0.55, 0.3, 0.55);
  const haloGeo = tor(3.4, 0.08, 48);
  const dishGeo = reg.G(new THREE.SphereGeometry(2.1, 24, 10, 0, Math.PI * 2, 0, 0.95));

  // turret_gun.glb → normalised to ~3 m
  let turretH = 3;
  if (turretSrc) {
    const b = new THREE.Box3().setFromObject(turretSrc);
    turretH = b.max.y - b.min.y || 1;
  }

  function build(id: TowerId): TowerModel {
    const root = new THREE.Group();
    const g = glows[id];
    const base = new THREE.Mesh(baseGeo, dark);
    base.position.y = 0.28;
    root.add(base);
    const ring = new THREE.Mesh(baseRing, g);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.58;
    root.add(ring);
    const aim = new THREE.Group();
    aim.position.y = 0.55;
    root.add(aim);
    let pitch: THREE.Object3D | null = null;
    let spin: THREE.Object3D | null = null;
    let orb: THREE.Mesh | null = null;
    const muzzle = new THREE.Object3D();

    if (id === "pulse") {
      if (turretSrc) {
        const clone = turretSrc.clone(true);
        const s = 3.1 / turretH;
        clone.scale.setScalar(s);
        const bb = new THREE.Box3().setFromObject(clone);
        clone.position.y = -bb.min.y;
        aim.add(clone);
        // the Top mesh rotates with the aim node; the bases stay put (they are cheap to leave attached)
        muzzle.position.set(0, 2.55, 1.6);
        const tint = new THREE.Mesh(sph(0.28), g);
        tint.position.set(0, 3.0, 0);
        aim.add(tint);
      } else {
        const body = new THREE.Mesh(box(1.4, 1.2, 1.4), mid);
        body.position.y = 0.8;
        aim.add(body);
        const barrel = new THREE.Mesh(box(0.35, 0.35, 2.6), dark);
        barrel.position.set(0, 1.2, 1.4);
        aim.add(barrel);
        muzzle.position.set(0, 1.2, 2.7);
      }
    } else if (id === "arc") {
      const col = new THREE.Mesh(cyl(0.55, 1.05, 3.6, 16), mid);
      col.position.y = 1.8;
      aim.add(col);
      for (let i = 0; i < 4; i++) {
        const t = new THREE.Mesh(tor(0.95 - i * 0.1, 0.12, 24), g);
        t.rotation.x = Math.PI / 2;
        t.position.y = 0.9 + i * 0.72;
        aim.add(t);
      }
      orb = new THREE.Mesh(sph(0.95), g);
      orb.position.y = 4.3;
      aim.add(orb);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const pr = new THREE.Mesh(cyl(0.07, 0.14, 2.3, 8), mid);
        pr.position.set(Math.cos(a) * 1.15, 4.1, Math.sin(a) * 1.15);
        pr.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        aim.add(pr);
      }
      muzzle.position.set(0, 4.5, 0);
    } else if (id === "emp") {
      const ped = new THREE.Mesh(cyl(0.7, 1.2, 1.5, 14), mid);
      ped.position.y = 0.75;
      aim.add(ped);
      const dish = new THREE.Mesh(dishGeo, dark);
      dish.position.y = 1.35;
      dish.scale.set(1, 0.7, 1);
      dish.rotation.x = Math.PI;
      dish.position.y = 3.0;
      aim.add(dish);
      orb = new THREE.Mesh(sph(0.6), g);
      orb.position.y = 2.65;
      aim.add(orb);
      spin = new THREE.Group();
      const sr = new THREE.Mesh(tor(1.8, 0.1, 40), g);
      sr.rotation.x = Math.PI / 2 + 0.35;
      spin.add(sr);
      const sr2 = new THREE.Mesh(tor(1.35, 0.08, 40), g);
      sr2.rotation.x = Math.PI / 2 - 0.5;
      spin.add(sr2);
      spin.position.y = 3.1;
      aim.add(spin);
      muzzle.position.set(0, 3.0, 0);
    } else if (id === "rail") {
      const mount = new THREE.Mesh(box(2.3, 1.5, 2.3), mid);
      mount.position.y = 0.75;
      aim.add(mount);
      pitch = new THREE.Group();
      pitch.position.y = 1.9;
      aim.add(pitch);
      for (const sx of [-0.55, 0.55]) {
        const r = new THREE.Mesh(box(0.42, 0.5, 7.2), dark);
        r.position.set(sx, 0, 2.2);
        pitch.add(r);
      }
      const rod = new THREE.Mesh(box(0.22, 0.22, 7.4), g);
      rod.position.set(0, 0, 2.2);
      pitch.add(rod);
      const brk = new THREE.Mesh(box(1.8, 0.9, 1.4), mid);
      brk.position.set(0, 0, -0.8);
      pitch.add(brk);
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(tor(0.55, 0.08, 16), g);
        c.position.set(0, 0, 0.8 + i * 1.7);
        pitch.add(c);
      }
      muzzle.position.set(0, 0, 5.9);
      pitch.add(muzzle);
    } else {
      // flak
      const sw = new THREE.Mesh(cyl(1.1, 1.5, 1.1, 14), mid);
      sw.position.y = 0.55;
      aim.add(sw);
      pitch = new THREE.Group();
      pitch.position.y = 1.5;
      aim.add(pitch);
      const hub = new THREE.Mesh(box(1.9, 1.4, 1.5), dark);
      pitch.add(hub);
      for (const sx of [-0.55, 0.55])
        for (const sy of [-0.38, 0.38]) {
          const br = new THREE.Mesh(cyl(0.2, 0.28, 3.4, 10), mid);
          br.rotation.x = Math.PI / 2;
          br.position.set(sx, sy, 2.2);
          pitch.add(br);
          const tip = new THREE.Mesh(cyl(0.3, 0.3, 0.3, 10), g);
          tip.rotation.x = Math.PI / 2;
          tip.position.set(sx, sy, 3.95);
          pitch.add(tip);
        }
      muzzle.position.set(0, 0, 4.2);
      pitch.add(muzzle);
    }
    if (!muzzle.parent) aim.add(muzzle);
    // tier marks on the base rim
    const marks: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (0.75 + i * 0.25);
      const m = new THREE.Mesh(markGeo, g);
      m.position.set(Math.cos(a) * 2.9, 0.62, Math.sin(a) * 2.9);
      m.rotation.y = -a;
      m.visible = i === 0;
      root.add(m);
      marks.push(m);
    }
    const halo = new THREE.Mesh(haloGeo, white);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.8;
    halo.visible = false;
    root.add(halo);
    const disabledRing = new THREE.Mesh(haloGeo, warn);
    disabledRing.rotation.x = Math.PI / 2;
    disabledRing.position.y = 1.2;
    disabledRing.visible = false;
    root.add(disabledRing);
    void trim;
    return {
      root,
      aim,
      pitch,
      muzzle,
      spin,
      orb,
      marks,
      halo,
      disabledRing,
      setTier(tier, branch) {
        marks.forEach((m, i) => (m.visible = i < tier));
        root.scale.setScalar(1.9 * (1 + (tier - 1) * 0.08));
        halo.visible = tier >= 3;
        halo.scale.setScalar(branch === 1 ? 1.12 : 1);
      },
    };
  }
  return { build, glows, white };
}

// ------------------------------------------------------------------ enemies
export type EnemyGeo = { body: THREE.BufferGeometry; glow: THREE.BufferGeometry; lift: number };

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  parts.forEach((p) => p.dispose());
  return g;
}

export function createEnemyGeos(reg: Reg): { skitter: EnemyGeo; hover: EnemyGeo; shield: EnemyGeo; splitter: EnemyGeo } {
  // skitter: low spider-drone
  const sb: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.85, 12, 8);
  body.scale(1, 0.55, 1.35);
  body.translate(0, 0.75, 0);
  sb.push(body);
  for (let i = 0; i < 3; i++)
    for (const sx of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.07, 0.05, 1.3, 5);
      leg.translate(0, 0.65, 0);
      leg.rotateZ(sx * 0.9);
      leg.translate(sx * 0.7, 0.05, (i - 1) * 0.6);
      sb.push(leg);
    }
  const sg: THREE.BufferGeometry[] = [];
  const eye = new THREE.SphereGeometry(0.28, 8, 6);
  eye.translate(0, 0.95, 1.05);
  sg.push(eye);
  const stripe = new THREE.BoxGeometry(0.18, 0.1, 1.5);
  stripe.translate(0, 1.28, -0.1);
  sg.push(stripe);
  const skitter = { body: reg.G(merge(sb)), glow: reg.G(merge(sg)), lift: 0 };

  // hover: saucer with rotor ring
  const hb: THREE.BufferGeometry[] = [];
  const disc = new THREE.SphereGeometry(1.5, 16, 8);
  disc.scale(1, 0.38, 1);
  hb.push(disc);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = new THREE.CylinderGeometry(0.1, 0.1, 1.5, 6);
    arm.rotateZ(Math.PI / 2);
    arm.rotateY(-a);
    arm.translate(Math.cos(a) * 1.6, 0.05, Math.sin(a) * 1.6);
    hb.push(arm);
  }
  const hg: THREE.BufferGeometry[] = [];
  const rim = new THREE.TorusGeometry(1.5, 0.1, 6, 28);
  rim.rotateX(Math.PI / 2);
  hg.push(rim);
  const dome = new THREE.SphereGeometry(0.5, 10, 8);
  dome.translate(0, 0.35, 0);
  hg.push(dome);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rot = new THREE.TorusGeometry(0.62, 0.06, 5, 14);
    rot.rotateX(Math.PI / 2);
    rot.translate(Math.cos(a) * 2.2, 0.08, Math.sin(a) * 2.2);
    hg.push(rot);
  }
  const hover = { body: reg.G(merge(hb)), glow: reg.G(merge(hg)), lift: 0 };

  // shield carrier: hex pylon
  const pb: THREE.BufferGeometry[] = [];
  const hex = new THREE.CylinderGeometry(1.35, 1.65, 2.4, 6);
  hex.translate(0, 1.4, 0);
  pb.push(hex);
  const cap = new THREE.CylinderGeometry(0.5, 1.1, 0.7, 6);
  cap.translate(0, 3.05, 0);
  pb.push(cap);
  const pg: THREE.BufferGeometry[] = [];
  const ringG = new THREE.TorusGeometry(1.55, 0.12, 6, 6);
  ringG.rotateX(Math.PI / 2);
  ringG.translate(0, 1.5, 0);
  pg.push(ringG);
  const gem = new THREE.OctahedronGeometry(0.55);
  gem.translate(0, 3.8, 0);
  pg.push(gem);
  const shield = { body: reg.G(merge(pb)), glow: reg.G(merge(pg)), lift: 0 };

  // splitter: node cluster
  const dodeca = new THREE.DodecahedronGeometry(1.4, 0);
  dodeca.translate(0, 1.7, 0);
  const sp = dodeca.getAttribute("position");
  const seen = new Set<string>();
  const nodes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < sp.count; i++) {
    const key = `${sp.getX(i).toFixed(2)},${sp.getY(i).toFixed(2)},${sp.getZ(i).toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = new THREE.SphereGeometry(0.32, 6, 5);
    n.translate(sp.getX(i) * 1.02, sp.getY(i) + (sp.getY(i) - 1.7) * 0.02, sp.getZ(i) * 1.02);
    nodes.push(n);
  }
  const splitter = { body: reg.G(dodeca), glow: reg.G(merge(nodes)), lift: 0 };
  return { skitter, hover, shield, splitter };
}

// ------------------------------------------------------------------ reactor
export type Reactor = {
  group: THREE.Group;
  core: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  rings: THREE.Mesh[];
  light: THREE.PointLight;
  beam: THREE.Mesh;
  update(t: number, frac: number, hit: number): void;
};

export function buildReactor(reg: Reg, fade: THREE.Texture): Reactor {
  const group = new THREE.Group();
  const dark = reg.M(new THREE.MeshStandardMaterial({ color: 0x1a2330, roughness: 0.4, metalness: 0.85 }));
  const coreMat = reg.M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4ade80).multiplyScalar(1.6), toneMapped: false }));
  const base = new THREE.Mesh(reg.G(new THREE.CylinderGeometry(8.2, 9.2, 1.1, 40)), dark);
  base.position.y = 0.55;
  group.add(base);
  const trim = new THREE.Mesh(reg.G(new THREE.TorusGeometry(8.4, 0.18, 8, 64)), coreMat);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 1.15;
  group.add(trim);
  const trim2 = new THREE.Mesh(reg.G(new THREE.TorusGeometry(6.2, 0.1, 8, 64)), coreMat);
  trim2.rotation.x = Math.PI / 2;
  trim2.position.y = 1.15;
  group.add(trim2);
  const pillar = new THREE.Mesh(reg.G(new THREE.CylinderGeometry(2.7, 3.4, 3.2, 8)), dark);
  pillar.position.y = 2.7;
  group.add(pillar);
  const core = new THREE.Mesh(reg.G(new THREE.CylinderGeometry(1.9, 1.9, 9, 8, 1, true)), coreMat);
  core.position.y = 8.2;
  group.add(core);
  const cap1 = new THREE.Mesh(reg.G(new THREE.OctahedronGeometry(2.4)), coreMat);
  cap1.position.y = 14.3;
  group.add(cap1);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(reg.G(new THREE.TorusGeometry(3.8 + i * 0.7, 0.16, 8, 48)), dark);
    r.position.y = 6 + i * 3.4;
    group.add(r);
    rings.push(r);
    const e = new THREE.Mesh(reg.G(new THREE.TorusGeometry(3.8 + i * 0.7, 0.07, 6, 48)), coreMat);
    r.add(e);
  }
  const beamMat = reg.M(
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4ade80).multiplyScalar(1.4), map: fade, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }),
  );
  const beam = new THREE.Mesh(reg.G(new THREE.CylinderGeometry(1.2, 2.4, 160, 20, 1, true).translate(0, 80, 0)), beamMat);
  beam.position.y = 3;
  group.add(beam);
  const light = new THREE.PointLight(0x4ade80, 90, 70, 1.6);
  light.position.y = 10;
  group.add(light);
  return {
    group,
    core,
    coreMat,
    rings,
    light,
    beam,
    update(t, frac, hit) {
      rings.forEach((r, i) => {
        r.rotation.y = t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1);
        r.rotation.x = Math.sin(t * 0.7 + i) * 0.12;
      });
      cap1.rotation.y = t * 1.2;
      const c = new THREE.Color().setHSL(0.37 * Math.max(0, Math.min(1, (frac - 0.1) / 0.8)), 0.8, 0.55);
      const pulse = 1 + Math.sin(t * (2 + (1 - frac) * 6)) * 0.12 + hit * 1.4;
      coreMat.color.copy(c).multiplyScalar(1.5 * pulse);
      (beam.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(1.2);
      light.color.copy(c);
      light.intensity = (80 + hit * 160) * (0.9 + 0.1 * Math.sin(t * 3));
    },
  };
}

/**
 * FREEFALL: the wingsuit flyer. A skinned soldier posed procedurally (arms swept back, legs spread, head up),
 * a glowing wing membrane stretched between hands, feet and hips, neon contrails, and the canopy.
 */
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { rotateBoneWorld } from "../nexus-lib/rig";
import type { Res } from "./world";

export type FlyerPose = {
  fly: number; // 0..1 blend into the prone wingsuit pose
  hang: number; // 0..1 blend into the canopy hang pose
  dive: number; // 0..1 arms pulled back
  flare: number; // 0..1 arms wide
  bank: number; // -1..1
  flap: number; // flutter amplitude
};

type Trail = { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial; pts: THREE.Vector3[]; ups: THREE.Vector3[]; n: number };

const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const BONES = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
];

export type Flyer = ReturnType<typeof createFlyer>;

export function createFlyer(
  scene: THREE.Scene,
  res: Res,
  src: THREE.Object3D | null,
  clips: THREE.AnimationClip[],
  opts: { color: number; ghost?: boolean; mobile: boolean; dot: THREE.Texture },
) {
  const { G, M } = res;
  const color = opts.color;
  const ghost = !!opts.ghost;
  const root = new THREE.Group();
  scene.add(root);
  const bones = new Map<string, THREE.Object3D>();
  const restQ = new Map<string, THREE.Quaternion>();
  const restP = new Map<string, THREE.Vector3>();
  let mixer: THREE.AnimationMixer | null = null;
  let char: THREE.Object3D | null = null;
  let height = 1.7;
  const mats: THREE.Material[] = [];

  if (src) {
    char = cloneSkeleton(src);
    char.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const sm = m.material as THREE.MeshStandardMaterial;
      const mm = sm.clone();
      if (/visor/i.test(m.name) || /visor/i.test(sm.name)) {
        mm.emissive = new THREE.Color(color);
        mm.emissiveIntensity = 1.6;
        mm.color.setHex(0x0a0d10);
      } else {
        mm.color.lerp(new THREE.Color(0x3a4150), 0.35);
        mm.emissive = new THREE.Color(color).multiplyScalar(0.1);
      }
      if (ghost) {
        mm.transparent = true;
        mm.opacity = 0.32;
        mm.depthWrite = false;
        mm.emissive = new THREE.Color(color);
        mm.emissiveIntensity = 0.9;
        mm.color.setHex(0x2a7aa8);
      }
      mats.push(mm);
      m.material = mm;
      m.frustumCulled = false;
    });
    char.scale.setScalar(0.92);
    root.add(char);
    root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(char);
    height = Math.max(1.2, bb.max.y - bb.min.y);
    char.position.set(0, -height / 2, 0);
    for (const n of BONES) {
      const b = char.getObjectByName(`mixamorig:${n}`) ?? char.getObjectByName(`mixamorig${n}`);
      if (b) {
        bones.set(n, b);
        restQ.set(n, b.quaternion.clone());
        restP.set(n, b.position.clone());
      }
    }
    mixer = new THREE.AnimationMixer(char);
    const idle = clips.find((c) => c.name === "Idle");
    if (idle) mixer.clipAction(idle).play();
    mixer.update(0.01);
  } else {
    const fb = new THREE.Mesh(G(new THREE.CapsuleGeometry(0.28, 1.0, 4, 8).rotateX(Math.PI / 2)), M(new THREE.MeshStandardMaterial({ color: 0x20242c })));
    root.add(fb);
  }

  // ------------------------------------------------------------------ wing membrane
  const wingPts = new Float32Array(7 * 3 * 3);
  const wingGeo = G(new THREE.BufferGeometry());
  wingGeo.setAttribute("position", new THREE.BufferAttribute(wingPts, 3));
  const wingCols = new Float32Array(7 * 3 * 3);
  const accent = new THREE.Color(color);
  // vertex tint: bright along the hand edge, faint toward the body
  const tint = [1, 1, 0.55, 1, 0.55, 0.25, 1, 1, 0.55, 1, 0.55, 0.25, 0.55, 0.55, 0.25];
  for (let i = 0; i < 15; i++) wingCols.set([accent.r * tint[i], accent.g * tint[i], accent.b * tint[i]], i * 3);
  wingGeo.setAttribute("color", new THREE.BufferAttribute(wingCols, 3));
  const wingMat = M(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: ghost ? 0.22 : 0.62, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.frustumCulled = false;
  root.add(wing);
  const edgePts = new Float32Array(8 * 2 * 3);
  const edgeGeo = G(new THREE.BufferGeometry());
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePts, 3));
  const edgeMat = M(new THREE.LineBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5), transparent: true, opacity: ghost ? 0.4 : 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.frustumCulled = false;
  root.add(edges);

  // ------------------------------------------------------------------ contrails
  function makeTrail(width: number): Trail & { width: number } {
    const n = opts.mobile ? 16 : 26;
    const geo = G(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const col = new Float32Array(n * 2 * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = Math.pow(1 - i / (n - 1), 2.2) * (ghost ? 0.45 : 1);
      for (let j = 0; j < 2; j++) col.set([c.r * k * 1.1, c.g * k * 1.1, c.b * k * 1.1], (i * 2 + j) * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    geo.setIndex(idx);
    const mat = M(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return {
      mesh,
      geo,
      mat,
      n,
      width,
      pts: Array.from({ length: n }, () => new THREE.Vector3()),
      ups: Array.from({ length: n }, () => new THREE.Vector3(0, 1, 0)),
    };
  }
  const trails = [makeTrail(0.08), makeTrail(0.08), makeTrail(0.06), makeTrail(0.06)];
  const trailBones = ["LeftHand", "RightHand", "LeftFoot", "RightFoot"];
  function pushTrail(tr: Trail & { width: number }, p: THREE.Vector3, up: THREE.Vector3, reset: boolean) {
    if (reset) for (let i = 0; i < tr.n; i++) tr.pts[i].copy(p);
    for (let i = tr.n - 1; i > 0; i--) {
      tr.pts[i].copy(tr.pts[i - 1]);
      tr.ups[i].copy(tr.ups[i - 1]);
    }
    tr.pts[0].copy(p);
    tr.ups[0].copy(up).multiplyScalar(tr.width);
    const a = tr.geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < tr.n; i++) {
      const w = 1 - i / tr.n;
      a.setXYZ(i * 2, tr.pts[i].x + tr.ups[i].x * w, tr.pts[i].y + tr.ups[i].y * w, tr.pts[i].z + tr.ups[i].z * w);
      a.setXYZ(i * 2 + 1, tr.pts[i].x - tr.ups[i].x * w, tr.pts[i].y - tr.ups[i].y * w, tr.pts[i].z - tr.ups[i].z * w);
    }
    a.needsUpdate = true;
  }

  // ------------------------------------------------------------------ canopy
  const canopy = new THREE.Group();
  canopy.visible = false;
  root.add(canopy);
  let canopyLines: THREE.LineSegments | null = null;
  {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 32;
    const c = cv.getContext("2d")!;
    for (let i = 0; i < 16; i++) {
      c.fillStyle = i % 2 ? "#0d3a5a" : "#38bdf8";
      c.fillRect(i * 16, 0, 16, 32);
    }
    c.fillStyle = "rgba(255,255,255,.7)";
    c.fillRect(0, 0, 256, 3);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    res.T(tex);
    const geo = G(new THREE.SphereGeometry(1, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.5));
    const mat = M(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: ghost ? 0.3 : 0.82, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.3, 1.3, 1.3) }));
    const dome = new THREE.Mesh(geo, mat);
    dome.scale.set(4.8, 1.7, 3.0);
    dome.frustumCulled = false;
    canopy.add(dome);
    // suspension lines: rim → shoulders
    const lp: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rx = Math.cos(a) * 4.8;
      const rz = Math.sin(a) * 3.0;
      lp.push(rx, 0, rz, Math.sign(Math.cos(a)) * 0.25, -6.2, 0);
    }
    const lg = G(new THREE.BufferGeometry());
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    canopyLines = new THREE.LineSegments(lg, M(new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.5 })));
    canopyLines.frustumCulled = false;
    canopy.add(canopyLines);
    canopy.position.set(0, 6.4, 0);
  }

  // ------------------------------------------------------------------ pose
  const tq = new THREE.Quaternion();
  const rootQ = new THREE.Quaternion();
  const ax = new THREE.Vector3();
  const saved = new Map<string, THREE.Quaternion>();
  const target = new Map<string, THREE.Quaternion>();
  const savedHips = new THREE.Vector3();
  const bAxis = (a: THREE.Vector3) => ax.copy(a).applyQuaternion(rootQ);
  const rot = (name: string, axis: THREE.Vector3, ang: number) => {
    const b = bones.get(name);
    if (b) rotateBoneWorld(b, bAxis(axis), ang);
  };
  function resetToRest() {
    for (const [n, b] of bones) {
      b.quaternion.copy(restQ.get(n)!);
      if (n === "Hips") b.position.copy(restP.get(n)!);
    }
    root.updateMatrixWorld(true);
  }
  function flyTarget(p: FlyerPose, t: number) {
    const sweep = 0.5 + 0.5 * p.dive - 0.35 * p.flare;
    const flutter = Math.sin(t * 38) * 0.05 * p.flap;
    // model axes: +X = right, +Y = head, chest faces -Z. Arms swept back = toward -Y.
    rot("Head", AX, 0.75);
    rot("Neck", AX, 0.25);
    rot("Spine1", AX, -0.12);
    rot("RightArm", AZ, -(sweep - p.bank * 0.22 - flutter));
    rot("LeftArm", AZ, sweep + p.bank * 0.22 + flutter);
    rot("RightForeArm", AZ, -0.08);
    rot("LeftForeArm", AZ, 0.08);
    const spread = 0.2 + 0.1 * p.flare + 0.02 * Math.abs(p.bank);
    rot("RightUpLeg", AZ, spread + p.bank * 0.1);
    rot("LeftUpLeg", AZ, -spread + p.bank * 0.1);
    rot("LeftLeg", AX, 0.1);
    rot("RightLeg", AX, 0.1);
  }
  function hangTarget() {
    rot("RightArm", AZ, 1.3);
    rot("LeftArm", AZ, -1.3);
    rot("RightForeArm", AZ, 0.4);
    rot("LeftForeArm", AZ, -0.4);
    rot("RightUpLeg", AZ, 0.06);
    rot("LeftUpLeg", AZ, -0.06);
    rot("LeftLeg", AX, -0.25);
    rot("RightLeg", AX, -0.25);
    rot("Head", AX, -0.1);
  }

  const wp = new THREE.Vector3();
  const lp = new THREE.Vector3();
  const upV = new THREE.Vector3();
  let trailInit = true;

  /** Update bones after root's transform has been set. */
  function pose(p: FlyerPose, dt: number, t: number) {
    if (!char) return;
    const needAnim = p.fly < 0.999 && p.hang < 0.999;
    if (mixer && needAnim) mixer.update(dt);
    if (p.fly > 0.001 || p.hang > 0.001) {
      root.updateMatrixWorld(true);
      root.getWorldQuaternion(rootQ);
      // save animated
      for (const [n, b] of bones) {
        if (!saved.has(n)) saved.set(n, new THREE.Quaternion());
        saved.get(n)!.copy(b.quaternion);
      }
      savedHips.copy(bones.get("Hips")!.position);
      const grab = (map: Map<string, THREE.Quaternion>) => {
        for (const [n, b] of bones) {
          if (!map.has(n)) map.set(n, new THREE.Quaternion());
          map.get(n)!.copy(b.quaternion);
        }
      };
      const flyQ = new Map<string, THREE.Quaternion>();
      const hangQ = new Map<string, THREE.Quaternion>();
      if (p.fly > 0.001) {
        resetToRest();
        flyTarget(p, t);
        grab(flyQ);
      }
      if (p.hang > 0.001) {
        resetToRest();
        hangTarget();
        grab(hangQ);
      }
      for (const [n, b] of bones) {
        tq.copy(saved.get(n)!);
        if (p.fly > 0.001) tq.slerp(flyQ.get(n)!, p.fly);
        if (p.hang > 0.001) tq.slerp(hangQ.get(n)!, p.hang);
        b.quaternion.copy(tq);
      }
      const hips = bones.get("Hips")!;
      hips.position.copy(savedHips).lerp(restP.get("Hips")!, Math.max(p.fly, p.hang));
      void target;
    }
    root.updateMatrixWorld(true);
    // wing membrane (in root space)
    const g = (n: string, out: THREE.Vector3) => {
      const b = bones.get(n);
      if (!b) return out.set(0, 0, 0);
      b.getWorldPosition(wp);
      return out.copy(root.worldToLocal(wp));
    };
    const aL = g("LeftArm", new THREE.Vector3());
    const hL = g("LeftHand", new THREE.Vector3());
    const fL = g("LeftFoot", new THREE.Vector3());
    const aR = g("RightArm", new THREE.Vector3());
    const hR = g("RightHand", new THREE.Vector3());
    const fR = g("RightFoot", new THREE.Vector3());
    const hip = g("Hips", new THREE.Vector3());
    // extend the hand and foot tips a little so the surface reads as a wing, not a cloth scrap
    const ext = (a: THREE.Vector3, b: THREE.Vector3, k: number) => b.clone().addScaledVector(b.clone().sub(a), k);
    const hL2 = ext(aL, hL, 0.35);
    const hR2 = ext(aR, hR, 0.35);
    const fL2 = ext(hip, fL, 0.15);
    const fR2 = ext(hip, fR, 0.15);
    const tris: THREE.Vector3[][] = [
      [aL, hL2, fL2],
      [aL, fL2, hip],
      [aR, hR2, fR2],
      [aR, fR2, hip],
      [fL2, fR2, hip],
    ];
    let k = 0;
    for (const tri of tris) for (const v of tri) wingPts.set([v.x, v.y, v.z], k++ * 3);
    (wingGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    const e: THREE.Vector3[] = [aL, hL2, hL2, fL2, fL2, fR2, fR2, hR2, hR2, aR, aL, hip, aR, hip];
    for (let i = 0; i < e.length; i++) edgePts.set([e[i].x, e[i].y, e[i].z], i * 3);
    edgeGeo.setDrawRange(0, e.length);
    (edgeGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    const wv = Math.min(1, p.fly) * (1 - p.hang);
    wing.visible = edges.visible = wv > 0.05;
    wingMat.opacity = (ghost ? 0.22 : 0.62) * wv;
    edgeMat.opacity = (ghost ? 0.4 : 0.95) * wv;
    void upV;
    void lp;
  }

  function updateTrails(visibleK: number, upDir: THREE.Vector3) {
    trailBones.forEach((n, i) => {
      const b = bones.get(n);
      const tr = trails[i];
      if (!b) return;
      b.getWorldPosition(wp);
      pushTrail(tr, wp, upDir, trailInit);
      tr.mat.opacity = visibleK * (ghost ? 0.5 : 0.85);
    });
    trailInit = false;
  }
  function resetTrails() {
    trailInit = true;
  }

  function setCanopy(open: number, t: number) {
    canopy.visible = open > 0.01;
    if (!canopy.visible) return;
    const o = open < 1 ? 1 - Math.pow(1 - open, 3) * Math.cos(open * 9) : 1;
    const flutter = 1 + Math.sin(t * 7) * 0.012;
    canopy.scale.set(Math.max(0.05, o) * flutter, Math.max(0.05, o), Math.max(0.05, o));
    canopy.rotation.z = Math.sin(t * 2.1) * 0.05;
  }

  function dispose() {
    scene.remove(root);
    for (const tr of trails) scene.remove(tr.mesh);
    mixer?.stopAllAction();
    for (const m of mats) m.dispose();
  }

  return { root, height, pose, updateTrails, resetTrails, setCanopy, canopy, dispose, hasModel: !!char, bonePos: (n: string, out: THREE.Vector3) => bones.get(n)?.getWorldPosition(out) };
}

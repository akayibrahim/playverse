// Offline retarget: Quaternius UAL (CC0) clips → soldier.glb mixamorig skeleton.
// usage: node retarget.mjs <projectDir> <ual1.glb> <ual2.glb> <out.json>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [proj, ual1, ual2, outFile] = process.argv.slice(2);
const nm = (p) => pathToFileURL(path.join(proj, "node_modules/three", p)).href;
const THREE = await import(nm("build/three.module.js"));
const { GLTFLoader } = await import(nm("examples/jsm/loaders/GLTFLoader.js"));

globalThis.self = globalThis;
const loader = new GLTFLoader();
function load(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => loader.parse(ab, "", res, rej));
}

// target bone (sanitized mixamo) → [UAL1 name, UAL2 name]
const MAP = {
  Hips: ["DEF-hips", "pelvis"],
  Spine: ["DEF-spine.001", "spine_01"],
  Spine1: ["DEF-spine.002", "spine_02"],
  Spine2: ["DEF-spine.003", "spine_03"],
  Neck: ["DEF-neck", "neck_01"],
  Head: ["DEF-head", "Head"],
  LeftShoulder: ["DEF-shoulder.L", "clavicle_l"],
  LeftArm: ["DEF-upper_arm.L", "upperarm_l"],
  LeftForeArm: ["DEF-forearm.L", "lowerarm_l"],
  LeftHand: ["DEF-hand.L", "hand_l"],
  RightShoulder: ["DEF-shoulder.R", "clavicle_r"],
  RightArm: ["DEF-upper_arm.R", "upperarm_r"],
  RightForeArm: ["DEF-forearm.R", "lowerarm_r"],
  RightHand: ["DEF-hand.R", "hand_r"],
  LeftUpLeg: ["DEF-thigh.L", "thigh_l"],
  LeftLeg: ["DEF-shin.L", "calf_l"],
  LeftFoot: ["DEF-foot.L", "foot_l"],
  LeftToeBase: ["DEF-toe.L", "ball_l"],
  RightUpLeg: ["DEF-thigh.R", "thigh_r"],
  RightLeg: ["DEF-shin.R", "calf_r"],
  RightFoot: ["DEF-foot.R", "foot_r"],
  RightToeBase: ["DEF-toe.R", "ball_r"],
};
// child used for rest-direction alignment
const CHILD = {
  Hips: "Spine", Spine: "Spine1", Spine1: "Spine2", Spine2: "Neck", Neck: "Head",
  LeftShoulder: "LeftArm", LeftArm: "LeftForeArm", LeftForeArm: "LeftHand",
  RightShoulder: "RightArm", RightArm: "RightForeArm", RightForeArm: "RightHand",
  LeftUpLeg: "LeftLeg", LeftLeg: "LeftFoot", LeftFoot: "LeftToeBase",
  RightUpLeg: "RightLeg", RightLeg: "RightFoot", RightFoot: "RightToeBase",
};
const ORDER = Object.keys(MAP); // parents before children

// [outName, pack, srcClip, opts]
const JOBS = [
  ["death_a", 0, "Death01", {}],
  ["death_b", 0, "Death01", { mirror: true }],
  ["death_c", 1, "LayToIdle", { reverse: true }],
  ["hit_chest", 0, "Hit_Chest", {}],
  ["hit_head", 0, "Hit_Head", {}],
  ["knockback", 1, "Hit_Knockback", {}],
  ["crouch_idle", 0, "Crouch_Idle_Loop", {}],
  ["crouch_walk", 0, "Crouch_Fwd_Loop", {}],
  ["throw", 1, "OverhandThrow", {}],
  ["takedown", 1, "Melee_Hook", {}],
  ["getup", 1, "LayToIdle", {}],
  ["roll", 0, "Roll", {}],
];

const tgt = await load(path.join(proj, "public/assets/models/soldier.glb"));
const tScene = tgt.scene;
const tBones = {};
tScene.traverse((o) => {
  const m = /^mixamorig:?(.+)$/.exec(o.name);
  if (o.isBone && m) tBones[m[1]] = o;
});
// target rest = TPose clip
{
  const mx = new THREE.AnimationMixer(tScene);
  mx.clipAction(tgt.animations.find((c) => c.name === "TPose")).play();
  mx.setTime(0);
  tScene.updateMatrixWorld(true);
}
const q = () => new THREE.Quaternion();
const v = () => new THREE.Vector3();
const tRestW = {}, tRestPos = {}, tParentW = {};
const tHipsParentInv = new THREE.Matrix4().copy(tBones.Hips.parent.matrixWorld).invert();
for (const n of ORDER) {
  tRestW[n] = tBones[n].getWorldQuaternion(q());
  tRestPos[n] = tBones[n].getWorldPosition(v());
}
const tHipsH = tRestPos.Hips.y;
const tHipsRestLocal = tBones.Hips.position.clone();

const packs = [await load(ual1), await load(ual2)];
const out = [];
const FPS = 30;

for (const [outName, pi, srcName, opts] of JOBS) {
  const src = packs[pi];
  const idx = pi;
  const sScene = src.scene;
  const sBones = {};
  sScene.traverse((o) => {
    if (o.isBone) sBones[o.name] = o;
  });
  const sb = (n) => sBones[THREE.PropertyBinding.sanitizeNodeName(MAP[n][idx])];
  const mx = new THREE.AnimationMixer(sScene);
  // source rest = A_TPose
  const restAct = mx.clipAction(src.animations.find((c) => c.name === "A_TPose"));
  restAct.play();
  mx.setTime(0);
  sScene.updateMatrixWorld(true);
  const sRestW = {}, sRestPos = {};
  for (const n of ORDER) {
    sRestW[n] = sb(n).getWorldQuaternion(q());
    sRestPos[n] = sb(n).getWorldPosition(v());
  }
  // facing alignment: forward = toe - foot (horizontal)
  const fwd = (pos) => v().subVectors(pos.LeftToeBase, pos.LeftFoot).setY(0).normalize();
  const C = q().setFromUnitVectors(fwd(sRestPos), fwd(tRestPos));
  const Ci = C.clone().invert();
  const sHipsH = sRestPos.Hips.y;
  const scale = tHipsH / sHipsH;
  // rest alignment R_b: rotate target rest bone dir onto source rest bone dir (common frame)
  const R = {};
  for (const n of ORDER) {
    const c = CHILD[n];
    if (!c) {
      const p = Object.keys(CHILD).find((k) => CHILD[k] === n);
      R[n] = p ? R[p].clone() : q();
      continue;
    }
    const ds = v().subVectors(sRestPos[c], sRestPos[n]).applyQuaternion(C).normalize();
    const dt = v().subVectors(tRestPos[c], tRestPos[n]).normalize();
    R[n] = q().setFromUnitVectors(dt, ds);
  }
  restAct.stop();
  const clip = src.animations.find((c) => c.name === srcName);
  const act = mx.clipAction(clip);
  act.play();
  const dur = clip.duration;
  const frames = Math.max(2, Math.round(dur * FPS) + 1);
  const times = [];
  const qv = {};
  for (const n of ORDER) qv[n] = [];
  const hp = [];
  const mirrorName = (n) => (n.startsWith("Left") ? "Right" + n.slice(4) : n.startsWith("Right") ? "Left" + n.slice(5) : n);
  for (let f = 0; f < frames; f++) {
    const tt = (f / (frames - 1)) * dur;
    times.push(+(f / FPS).toFixed(4));
    const st = opts.reverse ? dur - tt : tt;
    mx.setTime(0);
    act.time = st;
    mx.update(0);
    sScene.updateMatrixWorld(true);
    const W = {};
    for (const n of ORDER) {
      const Q = C.clone().multiply(sb(n).getWorldQuaternion(q())).multiply(sRestW[n].clone().invert()).multiply(Ci);
      W[n] = Q.multiply(R[n]).multiply(tRestW[n]);
    }
    const hpos = sb("Hips").getWorldPosition(v()).sub(sRestPos.Hips).applyQuaternion(C).multiplyScalar(scale);
    if (opts.mirror) {
      // mirror across target's local X (soldier is symmetric about X=0)
      const M = {};
      for (const n of ORDER) {
        const w = W[mirrorName(n)];
        const d = w.clone().multiply(tRestW[mirrorName(n)].clone().invert()); // world delta
        const dm = new THREE.Quaternion(d.x, -d.y, -d.z, d.w); // reflect delta across YZ plane
        M[n] = dm.multiply(tRestW[n]);
      }
      Object.assign(W, M);
      hpos.x = -hpos.x;
    }
    // world → local
    for (const n of ORDER) {
      const b = tBones[n];
      const pw = n === "Hips" ? b.parent.getWorldQuaternion(q()) : W[ORDER.find((k) => tBones[k] === b.parent)] ?? b.parent.getWorldQuaternion(q());
      const loc = pw.clone().invert().multiply(W[n]);
      qv[n].push(...loc.toArray().map((x) => +x.toFixed(4)));
    }
    const wp = tRestPos.Hips.clone().add(hpos).applyMatrix4(tHipsParentInv);
    hp.push(...wp.toArray().map((x) => +x.toFixed(3)));
  }
  const tracks = [new THREE.VectorKeyframeTrack(`mixamorig${"Hips"}.position`, times, hp)];
  for (const n of ORDER) tracks.push(new THREE.QuaternionKeyframeTrack(`mixamorig${n}.quaternion`, times, qv[n]));
  const c = new THREE.AnimationClip(outName, -1, tracks);
  out.push(THREE.AnimationClip.toJSON(c));
  act.stop();
  console.log(outName, dur.toFixed(2), frames, "scale", scale.toFixed(3));
}
fs.writeFileSync(outFile, JSON.stringify(out));
console.log("wrote", outFile, (fs.statSync(outFile).size / 1024).toFixed(0), "KB", "hipsRestLocal", tHipsRestLocal.toArray());

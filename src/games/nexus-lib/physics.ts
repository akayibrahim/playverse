/**
 * NEXUS 2100 — rigid-body physics (Rapier, WASM, lazy-loaded).
 *
 * Used for things that should tumble and settle believably: ragdolls, dropped rifles, drone wrecks,
 * brass, debris and (later) grenades. Gameplay movement and hit detection stay on the existing
 * kinematic/raycast code, so the game still runs if the WASM fails to load.
 */
import * as THREE from "three";
import type * as RAPIER_NS from "@dimforge/rapier3d-compat";

type R = typeof RAPIER_NS;

export type Prop = {
  obj: THREE.Object3D;
  body: RAPIER_NS.RigidBody;
  life: number;
  age: number;
  onRemove?: () => void;
  onImpact?: (speed: number) => void;
  lastVy: number;
};

export type Ragdoll = {
  parts: { bone: THREE.Object3D; body: RAPIER_NS.RigidBody; offQ: THREE.Quaternion; offP: THREE.Vector3 | null }[];
  bodies: RAPIER_NS.RigidBody[];
  active: boolean;
};

export type Physics = {
  R: R;
  world: RAPIER_NS.World;
  addStaticBox(box: THREE.Box3): void;
  prop(
    obj: THREE.Object3D,
    half: THREE.Vector3,
    opts: {
      linvel?: THREE.Vector3;
      angvel?: THREE.Vector3;
      life?: number;
      density?: number;
      ccd?: boolean;
      ball?: number;
      restitution?: number;
      friction?: number;
      onRemove?: () => void;
      onImpact?: (speed: number) => void;
      center?: THREE.Vector3;
      damping?: [number, number];
    },
  ): Prop;
  removeProp(p: Prop): void;
  ragdoll(model: THREE.Object3D, find: (n: string) => THREE.Object3D | null, vel: THREE.Vector3, scale: number): Ragdoll | null;
  impulseAt(rd: Ragdoll, point: THREE.Vector3, imp: THREE.Vector3): void;
  freeze(rd: Ragdoll): void;
  explode(at: THREE.Vector3, radius: number, strength: number): void;
  step(dt: number): void;
  dispose(): void;
};

const RAG_GROUP = (0x0002 << 16) | (0xffff & ~0x0002); // ragdoll parts ignore each other

export async function createPhysics(): Promise<Physics | null> {
  let RAPIER: R;
  try {
    RAPIER = (await import("@dimforge/rapier3d-compat")).default as unknown as R;
    await RAPIER.init();
  } catch (err) {
    console.error("[NEXUS] physics unavailable", err);
    return null;
  }
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const props: Prop[] = [];
  const ragdolls: Ragdoll[] = [];
  let acc = 0;

  // ground slab (top at y=0)
  world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.9));

  const tq = new THREE.Quaternion();
  const tv = new THREE.Vector3();
  const tm = new THREE.Matrix4();
  const tq2 = new THREE.Quaternion();
  const ts = new THREE.Vector3();

  function addStaticBox(box: THREE.Box3) {
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    if (s.x <= 0 || s.y <= 0 || s.z <= 0) return;
    world.createCollider(RAPIER.ColliderDesc.cuboid(s.x, s.y, s.z).setTranslation(c.x, c.y, c.z).setFriction(0.8));
  }

  function prop(obj: THREE.Object3D, half: THREE.Vector3, o: Parameters<Physics["prop"]>[2]): Prop {
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(tv, tq, ts);
    // The collider is centred on the object's visual centre (local offset `center`).
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(tv.x, tv.y, tv.z)
      .setRotation({ x: tq.x, y: tq.y, z: tq.z, w: tq.w })
      .setLinearDamping(o.damping?.[0] ?? 0.05)
      .setAngularDamping(o.damping?.[1] ?? 0.3)
      .setCcdEnabled(!!o.ccd);
    if (o.linvel) desc.setLinvel(o.linvel.x, o.linvel.y, o.linvel.z);
    if (o.angvel) desc.setAngvel({ x: o.angvel.x, y: o.angvel.y, z: o.angvel.z });
    const body = world.createRigidBody(desc);
    const cd = (o.ball ? RAPIER.ColliderDesc.ball(o.ball) : RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z))
      .setDensity(o.density ?? 600)
      .setRestitution(o.restitution ?? 0.25)
      .setFriction(o.friction ?? 0.7);
    if (o.center) cd.setTranslation(o.center.x * ts.x, o.center.y * ts.y, o.center.z * ts.z);
    world.createCollider(cd, body);
    if (obj.parent && obj.parent.type !== "Scene") {
      let root: THREE.Object3D = obj;
      while (root.parent) root = root.parent;
      root.attach(obj);
    }
    const p: Prop = { obj, body, life: o.life ?? 8, age: 0, onRemove: o.onRemove, onImpact: o.onImpact, lastVy: 0 };
    props.push(p);
    return p;
  }

  function removeProp(p: Prop) {
    const i = props.indexOf(p);
    if (i < 0) return;
    props.splice(i, 1);
    world.removeRigidBody(p.body);
    p.onRemove?.();
  }

  // ---------------------------------------------------------------- ragdoll
  // [bone, end bone, radius, parent segment index, joint kind]
  const SEG: [string, string, number, number, "ball" | "hinge"][] = [
    ["Hips", "Spine1", 0.15, -1, "ball"],
    ["Spine1", "Neck", 0.17, 0, "ball"],
    ["Head", "HeadTop_End", 0.11, 1, "ball"],
    ["LeftArm", "LeftForeArm", 0.055, 1, "ball"],
    ["LeftForeArm", "LeftHand", 0.05, 3, "hinge"],
    ["RightArm", "RightForeArm", 0.055, 1, "ball"],
    ["RightForeArm", "RightHand", 0.05, 5, "hinge"],
    ["LeftUpLeg", "LeftLeg", 0.08, 0, "ball"],
    ["LeftLeg", "LeftFoot", 0.065, 7, "hinge"],
    ["RightUpLeg", "RightLeg", 0.08, 0, "ball"],
    ["RightLeg", "RightFoot", 0.065, 9, "hinge"],
  ];
  const Y = new THREE.Vector3(0, 1, 0);

  function ragdoll(model: THREE.Object3D, find: (n: string) => THREE.Object3D | null, vel: THREE.Vector3, scale: number): Ragdoll | null {
    model.updateWorldMatrix(true, true);
    const segs: { bone: THREE.Object3D; a: THREE.Vector3; b: THREE.Vector3; q: THREE.Quaternion; body: RAPIER_NS.RigidBody }[] = [];
    const rd: Ragdoll = { parts: [], bodies: [], active: true };
    for (const [bn, en, rad, parent, kind] of SEG) {
      const bone = find(bn);
      const end = find(en);
      if (!bone || !end) {
        for (const b of rd.bodies) world.removeRigidBody(b);
        return null;
      }
      const a = bone.getWorldPosition(new THREE.Vector3());
      const b = end.getWorldPosition(new THREE.Vector3());
      const dir = tv.subVectors(b, a);
      const len = Math.max(0.05, dir.length());
      const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize());
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const r = rad * scale;
      const half = Math.max(0.01, len / 2 - (bn === "Head" ? r : r * 0.6));
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(vel.x, vel.y, vel.z)
          .setLinearDamping(0.15)
          .setAngularDamping(2.2)
          .setCcdEnabled(true),
      );
      const col = bn === "Head" ? RAPIER.ColliderDesc.ball(r) : RAPIER.ColliderDesc.capsule(half, r);
      world.createCollider(col.setDensity(1000).setFriction(0.9).setRestitution(0.05).setCollisionGroups(RAG_GROUP), body);
      rd.bodies.push(body);
      segs.push({ bone, a, b, q, body });
      if (parent >= 0) {
        const p = segs[parent];
        // Anchor at this segment's start, expressed in each body's local frame.
        const pInv = p.q.clone().invert();
        const pMid = p.a.clone().add(p.b).multiplyScalar(0.5);
        const anc1 = a.clone().sub(pMid).applyQuaternion(pInv);
        const anc2 = a.clone().sub(mid).applyQuaternion(q.clone().invert());
        let jd: RAPIER_NS.JointData;
        if (kind === "hinge") {
          // hinge axis: perpendicular to the limb in the plane of the parent+child bones
          const pd = p.b.clone().sub(p.a).normalize();
          const cdv = b.clone().sub(a).normalize();
          let ax = new THREE.Vector3().crossVectors(pd, cdv);
          if (ax.lengthSq() < 1e-4) ax = new THREE.Vector3(1, 0, 0).applyQuaternion(p.q);
          ax.normalize();
          const ax1 = ax.clone().applyQuaternion(pInv);
          const ax2 = ax.clone().applyQuaternion(q.clone().invert());
          jd = RAPIER.JointData.revoluteWithAxes(anc1, anc2, ax1, ax2);
          jd.limitsEnabled = true;
          jd.limits = [-0.05, 2.3];
        } else {
          jd = RAPIER.JointData.spherical(anc1, anc2);
        }
        const j = world.createImpulseJoint(jd, p.body, body, true);
        j.setContactsEnabled(false);
      }
      // bone world = body world * offQ ; Hips also keeps a positional offset
      const bq = bone.getWorldQuaternion(new THREE.Quaternion());
      const offQ = q.clone().invert().multiply(bq);
      const offP = bn === "Hips" ? a.clone().sub(mid).applyQuaternion(q.clone().invert()) : null;
      rd.parts.push({ bone, body, offQ, offP });
    }
    ragdolls.push(rd);
    return rd;
  }

  function impulseAt(rd: Ragdoll, point: THREE.Vector3, imp: THREE.Vector3) {
    let best = rd.bodies[0];
    let bd = Infinity;
    for (const b of rd.bodies) {
      const t = b.translation();
      const d = (t.x - point.x) ** 2 + (t.y - point.y) ** 2 + (t.z - point.z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    best.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: point.x, y: point.y, z: point.z }, true);
  }

  function freeze(rd: Ragdoll) {
    if (!rd.active) return;
    rd.active = false;
    for (const b of rd.bodies) world.removeRigidBody(b);
    rd.bodies.length = 0;
    const i = ragdolls.indexOf(rd);
    if (i >= 0) ragdolls.splice(i, 1);
  }

  function syncRagdoll(rd: Ragdoll) {
    // parents first (SEG order); write local transforms so the skinned mesh follows
    for (const part of rd.parts) {
      const t = part.body.translation();
      const r = part.body.rotation();
      tq.set(r.x, r.y, r.z, r.w);
      tq2.copy(tq).multiply(part.offQ); // desired bone world rotation
      const parent = part.bone.parent!;
      parent.updateWorldMatrix(true, false);
      parent.matrixWorld.decompose(tv, tq, ts);
      part.bone.quaternion.copy(tq.invert().multiply(tq2));
      if (part.offP) {
        const r2 = part.body.rotation();
        const w = new THREE.Vector3(part.offP.x, part.offP.y, part.offP.z)
          .applyQuaternion(tq2.set(r2.x, r2.y, r2.z, r2.w))
          .add(tv.set(t.x, t.y, t.z));
        tm.copy(parent.matrixWorld).invert();
        part.bone.position.copy(w.applyMatrix4(tm));
      }
      part.bone.updateMatrixWorld(true);
    }
  }

  function explode(at: THREE.Vector3, radius: number, strength: number) {
    const push = (b: RAPIER_NS.RigidBody) => {
      const t = b.translation();
      const dx = t.x - at.x;
      const dy = t.y - at.y + 0.3;
      const dz = t.z - at.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius || d < 1e-3) return;
      const k = (strength * (1 - d / radius) * b.mass()) / d;
      b.applyImpulse({ x: dx * k, y: Math.abs(dy) * k + strength * 0.3 * b.mass() * (1 - d / radius), z: dz * k }, true);
    };
    for (const p of props) push(p.body);
    for (const rd of ragdolls) for (const b of rd.bodies) push(b);
  }

  function step(dt: number) {
    acc = Math.min(acc + dt, 1 / 20);
    let n = 0;
    while (acc >= world.timestep && n < 3) {
      world.step();
      acc -= world.timestep;
      n++;
    }
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      p.age += dt;
      const t = p.body.translation();
      const r = p.body.rotation();
      p.obj.position.set(t.x, t.y, t.z);
      p.obj.quaternion.set(r.x, r.y, r.z, r.w);
      if (p.onImpact) {
        const vy = p.body.linvel().y;
        if (p.lastVy < -1.2 && vy > p.lastVy + 1.2) p.onImpact(-p.lastVy);
        p.lastVy = vy;
      }
      if (p.age > p.life || t.y < -20) removeProp(p);
    }
    for (const rd of ragdolls) syncRagdoll(rd);
  }

  function dispose() {
    for (const p of [...props]) removeProp(p);
    ragdolls.length = 0;
    world.free();
  }

  return { R: RAPIER, world, addStaticBox, prop, removeProp, ragdoll, impulseAt, freeze, explode, step, dispose };
}

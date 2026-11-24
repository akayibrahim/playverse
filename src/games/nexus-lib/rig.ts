/**
 * NEXUS 2100 — weapon + arm rig.
 *
 * The Mixamo soldier ships without a weapon, so every operator carries a
 * procedural carbine built from a few shared primitives. After the animation
 * mixer has posed the skeleton, a world-space two-bone IK pass pulls both
 * arms onto the rifle's grip and handguard, so walk/run/idle clips keep the
 * legs and torso while the hands stay locked to the gun.
 */

import * as THREE from "three";

export type RifleParts = {
  geo: Record<string, THREE.BufferGeometry>;
  metal: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
};

export type Rifle = {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  rightHand: THREE.Object3D;
  leftHand: THREE.Object3D;
  accent: THREE.MeshStandardMaterial;
};

export function createRifleParts(): RifleParts {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r: number, len: number, seg = 10) => {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateX(Math.PI / 2);
    return g;
  };
  return {
    geo: {
      receiver: box(0.056, 0.078, 0.3),
      rail: box(0.03, 0.016, 0.3),
      guard: box(0.062, 0.064, 0.27),
      barrel: cyl(0.011, 0.2),
      brake: cyl(0.019, 0.055, 8),
      stock: box(0.046, 0.07, 0.19),
      pad: box(0.05, 0.115, 0.03),
      grip: box(0.034, 0.095, 0.042),
      mag: box(0.03, 0.14, 0.06),
      optic: box(0.042, 0.052, 0.1),
      lens: cyl(0.017, 0.012, 12),
      strip: box(0.064, 0.005, 0.14),
      supp: cyl(0.026, 0.22, 12),
      comp: box(0.04, 0.04, 0.07),
      holo: box(0.05, 0.06, 0.06),
      holoGlass: box(0.04, 0.042, 0.004),
      extMag: box(0.03, 0.2, 0.06),
    },
    metal: new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.38, metalness: 0.75 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.78, metalness: 0.08 }),
  };
}

/** Rifle points down +Z; its origin is the trigger group. */
export type Attachments = { optic?: string; muzzle?: string; mag?: string };

export function buildRifle(parts: RifleParts, accentColor: number, att: Attachments = {}): Rifle {
  const group = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 1.1,
    roughness: 0.4,
  });
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const g = parts.geo;
  add(g.receiver, parts.metal, 0, 0.02, 0.05);
  add(g.rail, parts.metal, 0, 0.068, 0.08);
  add(g.guard, parts.polymer, 0, 0.016, 0.33);
  add(g.barrel, parts.metal, 0, 0.022, 0.55);
  if (att.muzzle === "supp") add(g.supp, parts.polymer, 0, 0.022, 0.74);
  else if (att.muzzle === "comp") add(g.comp, parts.metal, 0, 0.022, 0.68);
  else add(g.brake, parts.metal, 0, 0.022, 0.665);
  add(g.stock, parts.polymer, 0, 0.005, -0.19);
  add(g.pad, parts.polymer, 0, -0.008, -0.295);
  add(g.grip, parts.polymer, 0, -0.06, -0.02, -0.32);
  if (att.mag === "ext") add(g.extMag, parts.metal, 0, -0.115, 0.125, 0.22);
  else add(g.mag, parts.metal, 0, -0.085, 0.12, 0.2);
  if (att.optic === "holo") {
    add(g.holo, parts.metal, 0, 0.11, 0.06);
    add(g.holoGlass, accent, 0, 0.115, 0.095);
  } else {
    add(g.optic, parts.metal, 0, 0.105, 0.07);
    add(g.lens, accent, 0, 0.105, 0.125);
  }
  add(g.strip, accent, 0, 0.05, 0.34);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.022, att.muzzle === "supp" ? 0.86 : att.muzzle === "comp" ? 0.72 : 0.7);
  group.add(muzzle);
  // IK targets are wrist positions, so they sit just behind the grip surfaces.
  const rightHand = new THREE.Object3D();
  rightHand.position.set(-0.012, -0.075, -0.075);
  group.add(rightHand);
  const leftHand = new THREE.Object3D();
  leftHand.position.set(0.03, -0.045, 0.21);
  group.add(leftHand);
  return { group, muzzle, rightHand, leftHand, accent };
}

// ------------------------------------------------------------------ IK
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

function rotateToward(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  if (!bone.parent) return;
  _q.setFromUnitVectors(from.normalize(), to.normalize());
  if (weight < 1) _q.slerp(_qp.identity(), 1 - weight);
  bone.getWorldQuaternion(_qb);
  bone.parent.getWorldQuaternion(_qp);
  _qb.premultiply(_q);
  bone.quaternion.copy(_qp.invert().multiply(_qb));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK in world space — independent of the rig's local bone
 * axes. `pole` is a world-space hint the elbow bends toward.
 */
export function solveArm(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight = 1,
) {
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _t.copy(target);
  _dir.subVectors(_t, _a);
  const d = THREE.MathUtils.clamp(_dir.length(), Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999);
  _dir.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _pole.subVectors(pole, _a);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, -1, 0);
  _pole.normalize();
  _elbow.copy(_a).addScaledVector(_dir, x).addScaledVector(_pole, h);

  _from.subVectors(_b, _a);
  _to.subVectors(_elbow, _a);
  rotateToward(upper, _from, _to, weight);

  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _from.subVectors(_c, _b);
  _to.subVectors(_t, _b);
  rotateToward(lower, _from, _to, weight);
}

const _axisQ = new THREE.Quaternion();
/** Rotate a bone about a world-space axis, preserving the rest of its pose. */
export function rotateBoneWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  _axisQ.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_qb);
  bone.parent.getWorldQuaternion(_qp);
  _qb.premultiply(_axisQ);
  bone.quaternion.copy(_qp.invert().multiply(_qb));
  bone.updateMatrixWorld(true);
}

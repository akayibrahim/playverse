/** OVERRIDE — visual builders for the dynamic things: drone, cameras, robots, lasers, doors, chargers, core. */
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { CELL, type CamDef, type DoorDef, type JunctionDef, type LaserDef, type ScannerDef } from "./levels";
import type { Nav } from "./nav";
import type { Track } from "./world";

const deg = Math.PI / 180;

// --------------------------------------------------------------------------- shared shader mats
export function coneMaterial(M: Track["M"], color: number, alpha = 0.12) {
  return M(
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalMatrix * normal; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ float along = 1.0 - vUv.y; float fres = abs(dot(normalize(vN), normalize(vV)));
          float a = uAlpha * (0.25 + 0.75 * pow(1.0 - fres, 1.2)) * (0.35 + 0.65 * pow(1.0 - along, 1.1));
          a *= smoothstep(0.6, 4.5, length(vV)); // fade out around the viewer so being inside a cone doesn't fog the screen
          gl_FragColor = vec4(uColor * (1.0 + (1.0-along)*0.6), a); }`,
    }),
  );
}
function fanMaterial(M: Track["M"], color: number, alpha: number) {
  return M(
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `attribute float aR; varying float vR; varying vec2 vUv; void main(){ vR = aR; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vR; varying vec2 vUv;
        void main(){ float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x); float a = uAlpha * (1.0 - vR*0.85) * (0.4 + 0.6*edge) + (vR > 0.97 ? uAlpha*0.6 : 0.0);
          gl_FragColor = vec4(uColor, a); }`,
    }),
  );
}

// --------------------------------------------------------------------------- drone
export type DroneVis = {
  root: THREE.Group;
  body: THREE.Group;
  rotors: THREE.Mesh[];
  light: THREE.PointLight;
  ring: THREE.MeshBasicMaterial;
  eye: THREE.MeshBasicMaterial;
  shadow: THREE.Mesh;
  shadowMat: THREE.MeshBasicMaterial;
  trail: { pts: THREE.Points; pos: Float32Array; col: Float32Array; head: number; geo: THREE.BufferGeometry };
};
export function buildDrone(tr: Track, shadowTex: THREE.Texture): DroneVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shell = M(new THREE.MeshStandardMaterial({ color: 0x1b1d26, roughness: 0.3, metalness: 0.8 }));
  const ring = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfb7185).multiplyScalar(2.6), toneMapped: false }));
  const eye = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(2.8), toneMapped: false }));
  const core = new THREE.Mesh(G(new THREE.SphereGeometry(0.15, 20, 14)), shell);
  core.scale.set(1, 0.62, 1.15);
  body.add(core);
  const belly = new THREE.Mesh(G(new THREE.SphereGeometry(0.075, 12, 10)), eye);
  belly.position.set(0, -0.05, 0.1);
  body.add(belly);
  const band = new THREE.Mesh(G(new THREE.TorusGeometry(0.152, 0.009, 6, 28)), ring);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.0;
  body.add(band);
  const rotors: THREE.Mesh[] = [];
  const discMat = M(new THREE.MeshBasicMaterial({ color: 0xffd7e0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 0.27;
    const z = Math.sin(a) * 0.27;
    const arm = new THREE.Mesh(G(new THREE.BoxGeometry(0.28, 0.025, 0.035)), shell);
    arm.position.set(x / 2, 0.01, z / 2);
    arm.rotation.y = -a;
    body.add(arm);
    const rg = new THREE.Mesh(G(new THREE.TorusGeometry(0.115, 0.012, 6, 22)), ring);
    rg.rotation.x = Math.PI / 2;
    rg.position.set(x, 0.035, z);
    body.add(rg);
    const disc = new THREE.Mesh(G(new THREE.CircleGeometry(0.11, 18)), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.04, z);
    body.add(disc);
    rotors.push(disc);
    const hub = new THREE.Mesh(G(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 6)), shell);
    hub.position.set(x, 0.02, z);
    body.add(hub);
  }
  const light = new THREE.PointLight(0xffb0c0, 0.9, 5, 1.6);
  light.position.set(0, -0.1, 0);
  root.add(light);
  const shadowMat = M(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.6, depthWrite: false, color: 0x000000 }));
  const shadow = new THREE.Mesh(G(new THREE.PlaneGeometry(1, 1)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 3;
  // trail shimmer
  const N = 56;
  const pos = new Float32Array(N * 3).fill(-999);
  const col = new Float32Array(N * 3);
  const geo = G(new THREE.BufferGeometry());
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const dot = document.createElement("canvas");
  dot.width = dot.height = 32;
  const c = dot.getContext("2d")!;
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 32);
  const tdot = tr.T(new THREE.CanvasTexture(dot));
  const pm = M(new THREE.PointsMaterial({ size: 0.09, map: tdot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const pts = new THREE.Points(geo, pm);
  pts.frustumCulled = false;
  return { root, body, rotors, light, ring, eye, shadow, shadowMat, trail: { pts, pos, col, head: 0, geo } };
}

// --------------------------------------------------------------------------- security camera
export type CamVis = {
  def: CamDef;
  root: THREE.Group;
  head: THREE.Group;
  cone: THREE.Mesh;
  foot: THREE.Mesh;
  coneMat: THREE.ShaderMaterial;
  footMat: THREE.ShaderMaterial;
  led: THREE.MeshBasicMaterial;
  icon: THREE.Sprite;
  pitch: number;
  effRange: number;
  yaw: number;
  tw: THREE.Vector3; // world position
};
export function buildCam(tr: Track, def: CamDef, iconTex: Record<string, THREE.Texture>): CamVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  root.position.set(def.x * CELL, def.y, def.z * CELL);
  const dark = M(new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.4, metalness: 0.8 }));
  const led = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(2.6), toneMapped: false }));
  const head = new THREE.Group();
  root.add(head);
  const body = new THREE.Mesh(G(new THREE.BoxGeometry(0.28, 0.24, 0.62)), dark);
  body.position.z = 0.18;
  head.add(body);
  const hood = new THREE.Mesh(G(new THREE.BoxGeometry(0.32, 0.04, 0.7)), dark);
  hood.position.set(0, 0.14, 0.2);
  head.add(hood);
  const lens = new THREE.Mesh(G(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 14)), M(new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.1, metalness: 1, emissive: 0x10223a })));
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.54;
  head.add(lens);
  const ledM = new THREE.Mesh(G(new THREE.SphereGeometry(0.03, 8, 6)), led);
  ledM.position.set(0.1, 0.07, 0.5);
  head.add(ledM);
  // mount
  const mount = new THREE.Mesh(G(new THREE.CylinderGeometry(0.05, 0.05, def.y > 5 ? 1.2 : 0.35, 8)), dark);
  mount.position.y = def.y > 5 ? 0.6 : 0.18;
  root.add(mount);
  const pitch = Math.min(0.55, Math.max(0.12, Math.atan(def.y / (def.range * 0.8))));
  const effRange = Math.min(def.range, def.y / Math.sin(pitch) + 1.2);
  // cone: apex at origin pointing +z
  const rad = Math.tan(def.fov * deg) * effRange;
  const cg = G(new THREE.ConeGeometry(rad, effRange, 28, 1, true));
  cg.rotateX(-Math.PI / 2); // apex now at -z, base at +z
  cg.translate(0, 0, effRange / 2);
  const coneMat = coneMaterial(M, 0x9fe8ff, 0.16);
  const cone = new THREE.Mesh(cg, coneMat);
  cone.renderOrder = 4;
  head.add(cone);
  // floor footprint
  const fg = G(new THREE.CircleGeometry(1, 32));
  fg.rotateX(-Math.PI / 2);
  const footMat = fanMaterialCircle(M, 0x9fe8ff, 0.2);
  const foot = new THREE.Mesh(fg, footMat);
  foot.renderOrder = 4;
  foot.visible = true;
  const icon = new THREE.Sprite(M(new THREE.SpriteMaterial({ map: iconTex.eye, transparent: true, depthTest: false, toneMapped: false })));
  icon.scale.set(0.5, 0.5, 1);
  icon.position.y = 0.55;
  icon.renderOrder = 12;
  icon.visible = false;
  root.add(icon);
  void fanMaterial;
  return { def, root, head, cone, foot, coneMat, footMat, led, icon, pitch, effRange, yaw: def.yaw, tw: new THREE.Vector3(def.x * CELL, def.y, def.z * CELL) };
}
function fanMaterialCircle(M: Track["M"], color: number, alpha: number) {
  return M(
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vP;
        void main(){ float r = length(vP); float a = uAlpha * (0.18 + 0.82 * smoothstep(0.78, 0.97, r)) * smoothstep(1.02, 0.96, r); gl_FragColor = vec4(uColor, a); }`,
    }),
  );
}
export function updateCamVis(c: CamVis, yaw: number, floorY = 0.04) {
  c.yaw = yaw;
  const a = yaw * deg;
  // world forward (cos a, 0, sin a); head looks +z locally → rotate so +z → forward
  c.head.rotation.set(0, 0, 0);
  c.root.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
  c.head.rotation.x = c.pitch; // tilt down (+x rotation points +z toward -y)
  // footprint ellipse
  const L = Math.min(c.effRange, c.def.y / Math.sin(c.pitch));
  const dist = Math.max(0.5, c.def.y / Math.tan(c.pitch));
  const rad = Math.tan(c.def.fov * deg) * L;
  c.foot.position.set(c.tw.x + Math.cos(a) * dist, floorY, c.tw.z + Math.sin(a) * dist);
  c.foot.rotation.y = -a;
  c.foot.scale.set(Math.min(c.effRange, rad / Math.sin(c.pitch) + 0.1) * 0.9, 1, rad);
}

// --------------------------------------------------------------------------- robot
export type RobotVis = {
  root: THREE.Group;
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  actions: Record<string, THREE.AnimationAction>;
  cur: string;
  fan: THREE.Mesh;
  fanGeo: THREE.BufferGeometry;
  fanMat: THREE.ShaderMaterial;
  visor: THREE.MeshBasicMaterial;
  icon: THREE.Sprite;
  ring: THREE.Mesh;
};
const FAN_N = 22;
export function buildRobot(tr: Track, src: THREE.Object3D | null, clips: THREE.AnimationClip[], iconTex: Record<string, THREE.Texture>): RobotVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  let model: THREE.Object3D | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  const actions: Record<string, THREE.AnimationAction> = {};
  const visor = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(3), toneMapped: false }));
  if (src) {
    model = cloneSkeleton(src);
    const box = new THREE.Box3().setFromObject(model);
    const hgt = box.max.y - box.min.y || 1;
    const k = 1.8 / hgt;
    model.scale.multiplyScalar(k);
    model.position.y = -box.min.y * k;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
        const c = (x as THREE.MeshStandardMaterial).clone();
        tr.M(c);
        if (c.name === "Main") {
          c.color.set(0x23283a);
          c.metalness = 0.7;
          c.roughness = 0.35;
          c.emissive.set(0x0a0f1a);
        } else if (c.name === "Grey") {
          c.color.set(0x7d8598);
          c.metalness = 0.7;
          c.roughness = 0.4;
        }
        return c;
      });
      m.material = mats.length === 1 ? mats[0] : mats;
      m.frustumCulled = false;
    });
    root.add(model);
    mixer = new THREE.AnimationMixer(model);
    for (const cl of clips) {
      if (["Idle", "Walking", "Running"].includes(cl.name)) actions[cl.name] = mixer.clipAction(cl);
    }
    // glowing visor + chest light (attached to root: robots barely bob)
    const vis = new THREE.Mesh(G(new THREE.BoxGeometry(0.34, 0.07, 0.04)), visor);
    vis.position.set(0, 1.5, 0.2);
    root.add(vis);
    const chest = new THREE.Mesh(G(new THREE.BoxGeometry(0.1, 0.1, 0.03)), visor);
    chest.position.set(0, 1.05, 0.22);
    root.add(chest);
  } else {
    const b = new THREE.Mesh(G(new THREE.CapsuleGeometry(0.3, 1.1, 4, 10)), M(new THREE.MeshStandardMaterial({ color: 0x23283a, metalness: 0.7, roughness: 0.4 })));
    b.position.y = 0.9;
    root.add(b);
  }
  // vision fan
  const fg = G(new THREE.BufferGeometry());
  const verts = new Float32Array((FAN_N + 2) * 3);
  const aR = new Float32Array(FAN_N + 2);
  const uvs = new Float32Array((FAN_N + 2) * 2);
  const idx: number[] = [];
  for (let i = 0; i <= FAN_N; i++) {
    aR[i + 1] = 1;
    uvs[(i + 1) * 2] = i / FAN_N;
    uvs[(i + 1) * 2 + 1] = 1;
    if (i < FAN_N) idx.push(0, i + 1, i + 2);
  }
  fg.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  fg.setAttribute("aR", new THREE.BufferAttribute(aR, 1));
  fg.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  fg.setIndex(idx);
  const fanMat = fanMaterial(M, 0x9fe8ff, 0.2);
  const fan = new THREE.Mesh(fg, fanMat);
  fan.frustumCulled = false;
  fan.renderOrder = 4;
  const icon = new THREE.Sprite(M(new THREE.SpriteMaterial({ map: iconTex.eye, transparent: true, depthTest: false, toneMapped: false })));
  icon.scale.set(0.5, 0.5, 1);
  icon.position.y = 2.25;
  icon.renderOrder = 12;
  icon.visible = false;
  root.add(icon);
  const ring = new THREE.Mesh(G(new THREE.RingGeometry(0.5, 0.58, 28)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(2), transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  root.add(ring);
  return { root, model, mixer, actions, cur: "", fan, fanGeo: fg, fanMat, visor, icon, ring };
}
export function playRobot(r: RobotVis, name: string, speed = 1) {
  if (!r.mixer || r.cur === name) return;
  const next = r.actions[name];
  if (!next) return;
  const prev = r.actions[r.cur];
  next.reset().fadeIn(0.25).play();
  next.timeScale = speed;
  prev?.fadeOut(0.25);
  r.cur = name;
}
export function updateFan(r: RobotVis, nav: Nav, x: number, z: number, yawRad: number, fovRad: number, range: number, eyeY: number) {
  const pos = r.fanGeo.getAttribute("position") as THREE.BufferAttribute;
  pos.setXYZ(0, x, 0.07, z);
  for (let i = 0; i <= FAN_N; i++) {
    const a = yawRad - fovRad + (i / FAN_N) * fovRad * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const d = nav.rayDist(x, z, dx, dz, range, eyeY);
    pos.setXYZ(i + 1, x + dx * d, 0.07, z + dz * d);
    (r.fanGeo.getAttribute("aR") as THREE.BufferAttribute).setX(i + 1, d / range);
  }
  pos.needsUpdate = true;
  (r.fanGeo.getAttribute("aR") as THREE.BufferAttribute).needsUpdate = true;
}

// --------------------------------------------------------------------------- lasers, junctions, doors, scanners, chargers
export type LaserVis = { def: LaserDef; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; posts: THREE.Mesh[]; on: boolean; k: number };
export function buildLaser(tr: Track, def: LaserDef): LaserVis {
  const { G, M } = tr;
  const ax = def.a[0] * CELL;
  const az = def.a[1] * CELL;
  const bx = def.b[0] * CELL;
  const bz = def.b[1] * CELL;
  const len = Math.hypot(bx - ax, bz - az);
  const h = def.y1 - def.y0;
  const mat = M(
    new THREE.ShaderMaterial({
      uniforms: { uOn: { value: 1 }, uTime: { value: 0 }, uLen: { value: len }, uH: { value: h } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uOn; uniform float uTime; uniform float uLen; uniform float uH; varying vec2 vUv;
        void main(){ float y = vUv.y * uH; float beam = smoothstep(0.07, 0.0, abs(fract(y/0.42 + 0.0) - 0.5) - 0.42 + 0.0);
          float line = step(0.9, fract(y/0.3)); float flick = 0.85 + 0.15*sin(uTime*40.0 + y*9.0);
          float a = (line*0.9 + 0.1) * flick * uOn;
          float edge = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
          gl_FragColor = vec4(vec3(1.0,0.12,0.2) * 2.0, a * edge * 0.85); }`,
    }),
  );
  const g = G(new THREE.PlaneGeometry(len, h));
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set((ax + bx) / 2, def.y0 + h / 2, (az + bz) / 2);
  mesh.rotation.y = -Math.atan2(bz - az, bx - ax);
  mesh.renderOrder = 5;
  const postMat = M(new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4, metalness: 0.8, emissive: 0x500010 }));
  const posts: THREE.Mesh[] = [];
  for (const [px, pz] of [[ax, az], [bx, bz]]) {
    const p = new THREE.Mesh(G(new THREE.BoxGeometry(0.18, h, 0.18)), postMat);
    p.position.set(px, def.y0 + h / 2, pz);
    posts.push(p);
  }
  return { def, mesh, mat, posts, on: true, k: 1 };
}

export type JunctionVis = { def: JunctionDef; root: THREE.Group; led: THREE.MeshBasicMaterial; tw: THREE.Vector3 };
export function buildJunction(tr: Track, def: JunctionDef): JunctionVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  root.position.set(def.x * CELL, def.y, def.z * CELL);
  root.rotation.y = Math.atan2(Math.cos(def.face * deg), Math.sin(def.face * deg));
  const dark = M(new THREE.MeshStandardMaterial({ color: 0x1c1f28, roughness: 0.5, metalness: 0.7 }));
  const body = new THREE.Mesh(G(new THREE.BoxGeometry(0.5, 0.65, 0.16)), dark);
  root.add(body);
  const led = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b4a).multiplyScalar(2.5), toneMapped: false }));
  const scr = new THREE.Mesh(G(new THREE.BoxGeometry(0.34, 0.22, 0.02)), led);
  scr.position.set(0, 0.12, 0.09);
  root.add(scr);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(G(new THREE.BoxGeometry(0.07, 0.07, 0.02)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb547).multiplyScalar(2), toneMapped: false })));
    b.position.set(-0.12 + i * 0.12, -0.15, 0.09);
    root.add(b);
  }
  const sx = def.x * CELL;
  const sz = def.z * CELL;
  return { def, root, led, tw: new THREE.Vector3(sx + Math.cos(def.face * deg) * 0.2, def.y, sz + Math.sin(def.face * deg) * 0.2) };
}

export type DoorVis = { def: DoorDef; root: THREE.Group; panels: THREE.Mesh[]; open: number; light: THREE.MeshBasicMaterial; center: THREE.Vector3; span: number };
export function buildDoor(tr: Track, def: DoorDef, ceil: number): DoorVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  let cx = 0;
  let cz = 0;
  for (const [x, z] of def.cells) {
    cx += (x + 0.5) * CELL;
    cz += (z + 0.5) * CELL;
  }
  cx /= def.cells.length;
  cz /= def.cells.length;
  root.position.set(cx, 0, cz);
  const span = def.cells.length * CELL;
  const alongZ = def.axis === "z"; // panels slide along z
  const light = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b4a).multiplyScalar(2.5), toneMapped: false }));
  const mat = M(new THREE.MeshStandardMaterial({ color: 0x20232e, roughness: 0.35, metalness: 0.85 }));
  const panels: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(G(new THREE.BoxGeometry(alongZ ? 0.3 : span / 2, ceil, alongZ ? span / 2 : 0.3)), mat);
    p.position.set(alongZ ? 0 : (s * span) / 4, ceil / 2, alongZ ? (s * span) / 4 : 0);
    const stripe = new THREE.Mesh(G(new THREE.BoxGeometry(alongZ ? 0.34 : span / 2 - 0.2, 0.08, alongZ ? span / 2 - 0.2 : 0.34)), light);
    stripe.position.y = 0.4 - ceil / 2 + 0.9;
    p.add(stripe);
    const warn = new THREE.Mesh(G(new THREE.BoxGeometry(alongZ ? 0.34 : span / 2 - 0.2, 0.12, alongZ ? span / 2 - 0.2 : 0.34)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb547).multiplyScalar(1.4), toneMapped: false })));
    warn.position.y = ceil / 2 - 0.3;
    p.add(warn);
    root.add(p);
    panels.push(p);
  }
  // reader boxes either side
  const rd = new THREE.Mesh(G(new THREE.BoxGeometry(0.16, 0.5, 0.16)), mat);
  const rdl = new THREE.Mesh(G(new THREE.BoxGeometry(0.12, 0.1, 0.12)), light);
  for (const s of [-1, 1]) {
    const r1 = rd.clone();
    const r2 = rdl.clone();
    const off = alongZ ? [s * 0.36, 0, span / 2 + 0.2] : [span / 2 + 0.2, 0, s * 0.36];
    r1.position.set(off[0], 1.2, off[2]);
    r2.position.set(off[0], 1.35, off[2]);
    root.add(r1, r2);
  }
  return { def, root, panels, open: 0, light, center: new THREE.Vector3(cx, 1, cz), span };
}
export function setDoor(d: DoorVis, open: number) {
  d.open = open;
  const alongZ = d.def.axis === "z";
  d.panels.forEach((p, i) => {
    const s = i === 0 ? -1 : 1;
    const base = (s * d.span) / 4;
    const off = base + s * (d.span / 2 - 0.1) * open;
    if (alongZ) p.position.z = off;
    else p.position.x = off;
  });
  d.light.color.set(open > 0.5 ? 0x4dffa0 : 0xff3b4a).multiplyScalar(2.5);
}

export type ScannerVis = { def: ScannerDef; root: THREE.Group; mat: THREE.ShaderMaterial };
export function buildScanner(tr: Track, def: ScannerDef, ceil: number): ScannerVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  const ax = def.a[0] * CELL;
  const az = def.a[1] * CELL;
  const bx = def.b[0] * CELL;
  const bz = def.b[1] * CELL;
  const len = Math.hypot(bx - ax, bz - az);
  const h = Math.min(ceil - 0.5, 3.2);
  const mat = M(
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float sweep = smoothstep(0.08, 0.0, abs(fract(uTime*0.45) - vUv.y)); float grid = step(0.94, fract(vUv.y*14.0))*0.25 + step(0.96, fract(vUv.x*8.0))*0.2;
          gl_FragColor = vec4(vec3(0.2,0.9,1.0)*1.6, 0.09 + sweep*0.55 + grid*0.4); }`,
    }),
  );
  const pane = new THREE.Mesh(G(new THREE.PlaneGeometry(len, h)), mat);
  pane.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
  pane.rotation.y = -Math.atan2(bz - az, bx - ax);
  pane.renderOrder = 5;
  root.add(pane);
  const frame = M(new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.4, metalness: 0.85 }));
  const glow = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(2.4), toneMapped: false }));
  for (const [px, pz] of [[ax, az], [bx, bz]]) {
    const p = new THREE.Mesh(G(new THREE.BoxGeometry(0.22, h, 0.22)), frame);
    p.position.set(px, h / 2, pz);
    root.add(p);
    const g = new THREE.Mesh(G(new THREE.BoxGeometry(0.08, h * 0.8, 0.08)), glow);
    g.position.set(px, h / 2, pz);
    root.add(g);
  }
  const top = new THREE.Mesh(G(new THREE.BoxGeometry(Math.abs(bx - ax) + 0.22, 0.2, Math.abs(bz - az) + 0.22)), frame);
  top.position.set((ax + bx) / 2, h, (az + bz) / 2);
  root.add(top);
  return { def, root, mat };
}

export type ChargerVis = { root: THREE.Group; ringMat: THREE.MeshBasicMaterial; tw: THREE.Vector3; ring: THREE.Mesh };
export function buildCharger(tr: Track, x: number, z: number, face: number): ChargerVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  root.position.set(x * CELL, 0, z * CELL);
  const dark = M(new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.4, metalness: 0.8 }));
  const ringMat = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dffb0).multiplyScalar(2.2), transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
  const ring = new THREE.Mesh(G(new THREE.RingGeometry(0.62, 0.74, 36)), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.045;
  root.add(ring);
  const disc = new THREE.Mesh(G(new THREE.CircleGeometry(0.62, 28)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dffb0).multiplyScalar(0.35), transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false })));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.04;
  root.add(disc);
  // wall unit (behind the pad in direction opposite of face)
  const a = face * deg;
  const post = new THREE.Mesh(G(new THREE.BoxGeometry(0.32, 1.3, 0.2)), dark);
  post.position.set(-Math.cos(a) * 0.95, 0.65, -Math.sin(a) * 0.95);
  post.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
  root.add(post);
  const bolt = new THREE.Mesh(G(new THREE.BoxGeometry(0.1, 0.34, 0.03)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dffb0).multiplyScalar(2.6), toneMapped: false })));
  bolt.position.set(0, 0.0, 0.115);
  const bg = new THREE.Group();
  bg.position.copy(post.position);
  bg.position.y = 0.9;
  bg.rotation.y = post.rotation.y;
  bg.add(bolt);
  root.add(bg);
  return { root, ringMat, tw: new THREE.Vector3(x * CELL, 0.9, z * CELL), ring };
}

// --------------------------------------------------------------------------- core + extraction marker
export type CoreVis = { root: THREE.Group; rings: THREE.Mesh[]; coreMat: THREE.MeshBasicMaterial; light: THREE.PointLight; data: THREE.Points; dpos: Float32Array; tw: THREE.Vector3 };
export function buildCore(tr: Track, x: number, z: number, ceil: number, accent: number): CoreVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  root.position.set(x * CELL, 0, z * CELL);
  const dark = M(new THREE.MeshStandardMaterial({ color: 0x14151c, roughness: 0.3, metalness: 0.9 }));
  const base = new THREE.Mesh(G(new THREE.CylinderGeometry(1.1, 1.3, 0.35, 28)), dark);
  base.position.y = 0.175;
  root.add(base);
  const coreMat = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.6), toneMapped: false, transparent: true, opacity: 0.92 }));
  const h = Math.min(ceil - 0.6, 3.4);
  const pillar = new THREE.Mesh(G(new THREE.CylinderGeometry(0.34, 0.34, h, 20, 1, true)), coreMat);
  pillar.position.y = 0.35 + h / 2;
  root.add(pillar);
  const inner = new THREE.Mesh(G(new THREE.CylinderGeometry(0.16, 0.16, h, 12)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3), toneMapped: false })));
  inner.position.y = 0.35 + h / 2;
  root.add(inner);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(G(new THREE.TorusGeometry(0.62 + i * 0.12, 0.025, 6, 40)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.4), toneMapped: false })));
    r.position.y = 0.9 + i * 0.85;
    r.rotation.x = Math.PI / 2 + (i - 1) * 0.35;
    root.add(r);
    rings.push(r);
  }
  const N = 70;
  const dpos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.28;
    const r = 0.5 + Math.random() * 0.7;
    dpos[i * 3] = Math.cos(a) * r;
    dpos[i * 3 + 1] = Math.random() * h;
    dpos[i * 3 + 2] = Math.sin(a) * r;
  }
  const dg = G(new THREE.BufferGeometry());
  dg.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
  const dm = M(new THREE.PointsMaterial({ size: 0.07, color: new THREE.Color(accent).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const data = new THREE.Points(dg, dm);
  data.frustumCulled = false;
  root.add(data);
  const light = new THREE.PointLight(accent, 5, 10, 1.8);
  light.position.y = 1.8;
  root.add(light);
  return { root, rings, coreMat, light, data, dpos, tw: new THREE.Vector3(x * CELL, 1.2, z * CELL) };
}

export type ExtractVis = { root: THREE.Group; mat: THREE.ShaderMaterial; ring: THREE.Mesh };
export function buildExtract(tr: Track, x: number, z: number, ceil: number, color: number): ExtractVis {
  const { G, M } = tr;
  const root = new THREE.Group();
  root.position.set(x * CELL, 0, z * CELL);
  const mat = M(
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
        void main(){ float a = (1.0 - vUv.y) * 0.5 + 0.1; a *= 0.7 + 0.3*sin(vUv.y*30.0 - uTime*6.0); gl_FragColor = vec4(uColor * 2.4, a); }`,
    }),
  );
  const beam = new THREE.Mesh(G(new THREE.CylinderGeometry(0.8, 0.8, ceil, 24, 1, true)), mat);
  beam.position.y = ceil / 2;
  beam.renderOrder = 6;
  root.add(beam);
  const ring = new THREE.Mesh(G(new THREE.RingGeometry(0.85, 1.05, 40)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6), side: THREE.DoubleSide, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false })));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  root.add(ring);
  root.visible = false;
  return { root, mat, ring };
}

// --------------------------------------------------------------------------- status icon textures
export function iconTextures(T: Track["T"]) {
  const mk = (draw: (c: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const c = cv.getContext("2d")!;
    draw(c);
    const t = T(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const glyph = (txt: string, col: string) => (c: CanvasRenderingContext2D) => {
    c.shadowColor = col;
    c.shadowBlur = 16;
    c.fillStyle = col;
    c.font = "900 96px system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(txt, 64, 70);
  };
  return {
    eye: mk((c) => {
      c.strokeStyle = "#9fe8ff";
      c.shadowColor = "#35f0ff";
      c.shadowBlur = 12;
      c.lineWidth = 7;
      c.beginPath();
      c.ellipse(64, 64, 42, 24, 0, 0, 7);
      c.stroke();
      c.fillStyle = "#9fe8ff";
      c.beginPath();
      c.arc(64, 64, 12, 0, 7);
      c.fill();
    }),
    q: mk(glyph("?", "#ffb547")),
    bang: mk(glyph("!", "#ff4d5c")),
    off: mk((c) => {
      c.strokeStyle = "#7dffb0";
      c.shadowColor = "#7dffb0";
      c.shadowBlur = 12;
      c.lineWidth = 8;
      c.beginPath();
      c.moveTo(34, 66);
      c.lineTo(58, 90);
      c.lineTo(96, 40);
      c.stroke();
    }),
  };
}
export function shadowTexture(T: Track["T"]) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return T(new THREE.CanvasTexture(cv));
}

"use client";

/**
 * OVERRIDE — stealth hacking in Halden Tower (District 07).
 * Pilot a palm-sized drone through three handcrafted floors: hack cameras (jack in, loop the feed),
 * ride security robots through badge doors, kill laser grids at the junction box, reach the data core
 * and get out through the window without being seen.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { loadPbr, type PbrSet } from "./nexus-lib/surface";
import { GradeShader } from "./nexus-lib/grade";
import { CELL, floors, gradeOf, type FloorDef, type Step, type V2 } from "./override-lib/levels";
import { Nav, VENT_H } from "./override-lib/nav";
import { buildWorld, type Track, type World } from "./override-lib/world";
import * as E from "./override-lib/ents";
import { buildOvHud } from "./override-lib/hud";
import { createSfx } from "./override-lib/sfx";

type RunStat = { label: string; value: string };
type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number, stats: RunStat[], opts?: { ownScreen?: boolean }) => void;
  best?: number;
};
type GameInstance = { dispose: () => void };

const ASSET = "/assets";
const SAVE_KEY = "playverse:override:save";
const SET_KEY = "playverse:override:settings";
const HINT_KEY = "playverse:override:hints";
const deg = Math.PI / 180;

type FloorBest = { score: number; grade: string; time: number; detected: number; hacks: number };
type Save = { best: Record<string, FloorBest> };

function store<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}
function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** CCTV look: barrel distortion, scanlines, green tint, noise and glitch bursts. */
const CctvShader = {
  name: "OvCctv",
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uAmt: { value: 0 }, uTime: { value: 0 }, uGlitch: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt; uniform float uTime; uniform float uGlitch; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      if (uAmt < 0.001 && uGlitch < 0.001) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 c = vUv - 0.5; float r2 = dot(c,c);
      vec2 uv = 0.5 + c * (1.0 + 0.42 * r2 * uAmt);
      float band = floor(vUv.y * 38.0); float gl = uGlitch * step(0.78, hash(vec2(band, floor(uTime*14.0))));
      uv.x += gl * (hash(vec2(band, uTime)) - 0.5) * 0.18;
      vec3 col;
      float ca = 0.004 * (uAmt + uGlitch*2.0);
      col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r; col.g = texture2D(tDiffuse, uv).g; col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 tint = vec3(lum) * vec3(0.62, 1.05, 0.78) + vec3(0.0, 0.015, 0.01);
      col = mix(col, tint, uAmt * 0.88);
      float sl = 0.5 + 0.5 * sin(vUv.y * uRes.y * 1.6);
      col *= 1.0 - uAmt * 0.2 * sl;
      col += uAmt * 0.07 * smoothstep(0.0, 0.08, fract(vUv.y * 0.9 - uTime * 0.11)) * 0.0;
      float roll = smoothstep(0.0, 0.015, abs(fract(vUv.y - uTime * 0.07) - 0.5) - 0.48 + 0.02);
      col += vec3(0.05,0.12,0.08) * uAmt * (1.0 - roll) * 0.0;
      col += (hash(vUv * uRes + uTime) - 0.5) * 0.11 * uAmt;
      float vig = smoothstep(0.75, 0.2, r2 * 2.2);
      col *= mix(1.0, vig, uAmt);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const SanitizeShader = {
  name: "OvSanitize",
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b) || !(c.a == c.a)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = clamp(c, 0.0, 40.0); }`,
};

type CamR = {
  vis: E.CamVis;
  def: FloorDef["cams"][number];
  meter: number;
  blind: number; // seconds remaining
  jacked: boolean;
  yaw: number; // current world yaw (deg)
  seen: boolean;
  sus: number;
  state: "idle" | "sus" | "alert" | "blind";
};
type RobState = "patrol" | "sus" | "hunt" | "search" | "return" | "ridden" | "reboot";
type RobR = {
  vis: E.RobotVis;
  def: FloorDef["robots"][number];
  x: number;
  z: number; // world
  yaw: number; // rad (forward = cos,sin)
  state: RobState;
  wp: number;
  dir: number;
  pause: number;
  path: V2[];
  pi: number;
  meter: number;
  seen: boolean;
  last: V2 | null; // last known drone (world)
  lostT: number;
  searchT: number;
  rideT: number;
  speedNow: number;
  look: number; // idle scan phase
};
type Tgt = { kind: "cam" | "robot" | "junction" | "core"; id: string; pos: THREE.Vector3; time: number; name: string; ref: unknown };
type Stage = "loading" | "menu" | "play" | "paused" | "fade" | "exfil" | "results";
type Mode = "drone" | "cam" | "ride";

export function createGame(container: HTMLElement, hooks: GameHooks): GameInstance {
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const mobile = coarse || container.clientWidth < 720;
  const ALL = floors();

  // ------------------------------------------------------------------ resource tracking (game + per floor)
  const gGeos = new Set<THREE.BufferGeometry>();
  const gMats = new Set<THREE.Material>();
  const gTexs = new Set<THREE.Texture>();
  const mkTrack = (g: Set<THREE.BufferGeometry>, m: Set<THREE.Material>, t: Set<THREE.Texture>): Track => ({
    G: (x) => (g.add(x), x),
    M: (x) => (m.add(x), x),
    T: (x) => (t.add(x), x),
  });
  let fGeos = new Set<THREE.BufferGeometry>();
  let fMats = new Set<THREE.Material>();
  let fTexs = new Set<THREE.Texture>();
  let fTrack = mkTrack(fGeos, fMats, fTexs);
  const listeners: Array<() => void> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = (el: EventTarget, type: string, fn: (ev: any) => void, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };

  const settings = store(SET_KEY, { vol: 0.8, muted: false });
  const progress = store<Save>(SAVE_KEY, { best: {} });
  const hintSeen = store<Record<string, number>>(HINT_KEY, {});
  const totalScore = () => Object.values(progress.best).reduce((s, b) => s + (b?.score ?? 0), 0);
  const unlocked = (n: number) => n === 1 || !!progress.best[String(n - 1)];

  let stage: Stage = "loading";
  let pausedFrom: Stage = "play";
  let disposed = false;
  let menuT = 0;
  let selFloor = 1;
  let simBoost = 1;
  let godMode = false;
  let topdown = false;

  let viewW = Math.max(1, container.clientWidth);
  let viewH = Math.max(1, container.clientHeight);

  // ------------------------------------------------------------------ HUD / audio
  const hud = buildOvHud(container, mobile);
  const prevOverflow = document.body.style.overflow;
  const prevOverscroll = document.documentElement.style.overscrollBehavior;
  if (mobile) {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
  }
  const sfx = createSfx();
  sfx.setVolume(settings.muted ? 0 : settings.vol);

  // ------------------------------------------------------------------ renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(viewW, viewH);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.insertBefore(renderer.domElement, hud.style);
  const canvas = renderer.domElement;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07040c);
  scene.fog = new THREE.FogExp2(0x120a22, 0.0035);
  const camera = new THREE.PerspectiveCamera(72, viewW / viewH, 0.05, 1600);
  scene.add(camera);
  const hemi = new THREE.HemisphereLight(0x9fa6ff, 0x2a1830, 0.9);
  scene.add(hemi);
  const POOL = mobile ? 4 : 6;
  type Slot = { light: THREE.PointLight; fix: number; k: number };
  const slots: Slot[] = [];
  for (let i = 0; i < POOL; i++) {
    const l = new THREE.PointLight(0xffe2c0, 0, 15, 1.7);
    scene.add(l);
    slots.push({ light: l, fix: -1, k: 0 });
  }

  // ------------------------------------------------------------------ assets
  const manager = new THREE.LoadingManager();
  const gltf = new GLTFLoader(manager);
  const texLoader = new THREE.TextureLoader(manager);
  let robotSrc: THREE.Object3D | null = null;
  let robotClips: THREE.AnimationClip[] = [];
  let pbr: { metal: PbrSet; concrete: PbrSet } | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;
  let pmrem: THREE.PMREMGenerator | null = null;
  const srcObjects: THREE.Object3D[] = [];

  // ------------------------------------------------------------------ composer
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  let cctv: ShaderPass | null = null;
  let grade: ShaderPass | null = null;
  try {
    const rt = new THREE.WebGLRenderTarget(viewW * pixelRatio(), viewH * pixelRatio(), { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    // guard: a single NaN/Inf texel (half-float overflow) would smear the whole bloom chain black
    composer.addPass(new ShaderPass(SanitizeShader));
    bloom = new UnrealBloomPass(new THREE.Vector2(viewW, viewH), mobile ? 0.5 : 0.62, 0.42, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    cctv = new ShaderPass(CctvShader);
    composer.addPass(cctv);
    grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
  } catch (err) {
    console.error("[OVERRIDE] post unavailable", err);
    composer = null;
  }
  const onResize = () => {
    viewW = Math.max(1, container.clientWidth);
    viewH = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(viewW, viewH);
    composer?.setPixelRatio(pixelRatio());
    composer?.setSize(viewW, viewH);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
    if (cctv) cctv.uniforms.uRes.value.set(viewW, viewH);
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(container);
  else on(window, "resize", onResize);
  onResize();

  // =================================================================== FLOOR RUNTIME
  let def: FloorDef = ALL[0];
  let nav: Nav = new Nav(def);
  let world: World | null = null;
  let floorRoot: THREE.Group | null = null;
  let camsR: CamR[] = [];
  let robs: RobR[] = [];
  let lasers: Array<E.LaserVis & { offT: number }> = [];
  let juncs: Array<E.JunctionVis & { used: number }> = [];
  let doors: Array<E.DoorVis & { holdT: number }> = [];
  let scans: E.ScannerVis[] = [];
  let chargers: E.ChargerVis[] = [];
  let core: E.CoreVis | null = null;
  let extract: E.ExtractVis | null = null;
  let drone: E.DroneVis | null = null;
  let icons: ReturnType<typeof E.iconTextures> | null = null;
  let hackBeam: THREE.Line | null = null;
  let hackBeamMat: THREE.LineBasicMaterial | null = null;

  // drone / player state
  const dp = new THREE.Vector3(); // drone position (world)
  const dv = new THREE.Vector3(); // velocity
  let dYaw = 0; // body yaw (rad, forward = cos,sin)
  let lookYaw = 0;
  let lookPitch = -0.12;
  let firstPerson = false;
  let mode: Mode = "drone";
  let battery = 100;
  let runT = 0;
  let detected = 0;
  let hacks = 0;
  let caughts = 0;
  let coreDone = false;
  let alarmT = 0; // >0 while lockdown
  let traceT = 0;
  let lightF = 0.5;
  let lightT = 0;
  let maxMeter = 0;
  let ckpt: { x: number; z: number; y: number; doors: boolean[]; coreDone: boolean } | null = null;
  let hackSt: { tgt: Tgt | null; p: number } = { tgt: null, p: 0 };
  let curTgt: Tgt | null = null;
  let jackCam: CamR | null = null;
  let jackT = 0;
  let camYawOff = 0;
  let camPitch = 0.3;
  let rideRob: RobR | null = null;
  let glitch = 0;
  let shake = 0;
  let exfilT = 0;
  let bannerT = 0;
  let hintT = 0;
  let lastLaserHit = -9;
  let lastScanHit = -9;
  let lowWarn = 0;
  let chargeNow = false;
  let fadeFn: (() => void) | null = null;
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const camLook = new THREE.Vector3();

  function disposeFloor() {
    if (floorRoot) {
      scene.remove(floorRoot);
      floorRoot = null;
    }
    if (world) {
      scene.remove(world.city);
      scene.remove(world.group);
      world = null;
    }
    for (const r of robs) r.vis.mixer?.stopAllAction();
    fGeos.forEach((g) => g.dispose());
    fMats.forEach((m) => m.dispose());
    fTexs.forEach((t) => t.dispose());
    fGeos = new Set();
    fMats = new Set();
    fTexs = new Set();
    fTrack = mkTrack(fGeos, fMats, fTexs);
    camsR = [];
    robs = [];
    lasers = [];
    juncs = [];
    doors = [];
    scans = [];
    chargers = [];
    core = null;
    extract = null;
    drone = null;
    hackBeam = null;
    for (const s of slots) {
      s.fix = -1;
      s.light.intensity = 0;
    }
  }

  function loadFloor(n: number) {
    disposeFloor();
    def = ALL[n - 1];
    nav = new Nav(def);
    const T = fTrack;
    const th = def.theme;
    scene.background = new THREE.Color(th.sky);
    (scene.fog as THREE.FogExp2).color.set(th.fog);
    hemi.color.set(th.hemiSky);
    hemi.groundColor.set(th.hemiGround);
    hemi.intensity = th.hemiI * 0.32;
    world = buildWorld(def, nav, T, pbr!, aniso, mobile);
    floorRoot = new THREE.Group();
    scene.add(world.group, world.city);
    scene.add(floorRoot);
    icons = E.iconTextures(T.T);
    // cameras
    for (const cd of def.cams) {
      const vis = E.buildCam(T, cd, icons);
      floorRoot.add(vis.root, vis.foot);
      camsR.push({ vis, def: cd, meter: 0, blind: 0, jacked: false, yaw: cd.yaw, seen: false, sus: 0, state: "idle" });
      E.updateCamVis(vis, cd.yaw);
    }
    // robots
    for (const rd of def.robots) {
      const vis = E.buildRobot(T, robotSrc, robotClips, icons);
      floorRoot.add(vis.root, vis.fan);
      const s = rd.route[rd.start ?? 0];
      const r: RobR = { vis, def: rd, x: s[0] * CELL, z: s[1] * CELL, yaw: 0, state: "patrol", wp: rd.start ?? 0, dir: 1, pause: 0, path: [], pi: 0, meter: 0, seen: false, last: null, lostT: 0, searchT: 0, rideT: 0, speedNow: 0, look: 0 };
      robs.push(r);
      planLeg(r);
    }
    for (const ld of def.lasers) {
      const l = E.buildLaser(T, ld);
      floorRoot.add(l.mesh, ...l.posts);
      lasers.push({ ...l, offT: 0 });
    }
    for (const jd of def.junctions) {
      const j = E.buildJunction(T, jd);
      floorRoot.add(j.root);
      juncs.push({ ...j, used: 0 });
    }
    for (const dd of def.doors) {
      const d = E.buildDoor(T, dd, def.ceil(dd.cells[0][0], dd.cells[0][1], "."));
      floorRoot.add(d.root);
      doors.push({ ...d, holdT: 0 });
    }
    for (const sd of def.scanners) {
      const s = E.buildScanner(T, sd, 4);
      floorRoot.add(s.root);
      scans.push(s);
    }
    for (const c of def.chargers) {
      const ch = E.buildCharger(T, c.x, c.z, c.face);
      floorRoot.add(ch.root);
      chargers.push(ch);
    }
    core = E.buildCore(T, def.core[0], def.core[1], def.ceil(Math.floor(def.core[0]), Math.floor(def.core[1]), "."), th.accent);
    floorRoot.add(core.root);
    extract = E.buildExtract(T, def.extract[0], def.extract[1], 4, th.accent2);
    floorRoot.add(extract.root);
    drone = E.buildDrone(T, E.shadowTexture(T.T));
    floorRoot.add(drone.root, drone.shadow, drone.trail.pts);
    // hack beam
    const bg = T.G(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]));
    hackBeamMat = T.M(new THREE.LineBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(3), transparent: true, opacity: 0.9, toneMapped: false, depthTest: false }));
    hackBeam = new THREE.Line(bg, hackBeamMat);
    hackBeam.frustumCulled = false;
    hackBeam.renderOrder = 15;
    hackBeam.visible = false;
    floorRoot.add(hackBeam);
    resetRunState();
  }

  function resetRunState() {
    runT = 0;
    detected = 0;
    hacks = 0;
    caughts = 0;
    coreDone = false;
    alarmT = 0;
    traceT = 0;
    battery = 100;
    mode = "drone";
    jackCam = null;
    rideRob = null;
    hackSt = { tgt: null, p: 0 };
    ckpt = null;
    resetDynamic();
    placeDrone(def.start[0] * CELL, def.start[1] * CELL, 1.1);
    lookYaw = dYaw = def.startYaw * deg;
    lookPitch = -0.12;
    if (extract) extract.root.visible = false;
    world?.setExtract(false);
    if (core) {
      core.coreMat.opacity = 0.92;
      core.light.intensity = 5;
    }
    shownHints.clear();
  }
  const shownHints = new Set<string>();

  function resetDynamic() {
    for (const c of camsR) {
      c.meter = 0;
      c.blind = 0;
      c.jacked = false;
      c.sus = 0;
      c.seen = false;
    }
    for (const r of robs) {
      const s = r.def.route[r.def.start ?? 0];
      r.x = s[0] * CELL;
      r.z = s[1] * CELL;
      r.state = "patrol";
      r.wp = r.def.start ?? 0;
      r.dir = 1;
      r.pause = 0;
      r.meter = 0;
      r.last = null;
      r.rideT = 0;
      r.vis.root.visible = true;
      planLeg(r);
      const nx = r.path[0];
      if (nx) r.yaw = Math.atan2(nx[1] * CELL - r.z, nx[0] * CELL - r.x);
    }
    for (const l of lasers) l.offT = 0;
    for (const j of juncs) j.used = 0;
    doors.forEach((d, i) => {
      nav.doorOpen[i] = false;
      E.setDoor(d, 0);
      d.holdT = 0;
    });
    alarmT = 0;
  }

  function placeDrone(x: number, z: number, y: number) {
    dp.set(x, y, z);
    dv.set(0, 0, 0);
    if (drone) drone.trail.pos.fill(-999);
  }

  // =================================================================== ROBOT AI
  function planLeg(r: RobR) {
    const route = r.def.route;
    const target = route[r.wp];
    const p = nav.path([r.x / CELL, r.z / CELL], target);
    r.path = p ?? [target];
    r.pi = 0;
  }
  function planTo(r: RobR, wx: number, wz: number) {
    const p = nav.path([r.x / CELL, r.z / CELL], [wx / CELL, wz / CELL]);
    r.path = p ?? [[wx / CELL, wz / CELL]];
    r.pi = 0;
  }
  /** advance along r.path; returns true when finished */
  function followPath(r: RobR, dt: number, speed: number, turn = 5) {
    const p = r.path[r.pi];
    if (!p) {
      r.speedNow = 0;
      return true;
    }
    const tx = p[0] * CELL;
    const tz = p[1] * CELL;
    const dx = tx - r.x;
    const dz = tz - r.z;
    const d = Math.hypot(dx, dz);
    const want = Math.atan2(dz, dx);
    r.yaw += clamp(angDiff(r.yaw, want), -turn * dt, turn * dt);
    const aligned = Math.abs(angDiff(r.yaw, want)) < 0.9;
    const step = Math.min(d, speed * dt * (aligned ? 1 : 0.15));
    if (d > 1e-4) {
      r.x += (dx / d) * step;
      r.z += (dz / d) * step;
    }
    r.speedNow = step / Math.max(dt, 1e-4);
    if (d < 0.18) {
      r.pi++;
      if (r.pi >= r.path.length) return true;
    }
    return false;
  }
  function nearestRouteIndex(r: RobR) {
    let best = 0;
    let bd = 1e9;
    r.def.route.forEach((p, i) => {
      const d = Math.hypot(p[0] * CELL - r.x, p[1] * CELL - r.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  function advanceWp(r: RobR) {
    const n = r.def.route.length;
    if (r.def.mode === "loop") r.wp = (r.wp + 1) % n;
    else {
      if (r.wp + r.dir >= n || r.wp + r.dir < 0) r.dir *= -1;
      r.wp += r.dir;
    }
  }

  function updateRobots(dt: number) {
    for (const r of robs) {
      if (r.state === "ridden") continue;
      if (r.state === "reboot") {
        // a freshly released unit stands still, visor dark, while its firmware reloads
        r.speedNow = 0;
        r.searchT -= dt;
        if (r.searchT > 0) continue;
        r.state = "return";
        r.searchT = 0;
        r.wp = nearestRouteIndex(r);
        planLeg(r);
      }
      const alarmOn = alarmT > 0;
      if (alarmOn && r.state !== "hunt" && r.state !== "search") {
        r.state = "hunt";
        if (!r.last) r.last = [dp.x, dp.z];
        planTo(r, r.last[0], r.last[1]);
      }
      if (traceT > 0 && r.state === "patrol" && r.last === null) {
        r.state = "hunt";
        r.last = [def.core[0] * CELL, def.core[1] * CELL];
        planTo(r, r.last[0], r.last[1]);
      }
      switch (r.state) {
        case "patrol": {
          if (r.pause > 0) {
            r.pause -= dt;
            r.speedNow = 0;
            r.look += dt;
            r.yaw += Math.cos(r.look * 1.6) * 0.55 * dt;
            if (r.pause <= 0) {
              advanceWp(r);
              planLeg(r);
            }
          } else if (followPath(r, dt, r.def.speed)) {
            r.pause = r.def.pause;
            r.look = 0;
          }
          if (r.meter > 0.5) {
            r.state = "sus";
            r.lostT = 0;
            sfx.suspicious(0.5);
          }
          break;
        }
        case "sus": {
          if (r.seen) {
            r.lostT = 0;
            r.last = [dp.x, dp.z];
            const want = Math.atan2(dp.z - r.z, dp.x - r.x);
            r.yaw += clamp(angDiff(r.yaw, want), -5 * dt, 5 * dt);
            const dist = Math.hypot(dp.x - r.x, dp.z - r.z);
            r.speedNow = 0;
            if (dist > 4.5) {
              r.path = [[dp.x / CELL, dp.z / CELL]];
              r.pi = 0;
              followPath(r, dt, 1.2);
            }
          } else {
            r.lostT += dt;
            if (r.last) {
              if (r.path.length === 0 || r.pi >= r.path.length) planTo(r, r.last[0], r.last[1]);
              followPath(r, dt, 1.4);
            }
            if (r.lostT > 3.2) {
              r.state = "return";
              r.wp = nearestRouteIndex(r);
              planLeg(r);
              r.last = null;
            }
          }
          if (r.meter <= 0.02 && !r.seen && r.lostT > 1.5) {
            r.state = "return";
            r.wp = nearestRouteIndex(r);
            planLeg(r);
            r.last = null;
          }
          break;
        }
        case "hunt": {
          if (r.seen) {
            r.last = [dp.x, dp.z];
          }
          if (r.last) {
            if (r.seen && Math.hypot(dp.x - r.x, dp.z - r.z) > 2.2) {
              r.path = [[dp.x / CELL, dp.z / CELL]];
              if (!nav.walkable(Math.floor(dp.x / CELL), Math.floor(dp.z / CELL))) planTo(r, dp.x, dp.z);
              r.pi = 0;
            }
            if (followPath(r, dt, 3.0, 7)) {
              r.state = "search";
              r.searchT = 4.5;
            }
          }
          break;
        }
        case "search": {
          r.speedNow = 0;
          r.searchT -= dt;
          r.yaw += dt * 2.1;
          if (r.seen) {
            r.state = "hunt";
            r.last = [dp.x, dp.z];
            planTo(r, dp.x, dp.z);
          } else if (r.searchT <= 0 && alarmT <= 0 && traceT <= 0) {
            r.state = "return";
            r.wp = nearestRouteIndex(r);
            planLeg(r);
            r.last = null;
          } else if (r.searchT <= 0) r.searchT = 2;
          break;
        }
        case "return": {
          if (followPath(r, dt, r.def.speed * 1.3)) {
            r.state = "patrol";
            r.pause = 0.4;
          }
          if (r.meter > 0.5) {
            r.state = "sus";
            r.lostT = 0;
          }
          break;
        }
        default:
          break;
      }
      if (alarmT <= 0 && traceT <= 0 && (r.state === "hunt" || r.state === "search") && !r.seen && r.searchT <= 0 && r.state === "hunt" && r.path.length === 0) {
        r.state = "return";
      }
    }
  }

  function updateRiddenRobot(dt: number, mx: number, mz: number) {
    const r = rideRob!;
    r.rideT -= dt;
    // movement relative to camera yaw
    const sp = 2.6;
    const fx = Math.cos(lookYaw);
    const fz = Math.sin(lookYaw);
    const wx = fx * -mz + -fz * mx;
    const wz = fz * -mz + fx * mx;
    const len = Math.hypot(wx, wz);
    let moved = 0;
    if (len > 0.05) {
      const nx = (wx / len) * sp * Math.min(1, len) * dt;
      const nz = (wz / len) * sp * Math.min(1, len) * dt;
      const tryMove = (ax: number, az: number) => {
        const px = r.x + ax;
        const pz = r.z + az;
        const m = 0.5;
        for (const [ox, oz] of [[m, m], [-m, m], [m, -m], [-m, -m]]) {
          const cx = Math.floor((px + ox) / CELL);
          const cz = Math.floor((pz + oz) / CELL);
          if (!nav.walkable(cx, cz)) return false;
          const di = nav.doorIndex(cx, cz);
          if (di !== undefined && !nav.doorOpen[di]) return false;
        }
        r.x = px;
        r.z = pz;
        return true;
      };
      if (tryMove(nx, nz) || tryMove(nx, 0) || tryMove(0, nz)) moved = 1;
      r.yaw += clamp(angDiff(r.yaw, Math.atan2(wz, wx)), -9 * dt, 9 * dt);
    }
    r.speedNow = moved ? sp * Math.min(1, len) : 0;
    // badge readers: a ridden robot opens doors
    doors.forEach((d, i) => {
      if (Math.hypot(d.center.x - r.x, d.center.z - r.z) < 3.2 && !nav.doorOpen[i]) {
        nav.doorOpen[i] = true;
        d.holdT = 30;
        sfx.door();
        toast("BADGE ACCEPTED — DOOR OPEN", "good");
        showBanner("ACCESS GRANTED", "SECURITY DOOR UNLOCKED", def.theme.accent2);
      }
    });
    if (r.rideT <= 0) exitRide("RIDE TIMED OUT");
  }

  // =================================================================== DETECTION
  function lightNow() {
    return world ? world.lightAt(dp.x, dp.z) : 0.5;
  }
  function detectRate(dist: number, range: number) {
    const prox = 1.3 - 0.85 * (dist / range);
    const speedK = 0.85 + 0.15 * clamp(dv.length() / 6, 0, 1);
    return 0.66 * prox * (0.5 + 0.5 * lightF) * speedK;
  }
  function camSees(c: CamR, px: number, py: number, pz: number) {
    if (c.blind > 0) return -1;
    const p = c.vis.tw;
    const dx = px - p.x;
    const dy = py - p.y;
    const dz = pz - p.z;
    const dist = Math.hypot(dx, dy, dz);
    const range = c.vis.effRange;
    if (dist > range) return -1;
    const a = c.yaw * deg;
    const cp = Math.cos(c.vis.pitch);
    const fx = Math.cos(a) * cp;
    const fy = -Math.sin(c.vis.pitch);
    const fz = Math.sin(a) * cp;
    const cosA = (dx * fx + dy * fy + dz * fz) / dist;
    if (cosA < Math.cos(c.def.fov * deg)) return -1;
    if (!nav.los(p.x, p.y, p.z, px, py, pz)) return -1;
    return dist;
  }
  function robSees(r: RobR, px: number, py: number, pz: number) {
    if (r.state === "ridden" || r.state === "reboot") return -1;
    const eyeY = 1.55;
    const dx = px - r.x;
    const dy = py - eyeY;
    const dz = pz - r.z;
    const dist = Math.hypot(dx, dy, dz);
    const range = 11;
    if (dist > range) return -1;
    const hd = Math.hypot(dx, dz);
    const close = hd < 2.2;
    if (!close) {
      const cosA = (dx * Math.cos(r.yaw) + dz * Math.sin(r.yaw)) / Math.max(hd, 1e-4);
      const vert = Math.atan2(Math.abs(dy), Math.max(hd, 0.1));
      if (cosA < Math.cos(40 * deg) || vert > 52 * deg) return -1;
    }
    if (!nav.los(r.x, eyeY, r.z, px, py, pz)) return -1;
    return dist;
  }
  function updateDetection(dt: number) {
    lightT -= dt;
    if (lightT <= 0) {
      lightF = lightNow();
      lightT = 0.12;
    }
    const hidden = mode === "ride";
    maxMeter = 0;
    let seenBy = 0;
    const drop = alarmT > 0 ? 0.12 : 0.34;
    const consider = (kind: "cam" | "rob", obj: CamR | RobR, d: number, range: number) => {
      const seen = d >= 0 && !hidden;
      if (kind === "cam") {
        const c = obj as CamR;
        c.seen = seen;
        if (seen) c.meter += detectRate(d, range) * dt;
        else c.meter = Math.max(0, c.meter - drop * dt);
        c.meter = Math.min(1, c.meter);
        maxMeter = Math.max(maxMeter, c.meter);
      } else {
        const r = obj as RobR;
        r.seen = seen;
        if (seen) r.meter += detectRate(d, range) * 1.05 * dt * (d < 2.2 ? 1.8 : 1);
        else r.meter = Math.max(0, r.meter - drop * dt);
        r.meter = Math.min(1, r.meter);
        maxMeter = Math.max(maxMeter, r.meter);
      }
      if (seen) seenBy++;
    };
    for (const c of camsR) consider("cam", c, camSees(c, dp.x, dp.y, dp.z), c.vis.effRange);
    for (const r of robs) consider("rob", r, robSees(r, dp.x, dp.y, dp.z), 11);
    if (godMode) {
      maxMeter = 0;
      for (const c of camsR) c.meter = 0;
      for (const r of robs) r.meter = 0;
      return;
    }
    if (mode === "ride") return;
    const full = camsR.some((c) => c.meter >= 1) || robs.some((r) => r.meter >= 1);
    if (full) {
      if (alarmT <= 0) triggerAlarm("SPOTTED");
      else caught("CAUGHT BY SECURITY");
    }
    // contact catch
    if (alarmT > 0) {
      for (const r of robs) if (r.state !== "ridden" && r.seen && Math.hypot(dp.x - r.x, dp.z - r.z) < 1.4 && Math.abs(dp.y - 1) < 1.6) caught("CAUGHT BY SECURITY");
    }
    void seenBy;
  }
  function triggerAlarm(why: string) {
    if (alarmT > 0) return;
    detected++;
    alarmT = 18;
    sfx.alarm();
    glitch = 0.6;
    shake = 0.5;
    toast(`ALARM — ${why}`, "bad");
    showBanner("LOCKDOWN", "SECURITY IS HUNTING YOU · BREAK LINE OF SIGHT", 0xff4d5c);
    for (const c of camsR) c.meter = Math.max(c.meter * 0.6, c.seen ? 0.6 : 0);
    for (const r of robs) {
      r.meter = r.seen ? 0.6 : 0;
      if (r.state !== "ridden") {
        r.state = "hunt";
        r.last = [dp.x, dp.z];
        planTo(r, dp.x, dp.z);
      }
    }
    if (mode === "cam") exitJack(false);
  }
  function endAlarm() {
    alarmT = 0;
    toast("LOCKDOWN LIFTED", "good");
    for (const c of camsR) c.meter = 0;
    for (const r of robs) {
      r.meter = 0;
      if (r.state === "hunt" || r.state === "search") {
        r.state = "return";
        r.wp = nearestRouteIndex(r);
        planLeg(r);
        r.last = null;
      }
    }
  }

  // =================================================================== HACKING
  function buildTargets(): Tgt[] {
    const out: Tgt[] = [];
    for (const c of camsR) {
      if (c.jacked) continue;
      out.push({ kind: "cam", id: c.def.id, pos: c.vis.tw.clone().add(new THREE.Vector3(0, -0.15, 0)), time: 1.1, name: `CAM ${c.def.id.toUpperCase()}`, ref: c });
    }
    for (const r of robs) {
      if (r.state === "ridden") continue;
      out.push({ kind: "robot", id: r.def.id, pos: new THREE.Vector3(r.x, 1.15, r.z), time: 1.7, name: `UNIT ${r.def.id.toUpperCase()}`, ref: r });
    }
    for (const j of juncs) {
      const linked = lasers.filter((l) => l.def.box === j.def.id);
      if (linked.length && linked.every((l) => l.offT > 0)) continue;
      out.push({ kind: "junction", id: j.def.id, pos: j.tw.clone(), time: 0.9, name: "LASER JUNCTION", ref: j });
    }
    if (!coreDone && core) out.push({ kind: "core", id: "core", pos: core.tw.clone(), time: 4.2, name: "DATA CORE", ref: core });
    return out;
  }
  function pickTarget(): Tgt | null {
    if (mode === "ride") return null;
    const list = buildTargets();
    let origin: THREE.Vector3;
    let dir: THREE.Vector3;
    let range: number;
    let cone: number;
    if (mode === "cam" && jackCam) {
      origin = jackCam.vis.tw;
      dir = camLook;
      range = 24;
      cone = 16;
    } else {
      origin = dp;
      dir = camLook;
      range = 8.5;
      cone = mobile ? 22 : 15;
    }
    let best: Tgt | null = null;
    let bestA = 1e9;
    for (const t of list) {
      if (mode === "cam" && t.ref === jackCam) continue;
      if (bot.on && bot.want && t.id !== bot.want) continue;
      const dx = t.pos.x - origin.x;
      const dy = t.pos.y - origin.y;
      const dz = t.pos.z - origin.z;
      const d = Math.hypot(dx, dy, dz);
      const r = t.kind === "core" ? 5.5 : range;
      if (d > r) continue;
      // view direction from the actual camera for aiming
      const cdx = t.pos.x - camera.position.x;
      const cdy = t.pos.y - camera.position.y;
      const cdz = t.pos.z - camera.position.z;
      const cd = Math.hypot(cdx, cdy, cdz) || 1;
      const ang = Math.acos(clamp((cdx * dir.x + cdy * dir.y + cdz * dir.z) / cd, -1, 1)) / deg;
      if (ang > (t.kind === "core" ? cone * 2 : cone)) continue;
      if (!nav.los(origin.x, origin.y, origin.z, t.pos.x, t.pos.y, t.pos.z) && t.kind !== "core") {
        // cameras sit on the ceiling: also accept sight from slightly lower
        if (!nav.los(origin.x, origin.y, origin.z, t.pos.x, Math.min(t.pos.y, 1.2), t.pos.z)) continue;
      }
      if (ang < bestA) {
        bestA = ang;
        best = t;
      }
    }
    return best;
  }
  function completeHack(t: Tgt) {
    hacks++;
    sfx.hackDone();
    glitch = 0.35;
    if (t.kind === "cam") enterJack(t.ref as CamR);
    else if (t.kind === "robot") enterRide(t.ref as RobR);
    else if (t.kind === "junction") {
      const j = t.ref as (typeof juncs)[number];
      for (const l of lasers) if (l.def.box === j.def.id) l.offT = j.def.off;
      j.used = j.def.off;
      sfx.laserOff();
      toast(`LASERS DISABLED · ${j.def.off}s`, "good");
    } else if (t.kind === "core") {
      coreDone = true;
      traceT = 22;
      toast("DATA CORE DOWNLOADED", "good");
      showBanner("CORE DOWNLOADED", "TRACE DETECTED · GET OUT THROUGH THE WINDOW", def.theme.accent2);
      if (extract) extract.root.visible = true;
      world?.setExtract(true);
      sfx.win();
      if (core) {
        core.coreMat.opacity = 0.3;
        core.light.intensity = 1.5;
      }
      hacks--; // downloading the core is the objective, not a "hack used"
    }
  }
  function enterJack(c: CamR) {
    if (mode === "cam") exitJack(false);
    jackCam = c;
    c.jacked = true;
    c.blind = 14;
    c.meter = 0;
    jackT = 10;
    mode = "cam";
    camYawOff = 0;
    camPitch = c.vis.pitch;
    c.vis.cone.visible = false;
    c.vis.foot.visible = false;
    sfx.jackIn();
    glitch = 0.8;
    hud.root.dataset.mode = "cam";
    hud.camN.textContent = `CAM ${c.def.id.toUpperCase()}`;
    toast(`JACKED INTO CAM ${c.def.id.toUpperCase()} · FEED LOOPED`, "good");
  }
  function exitJack(play = true) {
    if (!jackCam) return;
    jackCam.jacked = false;
    jackCam.vis.cone.visible = true;
    jackCam.vis.foot.visible = true;
    jackCam = null;
    mode = "drone";
    hud.root.dataset.mode = "play";
    if (play) sfx.jackOut();
    glitch = 0.5;
    lookYaw = dYaw;
  }
  function enterRide(r: RobR) {
    if (mode === "cam") exitJack(false);
    rideRob = r;
    r.state = "ridden";
    r.rideT = 15;
    r.meter = 0;
    r.path = [];
    mode = "ride";
    hud.root.dataset.mode = "ride";
    hud.rideN.textContent = `UNIT ${r.def.id.toUpperCase()}`;
    sfx.ride();
    lookYaw = r.yaw;
    lookPitch = -0.25;
    toast(`RIDING UNIT ${r.def.id.toUpperCase()} · ${15}s`, "good");
    if (drone) drone.root.visible = false;
  }
  function exitRide(msg = "DISMOUNTED") {
    const r = rideRob;
    if (!r) return;
    rideRob = null;
    r.state = "reboot";
    r.searchT = 4;
    r.meter = 0;
    r.last = null;
    r.vis.ring.visible = false;
    mode = "drone";
    hud.root.dataset.mode = "play";
    // drone lifts off the robot
    dp.set(r.x, 1.9, r.z);
    dv.set(0, 0.5, 0);
    if (drone) drone.root.visible = true;
    if (drone) drone.trail.pos.fill(-999);
    lookYaw = r.yaw;
    dYaw = r.yaw;
    sfx.jackOut();
    toast(`${msg} · UNIT REBOOTING 4s`, "good");
  }

  // =================================================================== INPUT
  const keys = new Set<string>();
  const input = { mx: 0, mz: 0, lift: 0, hack: false, exitPressed: false };
  const touch = { up: false, dn: false, hack: false, mx: 0, mz: 0 };
  let dragging = false;
  let locked = false;
  let pad: Gamepad | null = null;
  const bot = { on: false, steps: [] as Step[], i: 0, wait: 0, mx: 0, mz: 0, lift: 0, stuck: 0, probeT: 0, probeD: 1e9, hack: false, exit: false, log: [] as string[], done: false, want: "" };

  function lookDelta(dx: number, dy: number) {
    if (mode === "cam") {
      camYawOff = clamp(camYawOff + dx * 0.0032, -1.15, 1.15);
      camPitch = clamp(camPitch + dy * 0.0032, -0.2, 1.1);
    } else {
      lookYaw += dx * 0.0028;
      lookPitch = clamp(lookPitch - dy * 0.0028, -1.25, 1.1);
    }
  }
  function toggleView() {
    firstPerson = !firstPerson;
    toast(firstPerson ? "FIRST-PERSON VIEW" : "CHASE VIEW");
  }
  on(window, "keydown", (e: KeyboardEvent) => {
    if (stage === "loading") return;
    if (e.repeat && e.code !== "KeyE") {
      if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      return;
    }
    if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && (stage === "play" || stage === "paused")) e.preventDefault();
    keys.add(e.code);
    if (e.code === "KeyP" || e.code === "Escape") {
      if (stage === "play") pause();
      else if (stage === "paused") resume();
    }
    if (stage === "play") {
      if (e.code === "KeyQ") input.exitPressed = true;
      if (e.code === "KeyV") toggleView();
      if (e.code === "Tab") showObjectives(true);
    }
    if (e.code === "KeyM") toggleMute();
    if (e.code === "KeyF") toggleFs();
  });
  on(window, "keyup", (e: KeyboardEvent) => {
    keys.delete(e.code);
    if (e.code === "Tab") showObjectives(false);
  });
  on(window, "blur", () => keys.clear());
  on(document, "pointerlockchange", () => {
    locked = document.pointerLockElement === canvas;
    if (!locked && stage === "play" && !mobile && lockWanted) pause();
  });
  let lockWanted = false;
  on(canvas, "mousedown", (e: MouseEvent) => {
    if (stage !== "play" || mobile) return;
    if (!locked && canvas.requestPointerLock && e.button === 0) {
      try {
        const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
        lockWanted = true;
      } catch {
        /* ignore */
      }
    }
    dragging = true;
  });
  on(window, "mouseup", () => (dragging = false));
  on(window, "mousemove", (e: MouseEvent) => {
    if (stage !== "play" || mobile) return;
    if (locked || dragging) lookDelta(e.movementX, e.movementY);
  });
  on(canvas, "contextmenu", (e: Event) => e.preventDefault());

  // touch
  const stickEl = hud.stick;
  const stickKnob = stickEl.querySelector("i") as HTMLElement;
  let moveId = -1;
  let lookId = -1;
  let lookLast = { x: 0, y: 0 };
  let stickC = { x: 0, y: 0 };
  on(hud.zoneMv, "pointerdown", (e: PointerEvent) => {
    if (moveId >= 0) return;
    moveId = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const r = hud.root.getBoundingClientRect();
    stickC = { x: e.clientX, y: e.clientY };
    stickEl.style.left = `${e.clientX - r.left}px`;
    stickEl.style.top = `${e.clientY - r.top}px`;
    stickEl.classList.add("on");
    stickKnob.style.transform = "translate(0,0)";
  });
  on(hud.zoneMv, "pointermove", (e: PointerEvent) => {
    if (e.pointerId !== moveId) return;
    let dx = e.clientX - stickC.x;
    let dy = e.clientY - stickC.y;
    const m = 48;
    const l = Math.hypot(dx, dy);
    if (l > m) {
      dx = (dx / l) * m;
      dy = (dy / l) * m;
    }
    touch.mx = dx / m;
    touch.mz = dy / m;
    stickKnob.style.transform = `translate(${dx}px,${dy}px)`;
  });
  const endMove = (e: PointerEvent) => {
    if (e.pointerId !== moveId) return;
    moveId = -1;
    touch.mx = touch.mz = 0;
    stickEl.classList.remove("on");
  };
  on(hud.zoneMv, "pointerup", endMove);
  on(hud.zoneMv, "pointercancel", endMove);
  on(hud.zoneLk, "pointerdown", (e: PointerEvent) => {
    if (lookId >= 0) return;
    lookId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  });
  on(hud.zoneLk, "pointermove", (e: PointerEvent) => {
    if (e.pointerId !== lookId || stage !== "play") return;
    lookDelta((e.clientX - lookLast.x) * 1.5, (e.clientY - lookLast.y) * 1.5);
    lookLast = { x: e.clientX, y: e.clientY };
  });
  const endLook = (e: PointerEvent) => {
    if (e.pointerId === lookId) lookId = -1;
  };
  on(hud.zoneLk, "pointerup", endLook);
  on(hud.zoneLk, "pointercancel", endLook);
  const hold = (el: HTMLElement, key: "up" | "dn" | "hack") => {
    const set = (v: boolean) => {
      touch[key] = v;
      el.classList.toggle("on", v);
    };
    on(el, "pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      set(true);
    });
    on(el, "pointerup", () => set(false));
    on(el, "pointercancel", () => set(false));
    on(el, "pointerleave", () => set(false));
  };
  hold(hud.tUp, "up");
  hold(hud.tDn, "dn");
  hold(hud.tHack, "hack");
  on(hud.tExit, "pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    input.exitPressed = true;
  });
  on(hud.tView, "pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    toggleView();
  });

  function readGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    pad = null;
    for (const p of pads) if (p && p.connected) pad = p;
  }
  let padPrev = { exit: false, view: false, start: false };
  function readInput() {
    readGamepad();
    let mx = 0;
    let mz = 0;
    let lift = 0;
    let hack = false;
    if (keys.has("KeyW")) mz -= 1;
    if (keys.has("KeyS")) mz += 1;
    if (keys.has("KeyA")) mx -= 1;
    if (keys.has("KeyD")) mx += 1;
    if (keys.has("Space")) lift += 1;
    if (keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("KeyC") || keys.has("ShiftLeft")) lift -= 1;
    if (keys.has("KeyE")) hack = true;
    // keyboard look (arrow keys)
    const lk = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    const lp = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
    if (lk || lp) lookDelta(lk * 10, lp * 8);
    mx += touch.mx;
    mz += touch.mz;
    if (touch.up) lift += 1;
    if (touch.dn) lift -= 1;
    if (touch.hack) hack = true;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      mx += dz(pad.axes[0] ?? 0);
      mz += dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0);
      const ry = dz(pad.axes[3] ?? 0);
      if (rx || ry) lookDelta(rx * 14, ry * 11);
      lift += (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      if (pad.buttons[0]?.pressed) hack = true;
      const ex = !!pad.buttons[1]?.pressed;
      const vw = !!pad.buttons[3]?.pressed;
      const st = !!pad.buttons[9]?.pressed;
      if (ex && !padPrev.exit) input.exitPressed = true;
      if (vw && !padPrev.view) toggleView();
      if (st && !padPrev.start) (stage === "play" ? pause : stage === "paused" ? resume : () => {})();
      padPrev = { exit: ex, view: vw, start: st };
    }
    const l = Math.hypot(mx, mz);
    if (l > 1) {
      mx /= l;
      mz /= l;
    }
    input.mx = mx;
    input.mz = mz;
    input.lift = clamp(lift, -1, 1);
    input.hack = hack;
    if (bot.on) {
      input.hack = bot.hack;
      input.exitPressed = input.exitPressed || bot.exit;
      bot.exit = false;
    }
  }

  // =================================================================== PLAYER UPDATE
  function collideDrone(prevY: number) {
    const r = 0.23;
    const cx0 = Math.floor(dp.x / CELL);
    const cz0 = Math.floor(dp.z / CELL);
    for (let iter = 0; iter < 2; iter++) {
      for (let cz = cz0 - 1; cz <= cz0 + 1; cz++)
        for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
          let solid = false;
          if (nav.solidCell(cx, cz)) solid = true;
          else if (dp.y + r > nav.ceilAtCell(cx, cz) - 0.01) solid = true;
          if (!solid) continue;
          pushOut(cx * CELL, cx * CELL + CELL, cz * CELL, cz * CELL + CELL, r);
        }
      for (const b of nav.boxes) {
        if (prevY - r >= b.h - 0.02) continue;
        pushOut(b.x0, b.x1, b.z0, b.z1, r);
      }
    }
    // vertical: floor / prop tops / ceiling
    const cx = Math.floor(dp.x / CELL);
    const cz = Math.floor(dp.z / CELL);
    const ground = nav.groundAt(dp.x, dp.z, prevY - r, r * 0.6);
    const minY = ground + 0.2;
    const maxY = (nav.open(cx, cz) ? nav.ceilAtCell(cx, cz) : 3) - 0.24;
    if (dp.y < minY) {
      dp.y = minY;
      if (dv.y < 0) dv.y = 0;
    }
    if (dp.y > maxY) {
      dp.y = maxY;
      if (dv.y > 0) dv.y = 0;
    }
  }
  function pushOut(minX: number, maxX: number, minZ: number, maxZ: number, r: number) {
    const nx = clamp(dp.x, minX, maxX);
    const nz = clamp(dp.z, minZ, maxZ);
    let dx = dp.x - nx;
    let dz = dp.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    if (d2 < 1e-8) {
      // centre inside the box: push out along the shortest axis
      const dl = dp.x - minX;
      const dr = maxX - dp.x;
      const dt2 = dp.z - minZ;
      const db = maxZ - dp.z;
      const m = Math.min(dl, dr, dt2, db);
      if (m === dl) dp.x = minX - r;
      else if (m === dr) dp.x = maxX + r;
      else if (m === dt2) dp.z = minZ - r;
      else dp.z = maxZ + r;
      return;
    }
    const d = Math.sqrt(d2);
    dx /= d;
    dz /= d;
    dp.x = nx + dx * r;
    dp.z = nz + dz * r;
    const vn = dv.x * dx + dv.z * dz;
    if (vn < 0) {
      dv.x -= dx * vn;
      dv.z -= dz * vn;
    }
  }

  const botPos = new THREE.Vector3();
  function updateDrone(dt: number) {
    if (!drone) return;
    let mx = input.mx;
    let mz = input.mz;
    let lift = input.lift;
    if (bot.on) {
      // bot gives world-space direction
      mx = 0;
      mz = 0;
      lift = bot.lift;
    }
    const fx = Math.cos(lookYaw);
    const fz = Math.sin(lookYaw);
    let wx = fx * -mz + -fz * mx;
    let wz = fz * -mz + fx * mx;
    if (bot.on) {
      wx = bot.mx;
      wz = bot.mz;
    }
    const maxH = 6.2;
    const acc = 26;
    const tx = wx * maxH;
    const tz = wz * maxH;
    const k = 1 - Math.exp(-acc * dt * 0.28);
    dv.x += (tx - dv.x) * k;
    dv.z += (tz - dv.z) * k;
    dv.y += (lift * 3.4 - dv.y) * (1 - Math.exp(-10 * dt));
    const prevY = dp.y;
    botPos.copy(dp);
    // sub-step
    const steps = 2;
    for (let i = 0; i < steps; i++) {
      dp.x += (dv.x * dt) / steps;
      dp.y += (dv.y * dt) / steps;
      dp.z += (dv.z * dt) / steps;
      collideDrone(prevY);
    }
    // face where the camera looks (smoothly)
    dYaw += clamp(angDiff(dYaw, lookYaw), -9 * dt, 9 * dt);
    const hs = Math.hypot(dv.x, dv.z);
    const sp01 = clamp(hs / maxH, 0, 1);
    // tilt
    const bx = dv.x * Math.cos(dYaw) + dv.z * Math.sin(dYaw); // forward component
    const bz = -dv.x * Math.sin(dYaw) + dv.z * Math.cos(dYaw);
    void bz;
    const tiltF = clamp(bx / 18, -0.3, 0.3);
    const side = dv.x * -Math.sin(dYaw) + dv.z * Math.cos(dYaw);
    const tiltS = clamp(side / 16, -0.3, 0.3);
    drone.root.position.set(dp.x, dp.y + Math.sin(menuT * 3.1) * 0.012, dp.z);
    drone.root.rotation.set(0, Math.atan2(Math.cos(dYaw), Math.sin(dYaw)), 0);
    drone.body.rotation.x = lerp(drone.body.rotation.x, tiltF, 1 - Math.exp(-8 * dt));
    drone.body.rotation.z = lerp(drone.body.rotation.z, -tiltS, 1 - Math.exp(-8 * dt));
    for (let i = 0; i < drone.rotors.length; i++) drone.rotors[i].rotation.z += (i % 2 ? 1 : -1) * dt * 60;
    // shadow
    const cx = Math.floor(dp.x / CELL);
    const cz = Math.floor(dp.z / CELL);
    const gy = nav.groundAt(dp.x, dp.z, dp.y) + 0.03;
    void cx;
    void cz;
    drone.shadow.position.set(dp.x, gy, dp.z);
    const hh = Math.max(0.1, dp.y - gy);
    const ss = 0.5 + hh * 0.18;
    drone.shadow.scale.set(ss, ss, 1);
    drone.shadowMat.opacity = clamp(0.62 - hh * 0.1, 0.12, 0.62);
    drone.eye.color.set(0x35f0ff).multiplyScalar(2.4 + Math.sin(menuT * 6) * 0.4);
    // ring colour reflects visibility
    drone.ring.color.set(maxMeter > 0.5 ? 0xffb547 : 0xfb7185).multiplyScalar(2.6);
    // trail
    const tr = drone.trail;
    if (hs > 1.2 || Math.abs(dv.y) > 1) {
      const i = tr.head++ % (tr.pos.length / 3);
      tr.pos[i * 3] = dp.x + (Math.random() - 0.5) * 0.12;
      tr.pos[i * 3 + 1] = dp.y - 0.02 + (Math.random() - 0.5) * 0.08;
      tr.pos[i * 3 + 2] = dp.z + (Math.random() - 0.5) * 0.12;
      tr.col[i * 3] = 2.2;
      tr.col[i * 3 + 1] = 0.7;
      tr.col[i * 3 + 2] = 0.9;
    }
    for (let i = 0; i < tr.col.length; i += 3) {
      tr.col[i] *= 1 - dt * 2.2;
      tr.col[i + 1] *= 1 - dt * 2.2;
      tr.col[i + 2] *= 1 - dt * 2.2;
    }
    (tr.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (tr.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    drone.root.visible = !(firstPerson && mode === "drone") && mode !== "ride";
    drone.light.intensity = 0.9;
    drone.light.color.set(maxMeter > 0.5 ? 0xffc080 : 0xffb0c0);
    sfx.update(dt, sp01, mode === "drone" ? "drone" : mode === "ride" ? "ride" : "cam", alarmT > 0, 0);
  }

  // =================================================================== HAZARDS
  function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
    const vx = bx - ax;
    const vz = bz - az;
    const l2 = vx * vx + vz * vz;
    const t = l2 > 0 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
    const qx = ax + vx * t;
    const qz = az + vz * t;
    return Math.hypot(px - qx, pz - qz);
  }
  function laserOn(l: (typeof lasers)[number]) {
    if (l.offT > 0) return false;
    const p = l.def.pulse;
    if (p) {
      const cyc = p[0] + p[1];
      const t = (runT + p[2]) % cyc;
      return t < p[0];
    }
    return true;
  }
  function updateHazards(dt: number) {
    for (const l of lasers) {
      if (l.offT > 0) l.offT = Math.max(0, l.offT - dt);
      const on = laserOn(l);
      const target = on ? 1 : 0;
      l.k = lerp(l.k, target, 1 - Math.exp(-12 * dt));
      l.mat.uniforms.uOn.value = l.k;
      l.mat.uniforms.uTime.value = runT;
      l.mesh.visible = l.k > 0.02;
      if (on && mode === "drone" && !godMode && runT - lastLaserHit > 1.5) {
        const ax = l.def.a[0] * CELL;
        const az = l.def.a[1] * CELL;
        const bx = l.def.b[0] * CELL;
        const bz = l.def.b[1] * CELL;
        if (dp.y > l.def.y0 - 0.1 && dp.y < l.def.y1 + 0.1 && segDist(dp.x, dp.z, ax, az, bx, bz) < 0.3) {
          lastLaserHit = runT;
          sfx.zap();
          shake = 0.8;
          glitch = 0.8;
          battery = Math.max(0, battery - 10);
          // knock back
          const mxp = (ax + bx) / 2;
          const mzp = (az + bz) / 2;
          void mxp;
          void mzp;
          dv.multiplyScalar(-0.6);
          if (alarmT > 0) caught("LASER CONTACT");
          else triggerAlarm("LASER GRID TRIPPED");
        }
      }
    }
    for (const j of juncs) {
      if (j.used > 0) j.used = Math.max(0, j.used - dt);
      j.led.color.set(j.used > 0 ? 0x4dffa0 : 0xff3b4a).multiplyScalar(2.2 + (j.used > 0 ? 0 : Math.sin(runT * 5) * 0.5));
    }
    doors.forEach((d, i) => {
      if (d.holdT > 0) {
        d.holdT -= dt;
        if (d.holdT <= 0) {
          // close only when nothing blocks it
          const blocked = Math.hypot(dp.x - d.center.x, dp.z - d.center.z) < 2.4 || robs.some((r) => Math.hypot(r.x - d.center.x, r.z - d.center.z) < 2.4);
          if (blocked) d.holdT = 1;
          else nav.doorOpen[i] = false;
        }
      }
      const target = nav.doorOpen[i] ? 1 : 0;
      const o = lerp(d.open, target, 1 - Math.exp(-5 * dt));
      E.setDoor(d, Math.abs(o - target) < 0.01 ? target : o);
    });
    for (const s of scans) {
      s.mat.uniforms.uTime.value = runT;
      if (mode === "drone" && !godMode && runT - lastScanHit > 2) {
        const ax = s.def.a[0] * CELL;
        const az = s.def.a[1] * CELL;
        const bx = s.def.b[0] * CELL;
        const bz = s.def.b[1] * CELL;
        if (dp.y < 3.4 && segDist(dp.x, dp.z, ax, az, bx, bz) < 0.32) {
          lastScanHit = runT;
          sfx.zap();
          if (alarmT > 0) caught("SCANNER");
          else triggerAlarm("SCANNER TRIPPED — DRONE SIGNATURE");
        }
      }
    }
    // chargers
    chargeNow = false;
    if (mode === "drone") {
      for (const c of chargers) {
        const d = Math.hypot(dp.x - c.tw.x, dp.z - c.tw.z);
        if (d < 1.5 && dp.y < 2.2) {
          chargeNow = true;
          battery = Math.min(100, battery + 24 * dt);
        }
      }
    }
    for (const c of chargers) {
      const d = Math.hypot(dp.x - c.tw.x, dp.z - c.tw.z);
      c.ringMat.opacity = 0.55 + 0.3 * Math.sin(runT * 3 + c.tw.x) + (d < 1.5 ? 0.3 : 0);
      c.ring.scale.setScalar(1 + (d < 1.5 ? Math.sin(runT * 10) * 0.05 : 0));
    }
    // checkpoints
    for (const cp of def.checkpoints) {
      if (Math.hypot(dp.x - cp[0] * CELL, dp.z - cp[1] * CELL) < 3) {
        if (!ckpt || Math.hypot(ckpt.x - cp[0] * CELL, ckpt.z - cp[1] * CELL) > 0.5) {
          ckpt = { x: cp[0] * CELL, z: cp[1] * CELL, y: Math.max(1, dp.y), doors: nav.doorOpen.slice(), coreDone };
          if (runT > 3) toast("CHECKPOINT", "good");
        }
      }
    }
  }

  // =================================================================== CAMERAS (security)
  function updateCams(dt: number) {
    for (const c of camsR) {
      if (c.blind > 0) c.blind = Math.max(0, c.blind - dt);
      const d = c.def;
      let yaw = d.yaw + Math.sin((runT / d.period + (d.phase ?? 0)) * Math.PI * 2) * d.sweep;
      if (c.jacked) yaw = d.yaw + camYawOff / deg;
      else if (alarmT > 0 && c.blind <= 0) {
        // lock onto the drone during lockdown
        const want = Math.atan2(dp.z - c.vis.tw.z, dp.x - c.vis.tw.x) / deg;
        yaw = c.yaw + clamp(angDiff(c.yaw * deg, want * deg) / deg, -60 * dt, 60 * dt);
      }
      c.yaw = yaw;
      E.updateCamVis(c.vis, yaw);
      const blind = c.blind > 0;
      c.state = blind ? "blind" : c.meter >= 0.55 ? "alert" : c.meter > 0.12 ? "sus" : "idle";
      const col = blind ? 0x57ff9a : c.state === "alert" || alarmT > 0 ? 0xff3b4a : c.state === "sus" ? 0xffb547 : 0x9fe8ff;
      const cm = c.vis.coneMat.uniforms.uColor.value as THREE.Color;
      const fm = c.vis.footMat.uniforms.uColor.value as THREE.Color;
      cm.set(col);
      fm.set(col);
      c.vis.coneMat.uniforms.uAlpha.value = blind ? 0.03 : 0.08 + c.meter * 0.16;
      c.vis.footMat.uniforms.uAlpha.value = blind ? 0.04 : 0.13 + c.meter * 0.22;
      c.vis.led.color.set(blind ? 0x57ff9a : col).multiplyScalar(2.6);
      const showIcon = !c.jacked && (c.meter > 0.12 || blind);
      c.vis.icon.visible = showIcon;
      if (showIcon && icons) {
        const mat = c.vis.icon.material as THREE.SpriteMaterial;
        mat.map = blind ? icons.off : c.meter >= 0.55 ? icons.bang : icons.q;
        const s = 0.4 + c.meter * 0.5;
        c.vis.icon.scale.set(s, s, 1);
        c.vis.icon.position.y = 0.65;
      }
    }
  }
  function updateRobotVisuals(dt: number) {
    for (const r of robs) {
      const v = r.vis;
      v.root.position.set(r.x, 0, r.z);
      v.root.rotation.y = Math.atan2(Math.cos(r.yaw), Math.sin(r.yaw));
      const moving = r.speedNow > 0.2;
      E.playRobot(v, moving ? (r.state === "hunt" || r.speedNow > 2.6 ? "Running" : "Walking") : "Idle", r.state === "hunt" ? 1.0 : 0.85);
      v.mixer?.update(dt);
      const ridden = r.state === "ridden";
      const rebooting = r.state === "reboot";
      v.fan.visible = !ridden && !rebooting;
      v.ring.visible = ridden;
      (v.ring.material as THREE.MeshBasicMaterial).opacity = ridden ? 0.7 + Math.sin(runT * 6) * 0.2 : 0;
      if (rebooting) {
        v.visor.color.set(0x35f0ff).multiplyScalar(Math.sin(runT * 14) > 0.6 ? 1.2 : 0.05);
        v.icon.visible = false;
      } else if (!ridden) {
        const alert = r.state === "hunt" || r.state === "search";
        const col = alert ? 0xff3b4a : r.meter > 0.12 || r.state === "sus" ? 0xffb547 : 0x9fe8ff;
        (v.fanMat.uniforms.uColor.value as THREE.Color).set(col);
        v.fanMat.uniforms.uAlpha.value = 0.16 + r.meter * 0.25;
        v.visor.color.set(alert ? 0xff3b4a : r.state === "sus" ? 0xffb547 : 0x35f0ff).multiplyScalar(3);
        E.updateFan(v, nav, r.x, r.z, r.yaw, 40 * deg, 11, 1.55);
        const showIcon = r.meter > 0.12 || alert;
        v.icon.visible = showIcon;
        if (showIcon && icons) {
          const mat = v.icon.material as THREE.SpriteMaterial;
          mat.map = alert || r.meter >= 0.55 ? icons.bang : icons.q;
          const s = 0.4 + r.meter * 0.5;
          v.icon.scale.set(s, s, 1);
        }
      } else v.icon.visible = false;
    }
  }

  // =================================================================== LIGHT POOL
  let poolT = 0;
  function updateLights(dt: number, focus: THREE.Vector3) {
    if (!world) return;
    poolT -= dt;
    if (poolT <= 0) {
      poolT = 0.2;
      const cand: Array<{ i: number; d: number }> = [];
      world.fixtures.forEach((f, i) => {
        if (!f.on) return;
        const d = Math.hypot(f.x - focus.x, f.z - focus.z);
        if (d < 30) cand.push({ i, d });
      });
      cand.sort((a, b) => a.d - b.d);
      const want = cand.slice(0, slots.length).map((c) => c.i);
      // keep slots whose fixture is still wanted
      const used = new Set<number>();
      for (const s of slots) if (want.includes(s.fix)) used.add(s.fix);
      for (const s of slots) {
        if (want.includes(s.fix)) continue;
        const nf = want.find((w) => !used.has(w));
        if (nf !== undefined) {
          s.fix = nf;
          s.k = 0;
          used.add(nf);
        } else s.fix = -1;
      }
    }
    for (const s of slots) {
      const f = s.fix >= 0 ? world.fixtures[s.fix] : null;
      if (f) {
        s.light.position.set(f.x, Math.min(f.y, 5) - 0.3, f.z);
        s.light.color.copy(f.color);
        s.k = Math.min(1, s.k + dt * 2.5);
        s.light.intensity = f.i * 7 * s.k;
        s.light.distance = f.r;
      } else {
        s.k = Math.max(0, s.k - dt * 3);
        s.light.intensity = 0;
      }
    }
  }

  // =================================================================== CAMERA RIG
  const camPos = new THREE.Vector3();
  const lastPos = new THREE.Vector3();
  function updateCameraRig(dt: number) {
    const fov0 = camera.fov;
    let fov = 72;
    if (stage === "menu") {
      const a = menuT * 0.12;
      const r = 3.6;
      const sx = def.start[0] * CELL;
      const sz = def.start[1] * CELL;
      const base = def.startYaw * deg;
      camPos.set(sx + Math.cos(base + Math.PI - 0.5 + Math.sin(a) * 0.55) * r, 1.9 + Math.sin(menuT * 0.3) * 0.15, sz + Math.sin(base + Math.PI - 0.5 + Math.sin(a) * 0.55) * r);
      camera.position.copy(camPos);
      camera.lookAt(sx + Math.cos(base) * 4, 1.3, sz + Math.sin(base) * 4);
      fov = 66;
    } else if (topdown) {
      const cxw = (def.W * CELL) / 2;
      const czw = (def.H * CELL) / 2;
      camera.position.set(cxw, Math.max(def.W, def.H) * CELL * 0.95, czw + 0.01);
      camera.lookAt(cxw, 0, czw);
      fov = 55;
    } else if (mode === "cam" && jackCam) {
      camera.position.copy(jackCam.vis.tw);
      const a = jackCam.yaw * deg;
      const cp = camPitch;
      camLook.set(Math.cos(a) * Math.cos(cp), -Math.sin(cp), Math.sin(a) * Math.cos(cp));
      camera.lookAt(camera.position.x + camLook.x, camera.position.y + camLook.y, camera.position.z + camLook.z);
      fov = 88;
    } else if (mode === "ride" && rideRob) {
      const cp = lookPitch;
      camLook.set(Math.cos(lookYaw) * Math.cos(cp), Math.sin(cp), Math.sin(lookYaw) * Math.cos(cp));
      const tx = rideRob.x;
      const tz = rideRob.z;
      let dist = 3.6;
      const ty = 2.3;
      // collision-aware pull-in
      for (let d = 0.4; d <= 3.6; d += 0.3) {
        const px = tx - camLook.x * d;
        const py = ty - camLook.y * d;
        const pz = tz - camLook.z * d;
        if (nav.solidAt(px, Math.max(0.2, py), pz)) {
          dist = Math.max(0.6, d - 0.4);
          break;
        }
      }
      camera.position.set(tx - camLook.x * dist, clamp(ty - camLook.y * dist, 0.3, nav.ceilAt(tx, tz) - 0.2), tz - camLook.z * dist);
      camera.lookAt(camera.position.x + camLook.x, camera.position.y + camLook.y, camera.position.z + camLook.z);
      fov = 74;
    } else {
      const cp = lookPitch;
      camLook.set(Math.cos(lookYaw) * Math.cos(cp), Math.sin(cp), Math.sin(lookYaw) * Math.cos(cp));
      if (firstPerson) {
        camera.position.set(dp.x, dp.y + 0.02, dp.z);
        fov = 80;
      } else {
        const want = 3.1;
        let dist = want;
        for (let d = 0.35; d <= want; d += 0.25) {
          const px = dp.x - camLook.x * d;
          const py = dp.y + 0.42 - camLook.y * d;
          const pz = dp.z - camLook.z * d;
          if (nav.solidAt(px, py, pz)) {
            dist = Math.max(0.45, d - 0.45);
            break;
          }
        }
        camera.position.set(dp.x - camLook.x * dist, dp.y + 0.42 - camLook.y * dist, dp.z - camLook.z * dist);
        // keep inside the room volume
        const cc = nav.ceilAt(camera.position.x, camera.position.z);
        if (cc > 0) camera.position.y = clamp(camera.position.y, 0.15, cc - 0.1);
      }
      camera.lookAt(camera.position.x + camLook.x, camera.position.y + camLook.y, camera.position.z + camLook.z);
    }
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.12;
      camera.position.y += (Math.random() - 0.5) * shake * 0.12;
      shake = Math.max(0, shake - dt * 2.4);
    }
    if (Math.abs(fov - fov0) > 0.05) {
      camera.fov = lerp(fov0, fov, 1 - Math.exp(-8 * dt));
      camera.updateProjectionMatrix();
    }
  }

  // =================================================================== HUD
  let lastHud = 0;
  function toast(msg: string, kind: "" | "good" | "bad" = "") {
    const d = document.createElement("div");
    d.textContent = msg;
    if (kind) d.className = kind;
    hud.feed.appendChild(d);
    while (hud.feed.children.length > 4) hud.feed.firstElementChild?.remove();
    window.setTimeout(() => (d.style.opacity = "0"), 3200);
    window.setTimeout(() => d.remove(), 3700);
  }
  function showBanner(t: string, s: string, color: number, k = "") {
    hud.banner.querySelector(".k")!.textContent = k;
    hud.banner.querySelector(".t")!.textContent = t;
    hud.banner.querySelector(".s")!.textContent = s;
    (hud.banner.querySelector(".t") as HTMLElement).style.color = `#${color.toString(16).padStart(6, "0")}`;
    hud.banner.classList.add("on");
    bannerT = 2.6;
  }
  function showHint(text: string) {
    hud.hint.textContent = text;
    hud.hint.classList.add("on");
    hintT = 5;
  }
  function objectiveText() {
    if (coreDone) return "EXFILTRATE · reach the glowing window marker";
    const dc = Math.hypot(dp.x - core!.tw.x, dp.z - core!.tw.z);
    if (dc < 12) return "DOWNLOAD THE CORE · hold E beside the pillar";
    return def.objectives[def.n === 2 ? 1 : 0] ?? "";
  }
  function updateHud(dt: number) {
    hud.tm.textContent = fmt(runT);
    hud.sn.textContent = String(detected);
    hud.hk.textContent = String(hacks);
    hud.md.textContent = mode === "cam" ? "CCTV JACK" : mode === "ride" ? "RIDING" : alarmT > 0 ? "LOCKDOWN" : "DRONE";
    hud.objT.textContent = objectiveText();
    // detection
    const m = maxMeter;
    hud.detBar.style.width = `${Math.round(m * 100)}%`;
    hud.det.classList.toggle("warn", m > 0.35 && m < 0.8 && alarmT <= 0);
    hud.det.classList.toggle("alert", alarmT > 0 || m >= 0.8);
    hud.detSt.textContent = mode === "ride" ? "DISGUISED" : alarmT > 0 ? "ALERT" : m > 0.8 ? "SPOTTED" : m > 0.12 ? "SUSPICIOUS" : "HIDDEN";
    hud.detLt.textContent = lightF > 1.05 ? "BRIGHT" : lightF > 0.6 ? "DIM" : "SHADOW";
    // battery
    const bp = Math.round(battery);
    hud.batP.textContent = `${bp}%`;
    hud.batBars.forEach((b, i) => b.classList.toggle("on", i < Math.ceil((battery / 100) * hud.batBars.length)));
    hud.bat.classList.toggle("low", battery < 22);
    hud.bat.classList.toggle("chg", chargeNow);
    // lockdown
    hud.lock.classList.toggle("on", alarmT > 0 || traceT > 0);
    if (alarmT > 0 || traceT > 0) {
      const a = hud.lock.querySelector(".a") as HTMLElement;
      const c = hud.lock.querySelector(".c") as HTMLElement;
      a.textContent = alarmT > 0 ? "LOCKDOWN" : "TRACE ACTIVE";
      c.textContent = alarmT > 0 ? "BREAK LINE OF SIGHT" : "SECURITY CONVERGING ON THE CORE";
      hud.lockB.textContent = (alarmT > 0 ? alarmT : traceT).toFixed(1);
    }
    hud.alarmV.classList.toggle("on", alarmT > 0);
    // prompts + target ring
    const t = curTgt;
    hud.ret.classList.toggle("tgt", !!t);
    if (t && mode !== "ride") {
      tmpV.copy(t.pos).project(camera);
      const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
      hud.tgt.classList.toggle("on", vis);
      if (vis) {
        hud.tgt.style.transform = `translate(${((tmpV.x + 1) / 2) * viewW}px, ${((1 - tmpV.y) / 2) * viewH}px)`;
        hud.tgtNm.textContent = t.name;
        const p = hackSt.tgt === t ? hackSt.p : 0;
        (hud.tgtRing as unknown as SVGElement).setAttribute("stroke-dasharray", `${(p * 100).toFixed(1)} 100`);
      }
    } else hud.tgt.classList.remove("on");
    let ptxt = "";
    let prog = -1;
    const key = mobile ? "HACK" : "E";
    if (mode === "ride") ptxt = `<kbd>${mobile ? "EXIT" : "Q"}</kbd>DISMOUNT · WASD DRIVE · GO NEAR A BADGE READER`;
    else if (mode === "cam") ptxt = `<kbd>${mobile ? "EXIT" : "Q"}</kbd>EXIT FEED${t ? ` · HOLD <kbd>${key}</kbd>HACK ${t.name}` : ""}`;
    else if (t) {
      ptxt = `HOLD <kbd>${key}</kbd>${t.kind === "cam" ? "JACK INTO" : t.kind === "robot" ? "TAKE CONTROL OF" : t.kind === "core" ? "DOWNLOAD" : "OVERRIDE"} ${t.name}`;
      if (hackSt.tgt === t && hackSt.p > 0.02) prog = hackSt.p;
    } else if (chargeNow) ptxt = "CHARGING…";
    hud.prompt.classList.toggle("on", !!ptxt);
    hud.prompt.classList.toggle("prog", prog >= 0);
    if (ptxt) hud.promptTx.innerHTML = ptxt;
    if (prog >= 0) hud.promptBar.style.width = `${prog * 100}%`;
    if (mode === "ride" && rideRob) {
      hud.rideT.textContent = `${Math.max(0, rideRob.rideT).toFixed(1)}s`;
      hud.rideBar.style.width = `${clamp(rideRob.rideT / 15, 0, 1) * 100}%`;
    }
    if (mode === "cam" && jackCam) {
      hud.camJt.textContent = `${Math.max(0, jackT).toFixed(1)}s`;
      hud.camBar.style.width = `${clamp(jackT / 10, 0, 1) * 100}%`;
      hud.camBt.textContent = `BLIND ${jackCam.blind.toFixed(0)}s`;
      const d = new Date(2087, 10, 3, 2, 14, 0, 0);
      d.setSeconds(d.getSeconds() + Math.floor(runT));
      hud.camTs.textContent = d.toTimeString().slice(0, 8);
    }
    bannerT -= dt;
    if (bannerT <= 0) hud.banner.classList.remove("on");
    hintT -= dt;
    if (hintT <= 0) hud.hint.classList.remove("on");
    // area hints
    for (const h of def.hints) {
      if (shownHints.has(h.once) || hintSeen[h.once] === 1) continue;
      if (Math.hypot(dp.x - h.at[0] * CELL, dp.z - h.at[1] * CELL) < h.r * CELL * (h.r > 50 ? 1 : 1)) {
        shownHints.add(h.once);
        hintSeen[h.once] = 1;
        save(HINT_KEY, hintSeen);
        showHint(h.text);
        break;
      }
    }
    // post
    if (grade) {
      grade.uniforms.uTime.value = menuT;
      grade.uniforms.uDamage.value = alarmT > 0 ? 0.35 + Math.sin(menuT * 8) * 0.12 : Math.max(0, shake * 0.4);
      grade.uniforms.uLowHp.value = battery < 15 ? 0.6 : 0;
    }
    if (cctv) {
      cctv.uniforms.uAmt.value = mode === "cam" ? 1 : 0;
      cctv.uniforms.uTime.value = menuT;
      cctv.uniforms.uGlitch.value = glitch;
    }
    void dt;
  }
  let mapT = 0;
  const mctx = hud.map.getContext("2d")!;
  function drawMap() {
    const cw = hud.map.width;
    const ch = hud.map.height;
    mctx.clearRect(0, 0, cw, ch);
    const s = Math.min((cw - 8) / def.W, (ch - 8) / def.H);
    const ox = (cw - def.W * s) / 2;
    const oz = (ch - def.H * s) / 2;
    const X = (wx: number) => ox + (wx / CELL) * s;
    const Z = (wz: number) => oz + (wz / CELL) * s;
    for (let z = 0; z < def.H; z++)
      for (let x = 0; x < def.W; x++) {
        const c = def.grid[z][x];
        if (c === "." || c === "~" || c === "a") {
          mctx.fillStyle = c === "~" ? "rgba(255,181,71,.35)" : c === "a" ? "rgba(120,100,200,.16)" : "rgba(210,215,240,.2)";
          mctx.fillRect(ox + x * s, oz + z * s, s + 0.4, s + 0.4);
          if (nav.hb(x, z) > 0.01 && nav.hb(x, z) < 50) {
            mctx.fillStyle = "rgba(0,0,0,.4)";
            mctx.fillRect(ox + x * s, oz + z * s, s, s);
          }
        }
      }
    doors.forEach((d, i) => {
      mctx.fillStyle = nav.doorOpen[i] ? "#4dffa0" : "#ff3b4a";
      for (const [cx, cz] of d.def.cells) mctx.fillRect(ox + cx * s, oz + cz * s, s, s);
    });
    for (const l of lasers) {
      mctx.strokeStyle = laserOn(l) ? "#ff3b4a" : "rgba(255,59,74,.25)";
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.moveTo(X(l.def.a[0] * CELL), Z(l.def.a[1] * CELL));
      mctx.lineTo(X(l.def.b[0] * CELL), Z(l.def.b[1] * CELL));
      mctx.stroke();
    }
    for (const c of chargers) {
      mctx.fillStyle = "#7dffb0";
      mctx.fillRect(X(c.tw.x) - 2, Z(c.tw.z) - 2, 4, 4);
    }
    // core + extraction
    if (!coreDone) {
      mctx.fillStyle = `#${def.theme.accent.toString(16).padStart(6, "0")}`;
      mctx.beginPath();
      mctx.arc(X(def.core[0] * CELL), Z(def.core[1] * CELL), 5, 0, 7);
      mctx.fill();
    } else {
      mctx.strokeStyle = "#35f0ff";
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.arc(X(def.extract[0] * CELL), Z(def.extract[1] * CELL), 6 + Math.sin(menuT * 6) * 1.5, 0, 7);
      mctx.stroke();
    }
    // cams
    for (const c of camsR) {
      const x = X(c.vis.tw.x);
      const z = Z(c.vis.tw.z);
      const col = c.blind > 0 ? "87,255,154" : c.meter > 0.5 ? "255,59,74" : "159,232,255";
      const a = c.yaw * deg;
      const rg = Math.min(c.vis.effRange, 12) / CELL * s;
      mctx.fillStyle = `rgba(${col},.22)`;
      mctx.beginPath();
      mctx.moveTo(x, z);
      mctx.arc(x, z, rg, a - c.def.fov * deg, a + c.def.fov * deg);
      mctx.closePath();
      mctx.fill();
      mctx.fillStyle = `rgb(${col})`;
      mctx.fillRect(x - 2, z - 2, 4, 4);
    }
    for (const r of robs) {
      const x = X(r.x);
      const z = Z(r.z);
      const alert = r.state === "hunt" || r.state === "search";
      const col = r.state === "ridden" ? "53,240,255" : alert ? "255,59,74" : r.meter > 0.2 ? "255,181,71" : "159,232,255";
      if (r.state !== "ridden") {
        mctx.fillStyle = `rgba(${col},.2)`;
        mctx.beginPath();
        mctx.moveTo(x, z);
        mctx.arc(x, z, (9 / CELL) * s, r.yaw - 40 * deg, r.yaw + 40 * deg);
        mctx.closePath();
        mctx.fill();
      }
      mctx.fillStyle = `rgb(${col})`;
      mctx.beginPath();
      mctx.arc(x, z, 3.2, 0, 7);
      mctx.fill();
    }
    // drone
    const px = X(dp.x);
    const pz = Z(dp.z);
    mctx.save();
    mctx.translate(px, pz);
    mctx.rotate(lookYaw);
    mctx.fillStyle = "#fb7185";
    mctx.beginPath();
    mctx.moveTo(6, 0);
    mctx.lineTo(-4, 4);
    mctx.lineTo(-2, 0);
    mctx.lineTo(-4, -4);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
  }

  function showObjectives(on: boolean) {
    if (stage !== "play") return;
    if (!on) {
      if (hud.scr.dataset.kind === "obj") hideScr();
      return;
    }
    const cur = coreDone ? 3 : Math.hypot(dp.x - core!.tw.x, dp.z - core!.tw.z) < 12 ? 2 : 0;
    hud.scr.dataset.kind = "obj";
    hud.scr.className = "ov-scr on dim";
    hud.scr.style.pointerEvents = "none";
    hud.scr.innerHTML = `<div class="ov-center"><div class="ov-eye">FLOOR ${def.code} · ${def.name}</div><div class="ov-h2">OBJECTIVES</div>
      <div class="ov-obj-list">${def.objectives.map((o, i) => `<div class="${i < cur ? "done" : i === cur ? "cur" : ""}">${o}</div>`).join("")}</div></div>`;
  }

  // =================================================================== BOT
  function exposed(px: number, py: number, pz: number) {
    for (const c of camsR) if (camSees(c, px, py, pz) >= 0) return true;
    for (const r of robs) if (r.state !== "ridden" && robSees(r, px, py, pz) >= 0) return true;
    return false;
  }
  function updateBot(dt: number) {
    if (!bot.on || stage !== "play") return;
    bot.mx = bot.mz = bot.lift = 0;
    bot.hack = false;
    bot.want = "";
    if (bot.wait > 0) {
      bot.wait -= dt;
      return;
    }
    const st = bot.steps[bot.i];
    if (!st) {
      if (!bot.done) {
        bot.done = true;
        bot.log.push("script finished");
      }
      return;
    }
    const posX = mode === "ride" && rideRob ? rideRob.x : dp.x;
    const posZ = mode === "ride" && rideRob ? rideRob.z : dp.z;
    if ("go" in st) {
      const tx = st.go[0] * CELL;
      const tz = st.go[1] * CELL;
      const ty = st.go[2] ?? dp.y;
      const dx = tx - posX;
      const dz = tz - posZ;
      const d = Math.hypot(dx, dz);
      const dy = ty - dp.y;
      if (d < 0.35 && (Math.abs(dy) < 0.35 || mode === "ride")) {
        bot.i++;
        bot.stuck = 0;
        bot.probeD = 1e9;
        bot.log.push(`wp ${bot.i} @${runT.toFixed(1)}`);
        return;
      }
      let sx = d > 0.01 ? dx / d : 0;
      let sz = d > 0.01 ? dz / d : 0;
      sx *= Math.min(1, d / 1.0);
      sz *= Math.min(1, d / 1.0);
      // stop-and-go: do not step into a cone we are currently outside of
      if (mode === "drone" && !st.fast && !godMode) {
        const la = Math.min(d, 2.4);
        const lx = dp.x + (dx / Math.max(d, 1e-3)) * la;
        const lz = dp.z + (dz / Math.max(d, 1e-3)) * la;
        if (!exposed(dp.x, dp.y, dp.z) && exposed(lx, Math.max(dp.y, ty), lz)) {
          sx = 0;
          sz = 0;
        }
      }
      if (mode === "ride") {
        // robot drive: express in camera space
        const fx = Math.cos(lookYaw);
        const fz = Math.sin(lookYaw);
        // camera-space inputs so that updateRiddenRobot reproduces world direction (sx,sz)
        const fwd = sx * fx + sz * fz;
        const rgt = sx * -fz + sz * fx;
        input.mx = rgt;
        input.mz = -fwd;
        lookYaw += clamp(angDiff(lookYaw, Math.atan2(dz, dx)), -3 * dt, 3 * dt);
      } else {
        bot.mx = sx;
        bot.mz = sz;
        bot.lift = clamp(dy * 2, -1, 1);
        // unstick: no progress toward the waypoint while trying to move -> climb over the obstacle
        if (sx !== 0 || sz !== 0) {
          bot.probeT += dt;
          if (bot.probeT > 0.5) {
            bot.stuck = d > bot.probeD - 0.12 ? bot.stuck + 1 : 0;
            bot.probeT = 0;
            bot.probeD = d;
          }
        } else bot.probeT = 0;
        if (bot.stuck >= 2) bot.lift = dp.y > nav.ceilAt(dp.x, dp.z) - 0.5 ? -1 : 1;
        lookYaw += clamp(angDiff(lookYaw, Math.atan2(sz || 1e-6, sx || 1e-6)), -6 * dt, 6 * dt);
        lookPitch = lerp(lookPitch, -0.1, 0.05);
      }
    } else if ("wait" in st) {
      bot.wait = st.wait;
      bot.i++;
    } else if ("hack" in st) {
      const id = st.hack;
      const all = buildTargets();
      const t = all.find((x) => x.id === id);
      const origin = mode === "cam" && jackCam ? jackCam.vis.tw : dp;
      if (!t) {
        bot.log.push(`hack ${id}: target gone`);
        bot.i++;
        return;
      }
      // aim at it
      const dx = t.pos.x - origin.x;
      const dz = t.pos.z - origin.z;
      const dy = t.pos.y - origin.y;
      const want = Math.atan2(dz, dx);
      if (mode === "cam") {
        camYawOff = clamp(camYawOff + clamp(angDiff(jackCam!.yaw * deg, want), -3 * dt, 3 * dt), -1.15, 1.15);
        const wantP = Math.atan2(-dy, Math.hypot(dx, dz));
        camPitch = clamp(camPitch + clamp(wantP - camPitch, -2 * dt, 2 * dt), -0.2, 1.1);
      }
      else {
        lookYaw += clamp(angDiff(lookYaw, want), -8 * dt, 8 * dt);
        lookPitch = lerp(lookPitch, clamp(Math.atan2(dy, Math.hypot(dx, dz)) - 0.0, -1, 1) * 0.9 + 0.12, 0.2);
      }
      bot.hack = true;
      bot.want = id;
      if (Math.hypot(dx, dz) > 8.2 && mode === "drone") bot.log.push(`hack ${id}: too far ${Math.hypot(dx, dz).toFixed(1)}`);
      if (hacks > (bot as unknown as { h0?: number }).h0! || !all.some((x) => x.id === id && x.kind === t.kind)) {
        // handled by completion check below
      }
      (bot as unknown as { hackId?: string }).hackId = id;
      bot.wait = 0;
      // completion: target no longer in list, or mode changed for cam/robot
      if (t.kind === "cam" && jackCam && jackCam.def.id === id) bot.i++;
      else if (t.kind === "robot" && rideRob && rideRob.def.id === id) bot.i++;
    } else if ("near" in st) {
      const [id, x, z, r] = st.near;
      const rb = robs.find((q) => q.def.id === id);
      if (!rb || Math.hypot(rb.x / CELL - x, rb.z / CELL - z) < r) bot.i++;
    } else if ("clear" in st) {
      const [x, z, y] = st.clear;
      if (!exposed(x * CELL, y, z * CELL)) bot.i++;
    } else if ("ride" in st) {
      bot.i++;
    } else if ("exit" in st) {
      bot.exit = true;
      bot.i++;
    } else if ("jackTo" in st) {
      bot.i++;
    } else if ("until" in st) {
      const u = st.until;
      if (u === "core") {
        if (coreDone) bot.i++;
        else {
          const dx = core!.tw.x - dp.x;
          const dz = core!.tw.z - dp.z;
          lookYaw += clamp(angDiff(lookYaw, Math.atan2(dz, dx)), -8 * dt, 8 * dt);
          lookPitch = lerp(lookPitch, -0.05, 0.1);
          bot.hack = true;
          bot.want = "core";
        }
      } else if (u === "done") {
        if (stage !== "play") bot.i++;
      } else if (u === "alarm-clear") {
        if (alarmT <= 0) bot.i++;
      }
    }
  }
  // fix: bot hack with jacked robot ride gets a "hack" detection that used (bot as any).h0 — keep simple
  void (0 as unknown);

  // =================================================================== FLOW
  function setStage(s: Stage) {
    stage = s;
    hud.root.dataset.mode = s === "menu" ? "menu" : s === "results" ? "results" : mode === "cam" ? "cam" : mode === "ride" ? "ride" : "play";
  }
  function hideScr() {
    hud.scr.className = "ov-scr";
    hud.scr.innerHTML = "";
    hud.scr.dataset.kind = "";
    hud.scr.style.pointerEvents = "";
  }
  function floorCards() {
    return ALL.map((f) => {
      const b = progress.best[String(f.n)];
      const lock = !unlocked(f.n);
      return `<button type="button" class="ov-fl${selFloor === f.n ? " on" : ""}${lock ? " lock" : ""}" data-floor="${f.n}">
        <span class="n">${f.code}</span>
        <span><span class="t">${f.name}</span><span class="s" style="display:block">${lock ? "Complete the previous floor to unlock" : f.tagline}</span></span>
        <span class="g">${b ? `<b class="${b.grade}">${b.grade}</b>${b.score.toLocaleString()}` : lock ? "LOCKED" : "NEW"}</span></button>`;
    }).join("");
  }
  function showMenu() {
    setStage("menu");
    hud.scr.dataset.kind = "menu";
    hud.scr.className = "ov-scr on menu";
    hud.scr.style.pointerEvents = "";
    const total = totalScore();
    hud.scr.innerHTML = `<div class="ov-col">
      <div class="ov-eye">HALDEN TOWER · DISTRICT 07</div>
      <div class="ov-h1">OVER<span>RIDE</span></div>
      <div class="ov-sub">Slip a micro-drone into the Halden Tower. Jack the cameras, ride the security robots, loop the lasers and reach the core — without ever being seen.</div>
      <div class="ov-floors">${floorCards()}</div>
      <div class="ov-act"><button type="button" class="ov-btn" data-go="go">▶ INFILTRATE</button>${total ? `<span style="color:var(--d);font-size:10px;letter-spacing:.24em">TOTAL ${total.toLocaleString()}</span>` : ""}</div>
      <div class="ov-ctrl"><div><span>MOVE</span><b>WASD</b></div><div><span>UP / DOWN</span><b>SPACE / CTRL</b></div><div><span>HACK (HOLD)</span><b>E</b></div><div><span>EXIT FEED / RIDE</span><b>Q</b></div><div><span>VIEW</span><b>V</b></div><div><span>OBJECTIVES</span><b>TAB</b></div></div>
    </div>`;
    wireScr();
    if (disposed) return;
  }
  function wireScr() {
    hud.scr.querySelectorAll<HTMLElement>("[data-floor]").forEach((el) =>
      el.addEventListener("click", () => {
        const n = Number(el.dataset.floor);
        if (!unlocked(n)) return;
        sfx.click();
        selectFloor(n);
      }),
    );
    hud.scr.querySelector<HTMLElement>("[data-go]")?.addEventListener("click", () => {
      sfx.ensure();
      startFloor(selFloor);
    });
    hud.scr.querySelectorAll<HTMLElement>("[data-act]").forEach((el) =>
      el.addEventListener("click", () => {
        const a = el.dataset.act;
        sfx.click();
        if (a === "resume") resume();
        else if (a === "restart") startFloor(def.n);
        else if (a === "menu") toMenu();
        else if (a === "next") startFloor(def.n + 1);
      }),
    );
  }
  function selectFloor(n: number) {
    selFloor = n;
    if (def.n !== n) loadFloor(n);
    showMenu();
  }
  function toMenu() {
    if (document.pointerLockElement) document.exitPointerLock?.();
    lockWanted = false;
    sfx.stop();
    mode = "drone";
    jackCam = null;
    rideRob = null;
    if (!unlocked(selFloor)) selFloor = 1;
    if (def.n !== selFloor) loadFloor(selFloor);
    resetRunState();
    hud.fade.classList.remove("on");
    showMenu();
  }
  function startFloor(n: number) {
    if (!unlocked(n)) return;
    selFloor = n;
    hideScr();
    if (def.n !== n) loadFloor(n);
    else resetRunState();
    firstPerson = false;
    sfx.start();
    sfx.intensity(0.3);
    mode = "drone";
    hud.fl.textContent = `${def.code} · ${def.name}`;
    hud.root.dataset.mode = "play";
    stage = "play";
    hud.fade.classList.remove("on");
    showBanner(def.name, def.tagline, def.theme.accent, `FLOOR ${def.code} · HALDEN TOWER`);
    if (!hintSeen["fly"] || n > 1) showHint(def.n === 1 ? "WASD to fly · SPACE / CTRL up & down · mouse to look · V toggles first person" : def.hints[0]?.text ?? "");
    hintSeen["fly"] = 1;
    save(HINT_KEY, hintSeen);
    if (!mobile && canvas.requestPointerLock) {
      lockWanted = false;
      // pointer lock needs a user gesture; the start click is one
      try {
        const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
        lockWanted = true;
      } catch {
        /* ignore */
      }
    }
  }
  function pause() {
    if (stage !== "play") return;
    pausedFrom = stage;
    stage = "paused";
    lockWanted = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
    sfx.suspend(true);
    hud.scr.dataset.kind = "pause";
    hud.scr.className = "ov-scr on dim ov-pause";
    hud.scr.style.pointerEvents = "";
    hud.scr.innerHTML = `<div class="ov-center"><div class="ov-eye">FLOOR ${def.code} · ${def.name}</div><div class="ov-h2">PAUSED</div>
      <div class="ov-stats"><div><b>${fmt(runT)}</b><span>TIME</span></div><div><b>${detected}</b><span>DETECTED</span></div><div><b>${hacks}</b><span>HACKS</span></div></div>
      <div class="ov-act"><button type="button" class="ov-btn" data-act="resume">RESUME</button><button type="button" class="ov-btn ghost" data-act="restart">RESTART FLOOR</button><button type="button" class="ov-btn ghost" data-act="menu">FLOOR SELECT</button></div></div>`;
    wireScr();
  }
  function resume() {
    if (stage !== "paused") return;
    hideScr();
    stage = pausedFrom;
    sfx.suspend(false);
    if (!mobile && canvas.requestPointerLock) {
      try {
        const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
        lockWanted = true;
      } catch {
        /* ignore */
      }
    }
  }
  function fadeThen(fn: () => void, ms = 520) {
    hud.fade.classList.add("on");
    const prev = stage;
    stage = "fade";
    fadeFn = () => {
      fn();
      if (stage === "fade") stage = prev === "fade" ? "play" : prev;
    };
    window.setTimeout(() => {
      const f = fadeFn;
      fadeFn = null;
      if (!disposed) f?.();
    }, ms);
  }
  function caught(why: string) {
    if (stage !== "play" || godMode) return;
    caughts++;
    sfx.caught();
    shake = 1;
    glitch = 1;
    toast(why, "bad");
    showBanner("CAUGHT", why, 0xff4d5c, "SIGNAL LOST");
    fadeThen(() => restartAtCheckpoint(), 900);
  }
  function restartAtCheckpoint() {
    if (mode === "cam") exitJack(false);
    if (mode === "ride") {
      rideRob = null;
      mode = "drone";
      if (drone) drone.root.visible = true;
    }
    hud.root.dataset.mode = "play";
    resetDynamic();
    const c = ckpt;
    if (c) {
      placeDrone(c.x, c.z, c.y);
      c.doors.forEach((o, i) => {
        nav.doorOpen[i] = o;
        if (doors[i]) {
          doors[i].holdT = o ? 60 : 0;
          E.setDoor(doors[i], o ? 1 : 0);
        }
      });
      if (c.coreDone) {
        coreDone = true;
        traceT = 0;
      }
    } else placeDrone(def.start[0] * CELL, def.start[1] * CELL, 1.1);
    coreDone = c?.coreDone ?? false;
    if (extract) extract.root.visible = coreDone;
    world?.setExtract(coreDone);
    battery = Math.max(battery, 75);
    hackSt = { tgt: null, p: 0 };
    alarmT = 0;
    traceT = 0;
    lookYaw = dYaw = c ? lookYaw : def.startYaw * deg;
    hud.fade.classList.remove("on");
    hud.banner.classList.remove("on");
  }
  function floorScore() {
    const par = def.par;
    const timeK = clamp((par * 1.6 - runT) / (par * 1.6 - par * 0.55), 0, 1);
    let s = 2000 + Math.round(timeK * 2000);
    if (detected === 0) s += 2500;
    s -= Math.min(detected, 4) * 400;
    s += Math.max(0, def.parHacks + 2 - hacks) * 100;
    s -= caughts * 300;
    return Math.max(500, s);
  }
  function completeFloor() {
    if (stage !== "play") return;
    stage = "exfil";
    exfilT = 0;
    sfx.win();
    glitch = 0.6;
  }
  function finishFloor() {
    const score = floorScore();
    const grade = gradeOf(score);
    const prev = progress.best[String(def.n)];
    const isBest = !prev || score > prev.score;
    if (isBest) progress.best[String(def.n)] = { score, grade, time: Math.round(runT), detected, hacks };
    save(SAVE_KEY, progress);
    const total = totalScore();
    hooks.onScore(total);
    hooks.onGameOver(
      total,
      [
        { label: "Floor", value: `${def.code} ${def.name}` },
        { label: "Grade", value: grade },
        { label: "Time", value: fmt(runT) },
        { label: "Detected", value: String(detected) },
        { label: "Hacks", value: String(hacks) },
      ],
      { ownScreen: true },
    );
    if (document.pointerLockElement) document.exitPointerLock?.();
    lockWanted = false;
    sfx.stop();
    setStage("results");
    hud.fade.classList.remove("on");
    hud.scr.dataset.kind = "results";
    hud.scr.className = "ov-scr on dim";
    hud.scr.style.pointerEvents = "";
    const next = ALL[def.n];
    const ghost = detected === 0;
    hud.scr.innerHTML = `<div class="ov-center"><div class="ov-eye">FLOOR ${def.code} · ${def.name} · EXTRACTED${ghost ? " · GHOST" : ""}</div>
      <div class="ov-grade ${grade}">${grade}</div>
      <div class="ov-h2" style="font-size:22px">${score.toLocaleString()} PTS${isBest && prev ? ' <span style="color:var(--g);font-size:12px;letter-spacing:.2em">NEW BEST</span>' : ""}</div>
      <div class="ov-stats"><div><b>${fmt(runT)}</b><span>TIME · PAR ${fmt(def.par)}</span></div><div><b class="${detected ? "lo" : "hi"}">${detected}</b><span>TIMES DETECTED</span></div><div><b>${hacks}</b><span>HACKS USED</span></div></div>
      <div class="ov-sub">${ghost ? "Perfect infiltration — nobody ever saw you. +2500 ghost bonus." : "Never be detected for the ghost bonus. Faster, cleaner runs score higher."}${caughts ? ` ${caughts} restart${caughts > 1 ? "s" : ""} (−${caughts * 300}).` : ""}</div>
      <div class="ov-act">${next ? `<button type="button" class="ov-btn" data-act="next">NEXT FLOOR ▶</button>` : ""}<button type="button" class="ov-btn ${next ? "ghost" : ""}" data-act="restart">RETRY</button><button type="button" class="ov-btn ghost" data-act="menu">FLOOR SELECT</button></div>
      <div class="ov-sub" style="margin-top:12px;color:var(--d);font-size:11px">TOTAL ${total.toLocaleString()}${next ? "" : " · ALL FLOORS CLEARED"}</div></div>`;
    wireScr();
  }

  function toggleMute() {
    settings.muted = !settings.muted;
    sfx.setMuted(settings.muted);
    save(SET_KEY, settings);
    const b = hud.sys.querySelector<HTMLElement>("[data-act=mute]");
    if (b) {
      b.textContent = settings.muted ? "🔇" : "🔊";
      b.classList.toggle("off", settings.muted);
    }
  }
  function toggleFs() {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void container.requestFullscreen?.();
    } catch {
      /* ignore */
    }
  }
  hud.sys.querySelectorAll<HTMLElement>("[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = b.dataset.act;
      if (a === "mute") toggleMute();
      else if (a === "pause") (stage === "paused" ? resume : pause)();
      else if (a === "fs") toggleFs();
    }),
  );
  on(document, "visibilitychange", () => {
    if (document.hidden && stage === "play") pause();
  });
  if (settings.muted) {
    const b = hud.sys.querySelector<HTMLElement>("[data-act=mute]");
    if (b) {
      b.textContent = "🔇";
      b.classList.add("off");
    }
  }

  // =================================================================== MAIN UPDATE
  function updatePlay(dt: number) {
    runT += dt;
    readInput();
    updateBot(dt);
    // exits
    if (input.exitPressed) {
      input.exitPressed = false;
      if (mode === "cam") exitJack();
      else if (mode === "ride") exitRide();
    }
    // battery
    const hackingNow = hackSt.p > 0.02;
    const drain = (mode === "drone" ? 0.32 : 0.16) + (hackingNow ? 2.6 : 0);
    battery -= drain * dt;
    if (battery < 22 && battery > 0) {
      lowWarn -= dt;
      if (lowWarn <= 0) {
        lowWarn = 2.2;
        sfx.lowBattery();
      }
    }
    if (battery <= 0 && !godMode) {
      battery = 0;
      caught("BATTERY DEPLETED");
      return;
    }
    if (godMode) battery = Math.max(battery, 50);
    // timers
    if (alarmT > 0) {
      alarmT -= dt;
      if (alarmT <= 0) endAlarm();
    }
    if (traceT > 0) traceT -= dt;
    if (mode === "cam") {
      jackT -= dt;
      if (jackT <= 0) exitJack();
    }
    for (const c of camsR) c.meter = c.meter; // meters updated in detection
    // movement
    if (mode === "ride" && rideRob) updateRiddenRobot(dt, input.mx, input.mz);
    else if (mode === "drone") updateDrone(dt);
    else if (drone) {
      // parked while jacked
      dv.multiplyScalar(0.9);
      drone.root.position.set(dp.x, dp.y + Math.sin(menuT * 3.1) * 0.012, dp.z);
      for (let i = 0; i < drone.rotors.length; i++) drone.rotors[i].rotation.z += (i % 2 ? 1 : -1) * dt * 60;
      sfx.update(dt, 0.1, "cam", alarmT > 0, 0);
    }
    updateRobots(dt);
    updateCams(dt);
    updateHazards(dt);
    updateDetection(dt);
    // hacking
    const tgt = pickTarget();
    curTgt = tgt;
    if (input.hack && tgt) {
      if (hackSt.tgt !== tgt && (!hackSt.tgt || hackSt.tgt.id !== tgt.id)) hackSt = { tgt, p: 0 };
      hackSt.tgt = tgt;
      const before = hackSt.p;
      hackSt.p += dt / tgt.time;
      if (Math.floor(before * 8) !== Math.floor(hackSt.p * 8)) sfx.hackTick(hackSt.p);
      if (hackSt.p >= 1) {
        const t = tgt;
        hackSt = { tgt: null, p: 0 };
        completeHack(t);
      }
    } else {
      hackSt.p = Math.max(0, hackSt.p - dt * 2.2);
      if (hackSt.p <= 0) hackSt.tgt = null;
    }
    // hack beam
    if (hackBeam && hackBeamMat) {
      const active = hackSt.tgt && hackSt.p > 0.02 && mode !== "ride";
      hackBeam.visible = !!active;
      if (active && hackSt.tgt) {
        const o = mode === "cam" && jackCam ? jackCam.vis.tw : dp;
        const pa = hackBeam.geometry.getAttribute("position") as THREE.BufferAttribute;
        pa.setXYZ(0, o.x, o.y - 0.05, o.z);
        pa.setXYZ(1, hackSt.tgt.pos.x, hackSt.tgt.pos.y, hackSt.tgt.pos.z);
        pa.needsUpdate = true;
        hackBeamMat.opacity = 0.5 + 0.5 * Math.sin(menuT * 40);
      }
    }
    // core download
    if (core) {
      core.rings.forEach((r, i) => (r.rotation.z += dt * (1.2 + i * 0.7) * (i % 2 ? -1 : 1)));
      const dpos = core.dpos;
      for (let i = 0; i < dpos.length; i += 3) {
        dpos[i + 1] += dt * (0.5 + (i % 7) * 0.12);
        if (dpos[i + 1] > 3.4) dpos[i + 1] = 0;
      }
      (core.data.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
    if (extract) {
      extract.mat.uniforms.uTime.value = runT;
      extract.ring.rotation.z += dt;
    }
    // exfil
    if (coreDone && mode === "drone") {
      const ex = def.extract[0] * CELL;
      const ez = def.extract[1] * CELL;
      if (Math.hypot(dp.x - ex, dp.z - ez) < 1.7 && dp.y < 3.2) completeFloor();
    }
    updateRobotVisuals(dt);
    if (world) world.update(dt, menuT, camera.position);
    glitch = Math.max(0, glitch - dt * 2.2);
    // music intensity
    sfx.intensity(alarmT > 0 ? 1 : traceT > 0 ? 0.8 : clamp(maxMeter + 0.25, 0.2, 0.7));
    lastHud += dt;
    if (lastHud > 0.05) {
      updateHud(lastHud);
      lastHud = 0;
    }
    mapT += dt;
    if (mapT > 0.1) {
      mapT = 0;
      drawMap();
    }
  }

  function updateExfil(dt: number) {
    exfilT += dt;
    // the drone punches through the window
    const dx = Math.cos(def.extractFace * deg);
    const dz = Math.sin(def.extractFace * deg);
    void dx;
    void dz;
    // direction toward the pane
    const [px, pz] = def.extractPane;
    const vx = px + 0.5 - def.extract[0];
    const vz = pz + 0.5 - def.extract[1];
    const l = Math.hypot(vx, vz) || 1;
    if (drone) {
      dv.x = (vx / l) * Math.min(14, 4 + exfilT * 14);
      dv.z = (vz / l) * Math.min(14, 4 + exfilT * 14);
      dp.x += dv.x * dt;
      dp.z += dv.z * dt;
      dp.y += dt * 0.6;
      drone.root.position.copy(dp);
      drone.root.rotation.y = Math.atan2(vx / l, vz / l);
      drone.root.visible = true;
    }
    if (world?.breach.mesh) {
      const m = world.breach.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = clamp(0.28 - exfilT * 0.2, 0, 0.3);
    }
    if (exfilT > 0.5) hud.flash.style.opacity = String(clamp((exfilT - 0.5) * 1.2, 0, 1));
    if (exfilT > 1.2) hud.fade.classList.add("on");
    // chase camera keeps looking at the drone
    camera.position.set(dp.x - (vx / l) * 3.2, dp.y + 0.6, dp.z - (vz / l) * 3.2);
    camera.lookAt(dp);
    if (exfilT > 1.9) {
      hud.flash.style.opacity = "0";
      finishFloor();
    }
    updateRobotVisuals(dt);
    if (world) world.update(dt, menuT, camera.position);
  }

  // =================================================================== LOOP
  let raf = 0;
  let last = performance.now();
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 60;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fpsAcc += realDt;
    fpsN++;
    if (fpsAcc > 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    if (stage === "loading") {
      renderer.render(scene, camera);
      return;
    }
    if (stage !== "paused") menuT += realDt;
    if (stage === "play") for (let i = 0; i < simBoost; i++) updatePlay(realDt);
    else if (stage === "exfil") updateExfil(realDt);
    else if (stage === "menu") {
      // idle: rotors + robots idle
      if (drone) {
        for (let i = 0; i < drone.rotors.length; i++) drone.rotors[i].rotation.z += (i % 2 ? 1 : -1) * realDt * 60;
        drone.root.position.set(dp.x, dp.y + Math.sin(menuT * 2) * 0.04, dp.z);
        drone.root.rotation.y = Math.atan2(Math.cos(dYaw), Math.sin(dYaw));
      }
      runT += realDt * 0;
      updateCams(realDt * 0 + 0.0001);
      for (const c of camsR) {
        const d = c.def;
        c.yaw = d.yaw + Math.sin((menuT / d.period + (d.phase ?? 0)) * Math.PI * 2) * d.sweep;
        E.updateCamVis(c.vis, c.yaw);
      }
      updateRobots(0);
      updateRobotVisuals(realDt);
      if (world) world.update(realDt, menuT, camera.position);
    } else if (stage === "fade") {
      // keep the world animating under the fade
      if (world) world.update(realDt, menuT, camera.position);
      updateRobotVisuals(realDt);
    } else if (stage === "results") {
      if (world) world.update(realDt, menuT, camera.position);
    }
    if (stage !== "exfil") updateCameraRig(realDt);
    if (stage !== "paused" && world) updateLights(realDt, stage === "menu" ? camera.position : mode === "ride" && rideRob ? tmpV2.set(rideRob.x, 1, rideRob.z) : dp);
    // listener-ish stuff
    lastPos.copy(camera.position);
    if (bloom) bloom.strength = mode === "cam" ? 0.4 : mobile ? 0.5 : 0.62;
    if (grade) grade.uniforms.uTime.value = menuT;
    if (cctv) {
      cctv.uniforms.uTime.value = menuT;
      cctv.uniforms.uGlitch.value = glitch;
      cctv.uniforms.uAmt.value = stage === "play" || stage === "paused" ? (mode === "cam" ? 1 : 0) : 0;
    }
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  // =================================================================== BOOT
  const loadFill = document.createElement("div");
  function showLoading() {
    hud.scr.className = "ov-scr on load";
    hud.scr.innerHTML = `<div class="ov-load"><div class="ov-eye">HALDEN TOWER · SECURITY NETWORK</div><div class="ov-h2" style="margin-top:10px">INITIALISING DRONE</div>
      <div class="bar"><i></i></div><div class="st"><span>UPLOADING PAYLOAD</span><span class="pc">0%</span></div></div>`;
    const bar = hud.scr.querySelector(".bar i") as HTMLElement;
    const pc = hud.scr.querySelector(".pc") as HTMLElement;
    manager.onProgress = (_u, l, t) => {
      const p = t ? Math.round((l / t) * 100) : 0;
      bar.style.width = `${p}%`;
      pc.textContent = `${p}%`;
    };
  }
  async function boot() {
    showLoading();
    const robotP = gltf.loadAsync(`${ASSET}/models/robot.glb`).catch((e) => {
      console.error("[OVERRIDE] robot", e);
      return null;
    });
    const metalP = loadPbr(texLoader, `${ASSET}/tex/metal_plate_02`, 0.0701, aniso);
    const concP = loadPbr(texLoader, `${ASSET}/tex/concrete_pavers_02`, 0.1264, aniso);
    const hdrP = new HDRLoader(manager)
      .loadAsync(`${ASSET}/hdr/city_sunset.hdr`)
      .then((tex) => {
        if (disposed) return;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        pmrem = new THREE.PMREMGenerator(renderer);
        envRT = pmrem.fromEquirectangular(tex);
        tex.dispose();
        scene.environment = envRT.texture;
        scene.environmentIntensity = 0.14;
      })
      .catch(() => {});
    const [rob, metal, conc] = await Promise.all([robotP, metalP, concP, hdrP]);
    if (disposed) return;
    if (rob) {
      robotSrc = rob.scene;
      robotClips = rob.animations;
      srcObjects.push(rob.scene);
    }
    pbr = { metal, concrete: conc };
    loadFloor(1);
    selFloor = 1;
    // continue where the player left off: first floor without a grade
    for (const f of ALL) if (unlocked(f.n) && !progress.best[String(f.n)]) { selFloor = f.n; break; }
    if (selFloor !== 1) loadFloor(selFloor);
    showMenu();
  }

  // =================================================================== DEV HOOKS
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as Record<string, unknown>).__ov = {
      start: (n: number) => {
        progress.best["1"] = progress.best["1"] ?? undefined!;
        if (!unlocked(n)) {
          for (let k = 1; k < n; k++) if (!progress.best[String(k)]) progress.best[String(k)] = { score: 1, grade: "C", time: 0, detected: 0, hacks: 0 };
        }
        startFloor(n);
      },
      teleport: (x: number, z: number, y = 1.2) => placeDrone(x * CELL, z * CELL, y),
      god: (b: boolean) => (godMode = b),
      sim: (n: number) => (simBoost = Math.max(1, Math.floor(n))),
      topdown: (b: boolean) => {
        topdown = b;
        if (world?.ceilMesh.mesh) world.ceilMesh.mesh.visible = !b;
      },
      look: (yawDeg: number, pitchDeg = -8) => {
        lookYaw = yawDeg * deg;
        lookPitch = pitchDeg * deg;
      },
      view: (b: boolean) => (firstPerson = b),
      battery: (v: number) => (battery = v),
      pause: () => pause(),
      resume: () => resume(),
      finish: () => completeFloor(),
      core: () => completeHack({ kind: "core", id: "core", pos: core!.tw, time: 1, name: "core", ref: core }),
      hackNow: (id: string) => {
        const t = buildTargets().find((x) => x.id === id);
        if (t) completeHack(t);
        return !!t;
      },
      freeze: (b: boolean) => (stage = b ? "paused" : "play"),
      solve: (n: number) => {
        (window as unknown as { __ov: { start: (n: number) => void } }).__ov.start(n);
        bot.on = true;
        bot.steps = ALL[n - 1].solution.slice();
        bot.i = 0;
        bot.wait = 0;
        bot.done = false;
        bot.log = [];
      },
      botOff: () => (bot.on = false),
      botLog: () => ({ i: bot.i, step: bot.steps[bot.i], log: bot.log.slice(-12), stage, mode, pos: [dp.x / CELL, dp.y, dp.z / CELL] }),
      dbg: () => ({ scene, camera, composer, bloom, grade, cctv, renderer, world, drone }),
      /** fraction of a sweep cycle each cell is covered by any camera at height y (metres); rows of digits 0-9 */
      camMap: (y = 1.2, span = 24) => {
        const save = runT;
        const rows: string[] = [];
        const acc = new Float32Array(def.W * def.H);
        const N = Math.round(span / 0.25);
        for (let k = 0; k < N; k++) {
          runT = k * 0.25;
          for (const c of camsR) {
            const d = c.def;
            c.yaw = d.yaw + Math.sin((runT / d.period + (d.phase ?? 0)) * Math.PI * 2) * d.sweep;
          }
          for (let z = 0; z < def.H; z++)
            for (let x = 0; x < def.W; x++) {
              if (!nav.open(x, z)) continue;
              const px = (x + 0.5) * CELL;
              const pz = (z + 0.5) * CELL;
              if (camsR.some((c) => camSees(c, px, y, pz) >= 0)) acc[z * def.W + x] += 1 / N;
            }
        }
        runT = save;
        for (let z = 0; z < def.H; z++) {
          let r = "";
          for (let x = 0; x < def.W; x++) r += !nav.open(x, z) ? (def.grid[z][x] === " " ? " " : "#") : acc[z * def.W + x] === 0 ? "." : String(Math.min(9, Math.ceil(acc[z * def.W + x] * 9)));
          rows.push(r);
        }
        return rows.join("\n");
      },
      exposedAt: (x: number, y: number, z: number) => ({ any: exposed(x, y, z), cams: camsR.map((c) => camSees(c, x, y, z)), robs: robs.map((r) => robSees(r, x, y, z)) }),
      bot,
      menu: () => toMenu(),
      shotMenu: (n: number) => selectFloor(n),
      get state() {
        return {
          stage,
          mode,
          floor: def.n,
          pos: [+(dp.x / CELL).toFixed(2), +(dp.z / CELL).toFixed(2), +dp.y.toFixed(2)],
          battery: +battery.toFixed(1),
          detected,
          hacks,
          caughts,
          alarm: +alarmT.toFixed(1),
          trace: +traceT.toFixed(1),
          coreDone,
          t: +runT.toFixed(1),
          maxMeter: +maxMeter.toFixed(2),
          light: +lightF.toFixed(2),
          fps: +fps.toFixed(0),
          score: stage === "play" ? floorScore() : 0,
          botI: bot.i,
          botStep: bot.steps[bot.i] ?? null,
          botLog: bot.log.slice(-6),
          ckpt: ckpt ? [ckpt.x / CELL, ckpt.z / CELL] : null,
          cams: camsR.map((c) => ({ id: c.def.id, m: +c.meter.toFixed(2), blind: +c.blind.toFixed(1), yaw: +c.yaw.toFixed(0) })),
          robots: robs.map((r) => ({ id: r.def.id, s: r.state, m: +r.meter.toFixed(2), p: [+(r.x / CELL).toFixed(1), +(r.z / CELL).toFixed(1)] })),
          doors: nav.doorOpen.slice(),
          target: curTgt ? curTgt.id : null,
          calls: renderer.info.render.calls,
          tris: renderer.info.render.triangles,
        };
      },
    };
  }

  raf = requestAnimationFrame(frame);
  void boot();
  void loadFill;
  void VENT_H;

  // =================================================================== DISPOSE
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const off of listeners) off();
      ro?.disconnect();
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      disposeFloor();
      const srcGeos = new Set<THREE.BufferGeometry>();
      const srcMats = new Set<THREE.Material>();
      for (const obj of srcObjects)
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) srcGeos.add(m.geometry);
          if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => srcMats.add(x));
        });
      srcGeos.forEach((g) => g.dispose());
      srcMats.forEach((m) => m.dispose());
      gGeos.forEach((g) => g.dispose());
      gMats.forEach((m) => m.dispose());
      gTexs.forEach((t) => t.dispose());
      if (pbr) for (const s of [pbr.metal, pbr.concrete]) [s.diff, s.nor, s.arm].forEach((t) => t.dispose());
      envRT?.dispose();
      pmrem?.dispose();
      scene.environment = null;
      for (const p of composer?.passes ?? []) p.dispose();
      composer?.dispose();
      renderer.dispose();
      sfx.dispose();
      document.body.style.overflow = prevOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      hud.root.remove();
      hud.style.remove();
      canvas.remove();
      if (process.env.NODE_ENV !== "production") delete (window as unknown as Record<string, unknown>).__ov;
    },
  };
}

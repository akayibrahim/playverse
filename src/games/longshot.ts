"use client";

/**
 * LONGSHOT — a NEXUS 2100 marksman game.
 *
 * Same rain-soaked District 07 boulevard, seen from a sniper nest at the north end.
 * Real projectile ballistics (drop, crosswind, time of flight), a scoped bolt-action with
 * holdover reticle, breath control, a bullet cam, and three contracts:
 * sentries → a courier hidden in a crowd → overwatch for a moving fireteam.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { createAudio } from "./nexus-lib/audio";
import { createPhysics, type Physics, type Prop, type Ragdoll } from "./nexus-lib/physics";
import { esc } from "./nexus-lib/hud";
import { GradeShader } from "./nexus-lib/grade";
import { buildRifle, createRifleParts, rotateBoneWorld, solveArm, type Rifle } from "./nexus-lib/rig";
import { footprintBoxes } from "./nexus-lib/footprint";
import { applyKitSurfaces, glowNeon, loadPbr, triplanar, type PbrSet } from "./nexus-lib/surface";
import { asphalt, flashTex, sidewalk, softDot, verticalFade, wornPaint } from "./nexus-lib/textures";
import { buildLsHud } from "./longshot-lib/hud";
import { CONTRACTS, contractById, type Contract, type ContractId } from "./longshot-lib/contracts";

type RunStat = { label: string; value: string };
type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number, stats: RunStat[], opts?: { ownScreen?: boolean }) => void;
  onPopup?: (text: string) => void;
  best?: number;
};
type GameInstance = { dispose: () => void };

type UKind = "hostile" | "guard" | "civilian" | "courier" | "decoy" | "ally" | "marksman";
type UState = "idle" | "patrol" | "walk" | "alert" | "engage" | "flee" | "panic" | "hold" | "move" | "gone";
type Rig = { hips: THREE.Object3D; spine: THREE.Object3D; chest: THREE.Object3D; head: THREE.Object3D };
type Bones = {
  spine: THREE.Object3D;
  neck: THREE.Object3D;
  rArm: THREE.Object3D;
  rFore: THREE.Object3D;
  rHand: THREE.Object3D;
  lArm: THREE.Object3D;
  lFore: THREE.Object3D;
  lHand: THREE.Object3D;
};

type Unit = {
  id: number;
  kind: UKind;
  name: string;
  root: THREE.Group;
  body: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  current: string;
  rig: Rig | null;
  bones: Bones | null;
  pivot: THREE.Group | null;
  rifle: Rifle | null;
  umbrella: THREE.Group | null;
  umbrellaProp: Prop | null;
  carry: THREE.Group | null;
  hitboxes: THREE.Mesh[];
  owned: { mats: THREE.Material[]; geos: THREE.BufferGeometry[] };
  hp: number;
  alive: boolean;
  deathClip: string;
  ragdoll: Ragdoll | null;
  rifleProp: Prop | null;
  speed: number;
  faceYaw: number;
  state: UState;
  path: THREE.Vector3[];
  pathI: number;
  loop: boolean;
  wait: number;
  waitAt: number;
  walkSpeed: number;
  aimPoint: THREE.Vector3;
  aiming: boolean;
  aimW: number;
  shotCd: number;
  burst: number;
  alertT: number;
  crouch: boolean;
  peekT: number;
  target: Unit | "player" | null;
  laser: THREE.Mesh | null;
  laserMat: THREE.MeshBasicMaterial | null;
  glint: THREE.Sprite | null;
  glintT: number;
  objective: boolean;
  tagged: number;
  tagEl: HTMLElement | null;
  flinch: number;
  lastX: number;
  lastZ: number;
  twist: number;
  deadT: number;
  stopT: number;
  cover: THREE.Vector3 | null;
  stopIdx: number;
};

type Bullet = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  alive: boolean;
  cam: boolean;
  hits: number;
  kills: Unit[];
  from: THREE.Vector3;
  trail: THREE.Mesh;
  trailMat: THREE.MeshBasicMaterial;
  pen: number;
  ignore: Set<Unit>;
  dist: number;
};

type Spark = { pts: THREE.Points; mat: THREE.PointsMaterial; vel: Float32Array; life: number };
type Puff = { sp: THREE.Sprite; mat: THREE.SpriteMaterial; life: number; max: number; grow: number };

const ASSET = "/assets";
const ROAD_HALF = 6.2;
const Z_FAR = -78;
const Z_NEAR = 44;
const PERCH = new THREE.Vector3(0, 13.3, 46.85);
const DUCK_DROP = 1.0;
const UP = new THREE.Vector3(0, 1, 0);
// Ballistics: deliberately slower than a real .308 so drop + lead matter on a 100 m street.
const V0 = 250;
const GRAV = 9.8;
const ZERO = 40;
const WIND_K = 1.35;
const BASE_FOV = 62;
const ZOOMS = [4, 8, 12];
const ZOOM_MIN = 3;
const ZOOM_MAX = 14;
const MAG = 5;
const BOLT_TIME = 1.15;
const RELOAD_TIME = 2.6;
const PLAYER_HP = 100;
const SETTINGS_KEY = "playverse:longshotSettings";
const SAVE_KEY = "playverse:longshot";
const SEEN_KEY = "playverse:longshotSeen";

const GLB_ENV = [
  "cyberpunk_platform_a",
  "cyberpunk_platform_b",
  "cyberpunk_platform_c",
  "cyberpunk_platform_d",
  "streetlight_a",
  "streetlight_b",
  "cyberpunk_signs",
  "lootbox_crate",
  "tv_tower",
  "barrier_support",
  "rail",
  "antenna",
  "turret_gun",
  "air_conditioner",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function formatTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
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
    /* ignore */
  }
}
/** Bullet drop below the line of sight at distance d (m) for the zeroed rifle. */
function dropAt(d: number) {
  return (0.5 * GRAV * (d * d - ZERO * d)) / (V0 * V0);
}

export function createGame(container: HTMLElement, hooks: GameHooks): GameInstance {
  const rng = mulberry32(4242);
  const fx = Math.random;
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const mobile = coarse || container.clientWidth < 720;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const sourceObjects: THREE.Object3D[] = [];
  const listeners: Array<() => void> = [];
  const G = <X extends THREE.BufferGeometry>(g: X): X => (geometries.add(g), g);
  const M = <X extends THREE.Material>(m: X): X => (materials.add(m), m);
  const T = <X extends THREE.Texture>(t: X): X => (textures.add(t), t);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = (el: EventTarget, type: string, fn: (ev: any) => void, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };

  const settings = store(SETTINGS_KEY, { sens: 1, vol: 0.8, muted: false, music: 0.55 });
  const progress = store<{ stars: Record<string, number>; best: Record<string, number> }>(SAVE_KEY, { stars: {}, best: {} });
  let firstRun = true;
  try {
    firstRun = localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    /* ignore */
  }
  const unlocked = (c: Contract) => c.n === 1 || (progress.stars[CONTRACTS[c.n - 2].id] ?? 0) > 0;
  let selected: ContractId = CONTRACTS.slice()
    .reverse()
    .find((c) => unlocked(c))!.id;
  let C: Contract = contractById(selected);

  // ------------------------------------------------------------- state
  type Stage = "loading" | "menu" | "playing" | "paused" | "over";
  let stage: Stage = "loading";
  let disposed = false;
  let elapsed = 0;
  let menuTime = 0;
  let score = 0;
  let kills = 0;
  let headshots = 0;
  let shots = 0;
  let hitsN = 0;
  let longest = 0;
  let civHits = 0;
  let detection = 0;
  let compromised = false;
  let compromisedEver = false;
  let success = false;
  let failReason = "";
  let timeScale = 1;
  let hp = PLAYER_HP;
  let lastHurt = 99;
  let damageFlash = 0;
  let runMedals: Record<string, number> = {};
  let lastKillT = -99;

  let yaw = 0;
  let pitch = -0.16;
  let scoped = false;
  let scopeBlend = 0;
  /** continuous magnification (trackpad / wheel); Z + touch button snap to ZOOMS */
  let zoom = 8;
  let zoomTick = 0;
  let ducked = false;
  let duckBlend = 0;
  let breathHeld = false;
  let breath = 1; // stamina
  let breathOut = 0; // recovery after running out
  let swayT = 0;
  let swayAmp = 1;
  let mag = MAG;
  let reserve = 10;
  let boltT = 0;
  let reloadT = 0;
  let recoil = 0;
  let heartT = 0;
  let wind = 0;
  let windT = 0;
  let hintStep = firstRun ? 0 : 99;
  let hintTimer = 0;
  const keys = new Set<string>();

  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3();

  let viewW = Math.max(1, container.clientWidth);
  let viewH = Math.max(1, container.clientHeight);

  // --------------------------------------------------------------- HUD
  const hud = buildLsHud(container, mobile);
  const prevBodyOverflow = document.body.style.overflow;
  const prevOverscroll = document.documentElement.style.overscrollBehavior;
  if (mobile) {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
  }
  const audio = createAudio();
  audio.setVolume(settings.muted ? 0 : settings.vol);
  audio.setMusicVolume(settings.music);

  // ----------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: mobile, powerPreference: "high-performance", alpha: false, preserveDrawingBuffer: false });
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(viewW, viewH);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.insertBefore(renderer.domElement, hud.style);
  const canvas = renderer.domElement;

  const FOG = 0x1d1b2b;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.0105);

  const camera = new THREE.PerspectiveCamera(BASE_FOV, viewW / viewH, 0.03, 500);
  camera.position.copy(PERCH);
  scene.add(camera);

  const sun = new THREE.DirectionalLight(0xff9f6a, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -26;
  sc.right = 26;
  sc.top = 26;
  sc.bottom = -26;
  sc.near = 1;
  sc.far = 160;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const SUN_OFF = new THREE.Vector3(-30, 42, -52);
  const hemi = new THREE.HemisphereLight(0x7d8fc4, 0x231c2a, 0.55);
  scene.add(hemi);

  // -------------------------------------------------------- ground + road
  const asph = asphalt(rng);
  T(asph.map);
  T(asph.rough);
  asph.map.repeat.set(18, 18);
  asph.rough.repeat.set(18, 18);
  asph.map.anisotropy = asph.rough.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const ground = new THREE.Mesh(
    G(new THREE.PlaneGeometry(280, 280)),
    M(new THREE.MeshStandardMaterial({ map: asph.map, roughnessMap: asph.rough, roughness: 1, metalness: 0.05, envMapIntensity: 0.4 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -20;
  ground.receiveShadow = true;
  scene.add(ground);
  const groundMat = ground.material as THREE.MeshStandardMaterial;

  const SW_LEN = Z_NEAR - Z_FAR + 12;
  const SW_Z = (Z_NEAR + Z_FAR) / 2;
  const swTex = T(sidewalk(rng));
  swTex.repeat.set(1.2, 46);
  const swMat = M(new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.9 }));
  const curbMat = M(new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.6 }));
  const swGeo = G(new THREE.BoxGeometry(3.2, 0.12, SW_LEN));
  const curbGeo = G(new THREE.BoxGeometry(0.2, 0.15, SW_LEN));
  for (const side of [-1, 1]) {
    const sw = new THREE.Mesh(swGeo, swMat);
    sw.position.set(side * (ROAD_HALF + 1.7), 0.06, SW_Z);
    sw.receiveShadow = true;
    scene.add(sw);
    const curb = new THREE.Mesh(curbGeo, curbMat);
    curb.position.set(side * (ROAD_HALF + 0.08), 0.075, SW_Z);
    curb.receiveShadow = true;
    scene.add(curb);
  }
  function applyGroundPbr(road: PbrSet, pave: PbrSet) {
    const rep = 280 / 3.2;
    for (const t of [road.diff, road.nor, road.arm]) t.repeat.set(rep, rep);
    groundMat.map = road.diff;
    groundMat.normalMap = road.nor;
    groundMat.normalScale.set(0.9, 0.9);
    groundMat.aoMap = road.arm;
    groundMat.aoMapIntensity = 0.8;
    groundMat.color.setRGB(0.78, 0.8, 0.86);
    groundMat.needsUpdate = true;
    const pv = [pave.diff, pave.nor, pave.arm].map((t) => {
      const c = T(t.clone());
      c.repeat.set(3.2 / 2.2, SW_LEN / 2.2);
      c.needsUpdate = true;
      return c;
    });
    swMat.map = pv[0];
    swMat.normalMap = pv[1];
    swMat.aoMap = pv[2];
    swMat.roughnessMap = pv[2];
    swMat.roughness = 0.85;
    swMat.color.setRGB(0.62, 0.64, 0.7);
    swMat.needsUpdate = true;
  }
  const lineMat = M(
    new THREE.MeshStandardMaterial({
      color: 0xd8d2b4,
      alphaMap: T(wornPaint(rng)),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      roughness: 0.55,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  const lineGeo = G(new THREE.PlaneGeometry(0.14, 1.8));
  for (let z = Z_FAR; z <= Z_NEAR; z += 4.5) {
    const d = new THREE.Mesh(lineGeo, lineMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(0, 0.012, z);
    scene.add(d);
  }
  const edgeGeo = G(new THREE.PlaneGeometry(0.1, SW_LEN));
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(edgeGeo, lineMat);
    e.rotation.x = -Math.PI / 2;
    e.position.set(side * (ROAD_HALF - 0.4), 0.012, SW_Z);
    scene.add(e);
  }
  const zebraGeo = G(new THREE.PlaneGeometry(0.55, 3));
  for (const zc of [26, -9, -44]) {
    for (let x = -5.2; x <= 5.2; x += 1.1) {
      const z = new THREE.Mesh(zebraGeo, lineMat);
      z.rotation.x = -Math.PI / 2;
      z.position.set(x, 0.013, zc);
      scene.add(z);
    }
  }

  // ------------------------------------------------------------- rain
  // The rain volume follows wherever you're looking (the scope can be 100 m away).
  const RAIN = mobile ? 600 : 1600;
  const rainPos = new Float32Array(RAIN * 6);
  const rainSeed = new Float32Array(RAIN * 3);
  const rainGeo = G(new THREE.BufferGeometry());
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = M(new THREE.LineBasicMaterial({ color: 0xa9bfd4, transparent: true, opacity: 0.26, depthWrite: false }));
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  scene.add(rain);
  for (let i = 0; i < RAIN; i++) {
    rainSeed[i * 3] = rng() * 2 - 1;
    rainSeed[i * 3 + 1] = rng();
    rainSeed[i * 3 + 2] = rng() * 2 - 1;
  }
  const rainCenter = new THREE.Vector3();
  let rainT = 0;
  function updateRain(dt: number) {
    rainT += dt;
    const size = 22;
    const h = 18;
    const fall = 16;
    const slant = wind * 0.05;
    for (let i = 0; i < RAIN; i++) {
      const yf = (((rainSeed[i * 3 + 1] - (rainT * fall) / h) % 1) + 1) % 1;
      const x = rainCenter.x + rainSeed[i * 3] * size + slant * yf * h;
      const y = Math.max(0, rainCenter.y - h * 0.35) + yf * h;
      const z = rainCenter.z + rainSeed[i * 3 + 2] * size;
      rainPos[i * 6] = x;
      rainPos[i * 6 + 1] = y;
      rainPos[i * 6 + 2] = z;
      rainPos[i * 6 + 3] = x - slant * 0.5;
      rainPos[i * 6 + 4] = y + 0.5;
      rainPos[i * 6 + 5] = z + 0.01;
    }
    (rainGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  // --------------------------------------------------------------- FX
  const SPARK_N = 14;
  const sparks: Spark[] = [];
  for (let i = 0; i < 18; i++) {
    const geo = G(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARK_N * 3), 3));
    const mat = M(new THREE.PointsMaterial({ color: 0xffce8a, size: 0.06, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.frustumCulled = false;
    scene.add(pts);
    sparks.push({ pts, mat, vel: new Float32Array(SPARK_N * 3), life: 0 });
  }
  let sparkI = 0;
  const dotTex = T(softDot());
  const puffs: Puff[] = [];
  for (let i = 0; i < 30; i++) {
    const mat = M(new THREE.SpriteMaterial({ map: dotTex, color: 0x8a8f96, transparent: true, opacity: 0, depthWrite: false }));
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    scene.add(sp);
    puffs.push({ sp, mat, life: 0, max: 1, grow: 1 });
  }
  let puffI = 0;
  const flashT = T(flashTex());
  const flashes: Puff[] = [];
  for (let i = 0; i < 16; i++) {
    const mat = M(new THREE.SpriteMaterial({ map: flashT, color: 0xffe0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    scene.add(sp);
    flashes.push({ sp, mat, life: 0, max: 0.06, grow: 0 });
  }
  let flashI = 0;
  const tracerGeo = G(new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true));
  tracerGeo.rotateX(Math.PI / 2);
  tracerGeo.translate(0, 0, 0.5);
  type Tracer = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; from: THREE.Vector3; dir: THREE.Vector3; dist: number; t: number; on: boolean };
  const tracers: Tracer[] = [];
  for (let i = 0; i < 20; i++) {
    const mat = M(new THREE.MeshBasicMaterial({ color: 0xff8a7a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    const mesh = new THREE.Mesh(tracerGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, mat, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0, on: false });
  }
  let tracerI = 0;

  function spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const t = tracers[tracerI++ % tracers.length];
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 0.2) return;
    t.dir.divideScalar(t.dist);
    t.t = 0;
    t.on = true;
    t.mat.color.setHex(color);
    t.mesh.visible = true;
    t.mesh.position.copy(from);
    t.mesh.lookAt(tmpV.copy(from).add(t.dir));
    t.mesh.scale.set(1.6, 1.6, 0.001);
  }
  function spawnSparks(at: THREE.Vector3, color: number, n = 1, normal?: THREE.Vector3) {
    const s = sparks[sparkI++ % sparks.length];
    const attr = s.pts.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < SPARK_N; i++) {
      attr.setXYZ(i, at.x, at.y, at.z);
      s.vel[i * 3] = (fx() - 0.5) * 4 * n + (normal?.x ?? 0) * 2.2;
      s.vel[i * 3 + 1] = fx() * 3 * n + 0.4 + (normal?.y ?? 0) * 2.2;
      s.vel[i * 3 + 2] = (fx() - 0.5) * 4 * n + (normal?.z ?? 0) * 2.2;
    }
    attr.needsUpdate = true;
    s.mat.color.setHex(color);
    s.mat.opacity = 1;
    s.life = 0.32;
    s.pts.visible = true;
  }
  function spawnPuff(at: THREE.Vector3, color: number, size: number, life: number, opacity = 0.5) {
    const p = puffs[puffI++ % puffs.length];
    p.sp.position.copy(at);
    p.mat.color.setHex(color);
    p.mat.opacity = opacity;
    p.life = p.max = life;
    p.grow = size;
    p.sp.scale.setScalar(size * 0.3);
    p.sp.visible = true;
  }
  function spawnFlash(at: THREE.Vector3, size: number, life = 0.06, color = 0xffe0b0) {
    const f = flashes[flashI++ % flashes.length];
    f.sp.position.copy(at);
    f.sp.scale.setScalar(size * (0.8 + fx() * 0.4));
    f.mat.rotation = fx() * Math.PI;
    f.mat.color.setHex(color);
    f.mat.opacity = 1;
    f.life = f.max = life;
    f.sp.visible = true;
  }
  function updateFx(dt: number) {
    for (const t of tracers) {
      if (!t.on) continue;
      t.t += 180 * dt;
      const head = Math.min(t.dist, t.t);
      const tail = Math.max(0, t.t - 4);
      if (tail >= t.dist) {
        t.on = false;
        t.mesh.visible = false;
        continue;
      }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.scale.set(1.6, 1.6, Math.max(0.001, head - tail));
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const attr = s.pts.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < SPARK_N; i++) {
        s.vel[i * 3 + 1] -= 9.8 * dt;
        attr.setXYZ(i, attr.getX(i) + s.vel[i * 3] * dt, Math.max(0.01, attr.getY(i) + s.vel[i * 3 + 1] * dt), attr.getZ(i) + s.vel[i * 3 + 2] * dt);
      }
      attr.needsUpdate = true;
      s.mat.opacity = Math.max(0, s.life / 0.32);
      if (s.life <= 0) s.pts.visible = false;
    }
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.sp.scale.setScalar(p.grow * (0.3 + k * 0.9));
      p.sp.position.y += dt * 0.25;
      p.sp.position.x += wind * 0.25 * dt;
      p.mat.opacity = Math.max(0, (1 - k) * 0.5);
      if (p.life <= 0) p.sp.visible = false;
    }
    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.mat.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) f.sp.visible = false;
    }
  }

  // ------------------------------------------------------------- loading
  hud.overlay.className = "nx-ov load on";
  hud.overlay.innerHTML = `<div class="nx-load"><div class="nx-kick">MARKSMAN NET // DISTRICT 07</div>
    <div class="nx-h2" style="margin-top:14px">CALIBRATING OPTIC</div>
    <div class="bar"><i></i></div><div class="st"><span>NEST · DISTRICT · SKY</span><span class="pc">0%</span></div>
    <div class="err"></div></div>`;
  const loadFill = hud.overlay.querySelector(".bar i") as HTMLElement;
  const loadPct = hud.overlay.querySelector(".pc") as HTMLElement;
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, loaded, total) => {
    const p = total ? Math.round((loaded / total) * 100) : 0;
    loadFill.style.width = `${p}%`;
    loadPct.textContent = `${p}%`;
  };
  const gltfLoader = new GLTFLoader(manager);
  const hdrLoader = new HDRLoader(manager);
  let pmrem: THREE.PMREMGenerator | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;
  let hdrTex: THREE.DataTexture | null = null;
  let soldierSrc: THREE.Group | null = null;
  let clips: THREE.AnimationClip[] = [];
  let kitSet: PbrSet | null = null;
  const rifleParts = createRifleParts();
  for (const g of Object.values(rifleParts.geo)) geometries.add(g);
  materials.add(rifleParts.metal);
  materials.add(rifleParts.polymer);
  let phys: Physics | null = null;

  async function loadGlb(name: string, kind: "models" | "env") {
    try {
      const g = await gltfLoader.loadAsync(`${ASSET}/${kind}/${name}.glb`);
      sourceObjects.push(g.scene);
      return g;
    } catch (err) {
      console.error(`[LONGSHOT] GLB failed: ${name}`, err);
      return null;
    }
  }

  async function boot() {
    const solP = loadGlb("soldier", "models");
    const envP = Promise.all(GLB_ENV.map((n) => loadGlb(n, "env")));
    const hdrP = hdrLoader
      .loadAsync(`${ASSET}/hdr/city_sunset.hdr`)
      .then((tex) => {
        if (disposed) return;
        hdrTex = tex as THREE.DataTexture;
        hdrTex.mapping = THREE.EquirectangularReflectionMapping;
        pmrem = new THREE.PMREMGenerator(renderer);
        envRT = pmrem.fromEquirectangular(hdrTex);
        scene.environment = envRT.texture;
        scene.environmentIntensity = 0.45;
        scene.background = hdrTex;
        scene.backgroundBlurriness = 0.12;
        scene.backgroundIntensity = 0.16;
        scene.backgroundRotation.set(0, Math.PI * 0.62, 0);
        scene.environmentRotation.set(0, Math.PI * 0.62, 0);
      })
      .catch((err) => console.error("[LONGSHOT] HDR failed", err));
    const mocapP = fetch(`${ASSET}/models/anims.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: THREE.AnimationClipJSON[]) => list.map((j) => THREE.AnimationClip.parse(j)))
      .catch(() => [] as THREE.AnimationClip[]);
    const texLoader = new THREE.TextureLoader();
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const pbrP = Promise.all([
      loadPbr(texLoader, `${ASSET}/tex/metal_plate_02`, 0.0701, aniso),
      loadPbr(texLoader, `${ASSET}/tex/asphalt_02`, 0.1021, aniso),
      loadPbr(texLoader, `${ASSET}/tex/concrete_pavers_02`, 0.1264, aniso),
    ]).catch((err) => {
      console.error("[LONGSHOT] PBR textures failed", err);
      return null;
    });
    const [sol, env, , mocap, pbr] = await Promise.all([solP, envP, hdrP, mocapP, pbrP]);
    if (disposed) return;
    if (!sol) {
      (hud.overlay.querySelector(".err") as HTMLElement).textContent = "CRITICAL ASSET FAULT — SEE CONSOLE";
      return;
    }
    soldierSrc = sol.scene;
    clips = [...sol.animations, ...mocap];
    measureRig();
    if (pbr) {
      for (const set of pbr) for (const t of [set.diff, set.nor, set.arm]) T(t);
      kitSet = pbr[0];
      applyKitSurfaces(env.map((g) => g?.scene), pbr[0]);
      applyGroundPbr(pbr[1], pbr[2]);
    }
    buildWorld(env.map((g) => g?.scene ?? null));
    void createPhysics().then((p) => {
      if (!p) return;
      if (disposed) {
        p.dispose();
        return;
      }
      phys = p;
      for (const b of staticBoxes) p.addStaticBox(b);
      for (const sx of [-1, 1]) p.addStaticBox(new THREE.Box3(new THREE.Vector3(sx > 0 ? ROAD_HALF + 0.1 : -90, -0.5, -140), new THREE.Vector3(sx > 0 ? 90 : -ROAD_HALF - 0.1, 0.12, 80)));
    });
    renderer.compile(scene, camera);
    showMenu();
  }

  // ---------------------------------------------------------- world build
  const blockerMat = M(new THREE.MeshBasicMaterial({ visible: false }));
  /** Env pieces bullets can hit (precise mesh raycast after an AABB broadphase). */
  const shootables: Array<{ obj: THREE.Object3D; box: THREE.Box3 }> = [];
  const staticBoxes: THREE.Box3[] = [];
  const coverSpots: THREE.Vector3[] = [];

  function placeEnv(src: THREE.Group, pos: THREE.Vector3, scale: number, rotY: number, solid: boolean, shoot = true) {
    const box0 = new THREE.Box3().setFromObject(src);
    const c = box0.getCenter(new THREE.Vector3());
    const wrap = new THREE.Group();
    const inst = src.clone(true);
    inst.scale.setScalar(scale);
    inst.position.set(-c.x * scale, -box0.min.y * scale, -c.z * scale);
    inst.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    wrap.add(inst);
    wrap.position.copy(pos);
    wrap.rotation.y = rotY;
    scene.add(wrap);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    if (shoot) shootables.push({ obj: wrap, box });
    if (solid) for (const b of footprintBoxes(wrap, box)) staticBoxes.push(b);
    return box;
  }

  const perchMat = M(new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.7, metalness: 0.45, name: "Grey" }));
  const perchDark = M(new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6, metalness: 0.6, name: "Black" }));

  function buildWorld(env: Array<THREE.Group | null>) {
    const at = (i: number) => env[i] ?? null;
    for (const i of [0, 1, 2, 3, 6]) {
      const s = at(i);
      if (s) glowNeon(s);
    }
    // Facade corridor, longer than NEXUS' block so the far end sits ~120 m from the nest.
    const zRow = [-70, -62, -54, -46, -38, -30, -22, -14, -6, 2, 10, 18, 26, 34];
    for (const side of [-1, 1]) {
      for (let i = 0; i < zRow.length; i++) {
        if (side === 1 && zRow[i] === -6) continue; // side alley (courier's escape)
        const src = at((i + (side < 0 ? 0 : 2)) % 4);
        if (!src) continue;
        const x = side * (10.4 + rng() * 0.8);
        const z = zRow[i] + (rng() - 0.5) * 1.2;
        placeEnv(src, new THREE.Vector3(x, 0, z), 1.9 + rng() * 0.8, side < 0 ? Math.PI / 2 : -Math.PI / 2, true);
      }
    }
    for (const x of [-7, 0, 7]) {
      const src = at((Math.abs(x) + 1) % 4);
      if (src) placeEnv(src, new THREE.Vector3(x, 0, Z_FAR - 2), 2.7, 0, true);
    }
    const alleyWall = at(1);
    if (alleyWall) placeEnv(alleyWall, new THREE.Vector3(16.5, 0, -6), 2.4, -Math.PI / 2, true);
    const tower = at(8);
    if (tower) placeEnv(tower, new THREE.Vector3(4, 0, Z_FAR - 14), 2.6, 0, false, false);

    // Streetlights + light cones.
    const fadeTex = T(verticalFade());
    const coneGeo = G(new THREE.ConeGeometry(1.7, 3.6, 24, 1, true));
    coneGeo.translate(0, -1.8, 0);
    let li = 0;
    for (const side of [-1, 1]) {
      for (let z = -66; z <= 36; z += 9) {
        const src = at(li % 2 === 0 ? 4 : 5);
        li++;
        if (!src) continue;
        const x = side * (ROAD_HALF + 0.7);
        placeEnv(src, new THREE.Vector3(x, 0.12, z), 1.3, side < 0 ? 0 : Math.PI, false, false);
        const warm = (li + (side > 0 ? 1 : 0)) % 2 === 0;
        const color = warm ? 0xffb070 : 0x7fd8ff;
        const head = new THREE.Vector3(x * 0.92, 3.55, z);
        if (li % 2 === 0) {
          const light = new THREE.PointLight(color, warm ? 18 : 14, 14, 1.8);
          light.position.copy(head);
          scene.add(light);
        }
        const cone = new THREE.Mesh(
          coneGeo,
          M(new THREE.MeshBasicMaterial({ color, alphaMap: fadeTex, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
        );
        cone.position.copy(head);
        scene.add(cone);
        const glow = new THREE.Sprite(M(new THREE.SpriteMaterial({ map: dotTex, color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })));
        glow.position.copy(head);
        glow.scale.setScalar(0.9);
        scene.add(glow);
      }
    }
    const signSrc = at(6);
    if (signSrc) {
      for (const side of [-1, 1]) {
        for (const z of [-58, -40, -24, -9, 6, 21]) {
          placeEnv(signSrc, new THREE.Vector3(side * 8.7, 3 + rng() * 0.8, z), 0.95 + rng() * 0.3, side < 0 ? Math.PI / 2 : -Math.PI / 2, false);
        }
      }
    }
    for (const [x, z, c] of [
      [-4.5, -30, 0xff3fc8],
      [4.5, -52, 0x35f0ff],
      [-3, 8, 0x9a5cff],
    ] as Array<[number, number, number]>) {
      const l = new THREE.PointLight(c, 16, 12, 1.8);
      l.position.set(x, 3.2, z);
      scene.add(l);
    }

    // Street cover (crates, AC stacks, turrets, barriers) — also where hostiles hunker down.
    const cover: Array<[number, number, number, number, number]> = [
      [3.0, 16, 7, 2.3, 0.1],
      [-3.3, 10, 13, 1.25, 0],
      [2.7, 2.5, 7, 2.2, -0.15],
      [-3.0, -4, 9, 0.8, 0],
      [3.4, -12, 12, 1.6, 0],
      [-3.2, -18.5, 7, 2.3, 0.2],
      [1.2, -25, 13, 1.3, 0],
      [-2.6, -33, 7, 2.1, 0.3],
      [3.6, -39.5, 7, 2.1, 0],
      [-3.8, -47, 13, 1.3, 0],
      [2.2, -54, 7, 2.3, 0.1],
      [-1.5, -61, 12, 1.5, 0],
      [3.8, -66, 7, 2.0, 0],
    ];
    for (const [x, z, idx, s, r] of cover) {
      const src = at(idx);
      if (!src) continue;
      const box = placeEnv(src, new THREE.Vector3(x, 0, z), s, r, false);
      const b = box.clone();
      b.min.y = 0;
      staticBoxes.push(b);
      // hostile hide spot on the far (south) side of the cover, facing the nest
      coverSpots.push(new THREE.Vector3(x, 0, box.min.z - 0.55));
    }
    const railSrc = at(10);
    if (railSrc) for (const [x, z] of [[-5.6, -8], [5.6, 6], [-5.6, -40], [5.6, -28]]) placeEnv(railSrc, new THREE.Vector3(x, 0, z), 1.25, Math.PI / 2, false);

    buildPerch(at(13), at(11), at(6), at(9));
    buildSkyline();
  }


  /** Distant megablocks behind the facades so the boulevard sits inside a city, not on a plain. */
  const beacons: THREE.Sprite[] = [];
  function buildSkyline() {
    const W = 256;
    const H = 512;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#14161c";
    ctx.fillRect(0, 0, W, H);
    const em = document.createElement("canvas");
    em.width = W;
    em.height = H;
    const ex = em.getContext("2d")!;
    ex.fillStyle = "#000";
    ex.fillRect(0, 0, W, H);
    const cols = 16;
    const rows = 42;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * (W / cols) + 3;
        const y = r * (H / rows) + 3;
        const w = W / cols - 6;
        const h = H / rows - 5;
        ctx.fillStyle = "#1d2129";
        ctx.fillRect(x, y, w, h);
        if (rng() < 0.17) {
          const hue = rng();
          const col = hue < 0.7 ? `hsl(${32 + rng() * 14},70%,${58 + rng() * 18}%)` : hue < 0.92 ? `hsl(${195 + rng() * 15},55%,${60 + rng() * 15}%)` : `hsl(${305 + rng() * 25},70%,62%)`;
          ex.fillStyle = col;
          ex.globalAlpha = 0.35 + rng() * 0.5;
          ex.fillRect(x, y, w, h);
        }
      }
    }
    const map = T(new THREE.CanvasTexture(cv));
    map.colorSpace = THREE.SRGBColorSpace;
    const emap = T(new THREE.CanvasTexture(em));
    emap.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, emap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
    }
    const mat = M(new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.75, metalness: 0.3 }));
    const geos: THREE.BufferGeometry[] = [];
    const bm = M(new THREE.SpriteMaterial({ map: dotTex, color: 0xff2a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const side of [-1, 1]) {
      for (let z = -160; z < 80; z += 11 + rng() * 10) {
        for (let layer = 0; layer < 3; layer++) {
          const w = 9 + rng() * 14;
          const d = 9 + rng() * 14;
          const h = [16 + rng() * 22, 30 + rng() * 40, 55 + rng() * 60][layer];
          const x = side * ([32, 56, 84][layer] + rng() * 14);
          const g = new THREE.BoxGeometry(w, h, d);
          // UVs in world units so every tower shares one material
          const uv = g.getAttribute("uv") as THREE.BufferAttribute;
          const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) {
            const nx = Math.abs(nrm.getX(i));
            const ny = Math.abs(nrm.getY(i));
            const su = ny > 0.5 ? 0 : (nx > 0.5 ? d : w) / 22;
            const sv = ny > 0.5 ? 0 : h / 34;
            uv.setXY(i, uv.getX(i) * su + rng() * 0, uv.getY(i) * sv);
          }
          g.translate(x, h / 2, z + (rng() - 0.5) * 6);
          geos.push(g);
          if (h > 70 && rng() < 0.5) {
            const b = new THREE.Sprite(bm);
            b.position.set(x, h + 1, z);
            b.scale.setScalar(2.2);
            b.userData.ph = rng() * 6;
            scene.add(b);
            beacons.push(b);
          }
        }
      }
    }
    for (let x = -60; x <= 60; x += 14 + rng() * 8) {
      const w = 10 + rng() * 14;
      const h = 30 + rng() * 60;
      const g = new THREE.BoxGeometry(w, h, 14);
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 22, (uv.getY(i) * h) / 34);
      g.translate(x, h / 2, Z_FAR - 40 - rng() * 30);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) {
      G(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = false;
      scene.add(mesh);
    }
  }

  /** The nest: a steel deck 12 m up at the north end, parapet facing the boulevard. */
  function buildPerch(ac: THREE.Group | null, antenna: THREE.Group | null, signs: THREE.Group | null, truss: THREE.Group | null) {
    if (kitSet) {
      triplanar(perchMat, kitSet, { tile: 2.4, albedo: 0.85, chroma: 0.2, normal: 0.85, rough: [0.35, 0.9], metal: [0.4, 1], grime: 1 });
      triplanar(perchDark, kitSet, { tile: 1.6, albedo: 0.5, chroma: 0.1, normal: 0.7, rough: [0.4, 0.8], metal: [0.6, 1], grime: 0.4 });
    }
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = perchMat) => {
      const m = new THREE.Mesh(G(new THREE.BoxGeometry(w, h, d)), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const deckY = 11.6;
    box(16, 0.5, 10, 0, deckY - 0.25, 52);
    box(16, 1.05, 0.32, 0, deckY + 0.52, 46.6); // parapet
    box(16.2, 0.1, 0.5, 0, deckY + 1.08, 46.62, perchDark); // coping
    for (const sx of [-1, 1]) box(0.32, 1.05, 10, sx * 8, deckY + 0.52, 52);
    for (const [x, z] of [[-7, 47.5], [7, 47.5], [-7, 56], [7, 56], [0, 47.5]]) box(0.7, deckY - 0.5, 0.7, x, (deckY - 0.5) / 2, z, perchDark);
    for (const z of [47.5, 56]) {
      for (let y = 2; y < deckY - 1; y += 3) box(14, 0.18, 0.18, 0, y, z, perchDark);
    }
    // sandbag-ish rest + rifle mat
    box(1.4, 0.18, 0.5, 0.25, deckY + 1.16, 46.75, perchDark);
    scene.add(g);
    g.updateMatrixWorld(true);
    if (ac) placeEnv(ac, new THREE.Vector3(-5, deckY, 51), 1.4, 0.3, false);
    if (ac) placeEnv(ac, new THREE.Vector3(5.5, deckY, 53), 1.6, -0.4, false);
    if (antenna) placeEnv(antenna, new THREE.Vector3(6, deckY, 55), 3.5, 0, false);
    if (signs) placeEnv(signs, new THREE.Vector3(-3.2, deckY - 2.2, 46.2), 1.2, 0, false);
    if (truss) for (const x of [-10, 10]) placeEnv(truss, new THREE.Vector3(x, 0, 50), 3.2, 0, false);
    // warm work light on the deck
    const lamp = new THREE.PointLight(0xffb070, 6, 7, 2);
    lamp.position.set(-2.5, deckY + 1.6, 48.5);
    scene.add(lamp);
  }

  // ------------------------------------------------------------- units
  const units: Unit[] = [];
  let nextId = 1;
  const hitGeo = {
    head: G(new THREE.SphereGeometry(0.15, 8, 6)),
    torso: G(new THREE.BoxGeometry(0.5, 0.62, 0.34)),
    legs: G(new THREE.BoxGeometry(0.42, 0.86, 0.3)),
  };
  const laserGeo = G(new THREE.CylinderGeometry(0.008, 0.008, 1, 4, 1, true));
  laserGeo.rotateX(Math.PI / 2);
  laserGeo.translate(0, 0, 0.5);
  const umbGeo = {
    canopy: G(new THREE.ConeGeometry(0.62, 0.3, 14, 1, true)),
    rim: G(new THREE.TorusGeometry(0.6, 0.012, 4, 28)),
    shaft: G(new THREE.CylinderGeometry(0.008, 0.008, 0.95, 5)),
    caseBox: G(new THREE.BoxGeometry(0.44, 0.3, 0.1)),
    caseStrip: G(new THREE.BoxGeometry(0.44, 0.02, 0.105)),
  };
  umbGeo.rim.rotateX(Math.PI / 2);
  const UMB_RIMS = [0x35f0ff, 0xff3fc8, 0xffb547, 0x9a5cff, 0x7dffb0, 0xff6b74];
  const CIV_TINTS = [0x4a3c2f, 0x2f3a4a, 0x5a4636, 0x3d2c3a, 0x5c5f63, 0x22303a, 0x4b2f2a, 0x6b5a45];

  function findBone(model: THREE.Object3D, name: string) {
    return model.getObjectByName(`mixamorig${name}`) ?? model.getObjectByName(`mixamorig:${name}`) ?? null;
  }
  const rigRef = { hips: 1, chest: 1.3, head: 1.6 };
  function measureRig() {
    if (!soldierSrc) return;
    const body = new THREE.Group();
    const m = cloneSkeleton(soldierSrc);
    m.rotation.y = Math.PI;
    body.add(m);
    const mx = new THREE.AnimationMixer(m);
    const idle = clips.find((c) => c.name === "Idle");
    if (idle) mx.clipAction(idle).play();
    mx.update(0);
    body.updateMatrixWorld(true);
    const y = (n: string) => {
      const b = findBone(m, n);
      return b ? b.getWorldPosition(tmpV).y : 0;
    };
    rigRef.hips = y("Hips") || 1;
    rigRef.chest = y("Spine2") || 1.3;
    rigRef.head = y("Head") || 1.6;
    mx.stopAllAction();
    mx.uncacheRoot(m);
  }

  function spawnUnit(kind: UKind, at: THREE.Vector3, opts: { name?: string; yaw?: number; objective?: boolean; caseColor?: number; umbrella?: boolean } = {}): Unit | null {
    if (!soldierSrc) return null;
    const owned = { mats: [] as THREE.Material[], geos: [] as THREE.BufferGeometry[] };
    const root = new THREE.Group();
    root.position.copy(at);
    root.rotation.y = opts.yaw ?? 0;
    const body = new THREE.Group();
    root.add(body);
    const model = cloneSkeleton(soldierSrc);
    model.rotation.y = Math.PI;
    body.add(model);
    scene.add(root);
    const armed = kind === "hostile" || kind === "guard" || kind === "ally" || kind === "marksman";
    const civ = kind === "civilian" || kind === "courier" || kind === "decoy";
    const tint = new THREE.Color(
      kind === "ally" ? 0x67705f : kind === "marksman" ? 0x2c2834 : armed ? 0x2b2f36 : kind === "courier" ? 0x3b3530 : CIV_TINTS[Math.floor(fx() * CIV_TINTS.length)],
    );
    const visor =
      kind === "ally" ? 0x7dffb0 : kind === "marksman" ? 0xb36bff : armed ? 0xff2a3c : kind === "courier" ? 0xffb547 : [0xdfe8ee, 0x9fd8ff, 0xffd9a0, 0xc8b8ff][Math.floor(fx() * 4)];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const src = mesh.material as THREE.MeshStandardMaterial;
      const m = src.clone();
      owned.mats.push(m);
      if (/visor/i.test(mesh.name) || /visor/i.test(src.name)) {
        m.color.setHex(0x0a0d10);
        m.emissive = new THREE.Color(visor);
        m.emissiveIntensity = armed && kind !== "ally" ? 2.2 : civ ? 0.6 : 0.9;
        m.roughness = 0.2;
        m.metalness = 0.6;
      } else {
        m.color.lerp(tint, civ ? 0.85 : kind === "ally" ? 0.55 : 0.78);
        m.roughness = civ ? 0.75 : 0.62;
        m.metalness = civ ? 0.1 : 0.35;
        m.envMapIntensity = 0.9;
      }
      mesh.material = m;
    });
    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of clips) actions[clip.name] = mixer.clipAction(clip);
    const found = ["Spine1", "Neck", "RightArm", "RightForeArm", "RightHand", "LeftArm", "LeftForeArm", "LeftHand"].map((n) => findBone(model, n));
    const bones: Bones | null = found.every(Boolean)
      ? { spine: found[0]!, neck: found[1]!, rArm: found[2]!, rFore: found[3]!, rHand: found[4]!, lArm: found[5]!, lFore: found[6]!, lHand: found[7]! }
      : null;
    const rb = ["Hips", "Spine", "Spine2", "Head"].map((n) => findBone(model, n));
    const rig: Rig | null = rb.every(Boolean) ? { hips: rb[0]!, spine: rb[1]!, chest: rb[2]!, head: rb[3]! } : null;

    let pivot: THREE.Group | null = null;
    let rifle: Rifle | null = null;
    if (armed) {
      pivot = new THREE.Group();
      pivot.position.set(-0.13, 1.4, 0.05);
      body.add(pivot);
      rifle = buildRifle(rifleParts, visor, kind === "marksman" ? { optic: "acog", muzzle: "supp" } : {});
      owned.mats.push(rifle.accent);
      rifle.group.position.set(0, 0, 0.2);
      if (kind === "marksman") rifle.group.scale.set(1, 1, 1.35);
      pivot.add(rifle.group);
    }
    let umbrella: THREE.Group | null = null;
    if (civ && (opts.umbrella ?? kind === "civilian")) {
      umbrella = new THREE.Group();
      const rimC = UMB_RIMS[Math.floor(fx() * UMB_RIMS.length)];
      const cm = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.86, side: THREE.DoubleSide, emissive: rimC, emissiveIntensity: 0.06 });
      const rm = new THREE.MeshStandardMaterial({ color: rimC, emissive: rimC, emissiveIntensity: 2.4 });
      const sm = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.7, roughness: 0.4 });
      owned.mats.push(cm, rm, sm);
      const canopy = new THREE.Mesh(umbGeo.canopy, cm);
      canopy.position.y = 0.95;
      canopy.castShadow = true;
      const rim = new THREE.Mesh(umbGeo.rim, rm);
      rim.position.y = 0.8;
      const shaft = new THREE.Mesh(umbGeo.shaft, sm);
      shaft.position.y = 0.47;
      umbrella.add(canopy, rim, shaft);
      umbrella.position.set(0.16, 1.12, 0.2);
      umbrella.rotation.x = 0.12;
      body.add(umbrella);
    }
    let carry: THREE.Group | null = null;
    if (opts.caseColor !== undefined) {
      carry = new THREE.Group();
      const bm = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.6, roughness: 0.4 });
      const em = new THREE.MeshStandardMaterial({ color: opts.caseColor, emissive: opts.caseColor, emissiveIntensity: 2.6 });
      owned.mats.push(bm, em);
      const b = new THREE.Mesh(umbGeo.caseBox, bm);
      b.castShadow = true;
      const s1 = new THREE.Mesh(umbGeo.caseStrip, em);
      s1.position.y = 0.06;
      const s2 = new THREE.Mesh(umbGeo.caseStrip, em);
      s2.position.y = -0.06;
      carry.add(b, s1, s2);
      scene.add(carry);
    }
    const hitboxes: THREE.Mesh[] = [];
    for (const [geo, y, part] of [
      [hitGeo.head, 1.66, "head"],
      [hitGeo.torso, 1.2, "torso"],
      [hitGeo.legs, 0.45, "legs"],
    ] as Array<[THREE.BufferGeometry, number, string]>) {
      const h = new THREE.Mesh(geo, blockerMat);
      h.position.set(0, y, 0.02);
      h.userData.part = part;
      body.add(h);
      hitboxes.push(h);
    }
    let laser: THREE.Mesh | null = null;
    let laserMat: THREE.MeshBasicMaterial | null = null;
    if (armed && kind !== "ally") {
      laserMat = new THREE.MeshBasicMaterial({ color: kind === "marksman" ? 0xc28cff : 0xff2a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      owned.mats.push(laserMat);
      laser = new THREE.Mesh(laserGeo, laserMat);
      laser.visible = false;
      laser.frustumCulled = false;
      scene.add(laser);
    }
    let glint: THREE.Sprite | null = null;
    if (kind === "marksman" && rifle) {
      const gm = new THREE.SpriteMaterial({ map: flashT, color: 0xd2a6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false });
      owned.mats.push(gm);
      glint = new THREE.Sprite(gm);
      glint.position.set(0, 0.105, 0.2);
      glint.scale.setScalar(0.0001);
      rifle.group.add(glint);
    }
    const u: Unit = {
      id: nextId++,
      kind,
      name: opts.name ?? "",
      root,
      body,
      model,
      mixer,
      actions,
      current: "",
      rig,
      bones,
      pivot,
      rifle,
      umbrella,
      umbrellaProp: null,
      carry,
      hitboxes,
      owned,
      hp: 100,
      alive: true,
      deathClip: "",
      ragdoll: null,
      rifleProp: null,
      speed: 0,
      faceYaw: opts.yaw ?? 0,
      state: "idle",
      path: [],
      pathI: 0,
      loop: true,
      wait: 0,
      waitAt: 2,
      walkSpeed: civ ? 1.1 + fx() * 0.35 : 1.3,
      aimPoint: new THREE.Vector3(at.x, 1.3, at.z + 10),
      aiming: false,
      aimW: 0,
      shotCd: 1 + fx() * 1.5,
      burst: 0,
      alertT: 0,
      crouch: false,
      peekT: 0,
      target: null,
      laser,
      laserMat,
      glint,
      glintT: 0,
      objective: !!opts.objective,
      tagged: 0,
      tagEl: null,
      flinch: 0,
      lastX: at.x,
      lastZ: at.z,
      twist: 0,
      deadT: 0,
      stopT: 0,
      cover: null,
      stopIdx: 0,
    };
    for (const h of hitboxes) h.userData.unit = u;
    play(u, "Idle", 1);
    if (actions.Idle) actions.Idle.time = fx() * 3;
    units.push(u);
    return u;
  }

  function removeUnit(u: Unit) {
    if (u.ragdoll && phys) phys.freeze(u.ragdoll);
    if (u.rifleProp && phys) phys.removeProp(u.rifleProp);
    if (u.umbrellaProp && phys) phys.removeProp(u.umbrellaProp);
    u.ragdoll = u.rifleProp = u.umbrellaProp = null;
    for (const o of [u.rifle?.group, u.umbrella, u.carry, u.laser]) if (o?.parent) o.parent.remove(o);
    u.mixer.stopAllAction();
    u.mixer.uncacheRoot(u.model);
    scene.remove(u.root);
    for (const m of u.owned.mats) m.dispose();
    u.tagEl?.remove();
    const i = units.indexOf(u);
    if (i >= 0) units.splice(i, 1);
  }

  function play(u: Unit, name: string, ts: number, fade = 0.25) {
    const next = u.actions[name];
    if (!next || u.deathClip) return;
    next.timeScale = ts;
    if (u.current === name) return;
    const prev = u.actions[u.current];
    next.reset();
    next.enabled = true;
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.setEffectiveWeight(1);
    next.play();
    if (prev) next.crossFadeFrom(prev, fade, false);
    u.current = name;
  }
  function playOnce(u: Unit, name: string, fade = 0.1, ts = 1) {
    const next = u.actions[name];
    if (!next) return 0;
    const prev = u.actions[u.current];
    next.reset();
    next.enabled = true;
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.timeScale = ts;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false);
    u.current = name;
    return next.getClip().duration / ts;
  }
  function animate(u: Unit) {
    if (u.deathClip) return;
    const sp = u.speed;
    if (u.crouch && u.actions.crouch_idle) play(u, sp < 0.25 ? "crouch_idle" : "crouch_walk", sp < 0.25 ? 1 : Math.max(0.7, Math.min(1.6, sp / 1.3)));
    else if (sp < 0.25) play(u, "Idle", 1);
    else if (sp > 2.4) play(u, "Run", Math.max(0.7, Math.min(1.35, sp / 4.6)));
    else play(u, "Walk", Math.max(0.7, Math.min(1.6, sp / 1.4)));
  }

  // Post-mixer: hitboxes + rifle pivot follow the animated skeleton.
  const rigP = new THREE.Vector3();
  function syncRig(u: Unit, dt: number) {
    const rig = u.rig;
    if (!rig) return;
    u.body.updateMatrixWorld(true);
    const local = (b: THREE.Object3D) => u.body.worldToLocal(b.getWorldPosition(rigP));
    const head = local(rig.head);
    const hx = head.x;
    const hy = head.y;
    const hz = head.z;
    const chestY = local(rig.chest).y;
    const hipsY = local(rig.hips).y;
    for (const h of u.hitboxes) {
      const part = h.userData.part;
      if (part === "head") h.position.set(hx * 0.8, hy + 0.12, hz * 0.8 + 0.02);
      else if (part === "torso") h.position.set(hx * 0.4, 1.2 + (chestY - rigRef.chest), hz * 0.4 + 0.02);
      else if (part === "legs") {
        h.position.y = 0.45 * (hipsY / rigRef.hips);
        h.scale.y = Math.max(0.55, hipsY / rigRef.hips);
      }
    }
    if (u.pivot && u.alive && !u.deathClip) {
      const target = 1.4 + (chestY - rigRef.chest) * 0.9;
      u.pivot.position.y += (target - u.pivot.position.y) * Math.min(1, dt * 18);
    }
  }

  const lowReady = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.62, 0.55, 0.1, "YXZ"));
  const aimQ = new THREE.Quaternion();
  const poleR = new THREE.Vector3();
  const poleL = new THREE.Vector3();
  const handR = new THREE.Vector3();
  const handL = new THREE.Vector3();
  const pivotWorld = new THREE.Vector3();
  const invBodyQ = new THREE.Quaternion();
  const lookM = new THREE.Matrix4();
  const aimTmp = new THREE.Vector3();
  const umbHandle = new THREE.Vector3();
  function upperBody(u: Unit, dt: number) {
    if (!u.bones || u.deathClip) return;
    const b = u.bones;
    if (u.pivot && u.rifle) {
      u.aimW += ((u.aiming ? 1 : 0) - u.aimW) * Math.min(1, dt * 8);
      u.body.updateMatrixWorld(true);
      u.pivot.getWorldPosition(pivotWorld);
      aimTmp.copy(u.aimPoint);
      if (aimTmp.distanceTo(pivotWorld) < 2.5) aimTmp.sub(pivotWorld).setLength(2.5).add(pivotWorld);
      lookM.lookAt(aimTmp, pivotWorld, UP);
      aimQ.setFromRotationMatrix(lookM);
      u.body.getWorldQuaternion(invBodyQ).invert();
      aimQ.premultiply(invBodyQ);
      u.pivot.quaternion.slerpQuaternions(lowReady, aimQ, u.aimW);
      u.pivot.updateMatrixWorld(true);
      rotateBoneWorld(b.spine, UP, -0.42 * u.aimW);
      rotateBoneWorld(b.neck, UP, 0.34 * u.aimW);
      u.rifle.rightHand.getWorldPosition(handR);
      u.rifle.leftHand.getWorldPosition(handL);
      poleR.set(-0.6, 0.8, -0.25);
      u.body.localToWorld(poleR);
      poleL.set(0.25, 0.7, 0.35);
      u.body.localToWorld(poleL);
      solveArm(b.rArm, b.rFore, b.rHand, handR, poleR);
      solveArm(b.lArm, b.lFore, b.lHand, handL, poleL);
    } else if (u.umbrella && u.umbrella.parent === u.body) {
      // right hand grips the shaft just above the bottom
      u.umbrella.rotation.z = -wind * 0.035 + Math.sin(menuTime * 1.7 + u.id) * 0.03;
      u.umbrella.updateMatrixWorld(true);
      umbHandle.set(0, 0.06, 0).applyMatrix4(u.umbrella.matrixWorld);
      poleR.set(-0.7, 0.3, -0.2);
      u.body.localToWorld(poleR);
      solveArm(b.rArm, b.rFore, b.rHand, umbHandle, poleR);
    }
    if (u.carry && u.carry.parent === scene) {
      // case hangs from the left hand
      b.lHand.getWorldPosition(u.carry.position);
      u.carry.position.y -= 0.2;
      u.carry.rotation.set(0, u.root.rotation.y, 0);
    }
  }

  function startDeath(u: Unit, part: string, dir: THREE.Vector3, force: number) {
    u.alive = false;
    u.deadT = 0;
    u.aiming = false;
    if (u.laser) u.laser.visible = false;
    if (u.glint) u.glint.visible = false;
    if (u.tagEl) u.tagEl.style.display = "none";
    dropUmbrella(u);
    if (u.carry && u.carry.parent === scene && phys) {
      const c = u.carry;
      phys.prop(c, new THREE.Vector3(0.22, 0.15, 0.05), { linvel: tmpV.copy(dir).multiplyScalar(2).setY(1.5), angvel: new THREE.Vector3(fx() * 4, fx() * 4, fx() * 4), life: 600, density: 600 });
    }
    if (phys && u.rig) {
      u.mixer.update(0);
      const rd = phys.ragdoll(u.model, (n) => findBone(u.model, n), tmpV2.set(u.speed * Math.sin(u.root.rotation.y), 0, u.speed * Math.cos(u.root.rotation.y)), 1);
      if (rd) {
        u.mixer.stopAllAction();
        u.ragdoll = rd;
        u.deathClip = "ragdoll";
        const hb = u.hitboxes.find((h) => h.userData.part === part) ?? u.hitboxes[1];
        hb.getWorldPosition(tmpV3);
        tmpV.copy(dir).setY(0).normalize().multiplyScalar(force).setY(force * 0.12);
        phys.impulseAt(rd, tmpV3, tmpV);
        dropRifle(u, tmpV.multiplyScalar(0.02));
        return;
      }
    }
    const pick = part === "head" ? "death_c" : fx() < 0.5 ? "death_a" : "death_b";
    if (u.actions[pick]) {
      playOnce(u, pick, 0.1, pick === "death_c" ? 1.35 : 1);
      u.deathClip = pick;
    } else u.deathClip = "none";
    dropRifle(u);
  }

  const rifleBox = { half: new THREE.Vector3(0.05, 0.08, 0.45), center: new THREE.Vector3(0, 0, 0.2) };
  function dropRifle(u: Unit, push?: THREE.Vector3) {
    if (!phys || !u.rifle || u.rifleProp) return;
    const v = new THREE.Vector3((fx() - 0.5) * 1.2, 0.8 + fx(), (fx() - 0.5) * 1.2);
    if (push) v.add(push);
    u.rifleProp = phys.prop(u.rifle.group, rifleBox.half, {
      linvel: v,
      angvel: new THREE.Vector3((fx() - 0.5) * 6, (fx() - 0.5) * 4, (fx() - 0.5) * 6),
      life: 600,
      density: 700,
      center: rifleBox.center,
      restitution: 0.2,
    });
  }
  function dropUmbrella(u: Unit) {
    if (!u.umbrella || u.umbrella.parent !== u.body) return;
    if (!phys) {
      u.umbrella.visible = false;
      return;
    }
    u.umbrellaProp = phys.prop(u.umbrella, new THREE.Vector3(0.45, 0.2, 0.45), {
      linvel: new THREE.Vector3(wind * 0.8 + (fx() - 0.5), 1.5 + fx(), (fx() - 0.5) * 2),
      angvel: new THREE.Vector3((fx() - 0.5) * 5, (fx() - 0.5) * 6, (fx() - 0.5) * 5),
      life: 600,
      density: 60,
      center: new THREE.Vector3(0, 0.8, 0),
      damping: [0.9, 1.2],
    });
  }

  // ------------------------------------------------------- player rifle (view model)
  const vm = new THREE.Group();
  {
    const metal = M(new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.34, metalness: 0.85 }));
    const poly = M(new THREE.MeshStandardMaterial({ color: 0x2c2f2a, roughness: 0.82, metalness: 0.05 }));
    const accent = M(new THREE.MeshStandardMaterial({ color: 0x6ff2e3, emissive: 0x6ff2e3, emissiveIntensity: 1.2 }));
    const glass = M(new THREE.MeshStandardMaterial({ color: 0x0a1a24, roughness: 0.05, metalness: 0.9, emissive: 0x0d3b4a, emissiveIntensity: 0.4 }));
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const m = new THREE.Mesh(G(geo), mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      vm.add(m);
      return m;
    };
    const cyl = (r: number, len: number, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
    add(new THREE.BoxGeometry(0.06, 0.07, 0.34), metal, 0, 0, 0.02);
    add(cyl(0.013, 0.78), metal, 0, 0.008, -0.53);
    add(cyl(0.02, 0.09, 10), metal, 0, 0.008, -0.95);
    add(new THREE.BoxGeometry(0.07, 0.075, 0.42), poly, 0, -0.012, -0.22);
    add(new THREE.BoxGeometry(0.055, 0.11, 0.3), poly, 0, -0.03, 0.33);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.16), poly, 0, 0.035, 0.3);
    add(new THREE.BoxGeometry(0.036, 0.1, 0.045), poly, 0, -0.075, 0.12, -0.35);
    add(new THREE.BoxGeometry(0.035, 0.09, 0.07), metal, 0, -0.07, -0.02, 0.15);
    add(cyl(0.022, 0.36), metal, 0, 0.085, -0.02);
    add(cyl(0.031, 0.08), metal, 0, 0.085, -0.22);
    add(cyl(0.027, 0.06), metal, 0, 0.085, 0.17);
    add(cyl(0.025, 0.004), glass, 0, 0.085, -0.262);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), metal, 0, 0.115, -0.02);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10).rotateZ(Math.PI / 2), metal, 0.035, 0.085, -0.02);
    add(new THREE.BoxGeometry(0.008, 0.008, 0.24), accent, 0.036, -0.005, -0.25);
    add(cyl(0.006, 0.07, 6).rotateY(Math.PI / 2), metal, 0.05, 0.02, 0.1);
    add(new THREE.SphereGeometry(0.012, 8, 6), metal, 0.088, 0.02, 0.1);
    for (const s of [-1, 1]) {
      const leg = add(new THREE.BoxGeometry(0.012, 0.012, 0.2), metal, s * 0.022, -0.04, -0.52);
      leg.rotation.x = 0.06;
    }
    vm.traverse((o) => {
      (o as THREE.Mesh).castShadow = false;
      o.frustumCulled = false;
    });
    vm.scale.setScalar(0.72);
    vm.position.set(0.2, -0.2, -0.42);
    camera.add(vm);
  }
  const vmBase = new THREE.Vector3(0.2, -0.2, -0.42);
  const vmScoped = new THREE.Vector3(0, -0.062, -0.2);

  // ------------------------------------------------------------- ballistics
  const bullets: Bullet[] = [];
  const bulletGeo = G(new THREE.CylinderGeometry(0.0045, 0.0045, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5));
  const slugMat = M(new THREE.MeshStandardMaterial({ color: 0xd8a24a, metalness: 0.95, roughness: 0.22, emissive: 0x3a2205, emissiveIntensity: 0.5 }));
  const slug = new THREE.Group();
  {
    const b = new THREE.Mesh(G(new THREE.CylinderGeometry(0.0039, 0.0039, 0.022, 14).rotateX(Math.PI / 2)), slugMat);
    const tip = new THREE.Mesh(G(new THREE.ConeGeometry(0.0039, 0.014, 14).rotateX(-Math.PI / 2)), slugMat);
    tip.position.z = -0.018;
    slug.add(b, tip);
    slug.scale.setScalar(3);
    slug.visible = false;
    scene.add(slug);
  }
  const shockMat = M(new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const shock = new THREE.Mesh(G(new THREE.ConeGeometry(0.03, 0.34, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.15)), shockMat);
  shock.visible = false;
  scene.add(shock);

  const windVec = () => tmpV3.set(wind * WIND_K, -GRAV, 0);
  const segRay = new THREE.Raycaster();
  const segDir = new THREE.Vector3();
  const hitTmp = new THREE.Box3();
  type Hit = { point: THREE.Vector3; dist: number; unit: Unit | null; part: string; normal: THREE.Vector3 | null; ground: boolean };

  /** First thing a segment hits: units' hitboxes, env meshes, then the street surface. */
  function castSegment(a: THREE.Vector3, b: THREE.Vector3, ignore: Set<Unit> | null): Hit | null {
    segDir.subVectors(b, a);
    const len = segDir.length();
    if (len < 1e-6) return null;
    segDir.divideScalar(len);
    segRay.set(a, segDir);
    segRay.far = len;
    let best: Hit | null = null;
    const boxes: THREE.Object3D[] = [];
    for (const u of units) {
      if (!u.alive || ignore?.has(u)) continue;
      // cheap reject
      tmpV2.copy(u.root.position).setY(1);
      const d2 = distToSegSq(tmpV2, a, segDir, len);
      if (d2 > 2.2 * 2.2) continue;
      for (const h of u.hitboxes) boxes.push(h);
    }
    if (boxes.length) {
      const hs = segRay.intersectObjects(boxes, false);
      if (hs.length) {
        const h = hs[0];
        best = { point: h.point.clone(), dist: h.distance, unit: h.object.userData.unit as Unit, part: h.object.userData.part, normal: null, ground: false };
      }
    }
    for (const s of shootables) {
      hitTmp.copy(s.box).expandByScalar(0.05);
      if (!segRay.ray.intersectsBox(hitTmp)) continue;
      const hs = segRay.intersectObject(s.obj, true);
      for (const h of hs) {
        const mat = (h.object as THREE.Mesh).material as THREE.Material;
        if (mat && (mat as THREE.MeshBasicMaterial).visible === false) continue;
        if (!best || h.distance < best.dist) {
          const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
          best = { point: h.point.clone(), dist: h.distance, unit: null, part: "", normal: n, ground: false };
        }
        break;
      }
    }
    // street surface
    if (segDir.y < 0) {
      const gy = (x: number) => (Math.abs(x) > ROAD_HALF + 0.1 ? 0.12 : 0);
      const t = (gy(a.x + segDir.x * len) - a.y) / segDir.y;
      if (t >= 0 && t <= len && (!best || t < best.dist)) {
        best = { point: a.clone().addScaledVector(segDir, t), dist: t, unit: null, part: "", normal: UP.clone(), ground: true };
      }
    }
    return best;
  }
  function distToSegSq(p: THREE.Vector3, a: THREE.Vector3, dir: THREE.Vector3, len: number) {
    const t = THREE.MathUtils.clamp(tmpV.subVectors(p, a).dot(dir), 0, len);
    return tmpV.copy(a).addScaledVector(dir, t).distanceToSquared(p);
  }

  /** Launch velocity for the current aim (camera forward + zero elevation). */
  const camFwd = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  function launchVel(out: THREE.Vector3) {
    camera.getWorldDirection(camFwd);
    camRight.crossVectors(camFwd, UP).normalize();
    const lift = (0.5 * GRAV * ZERO) / (V0 * V0);
    return out.copy(camFwd).applyAxisAngle(camRight, lift).multiplyScalar(V0);
  }

  /** Dry-run the trajectory against the current poses (bullet-cam decision + rangefinder). */
  const simP = new THREE.Vector3();
  const simV = new THREE.Vector3();
  const simN = new THREE.Vector3();
  function predict(from: THREE.Vector3, vel: THREE.Vector3): Hit | null {
    simP.copy(from);
    simV.copy(vel);
    const acc = windVec();
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 1.2; i++) {
      simN.copy(simP).addScaledVector(simV, dt).addScaledVector(acc, 0.5 * dt * dt);
      simV.addScaledVector(acc, dt);
      const h = castSegment(simP, simN, null);
      if (h) return h;
      simP.copy(simN);
      if (simP.y < -1 || simP.z < Z_FAR - 30) break;
    }
    return null;
  }

  // bullet cam
  let cam: { b: Bullet; phase: "fly" | "impact"; t: number; victim: Unit | null; orbit: number; k: number } | null = null;

  function fire() {
    if (stage !== "playing" || cam) return;
    if (boltT > 0 || reloadT > 0) return;
    if (mag <= 0) {
      audio.dry();
      if (reserve > 0) startReload();
      return;
    }
    if (ducked) {
      setDuck(false);
      return;
    }
    mag--;
    shots++;
    audio.ensure();
    audio.marksman();
    recoil = 1;
    boltT = BOLT_TIME;
    swayAmp = Math.min(2.4, swayAmp + 0.6);
    const from = camera.getWorldPosition(new THREE.Vector3());
    const vel = launchVel(new THREE.Vector3());
    // muzzle flash + smoke at the real muzzle (seen when unscoped)
    const muzzle = vm.localToWorld(new THREE.Vector3(0, 0.008, -1.0));
    spawnFlash(muzzle, 0.5, 0.05);
    spawnPuff(muzzle, 0x9aa0a8, 1.3, 1.4, 0.35);
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xd9ecff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const trail = new THREE.Mesh(bulletGeo, trailMat);
    trail.frustumCulled = false;
    scene.add(trail);
    const b: Bullet = { pos: from.clone(), vel, t: 0, alive: true, cam: false, hits: 0, kills: [], from, trail, trailMat, pen: 1, ignore: new Set(), dist: 0 };
    bullets.push(b);
    // detection: the crack carries down the street
    raiseDetection(10, null);
    // bullet cam for decisive shots
    const p = predict(from, vel);
    if (p?.unit && p.unit.alive && (p.unit.kind !== "civilian" && p.unit.kind !== "decoy")) {
      const d = from.distanceTo(p.point);
      const lastObjective = isLastObjective(p.unit);
      const lethal = p.part !== "legs" || p.unit.hp <= 60;
      if (lethal && (lastObjective || (p.part === "head" && d > 62 && fx() < 0.45))) startCam(b, lastObjective);
    }
    if (hintStep === 2) hintStep = 3;
  }

  function startCam(b: Bullet, decisive: boolean) {
    b.cam = true;
    cam = { b, phase: "fly", t: 0, victim: null, orbit: fx() < 0.5 ? 1 : -1, k: 0.12 };
    hud.root.classList.add("bulletcam");
    hud.bcTitle.textContent = decisive ? "CONTRACT SHOT" : "LONG SHOT";
    hud.bcSub.textContent = "";
    slug.visible = true;
    shock.visible = true;
    audio.slowmo();
    audio.musicDuck(true);
  }
  function endCam() {
    if (!cam) return;
    cam = null;
    timeScale = 1;
    slug.visible = false;
    shock.visible = false;
    hud.root.classList.remove("bulletcam");
    audio.musicDuck(false);
    if (camera.fov !== targetFov()) {
      camera.fov = targetFov();
      camera.updateProjectionMatrix();
    }
  }

  function stepBullets(dt: number) {
    const acc = windVec();
    for (const b of bullets) {
      if (!b.alive) continue;
      let left = dt;
      while (left > 0 && b.alive) {
        const h = Math.min(left, 1 / 240);
        left -= h;
        const next = tmpV.copy(b.pos).addScaledVector(b.vel, h).addScaledVector(acc, 0.5 * h * h);
        const n = next.clone();
        const hit = castSegment(b.pos, n, b.ignore);
        b.vel.addScaledVector(acc, h);
        b.t += h;
        if (hit) {
          b.dist = b.from.distanceTo(hit.point);
          onBulletHit(b, hit);
          if (b.alive) {
            b.pos.copy(hit.point).addScaledVector(b.vel.clone().normalize(), 0.02);
          }
        } else b.pos.copy(n);
        if (b.t > 2 || b.pos.y < -2) b.alive = false;
      }
      // vapor trail: thin streak behind the round (what a spotter sees through the glass)
      const sp = b.vel.length();
      const len = Math.min(sp * 0.03, b.pos.distanceTo(b.from));
      b.trail.position.copy(b.pos);
      b.trail.lookAt(tmpV2.copy(b.pos).add(b.vel));
      const w = b.cam && cam?.phase === "fly" ? 0.35 : scoped ? 2.2 : 1.2;
      b.trail.scale.set(w, w, Math.max(0.01, b.cam && cam ? Math.min(len, 6) : len));
      b.trailMat.opacity = b.alive ? (b.cam && cam ? 0.18 : 0.55) : 0;
      if (!b.alive) {
        scene.remove(b.trail);
        b.trailMat.dispose();
      }
    }
    for (let i = bullets.length - 1; i >= 0; i--) if (!bullets[i].alive) bullets.splice(i, 1);
  }

  function onBulletHit(b: Bullet, h: Hit) {
    const d = b.dist;
    if (h.unit) {
      const u = h.unit;
      hitUnit(u, h.part, b, h.point);
      b.ignore.add(u);
      // a full-power round can punch through one body (collateral)
      if (b.pen > 0 && h.part !== "head") {
        b.pen--;
        b.vel.multiplyScalar(0.72);
      } else b.alive = false;
      if (b.cam && cam && !u.alive) {
        cam.phase = "impact";
        cam.t = 0;
        cam.victim = u;
        hud.bcSub.textContent = `${Math.round(d)} M · ${h.part === "head" ? "HEADSHOT" : h.part.toUpperCase()}`;
      }
      return;
    }
    b.alive = false;
    const n = h.normal ?? UP;
    spawnSparks(h.point, 0xffd9a0, 0.7, n);
    spawnPuff(h.point, h.ground ? 0x6f7680 : 0x8a8f96, h.ground ? 0.9 : 0.7, 0.9, 0.45);
    if (h.ground) spawnPuff(tmpV.copy(h.point).setY(h.point.y + 0.15), 0x9fb3c4, 0.5, 0.5, 0.5); // splash
    audio.impact(camera.position.distanceTo(h.point) * 0.25, 0);
    // near-miss: anyone close hears the impact
    for (const u of units) {
      if (!u.alive) continue;
      const dd = u.root.position.distanceTo(h.point);
      if (dd < 7) startle(u, h.point, dd < 3.5 ? 1 : 0.6);
    }
    if (b.cam && cam) {
      cam.phase = "impact";
      cam.t = 0.6;
      cam.victim = null;
      hud.bcTitle.textContent = "MISS";
      hud.bcSub.textContent = `${Math.round(d)} M`;
    }
  }

  // ------------------------------------------------------------- scope
  function targetFov() {
    if (cam) return camera.fov;
    return scoped ? BASE_FOV / zoom : BASE_FOV;
  }
  let retKey = "";
  function updateReticle() {
    const key = `${viewW}x${viewH}:${zoom.toFixed(2)}`;
    if (key === retKey) return;
    retKey = key;
    const r = Math.min(viewW, viewH) * 0.46;
    hud.scope.style.setProperty("--sr", `${r}px`);
    const cx = viewW / 2;
    const cy = viewH / 2;
    const fov = THREE.MathUtils.degToRad(BASE_FOV / zoom);
    const pxPerRad = viewH / 2 / Math.tan(fov / 2);
    const mil = pxPerRad * 0.001;
    const parts: string[] = [];
    const ln = (x1: number, y1: number, x2: number, y2: number, w = 1, c = "#0b0d0e") =>
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`);
    // heavy posts + fine crosshair
    ln(cx - r, cy, cx - r * 0.18, cy, 4);
    ln(cx + r * 0.18, cy, cx + r, cy, 4);
    ln(cx, cy + r * 0.18, cx, cy + r, 4);
    ln(cx, cy - r, cx, cy - r * 0.18, 4);
    ln(cx - r * 0.18, cy, cx + r * 0.18, cy, 1.2);
    ln(cx, cy - r * 0.18, cx, cy + r * 0.18, 1.2);
    // windage mil ticks
    for (let i = 1; i <= 10; i++) {
      const x = i * mil;
      if (x > r * 0.17) break;
      const h = i % 5 === 0 ? 7 : 4;
      ln(cx + x, cy - h, cx + x, cy + h, 1);
      ln(cx - x, cy - h, cx - x, cy + h, 1);
    }
    // holdover marks for range
    for (const d of [60, 80, 100, 120]) {
      const y = Math.tan(dropAt(d) / d) * pxPerRad;
      if (y > r * 0.9 || y < 3) continue;
      const w = 10 + (d / 20) * 2;
      ln(cx - w, cy + y, cx + w, cy + y, 1.2);
      parts.push(`<text x="${cx + w + 5}" y="${cy + y + 3.5}" fill="#0b0d0e" font-size="9" font-family="ui-monospace,monospace">${d}</text>`);
    }
    parts.push(`<circle cx="${cx}" cy="${cy}" r="1.6" fill="#ff3b48"/>`);
    hud.ret.innerHTML = parts.join("");
    hud.zoomLbl.textContent = `×${zoom.toFixed(zoom < 10 ? 1 : 0)}`;
    hud.tZoom.textContent = `×${Math.round(zoom)}`;
  }

  function setScope(on: boolean) {
    if (stage !== "playing" || cam) return;
    if (on && (ducked || reloadT > 0)) {
      if (ducked) setDuck(false);
      if (reloadT > 0) return;
    }
    if (scoped === on) return;
    scoped = on;
    audio.scope(on);
    hud.root.classList.toggle("scoped", on);
    hud.tScope.classList.toggle("on", on);
    if (!on && breathHeld) setBreath(false);
    if (on && hintStep === 0) hintStep = 1;
  }
  /** Next preset step (Z key / touch button), wrapping back to the lowest. */
  function cycleZoom() {
    const next = ZOOMS.find((z) => z > zoom + 0.25) ?? ZOOMS[0];
    zoom = next;
    audio.zoom();
    if (hintStep === 1) hintStep = 2;
  }
  /** Multiplicative zoom from wheel / trackpad scroll / pinch deltas (pixels). */
  function nudgeZoom(delta: number) {
    const before = zoom;
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(-delta * 0.0022), ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(zoom - before) < 1e-4) return;
    zoomTick += Math.abs(Math.log(zoom / before));
    if (zoomTick > 0.18) {
      zoomTick = 0;
      audio.zoom();
    }
    if (hintStep === 1) hintStep = 2;
  }
  function setBreath(on: boolean) {
    if (on && (!scoped || breathOut > 0 || breath < 0.05)) return;
    if (breathHeld === on) return;
    breathHeld = on;
    audio.breath(on);
    hud.tBreath.classList.toggle("on", on);
  }
  function setDuck(on: boolean) {
    if (stage !== "playing" || cam) return;
    if (ducked === on) return;
    ducked = on;
    if (on) setScope(false);
    hud.tDuck.classList.toggle("on", on);
    hud.root.classList.toggle("ducked", on);
  }
  function startReload() {
    if (reloadT > 0 || mag >= MAG || reserve <= 0) return;
    setScope(false);
    reloadT = RELOAD_TIME;
    audio.reloadOut();
  }

  // ------------------------------------------------------------- damage
  type Delayed = { t: number; fn: () => void };
  const delayed: Delayed[] = [];
  const later = (t: number, fn: () => void) => delayed.push({ t, fn });
  const isHostile = (u: Unit) => u.kind === "hostile" || u.kind === "guard" || u.kind === "marksman";
  const isCiv = (u: Unit) => u.kind === "civilian" || u.kind === "decoy";

  function hitUnit(u: Unit, part: string, b: Bullet, point: THREE.Vector3) {
    if (!u.alive) return;
    const d = b.from.distanceTo(point);
    const dmg = part === "head" ? 999 : part === "torso" ? 120 : 55;
    u.hp -= dmg;
    u.flinch = 1;
    hitsN++;
    spawnPuff(point, 0x5a0a10, 0.35, 0.6, 0.55);
    later(d / 343, () => audio.thwack(d));
    const dir = b.vel.clone().normalize();
    if (u.hp > 0) {
      showHit(false, false);
      if (u.actions.hit_chest && !u.deathClip) {
        const a = u.actions.hit_chest;
        a.reset();
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.setEffectiveWeight(0.85);
        a.play();
      }
      if (isCiv(u)) civilianHit(u, false);
      startle(u, b.from, 1);
      if (isHostile(u)) raiseDetection(25, null);
      return;
    }
    startDeath(u, part, dir, part === "head" ? 42 : 85);
    b.kills.push(u);
    if (isCiv(u)) {
      civilianHit(u, true);
      return;
    }
    if (u.kind === "ally") return;
    kills++;
    const head = part === "head";
    if (head) headshots++;
    longest = Math.max(longest, d);
    let pts = 100 + Math.round(d * 2);
    const tags: string[] = [];
    if (head) {
      pts += 100;
      tags.push("HEADSHOT");
    }
    if (u.speed > 1.6) {
      pts += 75;
      tags.push("MOVING");
    }
    if (d >= 85) {
      pts += 150;
      medal("longshot", "LONG SHOT", `${Math.round(d)} M`);
    }
    if (b.kills.filter((k) => !isCiv(k)).length === 2) {
      pts += 300;
      medal("collateral", "COLLATERAL", "ONE ROUND · TWO TARGETS");
    }
    if (elapsed - lastKillT < 3.2) {
      pts += 100;
      tags.push("QUICK");
    }
    if (u.kind === "courier") {
      pts += 600;
      tags.push("COURIER");
    }
    lastKillT = elapsed;
    if (!compromised && u.state !== "engage" && u.state !== "alert") tags.push("UNAWARE");
    addScore(pts);
    showHit(head, true);
    popup(`+${pts}`, head);
    feed(`${u.kind === "courier" ? "COURIER" : u.kind === "marksman" ? "MARKSMAN" : "HOSTILE"} · <u>${Math.round(d)}M</u>${tags.length ? " · " + tags.join(" · ") : ""}`, head ? "hs" : "");
    later(0.05, () => (head ? audio.headshot() : audio.kill()));
    // witnesses
    for (const w of units) {
      if (!w.alive || w === u) continue;
      const dd = w.root.position.distanceTo(u.root.position);
      if (dd < (isHostile(w) ? 12 : 10)) startle(w, u.root.position, 1);
    }
  }

  function civilianHit(u: Unit, killed: boolean) {
    civHits++;
    addScore(-500);
    feed(`CIVILIAN ${killed ? "KILLED" : "WOUNDED"} · <em>−500</em>`, "bad");
    audio.alarm();
    raiseDetection(30, null);
    for (const w of units) if (w.alive && w !== u && w.root.position.distanceTo(u.root.position) < 14) startle(w, u.root.position, 1);
    if (C.id === "courier" && civHits >= 3) endContract(false, "CIVILIAN CASUALTIES — CONTRACT VOID");
  }

  function startle(u: Unit, at: THREE.Vector3, k: number) {
    if (!u.alive) return;
    if (isCiv(u)) {
      if (u.state === "panic") return;
      u.state = "panic";
      u.walkSpeed = 3.8 + fx() * 0.8;
      const away = Math.sign(u.root.position.z - at.z) || 1;
      u.path = [new THREE.Vector3(u.root.position.x, 0, away > 0 ? Z_NEAR - 4 : Z_FAR + 4)];
      u.pathI = 0;
      u.loop = false;
      if (fx() < 0.45) dropUmbrella(u);
      return;
    }
    if (u.kind === "courier") {
      if (u.state !== "flee") {
        u.state = "flee";
        u.walkSpeed = 3.9;
        u.path = [new THREE.Vector3(8.2, 0, -2), new THREE.Vector3(12.5, 0, -2), new THREE.Vector3(16, 0, -2)];
        u.pathI = 0;
        u.loop = false;
        feed("THE COURIER IS <em>RUNNING</em>", "bad");
      }
      return;
    }
    if (isHostile(u) && u.state !== "engage" && u.state !== "alert") {
      u.state = "alert";
      u.alertT = 2.2 + fx() * 2;
      u.aiming = false;
      u.cover = nearestCover(u.root.position);
      raiseDetection(18 * k, null);
    }
  }

  function nearestCover(p: THREE.Vector3) {
    let best: THREE.Vector3 | null = null;
    let bd = 14 * 14;
    for (const c of coverSpots) {
      const d = c.distanceToSquared(p);
      if (d < bd && !units.some((u) => u.alive && u.cover === c)) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  function raiseDetection(n: number, _at: THREE.Vector3 | null) {
    if (stage !== "playing" || compromised || C.id === "overwatch") return;
    detection = Math.min(100, detection + n);
    if (detection >= 100) compromise();
  }
  function compromise() {
    if (compromised) return;
    compromised = true;
    compromisedEver = true;
    detection = 100;
    audio.alarm();
    banner("POSITION COMPROMISED", "HOSTILES ARE RETURNING FIRE — DUCK (C) TO TAKE COVER", true);
    for (const u of units) {
      if (!u.alive) continue;
      if (isHostile(u)) {
        if (u.state !== "engage") {
          u.state = "alert";
          u.alertT = 0.6 + fx() * 1.5;
          u.cover = u.cover ?? nearestCover(u.root.position);
        }
      } else if (u.kind === "courier") startle(u, PERCH, 1);
      else if (isCiv(u)) startle(u, PERCH, 1);
    }
  }

  function damagePlayer(n: number, from: THREE.Vector3) {
    if (godMode || stage !== "playing") return;
    hp = Math.max(0, hp - n);
    lastHurt = 0;
    damageFlash = Math.min(1, damageFlash + n / 40);
    swayAmp = Math.min(3, swayAmp + 1.2);
    audio.hurt();
    feed(`HIT FROM <em>${Math.round(from.distanceTo(PERCH))}M</em>`, "bad");
    if (hp <= 0) endContract(false, "OPERATOR DOWN");
  }
  let godMode = false;

  // ------------------------------------------------------------- AI
  const walkV = new THREE.Vector3();
  function walkTo(u: Unit, target: THREE.Vector3, speed: number, dt: number, arrive = 0.35) {
    walkV.subVectors(target, u.root.position).setY(0);
    const d = walkV.length();
    if (d < arrive) {
      u.speed = 0;
      return true;
    }
    walkV.divideScalar(d);
    const step = Math.min(d, speed * dt);
    u.root.position.addScaledVector(walkV, step);
    u.speed = speed;
    u.faceYaw = Math.atan2(walkV.x, walkV.z);
    return false;
  }
  function faceToward(u: Unit, p: THREE.Vector3) {
    u.faceYaw = Math.atan2(p.x - u.root.position.x, p.z - u.root.position.z);
  }

  function hostileFire(u: Unit) {
    if (!u.rifle) return;
    const muzzle = u.rifle.muzzle.getWorldPosition(new THREE.Vector3());
    const tgt = u.target;
    const dest = tgt === "player" ? PERCH.clone() : tgt ? tgt.root.position.clone().setY(1.2) : u.aimPoint.clone();
    const distCam = camera.position.distanceTo(muzzle);
    let hit = false;
    if (tgt === "player") {
      hit = !ducked && fx() < (u.kind === "marksman" ? 1 : 0.16);
      if (!hit) dest.add(new THREE.Vector3((fx() - 0.5) * 3, (fx() - 0.3) * 2, 0));
      else later(0.15, () => damagePlayer(u.kind === "marksman" ? 45 : 13, muzzle));
      if (!hit && !ducked) later(0.25, () => audio.whiz((fx() - 0.5) * 1.4));
    } else if (tgt) {
      const crouched = tgt.state === "hold";
      hit = fx() < (crouched ? 0.2 : 0.34);
      if (hit) {
        tgt.hp -= 9;
        tgt.flinch = 1;
        if (tgt.hp <= 0 && tgt.alive) {
          startDeath(tgt, "torso", dest.clone().sub(muzzle).normalize(), 70);
          feed(`${tgt.name} · <em>DOWN</em>`, "bad");
          audio.alarm();
          anyAllyDown = true;
        }
      } else dest.add(new THREE.Vector3((fx() - 0.5) * 1.6, (fx() - 0.5) * 0.8, (fx() - 0.5) * 1.6));
    }
    spawnFlash(muzzle, u.kind === "marksman" ? 1.2 : 0.7, 0.05, u.kind === "marksman" ? 0xd8b8ff : 0xffd9a0);
    spawnTracer(muzzle, dest, u.kind === "marksman" ? 0xc28cff : 0xff8a7a);
    if (u.kind === "marksman") audio.sniper(distCam * 0.3, 0);
    else audio.remoteShot(distCam * 0.4, THREE.MathUtils.clamp((muzzle.x - camera.position.x) / 20, -1, 1), true);
  }

  function updateUnit(u: Unit, dt: number) {
    if (!u.alive) {
      u.deadT += dt;
      u.speed = 0;
      return;
    }
    u.flinch = Math.max(0, u.flinch - dt * 3);
    u.speed = 0;
    switch (u.kind) {
      case "civilian":
      case "decoy":
        updateCivilian(u, dt);
        break;
      case "courier":
        updateCourier(u, dt);
        break;
      case "ally":
        updateAlly(u, dt);
        break;
      default:
        updateHostile(u, dt);
    }
    const dy = wrapAngle(u.faceYaw - u.root.rotation.y);
    u.root.rotation.y += dy * Math.min(1, dt * 7);
    if (u.laser && u.laserMat && u.rifle) {
      const show = u.aiming && u.aimW > 0.8 && u.target !== null;
      u.laser.visible = show;
      if (show) {
        const m = u.rifle.muzzle.getWorldPosition(tmpV);
        u.laser.position.copy(m);
        const end = tmpV2.copy(u.aimPoint);
        u.laser.lookAt(end);
        u.laser.scale.set(scoped ? 2.5 : 1.2, scoped ? 2.5 : 1.2, m.distanceTo(end));
        u.laserMat.opacity = 0.35 + Math.sin(menuTime * 20 + u.id) * 0.1;
      }
    }
  }

  function followPath(u: Unit, dt: number, speed: number) {
    if (!u.path.length) return true;
    if (u.wait > 0) {
      u.wait -= dt;
      return false;
    }
    const tgt = u.path[u.pathI];
    if (walkTo(u, tgt, speed, dt)) {
      u.pathI++;
      if (u.pathI >= u.path.length) {
        if (!u.loop) {
          u.pathI = u.path.length - 1;
          return true;
        }
        u.pathI = 0;
      }
      u.wait = u.waitAt * (0.6 + fx() * 0.8);
    }
    return false;
  }

  function updateCivilian(u: Unit, dt: number) {
    const done = followPath(u, dt, u.walkSpeed);
    if (done) {
      if (u.state === "panic") {
        u.state = "gone";
        removeLater.push(u);
        return;
      }
      // reached the end: loop back the other way on the opposite lane
      const z = u.root.position.z;
      const dir = z > 0 ? -1 : 1;
      u.path = [new THREE.Vector3(u.root.position.x, 0, dir > 0 ? 38 : -68)];
      u.pathI = 0;
    }
  }

  function updateCourier(u: Unit, dt: number) {
    const done = followPath(u, dt, u.walkSpeed);
    if (done && stage === "playing") {
      u.state = "gone";
      endContract(false, "THE COURIER REACHED THE PICKUP");
    }
  }

  function updateHostile(u: Unit, dt: number) {
    const persp = u.kind === "marksman";
    switch (u.state) {
      case "patrol":
        u.aiming = false;
        followPath(u, dt, u.walkSpeed);
        break;
      case "walk": {
        // escort: keep formation on the courier
        u.aiming = false;
        const lead = contractState.courier;
        if (lead && lead.alive) {
          const off = u.path[0] ?? new THREE.Vector3();
          const tgt = tmpV3.copy(lead.root.position).add(off);
          walkTo(u, tgt, lead.state === "flee" ? 4 : Math.max(0.8, lead.walkSpeed * 1.05), dt, 0.25);
          if (u.speed === 0) u.faceYaw = lead.root.rotation.y;
        } else startle(u, u.root.position, 1);
        break;
      }
      case "idle":
        u.aiming = false;
        u.speed = 0;
        break;
      case "alert": {
        // searching: weapon up, scanning toward the nest, moving into cover
        u.alertT -= dt;
        u.aiming = true;
        u.aimPoint.set(PERCH.x + Math.sin(menuTime * 0.7 + u.id) * 8, PERCH.y - 4, PERCH.z);
        if (u.cover) {
          if (walkTo(u, u.cover, 3.6, dt, 0.3)) faceToward(u, PERCH);
        } else faceToward(u, PERCH);
        if (u.alertT <= 0) {
          u.state = "engage";
          u.peekT = 0.5 + fx();
          u.crouch = !!u.cover;
        }
        break;
      }
      case "engage": {
        if (u.cover && walkTo(u, u.cover, 3.6, dt, 0.3) === false) {
          u.aiming = false;
          break;
        }
        // pick target
        if (C.id === "overwatch" && !persp) {
          let best: Unit | null = null;
          let bd = 1e9;
          for (const a of units) {
            if (a.kind !== "ally" || !a.alive) continue;
            const d = a.root.position.distanceToSquared(u.root.position);
            if (d < bd) {
              bd = d;
              best = a;
            }
          }
          u.target = best;
        } else u.target = "player";
        if (!u.target) {
          u.aiming = false;
          u.crouch = !!u.cover;
          break;
        }
        const tp = u.target === "player" ? PERCH : u.target.root.position;
        faceToward(u, tp);
        u.peekT -= dt;
        if (u.crouch) {
          u.aiming = false;
          if (u.peekT <= 0) {
            u.crouch = false;
            u.peekT = persp ? 2.6 : 1.1 + fx() * 0.8; // aim time before the shot
            u.burst = persp ? 1 : 2 + Math.floor(fx() * 2);
            u.shotCd = 0;
            if (persp) u.glintT = 0;
          }
        } else {
          u.aiming = true;
          u.aimPoint.copy(tp).setY(u.target === "player" ? PERCH.y : 1.2);
          if (persp) u.glintT += dt;
          if (u.peekT <= 0) {
            u.shotCd -= dt;
            if (u.shotCd <= 0 && u.burst > 0) {
              hostileFire(u);
              u.burst--;
              u.shotCd = 0.16;
            }
            if (u.burst <= 0 && u.shotCd <= 0) {
              u.crouch = !!u.cover || persp;
              u.peekT = persp ? 3.5 + fx() * 2.5 : 1.6 + fx() * 2.2;
              u.glintT = 0;
            }
          }
        }
        break;
      }
      default:
        break;
    }
    if (u.glint) {
      const k = u.state === "engage" && !u.crouch ? Math.min(1, u.glintT / 2.2) : 0;
      u.glint.scale.setScalar(0.0001 + k * 0.05 * (0.8 + Math.sin(menuTime * 14) * 0.2));
    }
    // bodies nearby give the game away
    if (u.state === "patrol" || u.state === "idle" || u.state === "walk") {
      for (const o of units) {
        if (o.alive || o === u || o.deadT > 40 || !isHostile(o) && !isCiv(o)) continue;
        if (o.root.position.distanceTo(u.root.position) < 9) {
          startle(u, o.root.position, 1);
          raiseDetection(30, null);
          feed("A BODY HAS BEEN <em>FOUND</em>", "bad");
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------- contracts
  const removeLater: Unit[] = [];
  let anyAllyDown = false;
  const contractState: {
    courier: Unit | null;
    wave: number;
    waveUnits: Unit[];
    advanceT: number;
    civSpawn: number;
    exfil: boolean;
  } = { courier: null, wave: 0, waveUnits: [], advanceT: 0, civSpawn: 0, exfil: false };
  const V = (x: number, z: number) => new THREE.Vector3(x, 0, z);

  function hostileAt(x: number, z: number, yaw: number, state: UState, path: THREE.Vector3[] = [], waitAt = 2.5) {
    const u = spawnUnit("hostile", V(x, z), { yaw });
    if (!u) return null;
    u.state = state;
    u.path = path;
    u.waitAt = waitAt;
    u.objective = true;
    return u;
  }

  function setupContract() {
    contractState.courier = null;
    contractState.wave = 0;
    contractState.waveUnits = [];
    contractState.advanceT = 0;
    contractState.civSpawn = 0;
    contractState.exfil = false;
    anyAllyDown = false;
    if (C.id === "sentry") {
      hostileAt(-5, -10, Math.PI, "patrol", [V(-5, -10), V(-5, -27)], 2.5);
      hostileAt(2.4, -1.2, 0, "idle");
      hostileAt(0.6, 15, Math.PI, "patrol", [V(0.6, 15), V(0.6, -14)], 3);
      hostileAt(1.7, 16.2, Math.PI, "patrol", [V(1.7, 16.2), V(1.7, -12.8)], 3);
      hostileAt(-3.6, -50, 0.4, "idle");
    } else if (C.id === "courier") {
      for (let i = 0; i < (mobile ? 10 : 16); i++) spawnCivilian(-66 + fx() * 100);
      const courier = spawnUnit("courier", V(8.1, -66), { yaw: 0, objective: true, caseColor: 0xffb547, umbrella: false });
      if (courier) {
        courier.state = "walk";
        courier.walkSpeed = 1.18;
        courier.path = [V(8.1, -2.5), V(12.5, -2), V(16, -2)];
        courier.loop = false;
        courier.waitAt = 0;
        contractState.courier = courier;
      }
      for (const off of [V(-1.3, -1.6), V(0.9, -2.1)]) {
        const g = spawnUnit("guard", V(8.1 + off.x, -66 + off.z), { yaw: 0 });
        if (g) {
          g.state = "walk";
          g.path = [off];
        }
      }
      // decoys: an amber case under an umbrella, a blue case without one
      const d1 = spawnUnit("decoy", V(-7.8, -58), { yaw: 0, caseColor: 0xffb547, umbrella: true });
      if (d1) {
        d1.state = "walk";
        d1.path = [V(-7.8, 38)];
        d1.loop = false;
      }
      const d2 = spawnUnit("decoy", V(7.2, 30), { yaw: Math.PI, caseColor: 0x35a8ff, umbrella: false });
      if (d2) {
        d2.state = "walk";
        d2.path = [V(7.2, -68)];
        d2.loop = false;
      }
      hostileAt(-2.6, -20, 0.2, "idle");
    } else {
      const k = spawnUnit("ally", V(-1.6, 33), { name: "KESTREL", yaw: Math.PI });
      const v = spawnUnit("ally", V(1.6, 34), { name: "VOSS", yaw: Math.PI });
      for (const a of [k, v]) if (a) {
        a.state = "hold";
        a.stopIdx = 0;
        a.cover = a.root.position.clone();
      }
      contractState.advanceT = 3.5;
    }
  }

  function spawnCivilian(z: number) {
    const side = fx() < 0.5 ? -1 : 1;
    const lane = side * (7.3 + fx() * 1.6);
    const dirN = fx() < 0.5 ? 1 : -1;
    const u = spawnUnit("civilian", V(lane, z), { yaw: dirN > 0 ? 0 : Math.PI });
    if (!u) return;
    u.state = "walk";
    u.path = [V(lane, dirN > 0 ? 38 : -68)];
    u.loop = false;
    u.waitAt = 0;
  }

  const ALLY_STOPS: Array<[THREE.Vector3, THREE.Vector3]> = [
    [V(-1.6, 33), V(1.6, 34)],
    [V(-3.3, 11.6), V(3.0, 17.6)],
    [V(2.7, 4.0), V(-3.0, -2.4)],
    [V(3.4, -10.3), V(-3.2, -16.6)],
    [V(1.2, -23.3), V(-2.6, -31.2)],
    [V(-0.8, -50), V(0.8, -50.5)],
  ];
  const WAVES: Array<Array<[number, number, boolean?]>> = [
    [],
    [[-3.0, -4], [3.4, -12], [-3.2, -18.5]],
    [[1.2, -25], [-2.6, -33], [3.6, -39.5], [-1.5, -61, true]],
    [[3.6, -39.5], [-3.8, -47], [2.2, -54], [-2.6, -33]],
    [[-3.8, -47], [2.2, -54], [3.8, -66]],
  ];
  function spawnWave(k: number) {
    const list = WAVES[k] ?? [];
    contractState.waveUnits = [];
    for (const [cx, cz, sniper] of list) {
      const spot = coverSpots.find((c) => Math.abs(c.x - cx) < 0.6 && Math.abs(c.z - cz) < 3) ?? V(cx, cz - 1);
      const side = cx < 0 ? -1 : 1;
      const u = spawnUnit(sniper ? "marksman" : "hostile", V(side * 10.5, spot.z - 2 - fx() * 3), { yaw: 0 });
      if (!u) continue;
      u.state = "alert";
      u.alertT = 2.5 + fx() * 2;
      u.cover = spot;
      u.objective = true;
      contractState.waveUnits.push(u);
    }
    if (k > 1) banner(`CONTACT · SECTOR ${k}`, k === 2 ? "COUNTER-SNIPER IN THE AREA — WATCH FOR THE GLINT" : "HOSTILES MOVING ON THE TEAM", true);
    else banner("CONTACT FRONT", "LASERS = HOSTILES AIMING AT YOUR TEAM", true);
  }

  function updateAlly(u: Unit, dt: number) {
    if (u.state === "move") {
      u.crouch = false;
      u.aiming = false;
      if (walkTo(u, u.cover!, 3.4, dt, 0.3)) {
        u.state = "hold";
        faceToward(u, V(u.root.position.x, u.root.position.z - 10));
      }
      return;
    }
    // hold: crouched behind cover, popping up to fire at standing hostiles
    let tgt: Unit | null = null;
    let bd = 50 * 50;
    for (const h of units) {
      if (!h.alive || !isHostile(h) || h.state !== "engage" || h.crouch) continue;
      const d = h.root.position.distanceToSquared(u.root.position);
      if (d < bd) {
        bd = d;
        tgt = h;
      }
    }
    u.shotCd -= dt;
    if (tgt) {
      faceToward(u, tgt.root.position);
      u.crouch = false;
      u.aiming = true;
      u.aimPoint.copy(tgt.root.position).setY(1.3);
      if (u.shotCd <= 0) {
        u.shotCd = 1.5 + fx() * 1.3;
        if (u.rifle) {
          const m = u.rifle.muzzle.getWorldPosition(new THREE.Vector3());
          const dest = tgt.root.position.clone().setY(1.3);
          const ok = fx() < 0.22;
          if (!ok) dest.add(new THREE.Vector3((fx() - 0.5) * 2, (fx() - 0.4), (fx() - 0.5) * 2));
          spawnFlash(m, 0.6);
          spawnTracer(m, dest, 0xffe2a8);
          audio.remoteShot(camera.position.distanceTo(m) * 0.4, 0, false);
          if (ok) {
            tgt.hp -= 40;
            tgt.flinch = 1;
            if (tgt.hp <= 0) {
              startDeath(tgt, "torso", dest.sub(m).normalize(), 70);
              feed(`${u.name} · HOSTILE DOWN`, "");
            }
          }
        }
      }
    } else {
      u.aiming = false;
      u.crouch = true;
    }
  }

  function updateContract(dt: number) {
    if (C.id === "sentry") {
      const left = units.filter((u) => isHostile(u) && u.alive).length;
      if (left === 0 && !cam) endContract(true, "ALL SENTRIES DOWN");
    } else if (C.id === "courier") {
      // keep the crowd flowing
      contractState.civSpawn -= dt;
      const civs = units.filter((u) => u.kind === "civilian" && u.alive && u.state !== "panic").length;
      if (!compromised && contractState.civSpawn <= 0 && civs < (mobile ? 10 : 16)) {
        contractState.civSpawn = 2.5;
        spawnCivilianAtEnd();
      }
      const c = contractState.courier;
      if (c && !c.alive && !cam) endContract(true, "COURIER ELIMINATED");
    } else {
      const allies = units.filter((u) => u.kind === "ally");
      const alive = allies.filter((a) => a.alive);
      if (!alive.length) {
        endContract(false, "FIRETEAM LOST");
        return;
      }
      const waveLeft = contractState.waveUnits.filter((u) => u.alive).length;
      const allHolding = alive.every((a) => a.state === "hold");
      if (waveLeft === 0 && allHolding) {
        contractState.advanceT -= dt;
        if (contractState.advanceT <= 0) {
          const next = contractState.wave + 1;
          if (next >= ALLY_STOPS.length) {
            if (!cam) endContract(true, "FIRETEAM EXTRACTED");
            return;
          }
          contractState.wave = next;
          for (const a of alive) {
            a.stopIdx = next;
            a.cover = ALLY_STOPS[next][allies.indexOf(a)].clone();
            a.state = "move";
          }
          if (next < ALLY_STOPS.length - 1) spawnWave(next);
          else banner("MOVING TO EXFIL", "KEEP THEM COVERED", false);
          feed(next < ALLY_STOPS.length - 1 ? `FIRETEAM · <u>MOVING UP</u>` : "FIRETEAM · <u>EXFIL</u>", "");
          contractState.advanceT = 2.5;
        }
      }
    }
  }
  function spawnCivilianAtEnd() {
    const side = fx() < 0.5 ? -1 : 1;
    const lane = side * (7.3 + fx() * 1.6);
    const fromFar = fx() < 0.5;
    const u = spawnUnit("civilian", V(lane, fromFar ? -70 : 40), { yaw: fromFar ? 0 : Math.PI });
    if (!u) return;
    u.state = "walk";
    u.path = [V(lane, fromFar ? 38 : -68)];
    u.loop = false;
  }

  function isLastObjective(u: Unit) {
    if (C.id === "courier") return u.kind === "courier";
    if (C.id === "sentry") return isHostile(u) && units.filter((o) => isHostile(o) && o.alive).length === 1;
    const lastWave = contractState.wave >= ALLY_STOPS.length - 2;
    return lastWave && contractState.waveUnits.filter((o) => o.alive).length === 1 && contractState.waveUnits.includes(u);
  }

  // ------------------------------------------------------------- feedback
  function addScore(n: number) {
    score = Math.max(0, score + n);
    hooks.onScore(score);
  }
  function feed(html: string, cls: string) {
    const d = document.createElement("div");
    d.className = cls;
    d.innerHTML = html;
    hud.feed.prepend(d);
    while (hud.feed.children.length > 5) hud.feed.lastElementChild?.remove();
    setTimeout(() => {
      d.style.opacity = "0";
      setTimeout(() => d.remove(), 450);
    }, 4200);
  }
  function popup(text: string, hs: boolean) {
    const d = document.createElement("div");
    d.className = hs ? "hs" : "";
    d.textContent = text;
    hud.pops.appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }
  let bannerTimer = 0;
  function banner(t: string, s: string, alert: boolean) {
    hud.banner.className = "nx-banner on" + (alert ? " alert" : "");
    (hud.banner.querySelector(".k") as HTMLElement).textContent = alert ? "◆ ALERT" : "◆ NEST";
    (hud.banner.querySelector(".t") as HTMLElement).textContent = t;
    (hud.banner.querySelector(".s") as HTMLElement).textContent = s;
    bannerTimer = 3.2;
  }
  let hitT = 0;
  function showHit(head: boolean, kill: boolean) {
    hud.hit.className = "nx-hit" + (head ? " hs" : "") + (kill ? " kill" : "");
    hud.hit.style.opacity = "1";
    hitT = 0.35;
    audio.hitmarker();
  }
  function medal(id: string, name: string, sub: string) {
    runMedals[name] = (runMedals[name] ?? 0) + 1;
    void id;
    hud.medal.innerHTML = `<i>★</i><div><b>${esc(name)}</b><span>${esc(sub)}</span></div>`;
    hud.medal.classList.remove("on");
    void hud.medal.offsetWidth;
    hud.medal.classList.add("on");
    audio.medal();
  }

  // ------------------------------------------------------------- flow
  function clearUnits() {
    endCam();
    for (const u of units.slice()) removeUnit(u);
    for (const b of bullets) {
      scene.remove(b.trail);
      b.trailMat.dispose();
    }
    bullets.length = 0;
    delayed.length = 0;
    removeLater.length = 0;
  }

  function startContract(id: ContractId) {
    C = contractById(id);
    selected = id;
    clearUnits();
    score = kills = headshots = shots = hitsN = civHits = 0;
    longest = 0;
    detection = 0;
    compromised = compromisedEver = false;
    success = false;
    failReason = "";
    elapsed = 0;
    hp = PLAYER_HP;
    lastHurt = 99;
    damageFlash = 0;
    runMedals = {};
    lastKillT = -99;
    mag = MAG;
    reserve = C.rounds - MAG;
    boltT = reloadT = 0;
    breath = 1;
    breathOut = 0;
    swayAmp = 1;
    yaw = 0;
    pitch = -0.16;
    scoped = false;
    ducked = false;
    zoom = 8;
    windT = fx() * 100;
    hud.root.classList.remove("scoped", "ducked", "bulletcam");
    hooks.onScore(0);
    setupContract();
    stage = "playing";
    hud.root.dataset.mode = "play";
    hud.overlay.className = "nx-ov";
    hud.overlay.innerHTML = "";
    hud.squad.classList.toggle("on", C.id === "overwatch");
    hud.det.style.display = C.id === "overwatch" ? "none" : "";
    banner(C.title, C.bullets[0].toUpperCase(), false);
    audio.ensure();
    audio.startAmbient();
    audio.objective();
    lockPointer();
  }

  function endContract(win: boolean, reason: string) {
    if (stage !== "playing") return;
    success = win;
    failReason = reason;
    stage = "over";
    setScope(false);
    scoped = false;
    hud.root.classList.remove("scoped");
    audio.musicStinger(win);
    if (win) {
      const timeBonus = Math.max(0, Math.round((C.par - elapsed) * 8));
      const acc = shots ? hitsN / shots : 0;
      addScore(1000 + timeBonus + Math.round(acc * 500));
    }
    banner(win ? "CONTRACT COMPLETE" : "CONTRACT FAILED", reason, !win);
    setTimeout(() => {
      if (!disposed && stage === "over") showResults();
    }, 2400);
  }

  function starsEarned() {
    if (!success) return [false, false, false];
    if (C.id === "sentry") return [true, !compromisedEver, headshots >= 3];
    if (C.id === "courier") return [true, civHits === 0, !!contractState.courier && !compromisedEver && contractState.courier.state !== "flee"];
    return [true, !anyAllyDown, elapsed < 210];
  }

  function exitPointer() {
    if (document.pointerLockElement === canvas) {
      try {
        document.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
  }
  function lockPointer() {
    if (mobile || stage !== "playing") return;
    try {
      const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------- menus
  const starHtml = (n: number) => [0, 1, 2].map((i) => `<i class="${i < n ? "on" : ""}">★</i>`).join("");
  function showMenu() {
    stage = "menu";
    exitPointer();
    clearUnits();
    hud.root.dataset.mode = "menu";
    hud.root.classList.remove("scoped", "ducked", "bulletcam");
    scoped = ducked = false;
    hud.overlay.className = "nx-ov menu on";
    const sel = contractById(selected);
    hud.overlay.innerHTML = `<div class="nx-col">
      <div class="nx-kick">PLAYVERSE // NEXUS 2100 · MARKSMAN</div>
      <div class="nx-h1">LONG<span>SHOT</span></div>
      <div class="nx-sub">One nest. One bolt-action. A hundred metres of rain between you and the contract. Read the wind, hold your breath, lead the walkers.</div>
      <div class="ls-cards">${CONTRACTS.map((c) => {
        const lock = !unlocked(c);
        return `<button type="button" class="ls-card ${c.id === selected ? "on" : ""} ${lock ? "lock" : ""}" data-c="${c.id}">
          <b class="n">0${c.n}</b><div><div class="t">${c.title}</div><div class="s">${lock ? "COMPLETE THE PREVIOUS CONTRACT" : esc(c.tag)}</div></div>
          <span class="st">${starHtml(progress.stars[c.id] ?? 0)}</span></button>`;
      }).join("")}</div>
      <div class="ls-brief"><div class="k">BRIEFING · ${sel.title}</div><p>${esc(sel.brief)}</p>
        <ul>${sel.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
        ${sel.ident ? `<div class="id"><b>TARGET ID</b><span>${esc(sel.ident)}</span></div>` : ""}</div>
      <div class="nx-actions"><button type="button" class="nx-btn" data-go="deploy">DEPLOY ▸</button>
        <button type="button" class="nx-btn ghost" data-go="settings">SETTINGS</button>
        <span class="nx-best">BEST · <b>${(progress.best[selected] ?? 0).toLocaleString("en-US")}</b></span></div>
      <div class="nx-ctrl">${(mobile
        ? [["LOOK", "DRAG"], ["SCOPE", "SCOPE"], ["FIRE", "FIRE"], ["STEADY", "HOLD BREATH"], ["ZOOM", "×8"], ["COVER", "▾"]]
        : [["LOOK", "MOUSE"], ["SCOPE", "RMB / Q"], ["FIRE", "LMB / SPACE"], ["ZOOM", "SCROLL · PINCH · Z"], ["HOLD BREATH", "SHIFT"], ["COVER", "C"], ["RELOAD", "R"], ["PAUSE", "P / ESC"]]
      )
        .map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`)
        .join("")}</div></div>`;
    hud.overlay.querySelectorAll<HTMLButtonElement>(".ls-card").forEach((b) =>
      b.addEventListener("click", () => {
        const c = contractById(b.dataset.c as ContractId);
        if (!unlocked(c)) return;
        audio.ui();
        selected = c.id;
        C = c;
        showMenu();
      }),
    );
    (hud.overlay.querySelector('[data-go="deploy"]') as HTMLElement).addEventListener("click", () => {
      audio.ensure();
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
      startContract(selected);
    });
    (hud.overlay.querySelector('[data-go="settings"]') as HTMLElement).addEventListener("click", () => showSettings(showMenu));
  }

  function showSettings(back: () => void) {
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center"><div class="nx-kick">SETTINGS</div><div class="nx-h2">OPTIC & AUDIO</div>
      <div class="nx-set">
        <label><span>SENSITIVITY</span><input type="range" min="0.3" max="2.5" step="0.05" value="${settings.sens}" data-k="sens"><span>${settings.sens.toFixed(2)}</span></label>
        <label><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" value="${settings.vol}" data-k="vol"><span>${Math.round(settings.vol * 100)}</span></label>
        <label><span>MUSIC</span><input type="range" min="0" max="1" step="0.05" value="${settings.music}" data-k="music"><span>${Math.round(settings.music * 100)}</span></label>
      </div><div class="nx-actions"><button type="button" class="nx-btn" data-go="back">DONE</button></div></div>`;
    hud.overlay.querySelectorAll<HTMLInputElement>("input").forEach((inp) =>
      inp.addEventListener("input", () => {
        const k = inp.dataset.k as "sens" | "vol" | "music";
        settings[k] = Number(inp.value);
        (inp.nextElementSibling as HTMLElement).textContent = k === "sens" ? settings.sens.toFixed(2) : String(Math.round(settings[k] * 100));
        if (k === "vol") audio.setVolume(settings.muted ? 0 : settings.vol);
        if (k === "music") audio.setMusicVolume(settings.music);
        save(SETTINGS_KEY, settings);
      }),
    );
    (hud.overlay.querySelector('[data-go="back"]') as HTMLElement).addEventListener("click", back);
  }

  function pause() {
    if (stage !== "playing") return;
    stage = "paused";
    exitPointer();
    setBreath(false);
    audio.pause(true);
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center"><div class="nx-kick">PAUSED · ${C.title}</div><div class="nx-h2">HOLDING POSITION</div>
      <div class="nx-actions"><button type="button" class="nx-btn" data-go="resume">RESUME</button>
      <button type="button" class="nx-btn ghost" data-go="restart">RESTART</button>
      <button type="button" class="nx-btn ghost" data-go="settings">SETTINGS</button>
      <button type="button" class="nx-btn ghost" data-go="menu">ABORT</button></div></div>`;
    const go = (k: string, fn: () => void) => (hud.overlay.querySelector(`[data-go="${k}"]`) as HTMLElement).addEventListener("click", fn);
    go("resume", resume);
    go("restart", () => {
      audio.pause(false);
      startContract(C.id);
    });
    go("settings", () => showSettings(() => {
      stage = "playing";
      pause();
    }));
    go("menu", () => {
      audio.pause(false);
      showMenu();
    });
  }
  function resume() {
    if (stage !== "paused") return;
    stage = "playing";
    audio.pause(false);
    hud.overlay.className = "nx-ov";
    hud.overlay.innerHTML = "";
    lockPointer();
  }

  function showResults() {
    stage = "over";
    exitPointer();
    const stars = starsEarned();
    const n = stars.filter(Boolean).length;
    const prevStars = progress.stars[C.id] ?? 0;
    const newBest = success && score > (progress.best[C.id] ?? 0);
    if (success) {
      progress.stars[C.id] = Math.max(prevStars, n);
      if (newBest) progress.best[C.id] = score;
      save(SAVE_KEY, progress);
    }
    const acc = shots ? Math.round((hitsN / shots) * 100) : 0;
    const grade = !success ? "F" : n === 3 && acc >= 70 ? "S" : n === 3 ? "A" : n === 2 ? "B" : "C";
    const nextC = CONTRACTS[C.n];
    const canNext = success && nextC && unlocked(nextC);
    hooks.onGameOver(success ? score : 0, [
      { label: "RESULT", value: success ? "SUCCESS" : "FAILED" },
      { label: "KILLS", value: String(kills) },
      { label: "LONGEST", value: `${Math.round(longest)}M` },
    ], { ownScreen: true });
    hud.root.dataset.mode = "menu";
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center deb"><div class="nx-kick ${success ? "" : "r"}">${success ? "CONTRACT COMPLETE" : "CONTRACT FAILED"} · ${C.title}</div>
      <div class="nx-deb"><div>
        <div class="nx-grade ${success ? "" : "f"}">${grade}</div>
        <div class="nx-score">${score.toLocaleString("en-US")}</div>
        ${newBest ? `<div class="nx-newbest">★ NEW BEST</div>` : success ? "" : `<div class="nx-tiny">${esc(failReason)}</div>`}
        <div class="nx-stats">
          <div><b>${formatTime(elapsed)}</b><span>TIME</span></div>
          <div><b>${kills}</b><span>KILLS</span></div>
          <div><b>${headshots}</b><span>HEADSHOTS</span></div>
          <div><b>${Math.round(longest)}M</b><span>LONGEST</span></div>
          <div><b>${acc}%</b><span>ACCURACY</span></div>
          <div><b>${civHits}</b><span>CIVILIANS</span></div>
        </div></div>
      <div class="r"><div class="nx-starrow">${C.stars
        .map((t, i) => `<div class="${stars[i] ? "on" : ""}"><i>★</i>${esc(t)}</div>`)
        .join("")}</div>
        ${Object.keys(runMedals).length ? `<div class="nx-medals">${Object.entries(runMedals).map(([k, v]) => `<span><i>★</i>${esc(k)}${v > 1 ? ` ×${v}` : ""}</span>`).join("")}</div>` : ""}
        ${success && nextC && prevStars === 0 ? `<div class="nx-unlock">UNLOCKED · ${nextC.title}</div>` : ""}
        <div class="nx-actions">${canNext ? `<button type="button" class="nx-btn" data-go="next">NEXT CONTRACT ▸</button>` : ""}
          <button type="button" class="nx-btn ${canNext ? "ghost" : ""}" data-go="retry">RETRY</button>
          <button type="button" class="nx-btn ghost" data-go="menu">MENU</button></div></div></div></div>`;
    const go = (k: string, fn: () => void) => hud.overlay.querySelector(`[data-go="${k}"]`)?.addEventListener("click", fn);
    go("next", () => startContract(nextC!.id));
    go("retry", () => startContract(C.id));
    go("menu", showMenu);
  }

  // ------------------------------------------------------------- HUD
  const rangeHit = { d: 0, unit: null as Unit | null, point: new THREE.Vector3(), ok: false };
  let rangeAcc = 0;
  function updateRange() {
    const from = camera.getWorldPosition(tmpV2.set(0, 0, 0)).clone();
    camera.getWorldDirection(camFwd);
    const h = castSegment(from, from.clone().addScaledVector(camFwd, 260), null);
    rangeHit.ok = !!h;
    if (h) {
      rangeHit.d = h.dist;
      rangeHit.unit = h.unit;
      rangeHit.point.copy(h.point);
      if (h.unit && h.unit.alive && (isHostile(h.unit) || h.unit.kind === "courier") && !h.unit.tagged) {
        h.unit.tagged = 1;
        if (h.unit.kind === "courier") feed("COURIER · <u>TAGGED</u>", "hs");
      }
    } else rangeHit.unit = null;
  }

  const projV = new THREE.Vector3();
  function placeTag(el: HTMLElement, world: THREE.Vector3) {
    projV.copy(world).project(camera);
    if (projV.z > 1 || projV.z < -1 || Math.abs(projV.x) > 1.05 || Math.abs(projV.y) > 1.05) {
      el.style.display = "none";
      return false;
    }
    el.style.display = "block";
    el.style.left = `${((projV.x + 1) / 2) * viewW}px`;
    el.style.top = `${((1 - projV.y) / 2) * viewH}px`;
    return true;
  }

  function updateHud(realDt: number) {
    // wind
    hud.windV.textContent = Math.abs(wind).toFixed(1);
    hud.windArrow.setAttribute("transform", `rotate(${wind >= 0 ? 90 : -90}) scale(${0.6 + Math.min(1, Math.abs(wind) / 4) * 0.5})`);
    // detection
    if (C.id !== "overwatch") {
      hud.detFill.style.width = `${detection}%`;
      hud.det.classList.toggle("hot", compromised || detection > 70);
      hud.detT.textContent = compromised ? "COMPROMISED" : detection > 70 ? "SUSPICIOUS" : detection > 25 ? "UNEASY" : "HIDDEN";
    }
    // ammo
    if (hud.rounds.childElementCount !== MAG) hud.rounds.innerHTML = "<i></i>".repeat(MAG);
    Array.from(hud.rounds.children).forEach((c, i) => c.classList.toggle("off", i >= mag));
    hud.reserve.textContent = String(reserve);
    hud.mode.textContent = reloadT > 0 ? "RELOAD" : boltT > 0 ? "CYCLING" : mag > 0 ? "READY" : "EMPTY";
    hud.boltFill.style.width = `${reloadT > 0 ? (1 - reloadT / RELOAD_TIME) * 100 : boltT > 0 ? (1 - boltT / BOLT_TIME) * 100 : 0}%`;
    // vitals
    hud.hp.textContent = String(Math.ceil(hp));
    hud.hpFill.style.transform = `scaleX(${hp / PLAYER_HP})`;
    hud.vit.classList.toggle("low", hp < 35);
    hud.vit.classList.toggle("exposed", !ducked);
    hud.cov.textContent = ducked ? "IN COVER" : scoped ? "EXPOSED · SCOPED" : "EXPOSED";
    if (C.id === "overwatch") {
      const allies = units.filter((u) => u.kind === "ally");
      hud.squad.innerHTML = allies
        .map((a) => `<div class="m ${a.alive ? (a.flinch > 0.2 ? "hit" : "") : "down"}"><span>${a.name}</span><div class="b"><i style="width:${Math.max(0, a.hp)}%"></i></div><span>${a.alive ? (a.state === "move" ? "MOVING" : "HOLD") : "DOWN"}</span></div>`)
        .join("");
    }
    // objective
    const ph = `CONTRACT 0${C.n}`;
    hud.objPh.textContent = ph;
    hud.objSt.textContent = compromised ? "COMPROMISED" : "ACTIVE";
    hud.obj.classList.toggle("alert", compromised);
    hud.objT.textContent = C.title;
    if (C.id === "sentry") {
      const left = units.filter((u) => isHostile(u) && u.alive).length;
      hud.objS.textContent = `SENTRIES · ${left} LEFT · ${formatTime(elapsed)}`;
      hud.objBar.style.display = "none";
    } else if (C.id === "courier") {
      const c = contractState.courier;
      const dist = c ? Math.max(0, c.root.position.distanceTo(V(12.5, -2))) : 0;
      hud.objS.textContent = c && c.alive ? `COURIER · ${Math.round(dist)}M TO PICKUP · CIVS ${civHits}/3` : "COURIER DOWN";
      hud.objBar.style.display = "block";
      hud.objFill.style.width = `${Math.min(100, (1 - dist / 65) * 100)}%`;
      hud.objFill.style.background = "var(--r)";
    } else {
      const left = contractState.waveUnits.filter((u) => u.alive).length;
      hud.objS.textContent = `SECTOR ${Math.min(4, contractState.wave)}/4 · HOSTILES ${left} · ${formatTime(elapsed)}`;
      hud.objBar.style.display = "block";
      hud.objFill.style.width = `${(contractState.wave / (ALLY_STOPS.length - 1)) * 100}%`;
      hud.objFill.style.background = "";
    }
    // scope readouts
    if (scoped) {
      if (rangeHit.ok) {
        const d = rangeHit.d;
        hud.rng.textContent = `${Math.round(d)}M`;
        const t = d / V0;
        const drift = 0.5 * wind * WIND_K * t * t;
        const holdMil = (dropAt(d) / d) * 1000;
        const windMil = (drift / d) * 1000;
        hud.holdRd.textContent = `▼${Math.max(0, holdMil).toFixed(1)} ${windMil >= 0 ? "◀" : "▶"}${Math.abs(windMil).toFixed(1)}`;
      } else {
        hud.rng.textContent = "—";
        hud.holdRd.textContent = "—";
      }
      hud.wsRd.textContent = `${Math.abs(wind).toFixed(1)} ${wind >= 0 ? "▶" : "◀"}`;
      hud.breathFill.style.transform = `scaleX(${breath})`;
      hud.breathBar.className = "br" + (breathHeld ? " hold" : breathOut > 0 ? " out" : "");
    }
    hud.cross.classList.toggle("hide", scoped || cam !== null);
    // tags
    for (const u of units) {
      const show = u.alive && (u.kind === "ally" || u.tagged > 0);
      if (!show) {
        if (u.tagEl) u.tagEl.style.display = "none";
        continue;
      }
      if (!u.tagEl) {
        const el = document.createElement("div");
        el.className = "ls-tag " + (u.kind === "ally" ? "ally" : u.objective && u.kind === "courier" ? "tgt" : "hos");
        el.innerHTML = `<div class="d"></div><span>${u.kind === "ally" ? u.name : u.kind === "courier" ? "COURIER" : u.kind === "marksman" ? "MARKSMAN" : ""}</span>`;
        hud.view.appendChild(el);
        u.tagEl = el;
      }
      u.tagEl.classList.toggle("hurt", u.kind === "ally" && u.flinch > 0.2);
      placeTag(u.tagEl, tmpV.copy(u.root.position).setY(2.25));
    }
    // counter-sniper glint ring
    const ms = units.find((u) => u.kind === "marksman" && u.alive && u.glintT > 0.4 && !u.crouch);
    if (ms && ms.rifle) {
      if (!placeTag(hud.glint, ms.rifle.muzzle.getWorldPosition(tmpV))) hud.glint.style.display = "none";
    } else hud.glint.style.display = "none";
    // hit marker / banner / hints
    if (hitT > 0) {
      hitT -= realDt;
      if (hitT <= 0) hud.hit.style.opacity = "0";
    }
    if (bannerTimer > 0) {
      bannerTimer -= realDt;
      if (bannerTimer <= 0) hud.banner.classList.remove("on");
    }
    if (hintStep < 4 && stage === "playing") {
      const tips = mobile
        ? ["<span>TAP <kbd>SCOPE</kbd></span>", "<span><kbd>×8</kbd> ZOOM</span><span>HOLD <kbd>BREATH</kbd> TO STEADY</span>", "<span>USE THE RANGE MARKS TO HOLD OVER · <kbd>FIRE</kbd></span>", ""]
        : ["<span><kbd>RMB</kbd> / <kbd>Q</kbd> SCOPE IN</span>", "<span><kbd>SCROLL</kbd> / <kbd>PINCH</kbd> ZOOM</span><span><kbd>SHIFT</kbd> HOLD BREATH</span>", "<span><kbd>LMB</kbd> FIRE · HOLD OVER WITH THE RANGE MARKS · LEAD WALKERS</span>", ""];
      const html = tips[Math.min(hintStep, 3)];
      if (hud.hint.innerHTML !== html) hud.hint.innerHTML = html;
      hud.hint.classList.toggle("on", !!html && !cam);
      if (hintStep === 3) {
        hintTimer += realDt;
        if (hintTimer > 0.1) hintStep = 4;
      }
    } else hud.hint.classList.remove("on");
    const blood = Math.max(damageFlash, hp < 35 ? 0.35 + Math.sin(menuTime * 4) * 0.1 : 0);
    (hud.root.querySelector(".nx-blood") as HTMLElement).style.opacity = String(Math.min(1, blood));
  }

  // ------------------------------------------------------------- input
  const look = (dx: number, dy: number) => {
    const z = scoped ? camera.fov / BASE_FOV : 1;
    const k = 0.0022 * settings.sens * z;
    yaw = THREE.MathUtils.clamp(yaw - dx * k, -1.3, 1.3);
    pitch = THREE.MathUtils.clamp(pitch - dy * k, -0.75, 0.3);
  };
  on(document, "mousemove", (e: MouseEvent) => {
    if (stage !== "playing" || document.pointerLockElement !== canvas || cam) return;
    look(e.movementX, e.movementY);
  });
  let rmbDownAt = 0;
  let rmbWasScoped = false;
  on(canvas, "mousedown", (e: MouseEvent) => {
    if (mobile || stage !== "playing") return;
    if (document.pointerLockElement !== canvas) {
      lockPointer();
      return;
    }
    if (e.button === 0) fire();
    if (e.button === 2) {
      // tap = toggle (trackpads), hold = scope while held
      rmbDownAt = performance.now();
      rmbWasScoped = scoped;
      if (!scoped) setScope(true);
    }
  });
  on(window, "mouseup", (e: MouseEvent) => {
    if (e.button === 2 && rmbDownAt > 0) {
      const held = performance.now() - rmbDownAt > 280;
      rmbDownAt = 0;
      if (held || rmbWasScoped) setScope(false);
    }
  });
  on(canvas, "contextmenu", (e: Event) => e.preventDefault());
  // Wheel / trackpad: two-finger scroll and pinch (ctrlKey) both zoom smoothly. A notched mouse
  // wheel sends ~100 px per click, a trackpad many small deltas — scaling by size handles both.
  on(container, "wheel", (e: WheelEvent) => {
    if (stage !== "playing") return;
    e.preventDefault();
    let d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (e.ctrlKey) d *= 4; // pinch reports small deltas
    d = THREE.MathUtils.clamp(d, -160, 160);
    nudgeZoom(d);
  }, { passive: false });
  // Safari pinch
  on(container, "gesturestart", (e: Event) => e.preventDefault());
  on(container, "gesturechange", (e: Event & { scale?: number }) => {
    if (stage !== "playing" || !e.scale) return;
    e.preventDefault();
    const z = THREE.MathUtils.clamp(zoom * Math.pow(e.scale, 0.08), ZOOM_MIN, ZOOM_MAX);
    zoom = z;
  });
  on(document, "pointerlockchange", () => {
    if (document.pointerLockElement !== canvas && stage === "playing" && !mobile) pause();
  });
  const toggleMute = () => {
    settings.muted = !settings.muted;
    audio.setVolume(settings.muted ? 0 : settings.vol);
    save(SETTINGS_KEY, settings);
    const b = hud.sys.querySelector('[data-act="mute"]') as HTMLElement;
    b.textContent = settings.muted ? "🔇" : "🔊";
    b.classList.toggle("off", settings.muted);
  };
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void container.requestFullscreen?.().catch(() => {});
  };
  on(window, "keydown", (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === "m") toggleMute();
    if (k === "f") toggleFs();
    if (stage === "paused" && (k === "p" || k === "escape")) return resume();
    if (stage !== "playing") return;
    if (k === "p" || k === "escape") pause();
    if (k === "shift") setBreath(true);
    if (k === "q") setScope(!scoped);
    if (k === "c" || k === "control") setDuck(!ducked);
    if (k === "r") startReload();
    if (k === "z") cycleZoom();
    if (k === " ") {
      e.preventDefault();
      fire();
    }
  });
  on(window, "keyup", (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === "shift") setBreath(false);
  });
  hud.sys.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const a = b.dataset.act;
      if (a === "mute") toggleMute();
      if (a === "pause") {
        if (stage === "paused") resume();
        else pause();
      }
      if (a === "fs") toggleFs();
    }),
  );
  // touch: drag anywhere to look; buttons on top
  let lookId: number | null = null;
  let lookX = 0;
  let lookY = 0;
  on(canvas, "pointerdown", (e: PointerEvent) => {
    if (!mobile || e.pointerType === "mouse" || stage !== "playing") return;
    lookId = e.pointerId;
    lookX = e.clientX;
    lookY = e.clientY;
  });
  on(window, "pointermove", (e: PointerEvent) => {
    if (e.pointerId !== lookId || cam) return;
    look((e.clientX - lookX) * 1.6, (e.clientY - lookY) * 1.6);
    lookX = e.clientX;
    lookY = e.clientY;
  });
  const endLook = (e: PointerEvent) => {
    if (e.pointerId === lookId) lookId = null;
  };
  on(window, "pointerup", endLook);
  on(window, "pointercancel", endLook);
  const tb = (el: HTMLElement, down: () => void, up?: () => void) => {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      audio.ensure();
      down();
    });
    if (up) {
      el.addEventListener("pointerup", (e) => {
        e.preventDefault();
        up();
      });
      el.addEventListener("pointercancel", () => up());
      el.addEventListener("pointerleave", () => up());
    }
  };
  tb(hud.tFire, () => {
    hud.tFire.classList.add("on");
    fire();
  }, () => hud.tFire.classList.remove("on"));
  tb(hud.tScope, () => setScope(!scoped));
  tb(hud.tZoom, () => cycleZoom());
  tb(hud.tReload, () => startReload());
  tb(hud.tBreath, () => setBreath(true), () => setBreath(false));
  tb(hud.tDuck, () => setDuck(!ducked));

  // ------------------------------------------------------------ composer
  let composer: EffectComposer | null = null;
  let grade: ShaderPass | null = null;
  if (!mobile) {
    try {
      const rt = new THREE.WebGLRenderTarget(viewW * pixelRatio(), viewH * pixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(viewW, viewH), 0.5, 0.5, 0.9));
      composer.addPass(new OutputPass());
      grade = new ShaderPass(GradeShader);
      composer.addPass(grade);
    } catch (err) {
      console.error("[LONGSHOT] post-processing unavailable", err);
      composer = null;
      grade = null;
    }
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
    retKey = "";
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(container);
  else on(window, "resize", onResize);

  // --------------------------------------------------------------- loop
  let raf = 0;
  let last = performance.now();
  let hudAcc = 0;
  let boltSounded = false;
  const lookPoint = new THREE.Vector3();
  let menuCrowdT = 0;

  function updatePlayer(dt: number) {
    if (stage !== "playing" || cam) return;
    elapsed += dt;
    // wind: steady base with slow gusts
    windT += dt;
    wind = C.wind[0] + C.wind[1] * (Math.sin(windT * 0.13) * 0.7 + Math.sin(windT * 0.37 + 1.3) * 0.3);
    // breath
    if (breathHeld) {
      breath -= dt / 5;
      heartT -= dt;
      if (heartT <= 0) {
        heartT = 0.85;
        audio.heartbeat(0.7);
      }
      if (breath <= 0) {
        breath = 0;
        breathOut = 2.2;
        setBreath(false);
      }
    } else {
      if (breathOut > 0) breathOut -= dt;
      breath = Math.min(1, breath + dt / 3.2);
    }
    swayAmp += (1 - swayAmp) * Math.min(1, dt * 0.45);
    // weapon cycle
    if (boltT > 0) {
      boltT -= dt;
      if (!boltSounded && boltT < BOLT_TIME - 0.35) {
        boltSounded = true;
        audio.bolt();
      }
      if (boltT <= 0) {
        boltSounded = false;
        if (mag === 0 && reserve > 0) startReload();
      }
    }
    if (reloadT > 0) {
      reloadT -= dt;
      if (reloadT <= 0) {
        const n = Math.min(MAG - mag, reserve);
        mag += n;
        reserve -= n;
        audio.reloadIn();
        later(0.25, () => audio.bolt());
      }
    }
    if (mag === 0 && reserve === 0 && boltT <= 0 && bullets.length === 0 && !cam) {
      const left = units.some((u) => u.alive && (u.objective || u.kind === "courier"));
      if (left && C.id !== "overwatch") endContract(false, "OUT OF AMMUNITION");
    }
    // health
    lastHurt += dt;
    damageFlash = Math.max(0, damageFlash - dt * 1.5);
    if (lastHurt > 3.5) hp = Math.min(PLAYER_HP, hp + dt * (ducked ? 10 : 3));
    if (!compromised) detection = Math.max(0, detection - dt * 2.2);
    recoil = Math.max(0, recoil - dt * 3.2);
  }

  function updateCamera(realDt: number) {
    if (cam) {
      updateCamCam(realDt);
      return;
    }
    if (stage === "menu" || stage === "loading") {
      const t = menuTime * 0.05;
      camera.position.copy(PERCH).add(tmpV.set(Math.sin(t) * 1.2, 0.9, 1.4));
      camera.rotation.set(-0.12 + Math.sin(t * 1.7) * 0.02, Math.sin(t) * 0.22, 0, "YXZ");
      if (camera.fov !== 52) {
        camera.fov = 52;
        camera.updateProjectionMatrix();
      }
      vm.visible = false;
      return;
    }
    vm.visible = true;
    scopeBlend += ((scoped ? 1 : 0) - scopeBlend) * Math.min(1, realDt * 14);
    duckBlend += ((ducked ? 1 : 0) - duckBlend) * Math.min(1, realDt * 7);
    swayT += realDt;
    const base = scoped ? 0.0024 : 0.0012;
    const a = base * swayAmp * (breathHeld ? 0.1 : 1) * (breathOut > 0 ? 2.2 : 1);
    const sx = a * (Math.sin(swayT * 0.83) + 0.5 * Math.sin(swayT * 1.91 + 0.7));
    const sy = a * (Math.sin(swayT * 1.13 + 1) * 0.8 + 0.4 * Math.sin(swayT * 2.31));
    const kick = recoil * recoil * (scoped ? 0.03 : 0.06);
    camera.position.copy(PERCH);
    camera.position.y -= duckBlend * DUCK_DROP;
    camera.position.z += duckBlend * 0.35;
    camera.rotation.set(pitch + sy + kick, yaw + sx, 0, "YXZ");
    const f = targetFov();
    if (Math.abs(camera.fov - f) > 0.01) {
      camera.fov += (f - camera.fov) * Math.min(1, realDt * 18);
      if (Math.abs(camera.fov - f) < 0.02) camera.fov = f;
      camera.updateProjectionMatrix();
    }
    vm.position.lerpVectors(vmBase, vmScoped, scopeBlend);
    vm.position.z += recoil * 0.09;
    vm.position.y -= duckBlend * 0.1;
    vm.rotation.set(recoil * 0.12 + (boltT > 0 ? Math.sin(Math.min(1, (BOLT_TIME - boltT) / BOLT_TIME) * Math.PI) * 0.12 : 0) - (reloadT > 0 ? 0.35 : 0), 0, boltT > 0 ? Math.sin(Math.min(1, (BOLT_TIME - boltT) / BOLT_TIME) * Math.PI) * -0.25 : 0);
    vm.visible = scopeBlend < 0.92;
    if (grade) grade.uniforms.uAds.value = 0;
  }

  const camDir = new THREE.Vector3();
  const camSide = new THREE.Vector3();
  function updateCamCam(realDt: number) {
    if (!cam) return;
    cam.t += realDt;
    const b = cam.b;
    if (cam.phase === "fly") {
      timeScale = cam.k;
      camDir.copy(b.vel).normalize();
      camSide.crossVectors(camDir, UP).normalize();
      camera.position.copy(b.pos).addScaledVector(camDir, -0.42).addScaledVector(camSide, 0.1).addScaledVector(UP, 0.05);
      camera.lookAt(tmpV.copy(b.pos).addScaledVector(camDir, 3));
      if (camera.fov !== 46) {
        camera.fov = 46;
        camera.updateProjectionMatrix();
      }
      slug.position.copy(b.pos);
      slug.lookAt(tmpV.copy(b.pos).add(b.vel));
      slug.rotateZ(cam.t * 40);
      shock.position.copy(b.pos);
      shock.lookAt(tmpV.copy(b.pos).add(b.vel));
      shockMat.opacity = 0.05;
      if (!b.alive && cam.phase === "fly") {
        cam.phase = "impact";
        cam.t = 0.6;
      }
      vm.visible = false;
    } else {
      slug.visible = false;
      shock.visible = false;
      const v = cam.victim;
      timeScale = cam.t < 1 ? 0.16 : Math.min(1, 0.16 + (cam.t - 1) * 1.1);
      if (v) {
        const hips = v.rig ? v.rig.hips.getWorldPosition(tmpV) : tmpV.copy(v.root.position).setY(1);
        cam.orbit += realDt * 0.45;
        const ang = Math.atan2(PERCH.x - hips.x, PERCH.z - hips.z) + cam.orbit * (cam.orbit > 0 ? 1 : 1) + 0.6;
        lookPoint.lerp(hips, cam.t < 0.05 ? 1 : Math.min(1, realDt * 6));
        camera.position.set(hips.x + Math.sin(ang) * 3.2, Math.max(0.6, hips.y + 1.1), hips.z + Math.cos(ang) * 3.2);
        camera.lookAt(lookPoint);
        if (camera.fov !== 50) {
          camera.fov = 50;
          camera.updateProjectionMatrix();
        }
      }
      if (cam.t > 2.3) endCam();
    }
  }

  function updateWorld(dt: number, realDt: number) {
    // units
    for (const u of units) {
      if (stage === "playing" || stage === "over" || stage === "menu") updateUnit(u, dt);
      if (u.alive) {
        animate(u);
        u.mixer.update(dt);
        syncRig(u, dt);
        upperBody(u, dt);
      } else if (!u.ragdoll) {
        u.mixer.update(dt);
      }
    }
    for (const u of removeLater.splice(0)) removeUnit(u);
    stepBullets(dt);
    phys?.step(dt);
    for (let i = delayed.length - 1; i >= 0; i--) {
      delayed[i].t -= dt;
      if (delayed[i].t <= 0) {
        const fn = delayed[i].fn;
        delayed.splice(i, 1);
        fn();
      }
    }
    updateFx(dt);
    if (stage === "playing") updateContract(dt);
    // shadows + rain follow the look point
    camera.getWorldDirection(camFwd);
    const lp = scoped && rangeHit.ok ? rangeHit.point : tmpV3.copy(camera.position).addScaledVector(camFwd, 30).setY(0);
    lookPoint.lerp(lp, cam ? 1 : Math.min(1, realDt * 4));
    sun.target.position.copy(lookPoint);
    sun.position.copy(lookPoint).add(SUN_OFF);
    rainCenter.copy(scoped && !cam ? lookPoint : camera.position);
    updateRain(dt);
  }

  function render() {
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    menuTime += realDt;
    if (stage === "loading") {
      renderer.render(scene, camera);
      return;
    }
    if (stage === "paused") {
      render();
      return;
    }
    if (stage === "menu") {
      wind = 1.2 + Math.sin(menuTime * 0.2) * 0.8;
      menuCrowdT -= realDt;
      if (menuCrowdT <= 0 && units.length < 12) {
        menuCrowdT = 1.6;
        spawnCivilianAtEnd();
      }
    }
    if (!cam && stage !== "over") timeScale = 1;
    if (stage === "over" && !cam) timeScale = Math.max(0.35, timeScale - realDt * 0.4);
    updateCamera(realDt);
    for (const b of beacons) b.material.opacity = Math.sin(menuTime * 2.2 + b.userData.ph) > 0.6 ? 1 : 0.08;
    const dt = realDt * timeScale;
    updatePlayer(realDt);
    if (scoped && stage === "playing") {
      rangeAcc += realDt;
      if (rangeAcc > 0.05) {
        rangeAcc = 0;
        updateRange();
      }
    }
    updateWorld(dt, realDt);
    updateReticle();
    audio.update(realDt);
    audio.music(stage !== "playing" ? 0.05 : compromised ? 0.62 : C.id === "overwatch" ? 0.4 + (contractState.waveUnits.some((u) => u.alive) ? 0.25 : 0) : 0.12 + detection / 280);
    hudAcc += realDt;
    if (hudAcc > 0.05 && (stage === "playing" || stage === "over")) {
      hudAcc = 0;
      updateHud(0.05);
    }
    if (grade) {
      grade.uniforms.uTime.value = menuTime;
      grade.uniforms.uDamage.value = damageFlash;
      grade.uniforms.uLowHp.value = stage === "playing" ? Math.max(0, 1 - hp / 40) : 0;
    }
    render();
  }

  // ------------------------------------------------------------ dev hooks
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as Record<string, unknown>).__ls = {
      get stage() {
        return stage;
      },
      get units() {
        return units;
      },
      get state() {
        return { stage, score, kills, headshots, hp, detection, compromised, mag, reserve, wind, success, failReason, cam: !!cam, contract: C.id, wave: contractState.wave, elapsed };
      },
      start: (id: ContractId) => startContract(id),
      god: () => (godMode = true),
      scope: (b: boolean) => setScope(b),
      zoom: (i: number) => (zoom = ZOOMS[i] ?? i),
      get zoomLevel() {
        return zoom;
      },
      fire: () => fire(),
      duck: (b: boolean) => setDuck(b),
      setWind: (w: number) => {
        C = { ...C, wind: [w, 0] };
      },
      /** Aim at a unit's hitbox with drop + wind + lead compensation (test bot). */
      aimAt: (i: number, part = "torso", lead = true) => {
        const u = units[i];
        if (!u) return false;
        const hb = u.hitboxes.find((h) => h.userData.part === part)!;
        const p = hb.getWorldPosition(new THREE.Vector3());
        const from = camera.position.clone();
        let d = from.distanceTo(p);
        const t = d / V0;
        if (lead && u.speed > 0) p.add(new THREE.Vector3(Math.sin(u.root.rotation.y), 0, Math.cos(u.root.rotation.y)).multiplyScalar(u.speed * t));
        d = from.distanceTo(p);
        p.x -= 0.5 * wind * WIND_K * t * t;
        const dir = p.sub(from).normalize();
        yaw = Math.atan2(-dir.x, -dir.z);
        pitch = Math.asin(dir.y) + dropAt(d) / d;
        swayAmp = 0;
        breathHeld = true;
        return true;
      },
      cam: (p: number[], l: number[]) => {
        camera.position.set(p[0], p[1], p[2]);
        camera.lookAt(l[0], l[1], l[2]);
      },
    };
  }

  raf = requestAnimationFrame(frame);
  void boot();

  // ------------------------------------------------------------ dispose
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const off of listeners) off();
      ro?.disconnect();
      exitPointer();
      clearUnits();
      phys?.dispose();
      phys = null;
      const srcGeos = new Set<THREE.BufferGeometry>();
      const srcMats = new Set<THREE.Material>();
      for (const obj of sourceObjects) {
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) srcGeos.add(mesh.geometry);
          if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => srcMats.add(m));
        });
      }
      srcGeos.forEach((g) => g.dispose());
      srcMats.forEach((m) => m.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      envRT?.dispose();
      hdrTex?.dispose();
      pmrem?.dispose();
      scene.environment = null;
      scene.background = null;
      for (const p of composer?.passes ?? []) p.dispose();
      composer?.dispose();
      renderer.dispose();
      audio.dispose();
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      hud.root.remove();
      hud.style.remove();
      canvas.remove();
      if (process.env.NODE_ENV !== "production") delete (window as unknown as Record<string, unknown>).__ls;
    },
  };
}

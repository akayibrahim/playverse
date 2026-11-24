"use client";

/**
 * NEXUS 2100 — Operation Nightfall.
 *
 * Third-person squad shooter in a rain-soaked megacity street at dusk.
 * Three-phase mission: clear the street → repel reinforcements → hold the
 * uplink at extraction. Every operator is a SkeletonUtils clone of the rigged
 * soldier.glb carrying a procedural carbine held through two-bone arm IK.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { createAudio } from "./nexus-lib/audio";
import { buildHud, esc } from "./nexus-lib/hud";
import { GradeShader } from "./nexus-lib/grade";
import { buildRifle, createRifleParts, rotateBoneWorld, solveArm, type Rifle } from "./nexus-lib/rig";
import {
  ITEMS,
  MEDALS,
  RANKS,
  STARS,
  VISOR_COLORS,
  loadProgress,
  rankOf,
  saveProgress,
  unlockedBetween,
  type Slot,
} from "./nexus-lib/progress";
import { getNickname, setNickname } from "@/lib/storage";
import { asphalt, diamond, flashTex, nameTag, sidewalk, softDot, verticalFade } from "./nexus-lib/textures";

type RunStat = { label: string; value: string };
type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number, stats: RunStat[], opts?: { ownScreen?: boolean }) => void;
  onBoost?: (meter: number, active: boolean) => void;
  onPopup?: (text: string) => void;
  best?: number;
};
type GameInstance = { dispose: () => void };

type Team = "player" | "ally" | "hostile";
type Kind = "rifle" | "heavy" | "sniper" | "drone";
type Spot = [number, number, Kind?];
const DRONE_H = 3.1;
const KIND_LABEL: Record<Kind, string> = { rifle: "HOSTILE", heavy: "HEAVY", sniper: "SNIPER", drone: "DRONE" };
const KIND_INFO: Record<Exclude<Kind, "rifle">, { t: string; s: string }> = {
  heavy: { t: "HEAVY TROOPER", s: "Ballistic shield covers the front — aim for the head or flank" },
  sniper: { t: "SNIPER", s: "Watch for the violet glint — break line of sight before the shot" },
  drone: { t: "ATTACK DRONE", s: "Fast and fragile — track it and burst it down" },
};
type AiState = "patrol" | "combat";
type Actor = { mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction>; current: string };
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
type CoverPoint = { pos: THREE.Vector3; normal: THREE.Vector3; taken: Soldier | null };

type Soldier = {
  id: number;
  team: Team;
  kind: Kind;
  glint: THREE.Sprite | null;
  rotors: THREE.Object3D[];
  orbit: number;
  shield: THREE.Mesh | null;
  name: string;
  root: THREE.Group;
  body: THREE.Group;
  model: THREE.Object3D;
  actor: Actor;
  bones: Bones | null;
  pivot: THREE.Group;
  rifle: Rifle;
  hitboxes: THREE.Mesh[];
  owned: { mats: THREE.Material[]; tex: THREE.Texture[] };
  hp: number;
  maxHp: number;
  alive: boolean;
  down: boolean;
  vel: THREE.Vector3;
  speed: number;
  faceYaw: number;
  aimPoint: THREE.Vector3;
  aimW: number;
  aiming: boolean;
  flinch: number;
  fall: number;
  fallRoll: number;
  deadTime: number;
  state: AiState;
  awareness: number;
  reaction: number;
  target: Soldier | null;
  los: boolean;
  losTimer: number;
  cover: CoverPoint | null;
  coverTimer: number;
  noLosTime: number;
  peek: THREE.Vector3 | null;
  aimTimer: number;
  burst: number;
  burstCd: number;
  shotCd: number;
  patrol: THREE.Vector3[];
  patrolIndex: number;
  waitTime: number;
  avoidSign: number;
  avoidTime: number;
  spotted: number;
  revive: number;
  hurtTime: number;
  laser: THREE.Mesh | null;
  marker: THREE.Sprite | null;
  tag: THREE.Sprite | null;
  tagDown: THREE.Texture | null;
  tagUp: THREE.Texture | null;
  hpBar: THREE.Group | null;
  hpFill: THREE.Sprite | null;
};

type Tracer = {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  t: number;
  speed: number;
  len: number;
  on: boolean;
};
type Spark = { pts: THREE.Points; mat: THREE.PointsMaterial; vel: Float32Array; life: number };
type Puff = { sp: THREE.Sprite; mat: THREE.SpriteMaterial; life: number; max: number; grow: number };
type Pickup = { obj: THREE.Group; ring: THREE.Mesh; life: number; t: number };

const ASSET = "/assets";
const WORLD_HALF = 34;
const ROAD_HALF = 6.2;
const SPAWN = new THREE.Vector3(0, 0, 27);
const EXTRACT = new THREE.Vector3(0, 0, -25.5);
const UP = new THREE.Vector3(0, 1, 0);
const MAG = 30; // pickup size
const RESERVE = 120;
const RESERVE_MAX = 240;
const FIRE_INTERVAL = 0.092;
const RELOAD_TIME = 2.0;
const RELOAD_EMPTY = 2.45;
const DMG_BODY = 26;
const DMG_HEAD = 110;
const DMG_LEGS = 19;
const PLAYER_HP = 100;
const REGEN_DELAY = 4.5;
const REGEN_RATE = 16;
const UPLINK_TIME = 14;
const SEEN_KEY = "playverse:nexusSeen";
const SETTINGS_KEY = "playverse:nexusSettings";
const ALLY_NAMES = ["KESTREL", "VOSS"];

const WAVE1: Spot[] = [
  [-3.6, 9],
  [3.8, 4],
  [-2.6, -3],
  [3.4, -11],
  [-1.4, -17],
  [-7.6, -26, "sniper"],
];
const WAVE2: Spot[] = [
  [-4.5, -32],
  [4.5, -32],
  [0, -33, "heavy"],
  [8.4, -5.2],
  [-3, -30, "drone"],
  [3, -30, "drone"],
];
const WAVE3: Spot[] = [
  [-4, 31.5],
  [4, 31.5, "heavy"],
  [0, 32.5, "drone"],
  [8.4, -5.2],
  [7.6, 30, "sniper"],
];

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

function formatTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function store<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    /* storage disabled */
  }
}

type Mode = "op" | "daily";
type Modifier = { id: string; name: string; desc: string };
const MODIFIERS: Modifier[] = [
  { id: "night", name: "NIGHT OPS", desc: "Moonless sky, heavy fog. Neon is your only light." },
  { id: "headhunt", name: "HEADHUNTER", desc: "Armored hostiles: body shots deal 45% less damage." },
  { id: "scarce", name: "LOW SUPPLY", desc: "Half the reserve ammo, fewer drops." },
  { id: "ironman", name: "IRONMAN", desc: "No health regeneration." },
  { id: "blitz", name: "BLITZ", desc: "Hostiles react faster and shoot straighter." },
];

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function dailyOf(date: string) {
  let h = 2166136261;
  for (const c of date) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const seed = h >>> 0;
  return { date, seed, mod: MODIFIERS[seed % MODIFIERS.length] };
}

function playerId() {
  try {
    let id = localStorage.getItem("playverse:pid");
    if (!id || !/^[a-z0-9]{12,32}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
      localStorage.setItem("playverse:pid", id);
    }
    return id;
  } catch {
    return "anon" + Math.random().toString(36).slice(2, 12);
  }
}

type BoardRow = { name: string; score: number; you: boolean };
type BoardResp = { total: number; top: BoardRow[]; you: { rank: number; score: number } | null };

export function createGame(container: HTMLElement, hooks: GameHooks): GameInstance {
  const rng = mulberry32(2100);
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

  const settings = store(SETTINGS_KEY, { sens: 1, vol: 0.8, muted: false });
  let firstRun = true;
  try {
    firstRun = localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    /* ignore */
  }
  let best = hooks.best ?? 0;
  const prog = loadProgress();
  const equipped = (slot: Slot) => {
    const id = prog.equip[slot];
    const it = ITEMS[slot].find((i) => i.id === id);
    return it && it.rank <= rankOf(prog.xp).index ? id : ITEMS[slot][0].id;
  };
  const load = { mag: 30, reloadExtra: 0, adsSpread: 1, recoil: 1, noise: 26, dmg: 1, adsFov: 48, visor: 0x6ff2e3 };
  function applyLoadout() {
    const ext = equipped("mag") === "ext";
    const muz = equipped("muzzle");
    const holo = equipped("optic") === "holo";
    load.mag = ext ? 40 : 30;
    load.reloadExtra = ext ? 0.25 : 0;
    load.adsSpread = holo ? 0.6 : 1;
    load.adsFov = holo ? 38 : 48;
    load.recoil = muz === "comp" ? 0.65 : 1;
    load.noise = muz === "supp" ? 9 : 26;
    load.dmg = muz === "supp" ? 0.92 : 1;
    load.visor = VISOR_COLORS[equipped("visor")] ?? 0x6ff2e3;
  }
  applyLoadout();
  const pid = playerId();
  let mode: Mode = "op";
  const mod = { night: false, bodyDmg: 1, reserve: RESERVE, drop: 0.75, regen: true, enemyAcc: 1, reaction: 1 };
  // per-run medal tracking
  let runMedals: Record<string, number> = {};
  let killTimes: number[] = [];
  let hsStreak = 0;
  let phaseDamage = 0;
  let allyWentDown = false;

  // ------------------------------------------------------------- state
  type Stage = "loading" | "menu" | "playing" | "paused" | "dead" | "debrief";
  let stage: Stage = "loading";
  let disposed = false;
  let phase = 1;
  let phaseTimer = 0;
  let pendingWave = 0;
  let uplink = 0;
  let uplinkStarted = false;
  let elapsed = 0;
  let menuTime = 0;
  let kills = 0;
  let headshots = 0;
  let shots = 0;
  let hits = 0;
  let bonus = 0;
  let success = false;
  let deathTimer = 0;
  let timeScale = 1;
  let slowTimer = 0;
  let shake = 0;
  let damageFlash = 0;
  let lastHurt = 99;
  let quietTime = 0;

  let player: Soldier | null = null;
  const soldiers: Soldier[] = [];
  const allies: Soldier[] = [];
  const enemies: Soldier[] = [];
  const pickups: Pickup[] = [];
  const blockers: THREE.Mesh[] = [];
  const solidBoxes: THREE.Box3[] = [];
  const coverPoints: CoverPoint[] = [];
  let nextId = 1;

  let yaw = Math.PI;
  let pitch = -0.03;
  let recoil = 0;
  let recoilYaw = 0;
  let ads = false;
  let adsBlend = 0;
  let shoulder = 1;
  let shoulderBlend = 1;
  let firing = false;
  let fireCd = 0;
  let bloom = 0;
  let ammo = MAG;
  let reserve = RESERVE;
  let reloadT = 0;
  let reloadDur = 0;
  let reloadStage = 0;
  let lastShot = 99;
  let sprintHeld = false;
  let stepDist = 0;
  let movedTotal = 0;
  let shotsFired = 0;
  let hintStep = firstRun ? 0 : 99;
  let hintTimer = 0;
  let aimEnemy = false;
  const keys = new Set<string>();
  const moveIn = new THREE.Vector2();

  const fwd3 = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const losRay = new THREE.Raycaster();

  let viewW = Math.max(1, container.clientWidth);
  let viewH = Math.max(1, container.clientHeight);

  // --------------------------------------------------------------- HUD
  const hud = buildHud(container, mobile);
  // Mobile: the page itself must never scroll/bounce under the game.
  const prevBodyOverflow = document.body.style.overflow;
  const prevOverscroll = document.documentElement.style.overscrollBehavior;
  if (mobile) {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
  }
  /** Height of the game hidden behind browser chrome (iOS toolbar) → lift bottom UI by that much. */
  function updateVisibleBottom() {
    const vv = window.visualViewport;
    if (!mobile || !vv) return;
    const rect = container.getBoundingClientRect();
    const hidden = Math.max(0, Math.round(rect.bottom - (vv.offsetTop + vv.height)));
    hud.root.style.setProperty("--vb", `${Math.min(hidden, 160)}px`);
  }
  const audio = createAudio();
  audio.setVolume(settings.muted ? 0 : settings.vol);

  // ----------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: mobile, powerPreference: "high-performance", alpha: false });
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
  scene.fog = new THREE.FogExp2(FOG, 0.026);

  const camera = new THREE.PerspectiveCamera(66, viewW / viewH, 0.05, 400);
  camera.position.set(4, 5, 34);

  const sun = new THREE.DirectionalLight(0xff9f6a, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -30;
  sc.right = 30;
  sc.top = 30;
  sc.bottom = -30;
  sc.near = 1;
  sc.far = 140;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x7d8fc4, 0x231c2a, 0.55);
  scene.add(hemi);
  const muzzleLight = new THREE.PointLight(0xffc27a, 0, 9, 2);
  scene.add(muzzleLight);

  // -------------------------------------------------------- ground + road
  const asph = asphalt(rng);
  T(asph.map);
  T(asph.rough);
  asph.map.repeat.set(14, 14);
  asph.rough.repeat.set(14, 14);
  asph.map.anisotropy = asph.rough.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const ground = new THREE.Mesh(
    G(new THREE.PlaneGeometry(220, 220)),
    M(
      new THREE.MeshStandardMaterial({
        map: asph.map,
        roughnessMap: asph.rough,
        roughness: 1,
        metalness: 0.05,
        envMapIntensity: 0.4,
      }),
    ),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const swTex = T(sidewalk(rng));
  swTex.repeat.set(1.2, 30);
  const swMat = M(new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.9 }));
  const curbMat = M(new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.6 }));
  const swGeo = G(new THREE.BoxGeometry(3.2, 0.12, 2 * WORLD_HALF + 10));
  const curbGeo = G(new THREE.BoxGeometry(0.2, 0.15, 2 * WORLD_HALF + 10));
  for (const side of [-1, 1]) {
    const sw = new THREE.Mesh(swGeo, swMat);
    sw.position.set(side * (ROAD_HALF + 1.7), 0.06, 0);
    sw.receiveShadow = true;
    scene.add(sw);
    const curb = new THREE.Mesh(curbGeo, curbMat);
    curb.position.set(side * (ROAD_HALF + 0.08), 0.075, 0);
    curb.receiveShadow = true;
    scene.add(curb);
  }
  const lineMat = M(new THREE.MeshBasicMaterial({ color: 0xd8d2b4, transparent: true, opacity: 0.55, depthWrite: false }));
  const lineGeo = G(new THREE.PlaneGeometry(0.14, 1.8));
  for (let z = -WORLD_HALF; z <= WORLD_HALF; z += 4.5) {
    const d = new THREE.Mesh(lineGeo, lineMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(0, 0.012, z);
    scene.add(d);
  }
  const edgeGeo = G(new THREE.PlaneGeometry(0.1, 2 * WORLD_HALF + 10));
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(edgeGeo, lineMat);
    e.rotation.x = -Math.PI / 2;
    e.position.set(side * (ROAD_HALF - 0.4), 0.012, 0);
    scene.add(e);
  }
  const zebraGeo = G(new THREE.PlaneGeometry(0.55, 3));
  for (const zc of [17.5, -9]) {
    for (let x = -5.2; x <= 5.2; x += 1.1) {
      const s = new THREE.Mesh(zebraGeo, lineMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(x, 0.013, zc);
      scene.add(s);
    }
  }

  // ------------------------------------------------------------- rain
  const RAIN = mobile ? 500 : 1500;
  const rainPos = new Float32Array(RAIN * 6);
  const rainGeo = G(new THREE.BufferGeometry());
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = M(new THREE.LineBasicMaterial({ color: 0xa9bfd4, transparent: true, opacity: 0.28, depthWrite: false }));
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  scene.add(rain);
  for (let i = 0; i < RAIN; i++) {
    const x = (rng() - 0.5) * 36;
    const y = rng() * 16;
    const z = (rng() - 0.5) * 36;
    rainPos.set([x, y, z, x - 0.04, y + 0.5, z + 0.015], i * 6);
  }

  // ---------------------------------------------------------- extraction
  const extract = new THREE.Group();
  extract.position.copy(EXTRACT);
  scene.add(extract);
  const padMat = M(
    new THREE.MeshBasicMaterial({ color: 0x3c6e74, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  );
  const padRing = new THREE.Mesh(G(new THREE.RingGeometry(2.3, 2.42, 72)), padMat);
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.y = 0.03;
  extract.add(padRing);
  const progMat = M(
    new THREE.MeshBasicMaterial({ color: 0x6ff2e3, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
  );
  const progGeo = G(new THREE.RingGeometry(2.5, 2.72, 96, 1));
  const progRing = new THREE.Mesh(progGeo, progMat);
  progRing.rotation.x = -Math.PI / 2;
  progRing.rotation.z = Math.PI / 2;
  progRing.position.y = 0.035;
  progGeo.setDrawRange(0, 0);
  extract.add(progRing);
  const padInner = new THREE.Group();
  padInner.position.y = 0.04;
  extract.add(padInner);
  const dashGeo = G(new THREE.PlaneGeometry(0.14, 0.55));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const d = new THREE.Mesh(dashGeo, padMat);
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = -a;
    d.position.set(Math.cos(a) * 1.7, 0, Math.sin(a) * 1.7);
    padInner.add(d);
  }
  const fadeTex = T(verticalFade());
  const beamMat = M(
    new THREE.MeshBasicMaterial({
      color: 0x6ff2e3,
      alphaMap: fadeTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const beamGeo = G(new THREE.CylinderGeometry(0.55, 1.1, 30, 32, 1, true));
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 15;
  beam.rotation.x = Math.PI;
  extract.add(beam);

  // --------------------------------------------------------------- FX
  const tracerGeo = G(new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true));
  tracerGeo.rotateX(Math.PI / 2);
  tracerGeo.translate(0, 0, 0.5);
  const tracers: Tracer[] = [];
  for (let i = 0; i < 48; i++) {
    const mat = M(
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const mesh = new THREE.Mesh(tracerGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, mat, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0, speed: 0, len: 0, on: false });
  }
  let tracerI = 0;

  const SPARK_N = 14;
  const sparks: Spark[] = [];
  for (let i = 0; i < 26; i++) {
    const geo = G(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARK_N * 3), 3));
    const mat = M(
      new THREE.PointsMaterial({ color: 0xffce8a, size: 0.06, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
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
    const mat = M(
      new THREE.SpriteMaterial({ map: flashT, color: 0xffe0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    scene.add(sp);
    flashes.push({ sp, mat, life: 0, max: 0.06, grow: 0 });
  }
  let flashI = 0;

  function spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: number, speed = 260) {
    const t = tracers[tracerI++ % tracers.length];
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 0.2) return;
    t.dir.divideScalar(t.dist);
    t.t = 0;
    t.speed = speed;
    t.len = Math.min(3.2, t.dist);
    t.on = true;
    t.mat.color.setHex(color);
    t.mesh.visible = true;
    t.mesh.position.copy(from);
    t.mesh.lookAt(tmpV.copy(from).add(t.dir));
    t.mesh.scale.set(1, 1, 0.001);
  }

  function spawnSparks(at: THREE.Vector3, color: number, n = 1, normal?: THREE.Vector3) {
    const s = sparks[sparkI++ % sparks.length];
    const attr = s.pts.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < SPARK_N; i++) {
      attr.setXYZ(i, at.x, at.y, at.z);
      let vx = (fx() - 0.5) * 4 * n;
      let vy = fx() * 3 * n + 0.4;
      let vz = (fx() - 0.5) * 4 * n;
      if (normal) {
        vx += normal.x * 2.2;
        vy += normal.y * 2.2;
        vz += normal.z * 2.2;
      }
      s.vel[i * 3] = vx;
      s.vel[i * 3 + 1] = vy;
      s.vel[i * 3 + 2] = vz;
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
    p.life = life;
    p.max = life;
    p.grow = size;
    p.sp.scale.setScalar(size * 0.3);
    p.sp.visible = true;
  }

  function spawnFlash(at: THREE.Vector3, size: number) {
    const f = flashes[flashI++ % flashes.length];
    f.sp.position.copy(at);
    f.sp.scale.setScalar(size * (0.8 + fx() * 0.4));
    f.mat.rotation = fx() * Math.PI;
    f.mat.opacity = 1;
    f.life = f.max = 0.055;
    f.sp.visible = true;
  }

  function updateFx(dt: number) {
    for (const t of tracers) {
      if (!t.on) continue;
      t.t += t.speed * dt;
      const head = Math.min(t.dist, t.t);
      const tail = Math.max(0, t.t - t.len);
      if (tail >= t.dist) {
        t.on = false;
        t.mesh.visible = false;
        continue;
      }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.scale.set(1, 1, Math.max(0.001, head - tail));
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const attr = s.pts.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < SPARK_N; i++) {
        s.vel[i * 3 + 1] -= 9.8 * dt;
        attr.setXYZ(
          i,
          attr.getX(i) + s.vel[i * 3] * dt,
          Math.max(0.01, attr.getY(i) + s.vel[i * 3 + 1] * dt),
          attr.getZ(i) + s.vel[i * 3 + 2] * dt,
        );
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
      p.mat.opacity = Math.max(0, (1 - k) * 0.45);
      if (p.life <= 0) p.sp.visible = false;
    }
    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.mat.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) f.sp.visible = false;
    }
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 260);
  }

  // ------------------------------------------------------------- loading
  hud.overlay.className = "nx-ov load on";
  hud.overlay.innerHTML = `<div class="nx-load"><div class="nx-kick">TACTICAL NETWORK // DISTRICT 07</div>
    <div class="nx-h2" style="margin-top:14px">ESTABLISHING LINK</div>
    <div class="bar"><i></i></div><div class="st"><span>OPERATORS · DISTRICT · SKY</span><span class="pc">0%</span></div>
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
  let crateSrc: THREE.Group | null = null;
  const rifleParts = createRifleParts();
  for (const g of Object.values(rifleParts.geo)) geometries.add(g);
  materials.add(rifleParts.metal);
  materials.add(rifleParts.polymer);

  async function loadGlb(name: string, kind: "models" | "env") {
    try {
      const g = await gltfLoader.loadAsync(`${ASSET}/${kind}/${name}.glb`);
      sourceObjects.push(g.scene);
      return g;
    } catch (err) {
      console.error(`[NEXUS] GLB failed: ${name}`, err);
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
      .catch((err) => console.error("[NEXUS] HDR failed", err));
    const [sol, env] = await Promise.all([solP, envP, hdrP]);
    if (disposed) return;
    if (!sol) {
      (hud.overlay.querySelector(".err") as HTMLElement).textContent = "CRITICAL ASSET FAULT — SEE CONSOLE";
      return;
    }
    soldierSrc = sol.scene;
    clips = sol.animations;
    buildWorld(env.map((g) => g?.scene ?? null));
    resetMission();
    renderer.compile(scene, camera);
    showMenu();
  }

  // ---------------------------------------------------------- world build
  const blockerGeo = G(new THREE.BoxGeometry(1, 1, 1));
  const blockerMat = M(new THREE.MeshBasicMaterial({ visible: false }));
  function addBlocker(box: THREE.Box3) {
    const b = box.clone();
    b.min.y = 0;
    solidBoxes.push(b);
    const m = new THREE.Mesh(blockerGeo, blockerMat);
    b.getCenter(m.position);
    b.getSize(m.scale);
    m.updateMatrixWorld(true);
    scene.add(m);
    blockers.push(m);
    return b;
  }

  function placeEnv(src: THREE.Group, pos: THREE.Vector3, scale: number, rotY: number, solid: boolean) {
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
    if (solid) addBlocker(box);
    return box;
  }

  function glowNeon(root: THREE.Object3D) {
    const hsl = { h: 0, s: 0, l: 0 };
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm.color || !sm.emissive || sm.userData.nxGlow) continue;
        sm.userData.nxGlow = true;
        sm.color.getHSL(hsl);
        const neonHue = hsl.h > 0.72 || hsl.h < 0.02 || (hsl.h > 0.42 && hsl.h < 0.58) || (hsl.h > 0.12 && hsl.h < 0.2);
        if (hsl.s > 0.6 && hsl.l > 0.42 && neonHue) {
          sm.emissive.copy(sm.color);
          sm.emissiveIntensity = 0.85;
        }
      }
    });
  }

  function buildWorld(env: Array<THREE.Group | null>) {
    const at = (i: number) => env[i] ?? null;
    for (const i of [0, 1, 2, 3, 6]) {
      const s = at(i);
      if (s) glowNeon(s);
    }
    crateSrc = at(7);

    // Facade corridor.
    const zRow = [-30, -22, -14, -6, 2, 10, 18, 26, 33];
    for (const side of [-1, 1]) {
      for (let i = 0; i < zRow.length; i++) {
        if (side === 1 && i === 3) continue; // side alley (reinforcement entry)
        const src = at((i + (side < 0 ? 0 : 2)) % 4);
        if (!src) continue;
        const x = side * (10.4 + rng() * 0.8);
        const z = zRow[i] + (rng() - 0.5) * 1.2;
        placeEnv(src, new THREE.Vector3(x, 0, z), 1.9 + rng() * 0.7, side < 0 ? Math.PI / 2 : -Math.PI / 2, true);
      }
    }
    // End caps close the street so the corridor never opens into the void.
    for (const [z, rot] of [
      [-40, 0],
      [40, Math.PI],
    ] as Array<[number, number]>) {
      for (const x of [-7, 0, 7]) {
        const src = at((Math.abs(x) + (z > 0 ? 1 : 0)) % 4);
        if (src) placeEnv(src, new THREE.Vector3(x, 0, z), 2.6, rot, true);
      }
    }
    const alleyWall = at(1);
    if (alleyWall) placeEnv(alleyWall, new THREE.Vector3(15.5, 0, -6), 2.4, -Math.PI / 2, true);

    // Streetlights + light cones.
    const coneGeo = G(new THREE.ConeGeometry(1.7, 3.6, 24, 1, true));
    coneGeo.translate(0, -1.8, 0);
    const lampSpots: Array<{ x: number; z: number; warm: boolean }> = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const src = at(i % 2 === 0 ? 4 : 5);
        if (!src) continue;
        const x = side * (ROAD_HALF + 0.7);
        const z = -27 + i * 9;
        placeEnv(src, new THREE.Vector3(x, 0.12, z), 1.3, side < 0 ? 0 : Math.PI, false);
        lampSpots.push({ x, z, warm: (i + (side > 0 ? 1 : 0)) % 2 === 0 });
      }
    }
    lampSpots.forEach((l, i) => {
      const color = l.warm ? 0xffb66e : 0x7fd8ff;
      const head = new THREE.Vector3(l.x * 0.92, 3.55, l.z);
      if (i % 2 === 0) {
        const light = new THREE.PointLight(color, l.warm ? 18 : 14, 14, 1.8);
        light.position.copy(head);
        scene.add(light);
      }
      const cone = new THREE.Mesh(
        coneGeo,
        M(
          new THREE.MeshBasicMaterial({
            color,
            alphaMap: fadeTex,
            transparent: true,
            opacity: 0.07,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        ),
      );
      cone.position.copy(head);
      scene.add(cone);
      const glow = new THREE.Sprite(
        M(new THREE.SpriteMaterial({ map: dotTex, color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })),
      );
      glow.position.copy(head);
      glow.scale.setScalar(0.9);
      scene.add(glow);
    });

    const signSrc = at(6);
    if (signSrc) {
      for (const side of [-1, 1]) {
        for (const z of [-18, 0, 15]) {
          placeEnv(signSrc, new THREE.Vector3(side * 8.7, 3 + rng() * 0.8, z), 0.95 + rng() * 0.3, side < 0 ? Math.PI / 2 : -Math.PI / 2, false);
        }
      }
    }
    const tower = at(8);
    if (tower) placeEnv(tower, new THREE.Vector3(0, 0, -36.5), 2.3, 0, false);

    // Street cover.
    const cover: Array<[number, number, number, number, number]> = [
      [3.0, 16, 7, 2.3, 0.1],
      [-3.3, 12.5, 13, 1.25, 0],
      [-0.6, 7, 10, 0.55, Math.PI / 2],
      [2.7, 2.5, 7, 2.2, -0.15],
      [-3.0, -2, 9, 0.8, 0],
      [0.4, -6.5, 13, 1.3, 0.3],
      [3.4, -10, 12, 1.6, 0],
      [-3.2, -14.5, 7, 2.3, 0.2],
      [1.2, -18.5, 13, 1.3, 0],
      [-2.4, -21.5, 12, 1.5, 0.4],
      [3.6, -27.5, 7, 2.1, 0],
      [-2.0, 22, 9, 0.8, 0],
      [-4.8, 5.5, 7, 2.0, 0.6],
      [4.9, -16.5, 13, 1.2, 0],
    ];
    const streetBoxes: THREE.Box3[] = [];
    for (const [x, z, idx, s, r] of cover) {
      const src = at(idx);
      if (!src) continue;
      const box = placeEnv(src, new THREE.Vector3(x, 0, z), s, r, false);
      streetBoxes.push(addBlocker(box));
    }
    const railSrc = at(10);
    if (railSrc) {
      for (const [x, z] of [
        [-5.6, -6],
        [5.6, 8],
        [-5.6, 19],
      ]) {
        addBlocker(placeEnv(railSrc, new THREE.Vector3(x, 0, z), 1.25, Math.PI / 2, false));
      }
    }

    // Cover points around street boxes.
    const normals = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
    for (const b of streetBoxes) {
      const c = b.getCenter(new THREE.Vector3());
      const half = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      for (const n of normals) {
        const p = new THREE.Vector3(c.x + n.x * (half.x + 0.55), 0, c.z + n.z * (half.z + 0.55));
        if (Math.abs(p.x) > ROAD_HALF + 1.5 || blockedAt(p.x, p.z, 0.35)) continue;
        coverPoints.push({ pos: p, normal: n.clone(), taken: null });
      }
    }
  }

  // ----------------------------------------------------------- navigation
  function blockedAt(x: number, z: number, r: number) {
    if (Math.abs(z) > WORLD_HALF - 0.6) return true;
    const alley = z > -8.2 && z < -2.4 && x > 0;
    if (Math.abs(x) > (alley ? 14.5 : 9.3)) return true;
    for (const b of solidBoxes) {
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return true;
    }
    return false;
  }

  function groundY(x: number) {
    return Math.abs(x) > ROAD_HALF + 0.1 ? 0.12 : 0;
  }

  const losA = new THREE.Vector3();
  const losB = new THREE.Vector3();
  function los(from: THREE.Vector3, fromH: number, to: THREE.Vector3, toH: number) {
    losA.set(from.x, from.y + fromH, from.z);
    losB.set(to.x, to.y + toH, to.z).sub(losA);
    const d = losB.length();
    if (d < 0.01) return true;
    losRay.set(losA, losB.divideScalar(d));
    losRay.far = d - 0.25;
    return losRay.intersectObjects(blockers, false).length === 0;
  }

  function moveBy(s: Soldier, dx: number, dz: number) {
    const p = s.root.position;
    if (!blockedAt(p.x + dx, p.z, 0.36)) p.x += dx;
    if (!blockedAt(p.x, p.z + dz, 0.36)) p.z += dz;
  }

  const steerV = new THREE.Vector3();
  function moveToward(s: Soldier, target: THREE.Vector3, speed: number, dt: number, arrive: number) {
    steerV.subVectors(target, s.root.position);
    steerV.y = 0;
    const d = steerV.length();
    if (d < arrive) {
      s.speed = 0;
      return true;
    }
    steerV.divideScalar(d);
    if (s.avoidTime > 0) {
      s.avoidTime -= dt;
      steerV.set(-steerV.z * s.avoidSign, 0, steerV.x * s.avoidSign);
    } else if (blockedAt(s.root.position.x + steerV.x * 0.9, s.root.position.z + steerV.z * 0.9, 0.4)) {
      const lx = s.root.position.x - steerV.z * 0.9;
      const lz = s.root.position.z + steerV.x * 0.9;
      s.avoidSign = blockedAt(lx, lz, 0.4) ? -1 : 1;
      s.avoidTime = 0.55;
    }
    const step = Math.min(speed * dt, d);
    const bx = s.root.position.x;
    const bz = s.root.position.z;
    moveBy(s, steerV.x * step, steerV.z * step);
    const moved = Math.hypot(s.root.position.x - bx, s.root.position.z - bz);
    if (moved < step * 0.3) {
      s.avoidSign = -s.avoidSign;
      s.avoidTime = 0.5;
    }
    s.speed = dt > 0 ? moved / dt : 0;
    s.faceYaw = Math.atan2(steerV.x, steerV.z);
    return false;
  }

  // ------------------------------------------------------------ soldiers
  const hitGeo = {
    head: G(new THREE.SphereGeometry(0.15, 8, 6)),
    torso: G(new THREE.BoxGeometry(0.5, 0.62, 0.34)),
    legs: G(new THREE.BoxGeometry(0.42, 0.86, 0.3)),
  };
  const laserGeo = G(new THREE.CylinderGeometry(0.006, 0.006, 1, 4, 1, true));
  laserGeo.rotateX(Math.PI / 2);
  laserGeo.translate(0, 0, 0.5);
  const hostileTex = T(diamond("#ff4d5c"));

  const enemyGeo = {
    shield: G(new THREE.BoxGeometry(0.56, 0.98, 0.05)),
    shieldStrip: G(new THREE.BoxGeometry(0.46, 0.025, 0.01)),
    droneHit: G(new THREE.SphereGeometry(0.42, 10, 8)),
    droneCore: G(new THREE.SphereGeometry(0.3, 18, 12)),
    droneEye: G(new THREE.SphereGeometry(0.075, 12, 8)),
    droneArm: G(new THREE.BoxGeometry(0.62, 0.04, 0.06)),
    droneRotor: G(new THREE.CylinderGeometry(0.19, 0.19, 0.008, 20)),
    droneHub: G(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 8)),
    droneFin: G(new THREE.BoxGeometry(0.02, 0.14, 0.22)),
  };
  function droneModel(owned: { mats: THREE.Material[] }, rotors: THREE.Object3D[]) {
    const g = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0x1f232a, metalness: 0.75, roughness: 0.32 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x220508, emissive: 0xff2a3c, emissiveIntensity: 3 });
    const blur = new THREE.MeshBasicMaterial({ color: 0x9aa6b4, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    owned.mats.push(hull, eye, blur);
    const core = new THREE.Mesh(enemyGeo.droneCore, hull);
    core.scale.set(1, 0.55, 1.25);
    core.position.y = DRONE_H;
    core.castShadow = true;
    g.add(core);
    const e = new THREE.Mesh(enemyGeo.droneEye, eye);
    e.position.set(0, DRONE_H - 0.03, 0.34);
    g.add(e);
    const fin = new THREE.Mesh(enemyGeo.droneFin, hull);
    fin.position.set(0, DRONE_H + 0.16, -0.12);
    g.add(fin);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const arm = new THREE.Mesh(enemyGeo.droneArm, hull);
      arm.position.set(Math.cos(a) * 0.3, DRONE_H + 0.03, Math.sin(a) * 0.3);
      arm.rotation.y = -a;
      arm.castShadow = true;
      g.add(arm);
      const hub = new THREE.Mesh(enemyGeo.droneHub, hull);
      hub.position.set(Math.cos(a) * 0.58, DRONE_H + 0.07, Math.sin(a) * 0.58);
      g.add(hub);
      const rotor = new THREE.Mesh(enemyGeo.droneRotor, blur);
      rotor.position.set(Math.cos(a) * 0.58, DRONE_H + 0.11, Math.sin(a) * 0.58);
      g.add(rotor);
      rotors.push(hub);
    }
    return g;
  }

  function findBone(model: THREE.Object3D, name: string) {
    return model.getObjectByName(`mixamorig${name}`) ?? model.getObjectByName(`mixamorig:${name}`) ?? null;
  }

  function spawnSoldier(team: Team, at: THREE.Vector3, name = "", kind: Kind = "rifle"): Soldier | null {
    if (!soldierSrc) return null;
    const owned = { mats: [] as THREE.Material[], tex: [] as THREE.Texture[] };
    const root = new THREE.Group();
    root.position.copy(at);
    const body = new THREE.Group();
    root.add(body);
    const isDrone = kind === "drone";
    const rotors: THREE.Object3D[] = [];
    const model = isDrone ? droneModel(owned, rotors) : cloneSkeleton(soldierSrc);
    if (!isDrone) model.rotation.y = Math.PI; // asset faces -Z; root forward is +Z
    body.add(model);
    scene.add(root);

    const tint =
      team === "hostile"
        ? new THREE.Color(kind === "heavy" ? 0x1b1e24 : kind === "sniper" ? 0x2c2834 : 0x2b2f36)
        : team === "ally"
          ? new THREE.Color(0x67705f)
          : new THREE.Color(0xd8dde0);
    const visor =
      team === "hostile" ? (kind === "heavy" ? 0xff7a1a : kind === "sniper" ? 0xb36bff : 0xff2a3c) : team === "ally" ? 0x7dffb0 : load.visor;
    if (!isDrone) model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const src = mesh.material as THREE.MeshStandardMaterial;
      const m = src.clone();
      owned.mats.push(m);
      const isVisor = /visor/i.test(mesh.name) || /visor/i.test(src.name);
      if (isVisor) {
        m.color.setHex(0x0a0d10);
        m.emissive = new THREE.Color(visor);
        m.emissiveIntensity = team === "hostile" ? 2.2 : 0.9;
        m.roughness = 0.2;
        m.metalness = 0.6;
      } else {
        m.color.lerp(tint, team === "player" ? 0.15 : team === "ally" ? 0.55 : 0.78);
        m.roughness = 0.62;
        m.metalness = team === "hostile" ? 0.35 : 0.2;
        m.envMapIntensity = 0.9;
      }
      mesh.material = m;
    });

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<string, THREE.AnimationAction> = {};
    if (!isDrone) for (const clip of clips) actions[clip.name] = mixer.clipAction(clip);
    const actor: Actor = { mixer, actions, current: "" };

    const found = ["Spine1", "Neck", "RightArm", "RightForeArm", "RightHand", "LeftArm", "LeftForeArm", "LeftHand"].map((n) =>
      findBone(model, n),
    );
    const bones: Bones | null = !isDrone && found.every(Boolean)
      ? {
          spine: found[0]!,
          neck: found[1]!,
          rArm: found[2]!,
          rFore: found[3]!,
          rHand: found[4]!,
          lArm: found[5]!,
          lFore: found[6]!,
          lHand: found[7]!,
        }
      : null;

    const pivot = new THREE.Group();
    pivot.position.set(-0.13, 1.4, 0.05);
    body.add(pivot);
    const rifle = buildRifle(
      rifleParts,
      visor,
      team === "player" ? { optic: equipped("optic"), muzzle: equipped("muzzle"), mag: equipped("mag") } : {},
    );
    owned.mats.push(rifle.accent);
    rifle.group.position.set(0, 0, 0.2);
    pivot.add(rifle.group);
    if (isDrone) {
      pivot.position.set(0, DRONE_H - 0.12, 0.15);
      rifle.group.scale.setScalar(0.35);
      rifle.group.visible = false;
    }
    if (kind === "heavy") body.scale.setScalar(1.12);
    let shield: THREE.Mesh | null = null;
    if (kind === "heavy") {
      const sm = new THREE.MeshStandardMaterial({ color: 0x23272d, metalness: 0.8, roughness: 0.35, emissive: 0xff7a1a, emissiveIntensity: 0.05 });
      owned.mats.push(sm);
      shield = new THREE.Mesh(enemyGeo.shield, sm);
      shield.position.set(0.14, 1.02, 0.46);
      shield.castShadow = true;
      body.add(shield);
      const strip = new THREE.Mesh(enemyGeo.shieldStrip, rifle.accent);
      strip.position.set(0, 0.36, 0.035);
      shield.add(strip);
      const view = new THREE.Mesh(enemyGeo.shieldStrip, rifle.accent);
      view.position.set(0, 0.18, 0.035);
      view.scale.set(0.5, 1, 1);
      shield.add(view);
    }
    let glint: THREE.Sprite | null = null;
    if (kind === "sniper") {
      const gm = new THREE.SpriteMaterial({ map: flashT, color: 0xd2a6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false });
      owned.mats.push(gm);
      glint = new THREE.Sprite(gm);
      glint.position.set(0, 0.105, 0.16);
      glint.scale.setScalar(0.0001);
      rifle.group.add(glint);
    }

    const hitboxes: THREE.Mesh[] = [];
    const mk = (geo: THREE.BufferGeometry, y: number, part: string) => {
      const h = new THREE.Mesh(geo, blockerMat);
      h.position.set(0, y, 0.02);
      h.userData.part = part;
      body.add(h);
      hitboxes.push(h);
    };
    if (isDrone) mk(enemyGeo.droneHit, DRONE_H, "torso");
    else {
      mk(hitGeo.head, 1.66, "head");
      mk(hitGeo.torso, 1.2, "torso");
      mk(hitGeo.legs, 0.45, "legs");
    }
    if (shield) {
      const h = new THREE.Mesh(enemyGeo.shield, blockerMat);
      h.position.copy(shield.position);
      h.userData.part = "shield";
      body.add(h);
      hitboxes.unshift(h);
    }

    const s: Soldier = {
      id: nextId++,
      team,
      kind,
      glint,
      rotors,
      orbit: 0,
      shield,
      name,
      root,
      body,
      model,
      actor,
      bones,
      pivot,
      rifle,
      hitboxes,
      owned,
      hp: team !== "hostile" ? PLAYER_HP : kind === "heavy" ? 260 : kind === "sniper" ? 80 : kind === "drone" ? 60 : 100,
      maxHp: team !== "hostile" ? PLAYER_HP : kind === "heavy" ? 260 : kind === "sniper" ? 80 : kind === "drone" ? 60 : 100,
      alive: true,
      down: false,
      vel: new THREE.Vector3(),
      speed: 0,
      faceYaw: 0,
      aimPoint: new THREE.Vector3(at.x, 1.3, at.z - 10),
      aimW: 0,
      aiming: false,
      flinch: 0,
      fall: 0,
      fallRoll: 0,
      deadTime: 0,
      state: "patrol",
      awareness: 0,
      reaction: 0,
      target: null,
      los: false,
      losTimer: fx() * 0.2,
      cover: null,
      coverTimer: 0,
      noLosTime: 0,
      peek: null,
      aimTimer: 0,
      burst: 0,
      burstCd: 0.6 + fx(),
      shotCd: 0,
      patrol: [],
      patrolIndex: 0,
      waitTime: fx() * 2,
      avoidSign: fx() < 0.5 ? 1 : -1,
      avoidTime: 0,
      spotted: 0,
      revive: 0,
      hurtTime: 99,
      laser: null,
      marker: null,
      tag: null,
      tagDown: null,
      tagUp: null,
      hpBar: null,
      hpFill: null,
    };
    for (const h of hitboxes) h.userData.unit = s;

    if (team === "hostile") {
      const lm = new THREE.MeshBasicMaterial({ color: kind === "sniper" ? 0xc28cff : 0xff2a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      owned.mats.push(lm);
      s.laser = new THREE.Mesh(laserGeo, lm);
      s.laser.visible = false;
      s.laser.frustumCulled = false;
      scene.add(s.laser);
      const mm = new THREE.SpriteMaterial({ map: hostileTex, transparent: true, depthTest: false, sizeAttenuation: false });
      owned.mats.push(mm);
      s.marker = new THREE.Sprite(mm);
      s.marker.scale.set(0.022, 0.022, 1);
      s.marker.position.set(0, isDrone ? DRONE_H + 0.65 : kind === "heavy" ? 2.5 : 2.25, 0);
      s.marker.visible = false;
      s.marker.renderOrder = 10;
      root.add(s.marker);
      s.hpBar = new THREE.Group();
      s.hpBar.position.set(0, isDrone ? DRONE_H + 0.45 : kind === "heavy" ? 2.32 : 2.08, 0);
      s.hpBar.visible = false;
      const bgM = new THREE.SpriteMaterial({ color: 0x1a0507, transparent: true, opacity: 0.75, depthTest: false, sizeAttenuation: false });
      const fgM = new THREE.SpriteMaterial({ color: 0xff4d5c, depthTest: false, sizeAttenuation: false });
      owned.mats.push(bgM, fgM);
      const bg = new THREE.Sprite(bgM);
      bg.scale.set(0.05, 0.006, 1);
      bg.renderOrder = 10;
      const fg = new THREE.Sprite(fgM);
      fg.scale.set(0.046, 0.0035, 1);
      fg.renderOrder = 11;
      s.hpBar.add(bg, fg);
      s.hpFill = fg;
      root.add(s.hpBar);
    }
    if (team === "ally") {
      s.tagUp = nameTag(name, "#9dffc4");
      s.tagDown = nameTag(`${name} · DOWN`, "#ff6b74");
      owned.tex.push(s.tagUp, s.tagDown);
      const tm = new THREE.SpriteMaterial({ map: s.tagUp, transparent: true, depthTest: false, sizeAttenuation: false });
      owned.mats.push(tm);
      s.tag = new THREE.Sprite(tm);
      s.tag.scale.set(0.09, 0.0225, 1);
      s.tag.position.set(0, 2.2, 0);
      s.tag.renderOrder = 10;
      root.add(s.tag);
    }

    play(s, "Idle", 1);
    soldiers.push(s);
    return s;
  }

  function removeSoldier(s: Soldier) {
    s.actor.mixer.stopAllAction();
    s.actor.mixer.uncacheRoot(s.model);
    scene.remove(s.root);
    if (s.laser) scene.remove(s.laser);
    for (const m of s.owned.mats) m.dispose();
    for (const t of s.owned.tex) t.dispose();
    if (s.cover) s.cover.taken = null;
    for (const arr of [soldiers, enemies, allies]) {
      const i = arr.indexOf(s);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  function play(s: Soldier, name: string, ts: number) {
    const a = s.actor;
    const next = a.actions[name];
    if (!next) return;
    next.timeScale = ts;
    if (a.current === name) return;
    const prev = a.actions[a.current];
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev) next.crossFadeFrom(prev, 0.22, false);
    a.current = name;
  }

  function animate(s: Soldier, forwardSpeed: number) {
    const sp = s.speed;
    if (sp < 0.25) play(s, "Idle", 1);
    else if (forwardSpeed < -0.3) play(s, "Walk", -Math.max(0.7, Math.min(1.5, sp / 1.4)));
    else if (sp > 2.4) play(s, "Run", Math.max(0.7, Math.min(1.35, sp / 4.6)));
    else play(s, "Walk", Math.max(0.7, Math.min(1.6, sp / 1.4)));
  }

  // Upper-body pass: rifle orientation, torso blade, arm IK.
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
  function upperBody(s: Soldier, dt: number) {
    s.aimW += ((s.aiming ? 1 : 0) - s.aimW) * Math.min(1, dt * 10);
    s.body.updateMatrixWorld(true);
    s.pivot.getWorldPosition(pivotWorld);
    aimTmp.copy(s.aimPoint);
    if (aimTmp.distanceTo(pivotWorld) < 2.5) aimTmp.sub(pivotWorld).setLength(2.5).add(pivotWorld);
    // Object3D convention: +Z looks at target → lookAt(eye=target, target=eye).
    lookM.lookAt(aimTmp, pivotWorld, UP);
    aimQ.setFromRotationMatrix(lookM);
    s.body.getWorldQuaternion(invBodyQ).invert();
    aimQ.premultiply(invBodyQ);
    s.pivot.quaternion.slerpQuaternions(lowReady, aimQ, s.aimW);
    s.pivot.updateMatrixWorld(true);
    if (!s.bones) return;
    const b = s.bones;
    rotateBoneWorld(b.spine, UP, -0.42 * s.aimW);
    rotateBoneWorld(b.neck, UP, 0.34 * s.aimW);
    s.rifle.rightHand.getWorldPosition(handR);
    s.rifle.leftHand.getWorldPosition(handL);
    poleR.set(-0.6, 0.8, -0.25);
    s.body.localToWorld(poleR);
    poleL.set(0.25, 0.7, 0.35);
    s.body.localToWorld(poleL);
    solveArm(b.rArm, b.rFore, b.rHand, handR, poleR);
    solveArm(b.lArm, b.lFore, b.lHand, handL, poleL);
  }

  function updateBodyPose(s: Soldier, dt: number) {
    s.flinch *= Math.exp(-9 * dt);
    if (s.kind === "drone") {
      for (const r of s.rotors) r.rotation.y += dt * 40;
      if (s.alive) {
        s.body.position.y = Math.sin(performance.now() / 500 + s.id) * 0.12;
        s.body.rotation.x = Math.min(0.35, s.speed * 0.06) + s.flinch * 0.3;
        s.body.rotation.z = Math.sin(performance.now() / 700 + s.id) * 0.06;
        const d = wrapAngle(s.faceYaw - s.root.rotation.y);
        s.root.rotation.y += d * Math.min(1, dt * 6);
      } else {
        s.fall += dt;
        s.body.position.y = Math.max(-DRONE_H + 0.28, s.body.position.y - dt * (1 + s.fall * 12));
        if (s.body.position.y > -DRONE_H + 0.3) {
          s.body.rotation.z += dt * 7;
          s.body.rotation.x += dt * 2;
        }
      }
      return;
    }
    if (!s.alive || s.down) s.fall = Math.min(1, s.fall + dt / 0.6);
    else if (s.fall > 0) s.fall = Math.max(0, s.fall - dt / 0.7);
    const f = s.fall;
    const e = f * f * (3 - 2 * f);
    const g = s.alive && !s.down ? e : f * f; // falling accelerates, rising eases
    s.body.rotation.x = -Math.PI * 0.49 * g - s.flinch * 0.16;
    s.body.rotation.z = s.fallRoll * g;
    s.body.position.y = 0.17 * g;
    if (s.alive && !s.down) {
      const d = wrapAngle(s.faceYaw - s.root.rotation.y);
      s.root.rotation.y += d * Math.min(1, dt * (s.team === "player" ? 16 : 9));
    }
    s.root.position.y += (groundY(s.root.position.x) - s.root.position.y) * Math.min(1, dt * 12);
  }

  // ----------------------------------------------------------- mission
  function clearMission() {
    for (const s of [...soldiers]) removeSoldier(s);
    for (const p of pickups) scene.remove(p.obj);
    pickups.length = 0;
    for (const t of tracers) {
      t.on = false;
      t.mesh.visible = false;
    }
    for (const c of coverPoints) c.taken = null;
    player = null;
  }

  function resetMission() {
    clearMission();
    phase = 1;
    phaseTimer = 0;
    pendingWave = 0;
    uplink = 0;
    uplinkStarted = false;
    elapsed = 0;
    kills = headshots = shots = hits = bonus = 0;
    success = false;
    deathTimer = 0;
    timeScale = 1;
    slowTimer = 0;
    shake = 0;
    damageFlash = 0;
    lastHurt = 99;
    quietTime = 0;
    yaw = Math.PI;
    pitch = -0.03;
    recoil = recoilYaw = 0;
    ads = false;
    firing = false;
    applyLoadout();
    applyMode();
    rebuildMag();
    ammo = load.mag;
    reserve = mod.reserve;
    runMedals = {};
    killTimes = [];
    hsStreak = 0;
    phaseDamage = 0;
    allyWentDown = false;
    reloadT = 0;
    bloom = 0;
    lastShot = 99;
    hud.feed.innerHTML = "";
    medalQueue = [];
    medalTimer = 0;
    hud.medal.classList.remove("on");
    hud.pops.innerHTML = "";
    hud.banner.classList.remove("on");
    progGeo.setDrawRange(0, 0);
    padMat.color.setHex(0x3c6e74);
    beamMat.opacity = 0;

    player = spawnSoldier("player", SPAWN.clone(), "YOU");
    if (player) player.faceYaw = player.root.rotation.y = Math.PI;
    const off: Array<[number, number]> = [
      [-1.8, 2],
      [1.9, 2.8],
    ];
    ALLY_NAMES.forEach((n, i) => {
      const a = spawnSoldier("ally", new THREE.Vector3(SPAWN.x + off[i][0], 0, SPAWN.z + off[i][1]), n);
      if (a) {
        a.faceYaw = a.root.rotation.y = Math.PI;
        allies.push(a);
      }
    });
    spawnWave(mode === "daily" ? shuffleSpots(WAVE1, dailyOf(todayUTC()).seed) : WAVE1, false);
    buildSquadHud();
    setObjective();
    updateHud(true);
  }

  function applyMode() {
    const id = mode === "daily" ? dailyOf(todayUTC()).mod.id : "";
    mod.night = id === "night";
    mod.bodyDmg = id === "headhunt" ? 0.55 : 1;
    mod.reserve = id === "scarce" ? 60 : RESERVE;
    mod.drop = id === "scarce" ? 0.4 : 0.75;
    mod.regen = id !== "ironman";
    mod.enemyAcc = id === "blitz" ? 1.25 : 1;
    mod.reaction = id === "blitz" ? 0.6 : 1;
    renderer.toneMappingExposure = mod.night ? 0.8 : 0.95;
    scene.backgroundIntensity = mod.night ? 0.03 : 0.16;
    (scene.fog as THREE.FogExp2).density = mod.night ? 0.034 : 0.026;
    hemi.intensity = mod.night ? 0.32 : 0.55;
    sun.intensity = mod.night ? 0.45 : 1.7;
    sun.color.setHex(mod.night ? 0x7d92d6 : 0xff9f6a);
    rainMat.opacity = mod.night ? 0.4 : 0.28;
  }

  /** Daily layout: deterministic jitter of the patrol positions. */
  function shuffleSpots(spots: Spot[], seed: number): Spot[] {
    const r = mulberry32(seed);
    return spots.map(([x, z, kind]) => {
      if (kind) return [x, z, kind] as Spot;
      for (let k = 0; k < 6; k++) {
        const nx = THREE.MathUtils.clamp(x + (r() - 0.5) * 6, -ROAD_HALF + 0.8, ROAD_HALF - 0.8);
        const nz = z + (r() - 0.5) * 5;
        if (!blockedAt(nx, nz, 0.6)) return [nx, nz] as Spot;
      }
      return [x, z] as Spot;
    });
  }

  function spawnWave(spots: Spot[], alerted: boolean) {
    for (const [x, z, kind = "rifle"] of spots) {
      const e = spawnSoldier("hostile", new THREE.Vector3(x, 0, z), KIND_LABEL[kind], kind);
      if (!e) continue;
      if (kind === "sniper") {
        e.faceYaw = e.root.rotation.y = z < 0 ? 0 : Math.PI;
        e.patrol.push(new THREE.Vector3(x, 0, z));
        if (alerted) alertEnemy(e, 0.8);
      } else if (kind === "drone" || kind === "heavy") {
        e.faceYaw = e.root.rotation.y = z > (player?.root.position.z ?? 0) ? Math.PI : 0;
        e.orbit = fx() * Math.PI * 2;
        alertEnemy(e, 0.3);
      } else if (!alerted) {
        e.faceYaw = e.root.rotation.y = fx() * Math.PI * 2;
        for (let k = 0; k < 3; k++) {
          const px = THREE.MathUtils.clamp(x + (fx() - 0.5) * 5, -ROAD_HALF + 0.8, ROAD_HALF - 0.8);
          const pz = z + (fx() - 0.5) * 6;
          if (!blockedAt(px, pz, 0.5)) e.patrol.push(new THREE.Vector3(px, 0, pz));
        }
        e.patrol.push(new THREE.Vector3(x, 0, z));
      } else {
        e.faceYaw = e.root.rotation.y = z > (player?.root.position.z ?? 0) ? Math.PI : 0;
        alertEnemy(e, 0.2);
      }
      enemies.push(e);
    }
  }

  const PHASES = [
    { k: "PHASE 1/3", t: "CLEAR THE STREET" },
    { k: "PHASE 2/3", t: "REPEL REINFORCEMENTS" },
    { k: "PHASE 3/3", t: "HOLD THE UPLINK" },
  ];

  function hostilesLeft() {
    let n = 0;
    for (const e of enemies) if (e.alive) n++;
    return n;
  }

  function setObjective() {
    const p = PHASES[phase - 1];
    hud.objPhase.textContent = p.k;
    hud.objTitle.textContent = p.t;
  }

  function advancePhase() {
    bonus += 250;
    if (phaseDamage === 0) medal("untouchable");
    phaseDamage = 0;
    addPop("+250 SECTOR CLEAR", false);
    if (phase === 1) {
      phase = 2;
      pendingWave = 2;
      phaseTimer = 3.2;
      banner("PHASE 2 / 3", "REINFORCEMENTS INBOUND", "Hostile squad entering from the north end", true, 3.2);
      audio.alarm();
    } else if (phase === 2) {
      phase = 3;
      banner("PHASE 3 / 3", "REACH THE UPLINK", "Stand on the pad until the upload completes", false, 3.4);
      audio.objective();
      padMat.color.setHex(0x6ff2e3);
    }
    setObjective();
  }

  function finishMission(won: boolean) {
    if (stage !== "playing") return;
    success = won;
    stage = "dead"; // short cinematic hold before the debrief
    deathTimer = 0;
    firing = false;
    ads = false;
    if (won) {
      bonus += 500;
      if (player && player.hp < 30) medal("clutch");
      banner("UPLINK COMPLETE", "EXTRACTION CONFIRMED", "", false, 2.6);
      audio.objective();
    } else {
      banner("OPERATOR DOWN", "MISSION FAILED", "", true, 2.4);
    }
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  // ------------------------------------------------------------- combat
  const aimTargets: THREE.Object3D[] = [];
  function collectTargets() {
    aimTargets.length = 0;
    for (const e of enemies) if (e.alive) for (const h of e.hitboxes) aimTargets.push(h);
    for (const b of blockers) aimTargets.push(b);
    return aimTargets;
  }

  const muzzleW = new THREE.Vector3();
  function muzzleOf(s: Soldier, out: THREE.Vector3) {
    return s.rifle.muzzle.getWorldPosition(out);
  }

  function spreadNow() {
    const moving = player ? Math.min(1, player.speed / 6) : 0;
    const base = ads ? 0.22 * load.adsSpread : 1.2;
    return THREE.MathUtils.degToRad(base + moving * (ads ? 0.7 : 2.2) + bloom);
  }

  const shotDir = new THREE.Vector3();
  const sideV = new THREE.Vector3();
  const upV = new THREE.Vector3();
  function playerFire() {
    if (!player || !player.alive || fireCd > 0 || reloadT > 0) return;
    if (ammo <= 0) {
      audio.dry();
      fireCd = 0.25;
      if (reserve > 0) startReload();
      return;
    }
    fireCd = FIRE_INTERVAL;
    ammo -= 1;
    shots += 1;
    shotsFired += 1;
    lastShot = 0;
    audio.rifle();
    alertByNoise(player.root.position, load.noise);

    const sp = spreadNow();
    const ang = fx() * Math.PI * 2;
    const r = sp * Math.sqrt(fx());
    sideV.crossVectors(fwd3, UP).normalize();
    upV.crossVectors(sideV, fwd3).normalize();
    shotDir.copy(fwd3).addScaledVector(sideV, Math.cos(ang) * r).addScaledVector(upV, Math.sin(ang) * r).normalize();
    ray.set(camera.position, shotDir);
    ray.far = 120;
    const minD = camera.position.distanceTo(camPivot) * 0.9;
    const first = ray.intersectObjects(collectTargets(), false).find((h) => h.distance > minD);
    const impact = first ? first.point.clone() : camera.position.clone().addScaledVector(shotDir, 120);

    // The bullet actually leaves the muzzle: cover right in front of us stops it.
    muzzleOf(player, muzzleW);
    let hitObj = first?.object;
    tmpV2.subVectors(impact, muzzleW);
    const md = tmpV2.length();
    if (md > 0.3) {
      losRay.set(muzzleW, tmpV2.divideScalar(md));
      losRay.far = md - 0.15;
      const blk = losRay.intersectObjects(blockers, false)[0];
      if (blk) {
        impact.copy(blk.point);
        hitObj = blk.object;
      }
    }
    const supp = load.noise < 20;
    spawnFlash(muzzleW, supp ? 0.16 : 0.42);
    muzzleLight.position.copy(muzzleW);
    muzzleLight.intensity = supp ? 4 : 22;
    spawnTracer(muzzleW, impact, 0xffd9a0);

    const unit = hitObj?.userData.unit as Soldier | undefined;
    if (unit && unit.alive && hitObj?.userData.part === "shield") {
      hits += 1;
      spawnSparks(impact, 0xffb36a, 1, tmpV3.copy(shotDir).negate());
      audio.impact(impact.distanceTo(camera.position) * 0.5, 0);
      if (unit.shield) (unit.shield.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
      unit.spotted = 5;
      if (unit.state !== "combat") alertEnemy(unit, 0.2);
    } else if (unit && unit.alive && hitObj) {
      const part = hitObj.userData.part as string;
      hits += 1;
      const dmg = (part === "head" ? DMG_HEAD : (part === "legs" ? DMG_LEGS : DMG_BODY) * mod.bodyDmg) * load.dmg;
      spawnSparks(impact, 0xff6a4a, 0.7);
      spawnPuff(impact, 0x4a0a0c, 0.6, 0.45, 0.6);
      damage(unit, dmg, player, part === "head");
    } else if (first) {
      tmpV3.copy(shotDir).negate();
      spawnSparks(impact, 0xffd49a, 0.8, tmpV3);
      spawnPuff(impact, 0x9aa0a6, 0.7, 0.6);
      audio.impact(impact.distanceTo(camera.position), 0);
    }
    const k = ads ? 0.55 : 1;
    recoil += (0.0085 + fx() * 0.004) * k * load.recoil;
    recoilYaw += (fx() - 0.45) * 0.005 * k * load.recoil;
    bloom = Math.min(2.2, bloom + (ads ? 0.18 : 0.32));
    shake = Math.min(0.12, shake + 0.03);
    if (ammo === 0 && reserve > 0) startReload();
  }

  function startReload() {
    if (!player || !player.alive || reloadT > 0 || ammo >= load.mag || reserve <= 0) return;
    reloadDur = (ammo === 0 ? RELOAD_EMPTY : RELOAD_TIME) + load.reloadExtra;
    reloadT = reloadDur;
    reloadStage = 0;
    audio.reloadOut();
  }

  function updateReload(dt: number) {
    if (reloadT <= 0) return;
    reloadT -= dt;
    const p = 1 - reloadT / reloadDur;
    if (reloadStage === 0 && p > 0.55) {
      reloadStage = 1;
      audio.reloadIn();
    }
    if (reloadStage === 1 && p > 0.82 && ammo === 0) {
      reloadStage = 2;
      audio.bolt();
    }
    if (reloadT <= 0) {
      reloadT = 0;
      const take = Math.min(load.mag - ammo, reserve);
      ammo += take;
      reserve -= take;
    }
  }

  function damage(target: Soldier, amount: number, src: Soldier | null, head = false) {
    if (!target.alive || target.down) return;
    target.hp -= amount;
    target.flinch = 1;
    target.hurtTime = 0;
    if (target.team === "hostile") {
      if (target.hpBar) target.hpBar.visible = true;
      if (target.hpFill) target.hpFill.scale.x = 0.046 * Math.max(0, target.hp / target.maxHp);
      target.spotted = 5;
      if (target.state !== "combat" && target.hp > 0) alertEnemy(target, 0.15);
      if (src?.team === "player") {
        showHit(target.hp <= 0 ? "kill" : head ? "hs" : "hit");
        if (target.hp > 0) audio.hitmarker();
      }
      if (target.hp <= 0) killEnemy(target, src, head);
      else if (fx() < 0.35) target.coverTimer = 0; // relocate under fire
      return;
    }
    if (target.team === "player") {
      lastHurt = 0;
      phaseDamage += amount;
      buzz(35);
      damageFlash = Math.min(1, damageFlash + amount / 30);
      shake = Math.min(0.25, shake + 0.08);
      audio.hurt();
      if (src) addDamageIndicator(src.root.position);
      if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        target.fallRoll = (fx() - 0.5) * 0.5;
        finishMission(false);
      }
      return;
    }
    if (target.hp <= 0) {
      target.hp = 0;
      target.down = true;
      allyWentDown = true;
      target.revive = 0;
      target.fallRoll = (fx() - 0.5) * 0.6;
      if (target.tag && target.tagDown) (target.tag.material as THREE.SpriteMaterial).map = target.tagDown;
      feed(`<em>${esc(target.name)}</em> DOWN — REVIVE`, "bad");
    }
  }

  function killEnemy(e: Soldier, src: Soldier | null, head: boolean) {
    e.alive = false;
    e.hp = 0;
    e.deadTime = 0;
    e.fallRoll = (fx() - 0.5) * 0.7;
    if (e.cover) e.cover.taken = null;
    e.cover = null;
    if (e.laser) e.laser.visible = false;
    if (e.marker) e.marker.visible = false;
    if (e.hpBar) e.hpBar.visible = false;
    if (src) {
      e.faceYaw = Math.atan2(src.root.position.x - e.root.position.x, src.root.position.z - e.root.position.z);
      e.root.rotation.y = e.faceYaw;
    }
    kills += 1;
    const byPlayer = src?.team === "player";
    if (e.kind === "drone") {
      tmpV.set(e.root.position.x, DRONE_H + e.body.position.y, e.root.position.z);
      spawnFlash(tmpV, 2.2);
      spawnSparks(tmpV, 0xffa040, 2.2);
      spawnSparks(tmpV, 0xff5030, 1.6);
      spawnPuff(tmpV, 0x2a2a2e, 2.4, 1.4, 0.8);
      audio.explode(camera.position.distanceTo(tmpV), panOf(tmpV));
      if (camera.position.distanceTo(tmpV) < 10) shake = Math.min(0.3, shake + 0.15);
    }
    if (byPlayer && e.kind === "heavy") medal("giantslayer");
    if (byPlayer && e.kind === "sniper") medal("countersniper");
    if (byPlayer && e.kind === "drone") medal("skeet");
    if (byPlayer && player) {
      const now = elapsed;
      killTimes = killTimes.filter((t) => now - t < 1.8);
      killTimes.push(now);
      if (killTimes.length === 3) medal("triple");
      else if (killTimes.length === 2) medal("double");
      hsStreak = head ? hsStreak + 1 : 0;
      if (hsStreak === 3) medal("headhunter");
      if (e.state === "patrol") medal("ghost");
      if (e.root.position.distanceTo(player.root.position) > 28) medal("marksman");
    }
    const label = KIND_LABEL[e.kind];
    if (byPlayer) {
      const worth = (e.kind === "heavy" ? 250 : e.kind === "sniper" ? 200 : e.kind === "drone" ? 150 : 100) + (head ? 50 : 0);
      bonus += worth;
      if (head) {
        headshots += 1;
        audio.headshot();
        buzz([15, 30, 15]);
        addPop(`HEADSHOT +${worth}`, true);
      } else {
        audio.kill();
        buzz(20);
        addPop(`${e.kind === "rifle" ? "ELIMINATED" : `${label} DOWN`} +${worth}`, e.kind !== "rifle");
      }
    } else {
      bonus += 50;
    }
    feed(`${esc(byPlayer ? "YOU" : src?.name ?? "SQUAD")} <em>✕</em> ${label}${head ? " <u>◎ HEADSHOT</u>" : ""}`, head ? "hs" : "");
    if (fx() < mod.drop) dropAmmo(e.root.position);
    if (hostilesLeft() === 0 && pendingWave === 0 && phase < 3) {
      timeScale = 0.3;
      slowTimer = 0.7;
      advancePhase();
    }
  }

  function tgtH(s: Soldier) {
    return s.kind === "drone" ? DRONE_H + s.body.position.y : 1.25;
  }

  function closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
    tmpV2.subVectors(b, a);
    const l2 = tmpV2.lengthSq();
    const t = l2 > 0 ? THREE.MathUtils.clamp(tmpV.copy(p).sub(a).dot(tmpV2) / l2, 0, 1) : 0;
    return tmpV.copy(a).addScaledVector(tmpV2, t).distanceTo(p);
  }

  function panOf(pos: THREE.Vector3) {
    tmpV.subVectors(pos, camera.position).normalize();
    return THREE.MathUtils.clamp(tmpV.dot(camRight) * 0.85, -0.85, 0.85);
  }

  const shotEnd = new THREE.Vector3();
  function remoteShot(shooter: Soldier, t: Soldier, hit: boolean, aimH: number, spread: number) {
    muzzleOf(shooter, muzzleW);
    shotEnd.set(t.root.position.x, t.root.position.y + aimH, t.root.position.z);
    const d = muzzleW.distanceTo(shotEnd);
    if (!hit) {
      shotEnd.x += (fx() - 0.5) * spread;
      shotEnd.y += (fx() - 0.3) * spread * 0.55;
      shotEnd.z += (fx() - 0.5) * spread;
      tmpV.subVectors(shotEnd, muzzleW).normalize();
      shotEnd.copy(muzzleW).addScaledVector(tmpV, d + 12);
    }
    tmpV2.subVectors(shotEnd, muzzleW);
    const len = tmpV2.length();
    losRay.set(muzzleW, tmpV2.divideScalar(len));
    losRay.far = hit ? len - 0.3 : len;
    const blk = losRay.intersectObjects(blockers, false)[0];
    if (blk) shotEnd.copy(blk.point);
    const hostile = shooter.team === "hostile";
    spawnFlash(muzzleW, 0.36);
    spawnTracer(muzzleW, shotEnd, hostile ? 0xff6a5a : 0xbff7d8, hostile ? 210 : 240);
    audio.remoteShot(camera.position.distanceTo(muzzleW), panOf(shooter.root.position), hostile);
    if (blk) {
      spawnSparks(shotEnd, 0xffc48a, 0.6);
      spawnPuff(shotEnd, 0x8a9096, 0.5, 0.5);
      return false;
    }
    if (hit) {
      spawnSparks(shotEnd, 0xff7050, 0.5);
      return true;
    }
    if (t === player) {
      tmpV3.set(player.root.position.x, 1.4, player.root.position.z);
      if (closestOnSegment(muzzleW, shotEnd, tmpV3) < 2.2) {
        audio.whiz(panOf(shooter.root.position));
        shake = Math.min(0.2, shake + 0.03);
      }
    }
    return false;
  }

  function enemyFire(e: Soldier, t: Soldier, accMul = 1) {
    const d = e.root.position.distanceTo(t.root.position);
    let aimH = 1.25;
    let p = 0.42 * accMul * mod.enemyAcc * THREE.MathUtils.clamp(1.25 - d / 28, 0.3, 1);
    // Chest behind cover? Then only the head is exposed.
    if (!los(e.root.position, 1.45, t.root.position, 1.15)) {
      aimH = 1.62;
      p *= 0.45;
    }
    if (t === player) {
      if (player.speed > 4.5) p *= 0.5;
      else if (player.speed > 1) p *= 0.72;
    }
    if (phase === 3) p *= 1.1;
    if (remoteShot(e, t, fx() < p, aimH, 1.6)) damage(t, t === player ? 6 + Math.floor(fx() * 4) : 10 + Math.floor(fx() * 5), e);
  }

  function allyFire(a: Soldier, t: Soldier) {
    const d = a.root.position.distanceTo(t.root.position);
    const p = 0.4 * THREE.MathUtils.clamp(1.3 - d / 30, 0.35, 1);
    // Heavy shields stop frontal fire from the squad too.
    if (t.kind === "heavy") {
      tmpV.subVectors(a.root.position, t.root.position).setY(0).normalize();
      if (tmpV.x * Math.sin(t.root.rotation.y) + tmpV.z * Math.cos(t.root.rotation.y) > 0.45) {
        remoteShot(a, t, false, 1.1, 0.3);
        alertByNoise(a.root.position, 22);
        return;
      }
    }
    if (remoteShot(a, t, fx() < p, tgtH(t), 1.4)) damage(t, 15, a, false);
    alertByNoise(a.root.position, 22);
  }

  function alertEnemy(e: Soldier, reaction: number) {
    if (!e.alive || e.state === "combat") return;
    e.state = "combat";
    e.reaction = reaction * mod.reaction;
    e.coverTimer = 0;
    e.burstCd = 0.5 + fx() * 0.6;
  }

  function alertByNoise(pos: THREE.Vector3, radius: number) {
    for (const e of enemies) {
      if (!e.alive || e.state === "combat") continue;
      if (e.root.position.distanceTo(pos) < radius) alertEnemy(e, 0.35 + fx() * 0.4);
    }
  }

  // Ammo pickups.
  const pickRingGeo = G(new THREE.RingGeometry(0.42, 0.5, 32));
  const pickRingMat = M(
    new THREE.MeshBasicMaterial({ color: 0x6ff2e3, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  let crateBox: THREE.Box3 | null = null;
  function dropAmmo(at: THREE.Vector3) {
    if (!crateSrc) return;
    if (!crateBox) crateBox = new THREE.Box3().setFromObject(crateSrc);
    const g = new THREE.Group();
    g.position.set(at.x + (fx() - 0.5) * 0.6, groundY(at.x), at.z + (fx() - 0.5) * 0.6);
    const c = crateSrc.clone(true);
    c.scale.setScalar(0.55);
    const inner = new THREE.Group();
    inner.add(c);
    c.position.y = -crateBox.min.y * 0.55;
    g.add(inner);
    const ring = new THREE.Mesh(pickRingGeo, pickRingMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    scene.add(g);
    pickups.push({ obj: g, ring, life: 45, t: fx() * 6 });
  }

  function updatePickups(dt: number) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.life -= dt;
      p.t += dt;
      const inner = p.obj.children[0];
      inner.rotation.y += dt * 1.4;
      inner.position.y = 0.16 + Math.sin(p.t * 3) * 0.05;
      p.ring.scale.setScalar(1 + Math.sin(p.t * 4) * 0.08);
      let take = false;
      if (player?.alive && player.root.position.distanceTo(p.obj.position) < 1.3 && reserve < RESERVE_MAX) {
        reserve = Math.min(RESERVE_MAX, reserve + MAG);
        audio.pickup();
        addPop("+30 AMMO", false);
        take = true;
      }
      if (take || p.life <= 0) {
        scene.remove(p.obj);
        pickups.splice(i, 1);
      }
    }
  }

  // ----------------------------------------------------------- AI: enemy
  function pickTarget(e: Soldier): Soldier | null {
    let bestT: Soldier | null = null;
    let bestScore = Infinity;
    const cands: Soldier[] = [];
    if (player?.alive) cands.push(player);
    for (const a of allies) if (a.alive && !a.down) cands.push(a);
    for (const c of cands) {
      const d = e.root.position.distanceTo(c.root.position);
      const score = d * (c === player ? 0.75 : 1) + fx() * 6;
      if (score < bestScore) {
        bestScore = score;
        bestT = c;
      }
    }
    return bestT;
  }

  function chooseCover(e: Soldier, threat: THREE.Vector3) {
    let bestC: CoverPoint | null = null;
    let bestS = Infinity;
    for (const c of coverPoints) {
      if (c.taken && c.taken !== e && c.taken.alive) continue;
      const de = c.pos.distanceTo(e.root.position);
      if (de > 15) continue;
      const dt = c.pos.distanceTo(threat);
      if (dt < 6 || dt > 28) continue;
      tmpV.subVectors(threat, c.pos).setY(0).normalize();
      const protect = -tmpV.dot(c.normal);
      if (protect < 0.35) continue;
      const s = de + Math.abs(dt - 15) * 0.45 - protect * 4 + fx() * 2.5;
      if (s < bestS) {
        bestS = s;
        bestC = c;
      }
    }
    if (e.cover && e.cover !== bestC) e.cover.taken = null;
    e.cover = bestC;
    if (bestC) bestC.taken = e;
  }

  const chase = new THREE.Vector3();
  function updateEnemy(e: Soldier, dt: number) {
    e.spotted = Math.max(0, e.spotted - dt);
    e.hurtTime += dt;
    if (!e.alive) {
      e.deadTime += dt;
      if (e.deadTime > 8) e.root.position.y -= dt * 0.35;
      if (e.deadTime > 10) removeSoldier(e);
      return;
    }
    e.burstCd -= dt;
    e.shotCd -= dt;
    e.losTimer -= dt;
    const bx = e.root.position.x;
    const bz = e.root.position.z;
    if (e.kind !== "rifle") {
      updateSpecial(e, dt, bx, bz);
      if (e.marker) e.marker.visible = e.spotted > 0;
      if (e.spotted > 0) announceThreat(e.kind);
      return;
    }

    if (e.state === "patrol") {
      e.aiming = false;
      if (player?.alive) {
        const d = e.root.position.distanceTo(player.root.position);
        if (e.losTimer <= 0) {
          e.losTimer = 0.2;
          tmpV.subVectors(player.root.position, e.root.position).setY(0).normalize();
          const facing = Math.sin(e.root.rotation.y) * tmpV.x + Math.cos(e.root.rotation.y) * tmpV.z;
          e.los = d < 24 && (facing > 0.45 || d < 4) && los(e.root.position, 1.5, player.root.position, 1.3);
        }
        if (e.los) {
          const rate = (d < 8 ? 1.5 : d < 16 ? 0.55 : 0.25) * (player.speed > 4.5 ? 1.7 : player.speed < 0.5 ? 0.7 : 1);
          e.awareness += rate * dt;
          if (e.awareness >= 1) {
            alertEnemy(e, 0.25);
            for (const o of enemies) {
              if (o !== e && o.alive && o.root.position.distanceTo(e.root.position) < 14) alertEnemy(o, 0.6 + fx() * 0.5);
            }
          }
        } else e.awareness = Math.max(0, e.awareness - dt * 0.3);
      }
      if (e.waitTime > 0) {
        e.waitTime -= dt;
        e.speed = 0;
      } else if (e.patrol.length) {
        const wp = e.patrol[e.patrolIndex % e.patrol.length];
        if (moveToward(e, wp, 1.25, dt, 0.5)) {
          e.patrolIndex++;
          e.waitTime = 1.5 + fx() * 2.5;
        }
      }
      if (e.laser) e.laser.visible = false;
    } else {
      if (e.reaction > 0) {
        e.reaction -= dt;
        e.speed = 0;
      }
      if (!e.target || !e.target.alive || e.target.down || fx() < dt * 0.15) e.target = pickTarget(e);
      let t = e.target;
      if (e.losTimer <= 0) {
        e.losTimer = 0.18 + fx() * 0.1;
        e.los = !!t && los(e.root.position, 1.5, t.root.position, 1.3);
        if (t && !e.los) {
          const alt = [player, ...allies].find((c) => c && c.alive && !c.down && c !== t && los(e.root.position, 1.5, c.root.position, 1.3));
          if (alt) {
            e.target = t = alt;
            e.los = true;
          }
        }
      }
      if (e.los && t === player) e.spotted = 4;
      e.noLosTime = e.los ? 0 : e.noLosTime + dt;
      e.coverTimer -= dt;
      const threat = t ? t.root.position : (player?.root.position ?? SPAWN);
      if (e.coverTimer <= 0) {
        chooseCover(e, threat);
        e.coverTimer = 7 + fx() * 6;
        e.peek = null;
      }
      let dest: THREE.Vector3 | null = null;
      let run = 3.6;
      if (e.peek) dest = e.peek;
      else if (e.cover) dest = e.cover.pos;
      else if (t && (!e.los || e.root.position.distanceTo(t.root.position) > 22)) {
        dest = chase.copy(t.root.position);
        run = 2.8;
      }
      if (e.noLosTime > 2.6 && t) {
        // Peek: sidestep from cover until there's a line to the target.
        e.noLosTime = 0;
        const nx = e.cover ? e.cover.normal.x : 0;
        const nz = e.cover ? e.cover.normal.z : 1;
        for (const side of fx() < 0.5 ? [1, -1] : [-1, 1]) {
          for (const dist of [1.2, 2]) {
            tmpV3.set(e.root.position.x - nz * side * dist, 0, e.root.position.z + nx * side * dist);
            if (!blockedAt(tmpV3.x, tmpV3.z, 0.4) && los(tmpV3, 1.5, t.root.position, 1.3)) {
              e.peek = tmpV3.clone();
              break;
            }
          }
          if (e.peek) break;
        }
        if (!e.peek) {
          if (e.cover) e.cover.taken = null;
          e.cover = null;
          e.coverTimer = 3;
        }
      }
      let moving = false;
      if (e.reaction <= 0 && dest) {
        const arrived = moveToward(e, dest, e.burst > 0 ? 1.6 : run, dt, 0.35);
        moving = !arrived;
        if (arrived && e.peek && !e.los) e.peek = null;
      }
      if (!moving) e.speed = 0;
      const canShoot = e.reaction <= 0 && !!t && e.los && e.root.position.distanceTo(t.root.position) < 36;
      e.aiming = true;
      if (t) {
        e.aimPoint.set(t.root.position.x, t.root.position.y + 1.25, t.root.position.z);
        if (!moving || canShoot) e.faceYaw = Math.atan2(t.root.position.x - e.root.position.x, t.root.position.z - e.root.position.z);
      }
      if (canShoot && t) {
        if (e.burst === 0 && e.burstCd <= 0) {
          if (e.aimTimer < 0.55) e.aimTimer += dt;
          else {
            e.burst = 3 + Math.floor(fx() * 2);
            e.aimTimer = 0;
          }
        }
        if (e.burst > 0 && e.shotCd <= 0 && Math.abs(wrapAngle(e.faceYaw - e.root.rotation.y)) < 0.35) {
          enemyFire(e, t);
          e.burst -= 1;
          e.shotCd = 0.11;
          if (e.burst === 0) e.burstCd = 1.0 + fx() * 1.3;
        }
      } else {
        e.aimTimer = Math.max(0, e.aimTimer - dt);
        e.burst = 0;
      }
      if (e.laser) {
        const show = canShoot && (e.aimTimer > 0 || e.burst > 0);
        e.laser.visible = show;
        if (show) {
          muzzleOf(e, muzzleW);
          e.laser.position.copy(muzzleW);
          e.laser.lookAt(e.aimPoint);
          e.laser.scale.set(1, 1, muzzleW.distanceTo(e.aimPoint));
          (e.laser.material as THREE.MeshBasicMaterial).opacity = e.burst > 0 ? 0.65 : 0.15 + (e.aimTimer / 0.55) * 0.4;
        }
      }
    }
    const fwd = (e.root.position.x - bx) * Math.sin(e.root.rotation.y) + (e.root.position.z - bz) * Math.cos(e.root.rotation.y);
    animate(e, dt > 0 ? fwd / dt : 0);
    if (e.marker) e.marker.visible = e.spotted > 0;
  }

  // ------------------------------------------------- AI: special hostiles
  const seenThreats = new Set<string>(store<{ k: string[] }>("playverse:nexusThreats", { k: [] }).k);
  function announceThreat(kind: Kind) {
    if (kind === "rifle" || seenThreats.has(kind) || stage !== "playing") return;
    seenThreats.add(kind);
    save("playverse:nexusThreats", { k: [...seenThreats] });
    const info = KIND_INFO[kind];
    banner("NEW THREAT", info.t, info.s, true, 3.4);
    audio.alarm();
  }

  const strafe = new THREE.Vector3();
  function updateSpecial(e: Soldier, dt: number, bx: number, bz: number) {
    // --- target + line of sight (shared)
    if (e.state === "combat") {
      if (e.reaction > 0) e.reaction -= dt;
      if (!e.target || !e.target.alive || e.target.down || fx() < dt * 0.12) e.target = pickTarget(e);
    }
    const eye = e.kind === "drone" ? DRONE_H : 1.5;
    let t = e.target;
    if (e.losTimer <= 0) {
      e.losTimer = 0.2 + fx() * 0.1;
      if (e.state === "patrol") {
        // sniper scanning the street through the scope
        const p = player;
        if (p?.alive) {
          const d = e.root.position.distanceTo(p.root.position);
          tmpV.subVectors(p.root.position, e.root.position).setY(0).normalize();
          const facing = Math.sin(e.root.rotation.y) * tmpV.x + Math.cos(e.root.rotation.y) * tmpV.z;
          e.los = d < 46 && facing > 0.55 && los(e.root.position, eye, p.root.position, 1.3);
        }
      } else {
        e.los = !!t && los(e.root.position, eye, t.root.position, 1.3);
        if (t && !e.los) {
          const alt = [player, ...allies].find((c) => c && c.alive && !c.down && c !== t && los(e.root.position, eye, c.root.position, 1.3));
          if (alt) {
            e.target = t = alt;
            e.los = true;
          }
        }
      }
    }
    if (e.state === "patrol") {
      e.aiming = false;
      e.speed = 0;
      e.faceYaw = (e.root.position.z < 0 ? 0 : Math.PI) + Math.sin(elapsed * 0.35 + e.id) * 0.55;
      if (e.los && player) {
        e.awareness += (e.root.position.distanceTo(player.root.position) < 25 ? 0.9 : 0.45) * dt;
        if (e.awareness >= 1) alertEnemy(e, 0.2);
      } else e.awareness = Math.max(0, e.awareness - dt * 0.2);
      if (e.kind === "sniper") animate(e, 0);
      return;
    }
    if (e.los && t === player) e.spotted = 4;
    const d = t ? e.root.position.distanceTo(t.root.position) : 99;
    if (t) {
      e.aimPoint.set(t.root.position.x, t.root.position.y + 1.25, t.root.position.z);
      e.faceYaw = Math.atan2(t.root.position.x - e.root.position.x, t.root.position.z - e.root.position.z);
    }
    let laserOn = false;
    let laserOpacity = 0;

    if (e.kind === "heavy") {
      // Relentless advance behind the shield, long bursts at mid range.
      e.aiming = true;
      if (t && e.reaction <= 0 && (!e.los || d > 9)) moveToward(e, t.root.position, 1.7, dt, 8.5);
      else e.speed = 0;
      if (e.shield) {
        const m = e.shield.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = Math.max(0.05, m.emissiveIntensity - dt * 2.5);
      }
      if (t && e.los && e.reaction <= 0 && d < 34) {
        if (e.burst === 0 && e.burstCd <= 0) {
          e.aimTimer += dt;
          if (e.aimTimer > 0.5) {
            e.burst = 6;
            e.aimTimer = 0;
          }
        }
        if (e.burst > 0 && e.shotCd <= 0) {
          enemyFire(e, t, 0.7);
          e.burst--;
          e.shotCd = 0.12;
          if (e.burst === 0) e.burstCd = 1.4 + fx() * 0.8;
        }
        laserOn = e.aimTimer > 0 || e.burst > 0;
        laserOpacity = e.burst > 0 ? 0.6 : 0.2 + e.aimTimer * 0.6;
      } else e.burst = 0;
      const fwd = (e.root.position.x - bx) * Math.sin(e.root.rotation.y) + (e.root.position.z - bz) * Math.cos(e.root.rotation.y);
      animate(e, dt > 0 ? fwd / dt : 0);
    } else if (e.kind === "sniper") {
      // Holds position; long telegraphed aim (laser + glint), one heavy shot.
      e.speed = 0;
      e.aiming = true;
      animate(e, 0);
      if (t && e.los && d < 58 && e.reaction <= 0) {
        if (e.aimTimer < 0) e.aimTimer += dt; // post-shot cooldown
        else {
          e.aimTimer += dt;
          laserOn = true;
          laserOpacity = 0.25 + Math.min(1, e.aimTimer / 2) * 0.65;
          e.spotted = 4;
          if (e.aimTimer >= 2.1) {
            sniperShot(e, t);
            e.aimTimer = -1.8;
          }
        }
      } else if (e.aimTimer > 0) e.aimTimer = Math.max(0, e.aimTimer - dt * 1.5);
      if (e.glint) {
        const k = e.aimTimer > 0 ? Math.min(1, e.aimTimer / 2) : 0;
        e.glint.scale.setScalar(k > 0 ? 0.03 + k * 0.05 + Math.sin(elapsed * 22) * 0.008 : 0.0001);
      }
    } else {
      // Drone: orbit the target at standoff range, short bursts from above.
      e.aiming = true;
      if (t) {
        e.orbit += dt * 0.5 * e.avoidSign;
        const r = 10 + Math.sin(elapsed * 0.3 + e.id) * 2;
        strafe.set(
          THREE.MathUtils.clamp(t.root.position.x + Math.cos(e.orbit) * r, -5.6, 5.6),
          0,
          THREE.MathUtils.clamp(t.root.position.z + Math.sin(e.orbit) * r, -WORLD_HALF + 1, WORLD_HALF - 1),
        );
        const px = e.root.position.x;
        const pz = e.root.position.z;
        tmpV.subVectors(strafe, e.root.position).setY(0);
        const len = tmpV.length();
        if (len > 0.2) e.root.position.addScaledVector(tmpV.divideScalar(len), Math.min(len, 4.2 * dt));
        e.speed = dt > 0 ? Math.hypot(e.root.position.x - px, e.root.position.z - pz) / dt : 0;
        if (Math.abs(e.root.position.x) > 5.5) e.avoidSign = -e.avoidSign;
      }
      if (t && e.los && d < 30) {
        if (e.burst === 0 && e.burstCd <= 0) {
          e.aimTimer += dt;
          if (e.aimTimer > 0.4) {
            e.burst = 3;
            e.aimTimer = 0;
          }
        }
        if (e.burst > 0 && e.shotCd <= 0) {
          const p = 0.3 * THREE.MathUtils.clamp(1.25 - d / 26, 0.35, 1) * mod.enemyAcc * (t === player && player.speed > 4.5 ? 0.6 : 1);
          if (remoteShot(e, t, fx() < p, 1.3, 1.8)) damage(t, t === player ? 5 + Math.floor(fx() * 3) : 7, e);
          e.burst--;
          e.shotCd = 0.15;
          if (e.burst === 0) e.burstCd = 1.5 + fx() * 1;
        }
        laserOn = e.aimTimer > 0 || e.burst > 0;
        laserOpacity = 0.3;
      } else e.burst = 0;
    }

    if (e.laser) {
      e.laser.visible = laserOn;
      if (laserOn) {
        muzzleOf(e, muzzleW);
        e.laser.position.copy(muzzleW);
        e.laser.lookAt(e.aimPoint);
        const w = e.kind === "sniper" ? 2.4 : 1;
        e.laser.scale.set(w, w, muzzleW.distanceTo(e.aimPoint));
        (e.laser.material as THREE.MeshBasicMaterial).opacity = laserOpacity;
      }
    }
  }

  function sniperShot(e: Soldier, t: Soldier) {
    let p = 0.82 * mod.enemyAcc;
    let aimH = 1.25;
    if (!los(e.root.position, 1.5, t.root.position, 1.15)) {
      aimH = 1.62;
      p *= 0.5;
    }
    if (t === player) {
      if (player.speed > 4.5) p *= 0.35;
      else if (player.speed > 1) p *= 0.6;
    }
    muzzleOf(e, muzzleW);
    audio.sniper(camera.position.distanceTo(muzzleW), panOf(e.root.position));
    if (remoteShot(e, t, fx() < p, aimH, 1.2)) damage(t, t === player ? 45 : 60, e);
    alertByNoise(e.root.position, 30);
  }

  // ------------------------------------------------------------ AI: ally
  const formation = new THREE.Vector3();
  function updateAlly(a: Soldier, i: number, dt: number) {
    a.hurtTime += dt;
    if (a.down) {
      a.aiming = false;
      a.speed = 0;
      if (player?.alive && player.root.position.distanceTo(a.root.position) < 1.9) {
        a.revive += dt;
        if (a.revive >= 2.4) {
          a.down = false;
          a.hp = 60;
          a.revive = 0;
          bonus += 75;
          medal("lifesaver");
          audio.revive();
          addPop(`${a.name} REVIVED +75`, false);
          feed(`YOU <em>+</em> REVIVED ${esc(a.name)}`, "");
          if (a.tag && a.tagUp) (a.tag.material as THREE.SpriteMaterial).map = a.tagUp;
        }
      } else a.revive = Math.max(0, a.revive - dt * 0.5);
      return;
    }
    if (!player) return;
    if (a.hurtTime > 6) a.hp = Math.min(a.maxHp, a.hp + dt * 6);
    a.burstCd -= dt;
    a.shotCd -= dt;
    a.losTimer -= dt;
    const backX = -Math.sin(yaw);
    const backZ = -Math.cos(yaw);
    const sideX = -Math.cos(yaw);
    const sideZ = Math.sin(yaw);
    const lat = i === 0 ? -1.9 : 1.9;
    const behind = i === 0 ? 1.8 : 2.8;
    formation.set(
      player.root.position.x + backX * behind + sideX * lat,
      0,
      player.root.position.z + backZ * behind + sideZ * lat,
    );
    if (blockedAt(formation.x, formation.z, 0.4)) formation.set(player.root.position.x + backX * (behind + 1), 0, player.root.position.z + backZ * (behind + 1));
    const bx = a.root.position.x;
    const bz = a.root.position.z;
    const gap = Math.hypot(formation.x - bx, formation.z - bz);
    let moving = false;
    if (gap > 1.0) moving = !moveToward(a, formation, gap > 6 ? 5.2 : gap > 2.5 ? 3.6 : 2.2, dt, 0.6);
    else a.speed = 0;
    if (a.losTimer <= 0) {
      a.losTimer = 0.25 + fx() * 0.1;
      let bestT: Soldier | null = null;
      let bd = 30;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = e.root.position.distanceTo(a.root.position);
        if (d < bd && e.state === "combat" && los(a.root.position, 1.5, e.root.position, tgtH(e))) {
          bd = d;
          bestT = e;
        }
      }
      a.target = bestT;
    }
    const t = a.target && a.target.alive ? a.target : null;
    a.aiming = !!t;
    if (t) {
      a.aimPoint.set(t.root.position.x, tgtH(t), t.root.position.z);
      a.faceYaw = Math.atan2(t.root.position.x - a.root.position.x, t.root.position.z - a.root.position.z);
      if (!moving || a.speed < 3) {
        if (a.burst === 0 && a.burstCd <= 0) a.burst = 3;
        if (a.burst > 0 && a.shotCd <= 0 && Math.abs(wrapAngle(a.faceYaw - a.root.rotation.y)) < 0.4) {
          allyFire(a, t);
          a.burst--;
          a.shotCd = 0.12;
          if (a.burst === 0) a.burstCd = 1.3 + fx() * 1.2;
        }
      }
    } else {
      a.aimPoint.set(a.root.position.x + Math.sin(a.root.rotation.y) * 10, 1.3, a.root.position.z + Math.cos(a.root.rotation.y) * 10);
    }
    const fwd = (a.root.position.x - bx) * Math.sin(a.root.rotation.y) + (a.root.position.z - bz) * Math.cos(a.root.rotation.y);
    animate(a, dt > 0 ? fwd / dt : 0);
  }

  // ------------------------------------------------------------ player
  const wishV = new THREE.Vector3();
  function updatePlayer(dt: number) {
    if (!player) return;
    const p = player;
    if (!p.alive) {
      p.speed = 0;
      return;
    }
    let mx = moveIn.x;
    let mz = moveIn.y;
    if (keys.has("w") || keys.has("arrowup")) mz += 1;
    if (keys.has("s") || keys.has("arrowdown")) mz -= 1;
    if (keys.has("d") || keys.has("arrowright")) mx += 1;
    if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const stickSprint = mobile && Math.hypot(moveIn.x, moveIn.y) > 0.92;
    const sprint = (sprintHeld || stickSprint) && mz > 0.3 && !ads && !firing;
    const speed = ads ? 2.1 : sprint ? 6.0 : 3.4;
    const fx2 = Math.sin(yaw);
    const fz2 = Math.cos(yaw);
    // forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw)
    wishV.set((fx2 * mz - fz2 * mx) * speed, 0, (fz2 * mz + fx2 * mx) * speed);
    p.vel.lerp(wishV, Math.min(1, dt * (len > 0.05 ? 14 : 18)));
    const bx = p.root.position.x;
    const bz = p.root.position.z;
    moveBy(p, p.vel.x * dt, p.vel.z * dt);
    const moved = Math.hypot(p.root.position.x - bx, p.root.position.z - bz);
    p.speed = dt > 0 ? moved / dt : 0;
    movedTotal += moved;
    stepDist += moved;
    if (stepDist > (sprint ? 1.25 : 0.85) && p.speed > 0.8) {
      stepDist = 0;
      audio.footstep(sprint);
    }
    const combat = ads || firing || lastShot < 1.4 || reloadT > 0;
    p.aiming = combat && !sprint;
    if (sprint || (!combat && p.speed > 0.4)) p.faceYaw = Math.atan2(p.vel.x, p.vel.z);
    else if (combat) p.faceYaw = yaw;
    p.aimPoint.copy(aimPoint);
    const fwd = (p.root.position.x - bx) * Math.sin(p.root.rotation.y) + (p.root.position.z - bz) * Math.cos(p.root.rotation.y);
    animate(p, dt > 0 ? fwd / dt : 0);

    fireCd = Math.max(0, fireCd - dt);
    lastShot += dt;
    bloom = Math.max(0, bloom - dt * (firing ? 1.2 : 4.5));
    updateReload(dt);
    if (firing) playerFire();
    lastHurt += dt;
    if (mod.regen && lastHurt > REGEN_DELAY && p.hp < PLAYER_HP) p.hp = Math.min(PLAYER_HP, p.hp + REGEN_RATE * dt);
    if (phase === 3) {
      const onPad = p.root.position.distanceTo(EXTRACT) < 2.5;
      if (onPad && !uplinkStarted) {
        uplinkStarted = true;
        banner("UPLINK STARTED", "HOLD THE PAD", "Enemy counter-attack incoming", true, 2.6);
        audio.alarm();
        spawnWave(WAVE3, true);
      }
      if (onPad) uplink = Math.min(1, uplink + dt / UPLINK_TIME);
      if (uplink >= 1) finishMission(true);
    }
  }

  // ------------------------------------------------------------- camera
  const camPivot = new THREE.Vector3();
  const camDesired = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camFrom = new THREE.Vector3();
  let debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  const camDir = new THREE.Vector3();
  function updateCamera(dt: number) {
    if (!player) return;
    adsBlend += ((ads ? 1 : 0) - adsBlend) * Math.min(1, dt * 12);
    shoulderBlend += (shoulder - shoulderBlend) * Math.min(1, dt * 9);
    recoil *= Math.exp(-(firing ? 4 : 9) * dt);
    recoilYaw *= Math.exp(-8 * dt);
    const vp = THREE.MathUtils.clamp(pitch + recoil, -1.0, 0.85);
    const vy = yaw + recoilYaw;
    fwd3.set(Math.sin(vy) * Math.cos(vp), Math.sin(vp), Math.cos(vy) * Math.cos(vp));
    camRight.set(-Math.cos(vy), 0, Math.sin(vy));
    const sprinting = player.speed > 4.8;
    const dist = THREE.MathUtils.lerp(3.1, 1.95, adsBlend) + (sprinting ? 0.35 : 0);
    const sh = THREE.MathUtils.lerp(0.62, 0.5, adsBlend) * shoulderBlend;
    const pr = player.root.position;
    const deadLift = player.alive ? 0 : Math.min(1, deathTimer / 2);
    camPivot.set(pr.x, pr.y + 1.55, pr.z);
    camDesired.copy(camPivot).addScaledVector(camRight, sh).addScaledVector(fwd3, -(dist + deadLift * 2.5));
    camDesired.y += 0.1 + deadLift * 2.2;
    camFrom.copy(camPivot).addScaledVector(camRight, sh * 0.4);
    camDir.subVectors(camDesired, camFrom);
    const cd = camDir.length();
    losRay.set(camFrom, camDir.divideScalar(cd));
    losRay.far = cd;
    const hit = losRay.intersectObjects(blockers, false)[0];
    if (hit) camDesired.copy(camFrom).addScaledVector(camDir, Math.max(0.25, hit.distance - 0.25));
    camera.position.lerp(camDesired, 1 - Math.exp(-30 * dt));
    if (sprinting) {
      const t = performance.now() / 1000;
      camera.position.y += Math.sin(t * 13) * 0.025;
      camera.position.addScaledVector(camRight, Math.cos(t * 6.5) * 0.02);
    }
    if (shake > 0.001) {
      camera.position.x += (fx() - 0.5) * shake * 0.5;
      camera.position.y += (fx() - 0.5) * shake * 0.5;
      shake *= Math.exp(-10 * dt);
    }
    if (player.alive) camLook.copy(camera.position).addScaledVector(fwd3, 20);
    else camLook.set(pr.x, pr.y + 0.4, pr.z);
    camera.lookAt(camLook);
    const fov = THREE.MathUtils.lerp(68, load.adsFov, adsBlend) + (sprinting ? 6 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
    // What's under the crosshair (ignore anything between camera and player).
    ray.set(camera.position, fwd3);
    ray.far = 150;
    const minD = camera.position.distanceTo(camPivot) * 0.9;
    const target = ray.intersectObjects(collectTargets(), false).find((h) => h.distance > minD);
    aimEnemy = !!target?.object.userData.unit;
    if (target) aimPoint.copy(target.point);
    else aimPoint.copy(camera.position).addScaledVector(fwd3, 150);
    if (debugCam) {
      camera.position.copy(debugCam.pos);
      camera.lookAt(debugCam.look);
    }
    sun.position.set(pr.x + 18, 26, pr.z - 34);
    sun.target.position.set(pr.x, 0, pr.z - 4);
  }

  function menuCamera(dt: number) {
    menuTime += dt;
    const t = menuTime * 0.05;
    camera.position.set(Math.sin(t) * 3.5 + 2.5, 2.6 + Math.sin(t * 0.7) * 0.4, 33 - Math.sin(t * 0.6) * 2);
    camLook.set(-1.5 + Math.sin(t * 0.8), 1.7, 12);
    camera.lookAt(camLook);
    if (Math.abs(camera.fov - 55) > 0.05) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
    sun.position.set(18, 26, -10);
    sun.target.position.set(0, 0, 20);
  }

  function aimAssist(dt: number) {
    if ((!mobile && !padActive) || !player?.alive || (!firing && !ads)) return;
    let bestA = 0.09;
    let best: Soldier | null = null;
    for (const e of enemies) {
      if (!e.alive || e.spotted <= 0) continue;
      tmpV.set(e.root.position.x, tgtH(e), e.root.position.z).sub(camera.position).normalize();
      const a = Math.acos(THREE.MathUtils.clamp(tmpV.dot(fwd3), -1, 1));
      if (a < bestA) {
        bestA = a;
        best = e;
      }
    }
    if (!best) return;
    tmpV.set(best.root.position.x, tgtH(best), best.root.position.z).sub(camera.position);
    const ty = Math.atan2(tmpV.x, tmpV.z);
    const tp = Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z));
    const k = Math.min(1, dt * 3.2);
    yaw += wrapAngle(ty - yaw) * k;
    pitch += (tp - pitch) * k * 0.6;
  }

  // ------------------------------------------------------------ HUD
  function buzz(pattern: number | number[]) {
    if (!mobile || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* not allowed */
    }
  }

  let medalQueue: string[] = [];
  let medalTimer = 0;
  function medal(id: string) {
    const m = MEDALS[id];
    if (!m || stage !== "playing") return;
    runMedals[id] = (runMedals[id] ?? 0) + 1;
    medalQueue.push(id);
  }
  function updateMedals(dt: number) {
    medalTimer -= dt;
    if (medalTimer > 0 || !medalQueue.length) {
      if (medalTimer <= 0) hud.medal.classList.remove("on");
      return;
    }
    const id = medalQueue.shift()!;
    const m = MEDALS[id];
    hud.medal.innerHTML = `<i>${m.icon}</i><div><b>${m.name}</b><span>+${m.xp} XP</span></div>`;
    hud.medal.classList.remove("on");
    void hud.medal.offsetWidth;
    hud.medal.classList.add("on");
    audio.medal();
    buzz([10, 40, 10]);
    medalTimer = 1.7;
  }

  function rebuildMag() {
    hud.magWrap.innerHTML = "";
    hud.magTicks.length = 0;
    for (let i = 0; i < load.mag; i++) {
      const t = document.createElement("i");
      hud.magWrap.appendChild(t);
      hud.magTicks.push(t);
    }
    lastAmmo = -1;
  }

  function addPop(text: string, gold: boolean) {
    const d = document.createElement("div");
    d.textContent = text;
    if (gold) d.className = "hs";
    hud.pops.appendChild(d);
    while (hud.pops.children.length > 4) hud.pops.firstElementChild?.remove();
    window.setTimeout(() => d.remove(), 1150);
  }

  function feed(html: string, cls: string) {
    const d = document.createElement("div");
    d.innerHTML = html;
    if (cls) d.className = cls;
    hud.feed.prepend(d);
    while (hud.feed.children.length > 5) hud.feed.lastElementChild?.remove();
    window.setTimeout(() => (d.style.opacity = "0"), 4600);
    window.setTimeout(() => d.remove(), 5100);
  }

  let bannerTimer = 0;
  function banner(k: string, t: string, s: string, alert: boolean, dur: number) {
    hud.bannerK.textContent = k;
    hud.bannerT.textContent = t;
    hud.bannerS.textContent = s;
    hud.banner.classList.toggle("alert", alert);
    hud.banner.classList.add("on");
    bannerTimer = dur;
  }

  let hitTimer = 0;
  function showHit(kind: "hit" | "hs" | "kill") {
    hud.hit.className = "nx-hit" + (kind === "hit" ? "" : ` ${kind}`);
    hud.hit.style.opacity = "1";
    hitTimer = kind === "kill" ? 0.32 : 0.16;
  }

  function addDamageIndicator(from: THREE.Vector3) {
    if (!player) return;
    const d = hud.dmgs.find((x) => x.life <= 0) ?? hud.dmgs[0];
    d.life = 1.4;
    d.angle = Math.atan2(from.x - player.root.position.x, from.z - player.root.position.z);
  }

  function buildSquadHud() {
    hud.squad.innerHTML = allies
      .map((a) => `<div class="m" data-id="${a.id}"><span>${esc(a.name)}</span><div class="b"><i></i></div><span>OK</span></div>`)
      .join("");
  }

  const headingOf = (y: number) => ((THREE.MathUtils.radToDeg(Math.PI - y) % 360) + 360) % 360;

  function updateCompass() {
    const w = hud.compassWidth();
    const pxPerDeg = w / 130;
    const heading = headingOf(yaw);
    for (const t of hud.compassTicks) {
      const d = ((t.deg - heading + 540) % 360) - 180;
      if (Math.abs(d) > 68) {
        t.el.style.display = "none";
        continue;
      }
      t.el.style.display = "";
      t.el.style.left = `${w / 2 + d * pxPerDeg}px`;
    }
    hud.heading.textContent = `${String(Math.round(heading) % 360).padStart(3, "0")}°`;
    let i = 0;
    const pip = (pos: THREE.Vector3, cls: string) => {
      if (i >= hud.pips.length || !player) return;
      const by = Math.atan2(pos.x - player.root.position.x, pos.z - player.root.position.z);
      const d = ((headingOf(by) - heading + 540) % 360) - 180;
      const el = hud.pips[i++];
      el.className = `pip ${cls}`;
      el.style.display = "";
      el.style.left = `${w / 2 + THREE.MathUtils.clamp(d, -62, 62) * pxPerDeg}px`;
    };
    for (const e of enemies) if (e.alive && e.spotted > 0) pip(e.root.position, "");
    for (const a of allies) pip(a.root.position, "ally");
    if (phase === 3) pip(EXTRACT, "obj");
    for (; i < hud.pips.length; i++) hud.pips[i].style.display = "none";
  }

  const projV = new THREE.Vector3();
  function updateObjectiveMarker() {
    if (phase !== 3 || !player || stage !== "playing") {
      hud.edge.style.display = "none";
      hud.world.style.display = "none";
      return;
    }
    projV.set(EXTRACT.x, 2.2, EXTRACT.z).project(camera);
    const sx = (projV.x * 0.5 + 0.5) * viewW;
    const sy = (-projV.y * 0.5 + 0.5) * viewH;
    const m = 60;
    const dist = Math.round(player.root.position.distanceTo(EXTRACT));
    const onScreen = projV.z < 1 && sx > m && sx < viewW - m && sy > m && sy < viewH - m;
    if (onScreen) {
      hud.edge.style.display = "none";
      hud.world.style.display = dist < 3 ? "none" : "block";
      hud.world.style.left = `${sx}px`;
      hud.world.style.top = `${sy}px`;
      hud.worldLabel.textContent = `UPLINK ${dist}M`;
      return;
    }
    hud.world.style.display = "none";
    let dx = sx - viewW / 2;
    let dy = sy - viewH / 2;
    if (projV.z > 1) {
      dx = -dx;
      dy = -dy;
    }
    const k = Math.min((viewW / 2 - m) / Math.max(1e-3, Math.abs(dx)), (viewH / 2 - m) / Math.max(1e-3, Math.abs(dy)));
    hud.edge.style.display = "block";
    hud.edge.style.left = `${viewW / 2 + dx * k}px`;
    hud.edge.style.top = `${viewH / 2 + dy * k}px`;
    hud.edgeArrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    hud.edgeLabel.textContent = `UPLINK ${dist}M`;
  }

  let lastHp = -1;
  let lastAmmo = -1;
  let lastReserve = -1;
  function updateHud(force = false) {
    if (!player) return;
    const hp = Math.max(0, Math.round(player.hp));
    if (hp !== lastHp || force) {
      lastHp = hp;
      hud.hp.innerHTML = `${hp}<small>HP</small>`;
      hud.hpCells.forEach((c, i) => {
        c.style.transform = `scaleX(${THREE.MathUtils.clamp(hp / 10 - i, 0, 1)})`;
      });
      hud.vit.classList.toggle("low", hp < 35);
    }
    if (ammo !== lastAmmo || reserve !== lastReserve || force) {
      lastAmmo = ammo;
      lastReserve = reserve;
      hud.mag.textContent = String(ammo).padStart(2, "0");
      hud.reserve.textContent = String(reserve);
      hud.magTicks.forEach((t, i) => t.classList.toggle("off", i >= ammo));
      hud.wpn.classList.toggle("empty", ammo === 0);
    }
    hud.wpn.classList.toggle("reloading", reloadT > 0);
    if (reloadT > 0) hud.reloadFill.style.width = `${(1 - reloadT / reloadDur) * 100}%`;
    hud.keyHint.textContent =
      reloadT > 0 ? "RELOADING…" : ammo <= 8 && reserve > 0 ? "▲ LOW AMMO — R" : reserve === 0 && ammo <= 8 ? "▲ NO RESERVE — FIND AMMO" : mobile ? "" : "R RELOAD · Q SHOULDER";
    const left = hostilesLeft();
    hud.obj.classList.toggle("alert", phase === 2 || (phase === 3 && uplinkStarted));
    if (phase < 3) {
      hud.objState.textContent = pendingWave ? "INBOUND" : "ACTIVE";
      hud.objSub.textContent = pendingWave ? "REINFORCEMENTS ARRIVING…" : `HOSTILES REMAINING · ${left}`;
      hud.objBar.style.display = "none";
    } else {
      const onPad = player.root.position.distanceTo(EXTRACT) < 2.5;
      hud.objState.textContent = uplinkStarted ? `${Math.round(uplink * 100)}%` : "GO";
      hud.objSub.textContent = uplinkStarted
        ? onPad
          ? "UPLOADING — STAY ON THE PAD"
          : "UPLINK PAUSED — RETURN TO PAD"
        : `MOVE TO UPLINK PAD · ${Math.round(player.root.position.distanceTo(EXTRACT))}M`;
      hud.objBar.style.display = "block";
      hud.objBarFill.style.width = `${uplink * 100}%`;
    }
    for (const a of allies) {
      const row = hud.squad.querySelector(`[data-id="${a.id}"]`) as HTMLElement | null;
      if (!row) continue;
      row.classList.toggle("down", a.down);
      (row.querySelector(".b i") as HTMLElement).style.width = `${(a.hp / a.maxHp) * 100}%`;
      (row.lastElementChild as HTMLElement).textContent = a.down ? "DOWN" : a.target ? "ENGAGE" : "OK";
    }
  }

  function updateFastHud(dt: number) {
    const sp = spreadNow();
    const gap = Math.max(4, (Math.tan(sp) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (viewH / 2));
    hud.cross.style.setProperty("--g", `${gap.toFixed(1)}px`);
    hud.cross.classList.toggle("enemy", aimEnemy);
    hud.cross.classList.toggle("hide", !!player && (!player.alive || (player.speed > 4.8 && !ads)));
    hud.scope.style.opacity = String(adsBlend * 0.9);
    if (hitTimer > 0) {
      hitTimer -= dt;
      if (hitTimer <= 0) hud.hit.style.opacity = "0";
    }
    for (const d of hud.dmgs) {
      if (d.life <= 0) {
        d.el.style.opacity = "0";
        continue;
      }
      d.life -= dt;
      const rel = THREE.MathUtils.radToDeg(wrapAngle(yaw - d.angle));
      d.el.style.transform = `rotate(${rel}deg)`;
      d.el.style.opacity = String(Math.min(1, d.life / 0.6));
    }
    damageFlash = Math.max(0, damageFlash - dt * 1.4);
    const low = player?.alive ? THREE.MathUtils.clamp((40 - player.hp) / 40, 0, 1) : 0;
    hud.blood.style.opacity = String(Math.min(1, damageFlash * 0.9 + low * 0.55));
    audio.setLowHp(low);
    if (grade) {
      grade.uniforms.uDamage.value = damageFlash;
      grade.uniforms.uLowHp.value = low;
      grade.uniforms.uAds.value = adsBlend;
    }
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) hud.banner.classList.remove("on");
    }
    let near: Soldier | null = null;
    let far: Soldier | null = null;
    if (player?.alive) {
      for (const a of allies) {
        if (!a.down) continue;
        const d = a.root.position.distanceTo(player.root.position);
        if (d < 1.9) near = a;
        else if (d < 8) far = a;
      }
    }
    if (near) {
      hud.prompt.style.display = "block";
      hud.promptText.textContent = `REVIVING ${near.name}`;
      hud.promptFill.style.width = `${(near.revive / 2.4) * 100}%`;
    } else if (far) {
      hud.prompt.style.display = "block";
      hud.promptText.textContent = `${far.name} IS DOWN — MOVE CLOSE TO REVIVE`;
      hud.promptFill.style.width = "0%";
    } else hud.prompt.style.display = "none";
    updateHints(dt);
  }

  function setHint(html: string) {
    if (hud.hint.innerHTML !== html) hud.hint.innerHTML = html;
    hud.hint.classList.toggle("on", !!html);
  }

  function updateHints(dt: number) {
    if (hintStep >= 99 || stage !== "playing") return;
    hintTimer += dt;
    const k = (s: string) => `<kbd>${s}</kbd>`;
    if (hintStep === 0) {
      setHint(
        mobile
          ? `<span>LEFT THUMB · MOVE</span><span>RIGHT THUMB · LOOK</span>`
          : `<span>${k("W")}${k("A")}${k("S")}${k("D")} MOVE</span><span>${k("SHIFT")} SPRINT</span><span>${k("MOUSE")} LOOK</span>`,
      );
      if (movedTotal > 3) {
        hintStep = 1;
        hintTimer = 0;
      }
    } else if (hintStep === 1) {
      setHint(
        mobile
          ? `<span>AIM · TOGGLE</span><span>FIRE · HOLD &amp; DRAG</span>`
          : `<span>${k("RMB")} AIM</span><span>${k("LMB")} FIRE</span><span>HEADSHOTS KILL INSTANTLY</span>`,
      );
      if (shotsFired > 4) {
        hintStep = 2;
        hintTimer = 0;
      }
    } else if (hintStep === 2) {
      setHint(
        mobile
          ? `<span>R · RELOAD</span><span>⇄ · SWAP SHOULDER</span>`
          : `<span>${k("R")} RELOAD</span><span>${k("Q")} SWAP SHOULDER</span><span>${k("P")} PAUSE</span>`,
      );
      if (hintTimer > 6) {
        hintStep = 99;
        setHint("");
        save(SEEN_KEY, "1");
      }
    }
  }

  // ------------------------------------------------------------ menus
  function controlsHtml() {
    if (mobile) {
      return `<div class="nx-ctrl" style="display:grid"><div>MOVE<b>LEFT THUMB</b></div><div>LOOK<b>RIGHT THUMB</b></div>
        <div>FIRE<b>HOLD + DRAG</b></div><div>AIM<b>TOGGLE</b></div></div>`;
    }
    return `<div class="nx-ctrl"><div>MOVE<b>W A S D</b></div><div>SPRINT<b>SHIFT</b></div><div>AIM<b>RIGHT MOUSE</b></div>
      <div>FIRE<b>LEFT MOUSE</b></div><div>RELOAD<b>R</b></div><div>SHOULDER<b>Q</b></div><div>PAUSE<b>P / ESC</b></div><div>FULLSCREEN<b>F</b></div><div>SOUND<b>M</b></div></div>`;
  }

  function settingsHtml() {
    return `<div class="nx-set"><label><span>SENSITIVITY</span><input type="range" min="0.3" max="2.5" step="0.05" value="${settings.sens}" data-set="sens"><span>${settings.sens.toFixed(2)}</span></label>
      <label><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" value="${settings.vol}" data-set="vol"><span>${Math.round(settings.vol * 100)}</span></label></div>`;
  }

  function bindSettings() {
    hud.overlay.querySelectorAll<HTMLInputElement>("input[data-set]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const v = parseFloat(inp.value);
        const key = inp.dataset.set as "sens" | "vol";
        settings[key] = v;
        (inp.nextElementSibling as HTMLElement).textContent = key === "vol" ? String(Math.round(v * 100)) : v.toFixed(2);
        if (key === "vol") {
          settings.muted = v === 0;
          audio.setVolume(v);
          syncMute();
        }
        save(SETTINGS_KEY, settings);
      });
    });
  }

  function bindButtons(map: Record<string, () => void>) {
    hud.overlay.querySelectorAll<HTMLElement>("[data-go]").forEach((b) => {
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        audio.ensure();
        audio.ui();
        map[b.dataset.go ?? ""]?.();
      });
    });
  }

  function showMenu() {
    stage = "menu";
    menuTime = 0;
    hud.root.dataset.mode = "menu";
    hud.overlay.className = "nx-ov menu on";
    hud.overlay.innerHTML = `<div class="nx-col">
      <div class="nx-kick">PLAYVERSE // TACTICAL SIMULATION</div>
      <div class="nx-h1">NEXUS <span>2100</span></div>
      <div class="nx-sub">Operation Nightfall. District 07 has gone dark. Lead a three-operator fireteam down a rain-soaked megacity street, break the hostile cell and upload the evidence before their counter-attack lands.</div>
      <div class="nx-phases">
        <div><b>01</b><span>CLEAR THE STREET<small>Five riflemen and a sniper on patrol. Strike before they raise the alarm.</small></span></div>
        <div><b>02</b><span>REPEL REINFORCEMENTS<small>A shielded heavy and attack drones push in from the north end.</small></span></div>
        <div><b>03</b><span>HOLD THE UPLINK<small>Stand on the pad for ${UPLINK_TIME}s while they counter-attack.</small></span></div>
      </div>
      ${rankHtml()}
      ${dailyCardHtml()}
      <div class="nx-actions"><button type="button" class="nx-btn" data-go="deploy">DEPLOY ▸</button>
        <button type="button" class="nx-btn ghost" data-go="loadout">LOADOUT</button>
        <button type="button" class="nx-btn ghost" data-go="board">LEADERBOARD</button>
        <button type="button" class="nx-btn ghost" data-go="settings">SETTINGS</button>
        <span class="nx-best">BEST · <b>${best.toLocaleString("en-US")}</b></span></div>
      <div class="nx-setwrap" style="display:none">${settingsHtml()}${controlsHtml()}</div>
    </div>`;
    bindSettings();
    bindButtons({
      deploy: () => deploy("op"),
      daily: () => deploy("daily"),
      board: () => showBoard("daily"),
      loadout: () => showLoadout(),
      settings: () => {
        const w = hud.overlay.querySelector(".nx-setwrap") as HTMLElement;
        w.style.display = w.style.display === "none" ? "block" : "none";
      },
    });
  }

  function mobileFullscreen() {
    if (!mobile || document.fullscreenElement) return;
    const el = container as HTMLElement & { requestFullscreen?: (o?: FullscreenOptions) => Promise<void> };
    if (typeof el.requestFullscreen !== "function") return; // iOS Safari: use Add to Home Screen instead
    el.requestFullscreen({ navigationUI: "hide" })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
      .catch(() => undefined);
  }

  function deploy(m: Mode) {
    mobileFullscreen();
    if (m !== mode) {
      mode = m;
      resetMission();
    }
    startPlay();
  }

  function dailyCardHtml() {
    const d = dailyOf(todayUTC());
    return `<button type="button" class="nx-daily" data-go="daily"><div class="k"><b>DAILY OPS</b><span>${d.date} · UTC</span></div>
      <div class="t">${d.mod.name}</div><div class="s">${esc(d.mod.desc)} Same layout for everyone — global ranking.</div>
      <div class="go">PLAY DAILY ▸</div></button>`;
  }

  async function fetchBoard(board: "daily" | "all"): Promise<BoardResp | null> {
    try {
      const r = await fetch(`/api/scores?board=${board}&date=${todayUTC()}&id=${pid}`, { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json()) as BoardResp;
    } catch {
      return null;
    }
  }

  function boardRowsHtml(b: BoardResp | null) {
    if (!b) return `<div class="nx-tiny">LEADERBOARD OFFLINE</div>`;
    if (!b.top.length) return `<div class="nx-tiny">NO SCORES YET — BE THE FIRST</div>`;
    const rows = b.top
      .map(
        (r, i) =>
          `<div class="${r.you ? "you" : ""}"><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="nm">${esc(r.name)}</span><b>${r.score.toLocaleString("en-US")}</b></div>`,
      )
      .join("");
    const you =
      b.you && b.you.rank > 10
        ? `<div class="you sep"><span class="n">${b.you.rank}</span><span class="nm">${esc(getNickname() || "YOU")}</span><b>${b.you.score.toLocaleString("en-US")}</b></div>`
        : "";
    return `<div class="nx-lb">${rows}${you}</div><div class="nx-tiny">${b.total.toLocaleString("en-US")} OPERATORS RANKED</div>`;
  }

  function showBoard(tab: "daily" | "all") {
    const back = stage === "debrief" ? "debrief" : "menu";
    hud.overlay.className = back === "debrief" ? "nx-ov dim on" : "nx-ov menu on";
    hud.overlay.innerHTML = `<div class="nx-col"><div class="nx-kick">GLOBAL NETWORK</div>
      <div class="nx-h2" style="text-align:left">LEADERBOARD</div>
      <div class="nx-tabs"><button type="button" data-go="tdaily" class="${tab === "daily" ? "on" : ""}">DAILY · ${todayUTC()}</button>
        <button type="button" data-go="tall" class="${tab === "all" ? "on" : ""}">ALL-TIME · OPERATION</button></div>
      <div class="nx-lbwrap"><div class="nx-tiny">CONNECTING…</div></div>
      <div class="nx-actions"><button type="button" class="nx-btn ghost" data-go="back">BACK</button></div></div>`;
    bindButtons({
      tdaily: () => showBoard("daily"),
      tall: () => showBoard("all"),
      back: () => (back === "debrief" ? showDebriefAgain() : showMenu()),
    });
    void fetchBoard(tab).then((b) => {
      const w = hud.overlay.querySelector(".nx-lbwrap");
      if (w) w.innerHTML = boardRowsHtml(b);
    });
  }

  // Leaderboard submission (runs after the debrief is drawn).
  let lastRun: { score: number; time: number; kills: number; board: Mode } | null = null;
  let debriefHtml = "";
  function showDebriefAgain() {
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = debriefHtml;
    bindDebrief();
    void submitRun(false);
  }

  async function submitRun(fresh: boolean) {
    const slot = hud.overlay.querySelector(".nx-submit");
    if (!slot || !lastRun) return;
    const name = getNickname();
    if (!name) {
      slot.innerHTML = `<div class="nx-namebox"><span>CALLSIGN FOR THE GLOBAL BOARD</span>
        <div><input maxlength="16" placeholder="e.g. NOVA-7" /><button type="button" class="nx-btn sm">SUBMIT</button></div></div>`;
      const inp = slot.querySelector("input") as HTMLInputElement;
      const btn = slot.querySelector("button") as HTMLButtonElement;
      const go = () => {
        const v = inp.value.replace(/[^\p{L}\p{N} _.\-]/gu, "").trim();
        if (v.length < 2) {
          inp.focus();
          return;
        }
        setNickname(v);
        void submitRun(true);
      };
      btn.addEventListener("click", go);
      inp.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") go();
      });
      return;
    }
    const label = lastRun.board === "daily" ? "DAILY" : "GLOBAL";
    if (!fresh) {
      if (lastRunResult) slot.innerHTML = lastRunResult;
      return;
    }
    slot.innerHTML = `<div class="nx-tiny">UPLOADING TO ${label} BOARD…</div>`;
    try {
      const r = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pid, name, ...lastRun, date: todayUTC() }),
      });
      const j = (await r.json()) as { rank?: number; total?: number; best?: number; error?: string };
      lastRunResult = r.ok
        ? `<div class="nx-rankres"><b>#${j.rank}</b><span>${label} RANK · OF ${j.total}</span><em>AS ${esc(name)}</em>
            <button type="button" class="nx-btn ghost sm" data-go="board">VIEW BOARD</button></div>`
        : `<div class="nx-tiny">SCORE NOT RANKED (${esc(j.error ?? "error")})</div>`;
    } catch {
      lastRunResult = `<div class="nx-tiny">LEADERBOARD OFFLINE</div>`;
    }
    const cur = hud.overlay.querySelector(".nx-submit");
    if (cur) {
      cur.innerHTML = lastRunResult;
      cur.querySelector('[data-go="board"]')?.addEventListener("click", () => {
        audio.ui();
        showBoard(lastRun?.board === "daily" ? "daily" : "all");
      });
    }
    debriefHtml = hud.overlay.innerHTML;
  }
  let lastRunResult = "";

  function rankHtml() {
    const r = rankOf(prog.xp);
    const stars = STARS.map((st) => `<i class="${prog.stars[st.id] ? "on" : ""}" title="${esc(st.label)}">★</i>`).join("");
    return `<div class="nx-rank"><div class="badge">${r.index + 1}</div><div class="info">
      <div class="top"><b>${r.name}</b><span>${r.next ? `${r.into.toLocaleString("en-US")} / ${r.span.toLocaleString("en-US")} XP` : "MAX RANK"}</span></div>
      <div class="xp"><i style="width:${Math.round(r.pct * 100)}%"></i></div>
      <div class="bot"><span class="st">${stars}</span><span>${r.next ? `NEXT · ${r.next}` : ""}</span></div></div></div>`;
  }

  function showLoadout() {
    const r = rankOf(prog.xp);
    const slotName: Record<Slot, string> = { optic: "OPTIC", muzzle: "MUZZLE", mag: "MAGAZINE", visor: "VISOR" };
    const rows = (Object.keys(ITEMS) as Slot[])
      .map((slot) => {
        const opts = ITEMS[slot]
          .map((it) => {
            const locked = it.rank > r.index;
            const on = equipped(slot) === it.id;
            const sw = slot === "visor" ? `<em style="background:#${(VISOR_COLORS[it.id] ?? 0).toString(16).padStart(6, "0")}"></em>` : "";
            return `<button type="button" class="nx-opt${on ? " on" : ""}${locked ? " lock" : ""}" data-slot="${slot}" data-item="${it.id}" ${locked ? "disabled" : ""}>
              ${sw}<b>${it.name}</b><span>${locked ? `🔒 RANK ${it.rank + 1} · ${RANKS[it.rank].name}` : esc(it.desc)}</span></button>`;
          })
          .join("");
        return `<div class="nx-slot"><div class="k">${slotName[slot]}</div><div class="opts">${opts}</div></div>`;
      })
      .join("");
    hud.overlay.className = "nx-ov menu on";
    hud.overlay.innerHTML = `<div class="nx-col wide"><div class="nx-kick">ARMORY // MK-18 CARBINE</div>
      <div class="nx-h2" style="text-align:left">LOADOUT</div>
      ${rankHtml()}
      <div class="nx-slots">${rows}</div>
      <div class="nx-actions"><button type="button" class="nx-btn" data-go="deploy">DEPLOY ▸</button>
        <button type="button" class="nx-btn ghost" data-go="back">BACK</button></div></div>`;
    hud.overlay.querySelectorAll<HTMLButtonElement>(".nx-opt").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.disabled) return;
        audio.ensure();
        audio.ui();
        prog.equip[b.dataset.slot as Slot] = b.dataset.item ?? "";
        saveProgress(prog);
        // respawn the squad so the new carbine/visor shows in the menu backdrop
        resetMission();
        showLoadout();
      });
    });
    bindButtons({ deploy: () => deploy("op"), back: () => showMenu() });
  }

  function startPlay() {
    if (mobile) window.scrollTo(0, 0);
    updateVisibleBottom();
    audio.ensure();
    audio.startAmbient();
    hud.overlay.className = "nx-ov";
    hud.overlay.innerHTML = "";
    hud.root.dataset.mode = "play";
    stage = "playing";
    hintTimer = 0;
    camera.fov = 68;
    camera.updateProjectionMatrix();
    if (mode === "daily") {
      const d = dailyOf(todayUTC());
      banner(`DAILY OPS · ${d.date}`, d.mod.name, d.mod.desc, false, 3.4);
    } else banner("OPERATION NIGHTFALL", "CLEAR THE STREET", "Six hostiles patrolling District 07", false, 3);
    requestLock();
  }

  function pause() {
    if (stage !== "playing") return;
    stage = "paused";
    firing = false;
    ads = false;
    keys.clear();
    sprintHeld = false;
    audio.pause(true);
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center"><div class="nx-kick">SIMULATION PAUSED</div>
      <div class="nx-h2">OPERATION NIGHTFALL</div>
      <div class="nx-tiny">PHASE ${phase}/3 · ${formatTime(elapsed)} · ${kills} KILLS</div>
      <div style="max-width:360px;margin:18px auto 0;text-align:left">${settingsHtml()}</div>
      <div class="nx-actions" style="margin-top:22px"><button type="button" class="nx-btn" data-go="resume">RESUME</button>
      <button type="button" class="nx-btn ghost" data-go="restart">RESTART</button>
      <button type="button" class="nx-btn ghost" data-go="menu">MAIN MENU</button></div></div>`;
    bindSettings();
    bindButtons({
      resume: () => resume(),
      restart: () => {
        audio.pause(false);
        resetMission();
        startPlay();
      },
      menu: () => {
        audio.pause(false);
        resetMission();
        showMenu();
      },
    });
  }

  function resume() {
    if (stage !== "paused") return;
    audio.pause(false);
    hud.overlay.className = "nx-ov";
    hud.overlay.innerHTML = "";
    stage = "playing";
    last = performance.now();
    requestLock();
  }

  function finalScore() {
    const accuracy = shots > 0 ? hits / shots : 0;
    const accB = Math.round(accuracy * 400);
    const timeB = success ? Math.max(0, 900 - Math.floor(elapsed) * 3) : 0;
    const squadB = success ? allies.filter((a) => !a.down).length * 150 : 0;
    return { accuracy, accB, timeB, squadB, total: bonus + accB + timeB + squadB };
  }

  function showDebrief() {
    stage = "debrief";
    hud.root.dataset.mode = "menu";
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    const f = finalScore();
    const total = f.total;
    const isBest = total > best;
    if (isBest) best = total;
    const g = !success ? "F" : total >= 3400 ? "S" : total >= 2800 ? "A" : total >= 2200 ? "B" : total >= 1500 ? "C" : "D";
    hooks.onScore(total);
    hooks.onGameOver(
      total,
      [
        { label: "RESULT", value: success ? "SUCCESS" : "FAILED" },
        { label: "GRADE", value: g },
        { label: "KILLS", value: String(kills) },
        { label: "TIME", value: formatTime(elapsed) },
      ],
      { ownScreen: true },
    );
    save(SEEN_KEY, "1");
    hintStep = 99;
    setHint("");
    // --- progression
    const starHit: Record<string, boolean> = {
      complete: success,
      fast: success && elapsed < 240,
      squad: success && !allyWentDown,
    };
    let newStars = 0;
    for (const st of STARS) {
      if (starHit[st.id] && !prog.stars[st.id]) {
        prog.stars[st.id] = true;
        newStars++;
      }
    }
    let medalXp = 0;
    for (const [id, n] of Object.entries(runMedals)) {
      medalXp += (MEDALS[id]?.xp ?? 0) * n;
      prog.medals[id] = (prog.medals[id] ?? 0) + n;
    }
    const gained = Math.round(total * (success ? 1 : 0.5)) + medalXp + newStars * 300;
    const before = rankOf(prog.xp);
    prog.xp += gained;
    prog.runs += 1;
    if (success) prog.wins += 1;
    saveProgress(prog);
    const after = rankOf(prog.xp);
    const unlocked = unlockedBetween(before.index, after.index);
    const starsHtml = STARS.map(
      (st) =>
        `<div class="${starHit[st.id] ? "on" : prog.stars[st.id] ? "had" : ""}"><i>★</i><span>${esc(st.label)}</span></div>`,
    ).join("");
    const medalsHtml = Object.entries(runMedals)
      .map(([id, n]) => `<span><i>${MEDALS[id].icon}</i>${MEDALS[id].name}${n > 1 ? ` ×${n}` : ""}</span>`)
      .join("");
    const squadAlive = allies.filter((a) => !a.down).length + (player?.alive ? 1 : 0);
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center deb">
      <div class="nx-kick ${success ? "" : "r"}">${success ? "MISSION COMPLETE" : "OPERATOR KIA — MISSION FAILED"}</div>
      <div class="nx-h2">${mode === "daily" ? `DAILY OPS · ${dailyOf(todayUTC()).mod.name}` : "OPERATION NIGHTFALL"}</div>
      <div class="nx-deb"><div class="l">
      <div class="nx-grade ${success ? "" : "f"}">${g}</div>
      <div class="nx-score">${total.toLocaleString("en-US")}</div>
      ${isBest && total > 0 ? `<div class="nx-newbest">★ NEW PERSONAL BEST</div>` : `<div class="nx-tiny">BEST · ${best.toLocaleString("en-US")}</div>`}
      <div class="nx-stats">
        <div><b>${formatTime(elapsed)}</b><span>TIME</span></div>
        <div><b>${kills}</b><span>KILLS</span></div>
        <div><b>${headshots}</b><span>HEADSHOTS</span></div>
        <div><b>${Math.round(f.accuracy * 100)}%</b><span>ACCURACY</span></div>
        <div><b>${squadAlive}/3</b><span>SQUAD</span></div>
        <div><b>${success ? "3/3" : `${phase}/3`}</b><span>PHASE</span></div>
      </div>
      <div class="nx-tiny">COMBAT ${bonus.toLocaleString("en-US")} · ACCURACY +${f.accB} · TIME +${f.timeB} · SQUAD +${f.squadB}</div>
      </div><div class="r">
      <div class="nx-starrow">${starsHtml}</div>
      ${medalsHtml ? `<div class="nx-medals">${medalsHtml}</div>` : ""}
      <div class="nx-xpgain"><div class="top"><b>${after.index > before.index ? `RANK UP · ${after.name}` : after.name}</b><span>+${gained.toLocaleString("en-US")} XP</span></div>
        <div class="xp"><i class="old" style="width:${before.index === after.index ? Math.round(before.pct * 100) : 0}%"></i><i class="new" style="width:${Math.round(after.pct * 100)}%"></i></div></div>
      ${unlocked.length ? `<div class="nx-unlock">UNLOCKED · ${unlocked.map((u) => esc(u.name)).join(" · ")}</div>` : ""}
      <div class="nx-submit"></div>
      </div></div>
      <div class="nx-actions" style="margin-top:18px"><button type="button" class="nx-btn" data-go="again">REDEPLOY ▸</button>
        <button type="button" class="nx-btn ghost" data-go="loadout">LOADOUT</button>
        <button type="button" class="nx-btn ghost" data-go="menu">MAIN MENU</button></div>
      <div class="nx-tiny">PRESS ENTER TO REDEPLOY</div></div>`;
    debriefHtml = hud.overlay.innerHTML;
    lastRunResult = "";
    lastRun = { score: total, time: Math.round(elapsed), kills, board: mode };
    bindDebrief();
    void submitRun(true);
  }

  function bindDebrief() {
    bindButtons({
      again: () => {
        resetMission();
        startPlay();
      },
      loadout: () => {
        resetMission();
        stage = "menu";
        showLoadout();
      },
      menu: () => {
        resetMission();
        showMenu();
      },
      board: () => showBoard(lastRun?.board === "daily" ? "daily" : "all"),
    });
  }

  // ------------------------------------------------------------- input
  let hadLock = false;
  function requestLock() {
    if (mobile || stage !== "playing" || document.pointerLockElement === canvas) return;
    try {
      const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    } catch {
      /* drag-look fallback */
    }
  }

  function look(dx: number, dy: number, scale = 1) {
    const s = 0.0021 * settings.sens * scale * (ads ? 0.6 : 1);
    yaw -= dx * s;
    pitch = THREE.MathUtils.clamp(pitch - dy * s, -0.95, 0.8);
  }

  let mouseDrag = false;
  let lastMX = 0;
  let lastMY = 0;
  on(canvas, "pointerdown", (ev: PointerEvent) => {
    audio.ensure();
    if (stage !== "playing") return;
    if (ev.pointerType === "mouse") {
      if (document.pointerLockElement !== canvas) requestLock();
      if (ev.button === 0) firing = true;
      if (ev.button === 2) ads = true;
      mouseDrag = true;
      lastMX = ev.clientX;
      lastMY = ev.clientY;
      return;
    }
    touchDown(ev);
  });
  on(canvas, "pointermove", (ev: PointerEvent) => {
    if (stage !== "playing") return;
    if (ev.pointerType === "mouse") {
      if (document.pointerLockElement === canvas) return;
      if (mouseDrag) look(ev.clientX - lastMX, ev.clientY - lastMY);
      lastMX = ev.clientX;
      lastMY = ev.clientY;
      return;
    }
    touchMove(ev);
  });
  const upFn = (ev: PointerEvent) => {
    if (ev.pointerType === "mouse") {
      if (ev.button === 0) firing = false;
      if (ev.button === 2) ads = false;
      mouseDrag = false;
      return;
    }
    touchUp(ev);
  };
  on(canvas, "pointerup", upFn);
  on(canvas, "pointercancel", upFn);
  on(window, "mouseup", (ev: MouseEvent) => {
    if (ev.button === 0) firing = false;
    if (ev.button === 2) ads = false;
  });
  on(canvas, "contextmenu", (ev: Event) => ev.preventDefault());
  on(document, "mousemove", (ev: MouseEvent) => {
    if (stage === "playing" && document.pointerLockElement === canvas) look(ev.movementX || 0, ev.movementY || 0);
  });
  on(document, "pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) hadLock = true;
    else {
      if (hadLock && stage === "playing") pause();
      hadLock = false;
    }
  });

  on(window, "keydown", (ev: KeyboardEvent) => {
    const k = ev.key.toLowerCase();
    if (stage === "debrief" && (k === "enter" || k === " ")) {
      ev.preventDefault();
      resetMission();
      startPlay();
      return;
    }
    if (stage === "menu" && k === "enter") {
      ev.preventDefault();
      startPlay();
      return;
    }
    if (k === "f" && (stage === "playing" || stage === "menu")) toggleFullscreen();
    if (k === "m" && stage !== "loading") toggleMute();
    if (stage === "paused" && (k === "p" || k === "escape")) {
      resume();
      return;
    }
    if (stage !== "playing") return;
    if (k === "p" || k === "escape") {
      pause();
      return;
    }
    if (k === "r") startReload();
    if (k === "q") shoulder = -shoulder;
    if (k === "shift") sprintHeld = true;
    if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) ev.preventDefault();
    keys.add(k);
  });
  on(window, "keyup", (ev: KeyboardEvent) => {
    const k = ev.key.toLowerCase();
    keys.delete(k);
    if (k === "shift") sprintHeld = false;
  });
  on(window, "blur", () => {
    keys.clear();
    firing = false;
    ads = false;
    sprintHeld = false;
    if (stage === "playing") pause();
  });
  on(document, "visibilitychange", () => {
    if (document.hidden && stage === "playing") pause();
  });

  const muteBtn = hud.sys.querySelector('[data-act="mute"]') as HTMLElement;
  function syncMute() {
    muteBtn.textContent = settings.muted ? "🔇" : "🔊";
    muteBtn.classList.toggle("off", settings.muted);
  }
  function toggleMute() {
    settings.muted = !settings.muted;
    if (!settings.muted && settings.vol === 0) settings.vol = 0.8;
    audio.setVolume(settings.muted ? 0 : settings.vol);
    save(SETTINGS_KEY, settings);
    syncMute();
  }
  syncMute();

  function toggleFullscreen() {
    const el = container as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    else el.webkitRequestFullscreen?.();
  }
  hud.sys.querySelectorAll<HTMLElement>("button").forEach((b) => {
    on(b, "click", (ev: Event) => {
      ev.stopPropagation();
      if (b.dataset.act === "fs") toggleFullscreen();
      if (b.dataset.act === "mute") toggleMute();
      if (b.dataset.act === "pause") pause();
    });
  });

  // Touch: dynamic stick on the left, look anywhere else, fire button doubles as a look pad.
  const stick = { id: -1, cx: 0, cy: 0 };
  const lookT = { id: -1, x: 0, y: 0 };
  const fireT = { id: -1, x: 0, y: 0 };
  function touchDown(ev: PointerEvent) {
    const rect = container.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    if (x < viewW * 0.42 && stick.id < 0) {
      stick.id = ev.pointerId;
      stick.cx = x;
      stick.cy = y;
      hud.stick.style.left = `${x}px`;
      hud.stick.style.top = `${y}px`;
      hud.stick.classList.add("on");
      hud.stickHint.style.display = "none";
    } else if (lookT.id < 0) {
      lookT.id = ev.pointerId;
      lookT.x = ev.clientX;
      lookT.y = ev.clientY;
    }
  }
  function touchMove(ev: PointerEvent) {
    if (ev.pointerId === stick.id) {
      const rect = container.getBoundingClientRect();
      let dx = ev.clientX - rect.left - stick.cx;
      let dy = ev.clientY - rect.top - stick.cy;
      const max = 52;
      const l = Math.hypot(dx, dy);
      if (l > max) {
        dx = (dx / l) * max;
        dy = (dy / l) * max;
      }
      moveIn.set(dx / max, -dy / max);
      hud.stickKnob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (ev.pointerId === lookT.id) {
      look(ev.clientX - lookT.x, ev.clientY - lookT.y, 1.5);
      lookT.x = ev.clientX;
      lookT.y = ev.clientY;
    }
  }
  function touchUp(ev: PointerEvent) {
    if (ev.pointerId === stick.id) {
      stick.id = -1;
      moveIn.set(0, 0);
      hud.stickKnob.style.transform = "";
      hud.stick.classList.remove("on");
    }
    if (ev.pointerId === lookT.id) lookT.id = -1;
  }
  on(hud.tFire, "pointerdown", (ev: PointerEvent) => {
    ev.preventDefault();
    audio.ensure();
    firing = true;
    fireT.id = ev.pointerId;
    fireT.x = ev.clientX;
    fireT.y = ev.clientY;
    hud.tFire.classList.add("on");
    try {
      hud.tFire.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  });
  on(hud.tFire, "pointermove", (ev: PointerEvent) => {
    if (ev.pointerId !== fireT.id) return;
    look(ev.clientX - fireT.x, ev.clientY - fireT.y, 1.3);
    fireT.x = ev.clientX;
    fireT.y = ev.clientY;
  });
  const fireUp = () => {
    firing = false;
    fireT.id = -1;
    hud.tFire.classList.remove("on");
  };
  on(hud.tFire, "pointerup", fireUp);
  on(hud.tFire, "pointercancel", fireUp);
  on(hud.tAds, "pointerdown", (ev: PointerEvent) => {
    ev.preventDefault();
    ads = !ads;
    hud.tAds.classList.toggle("on", ads);
  });
  on(hud.tReload, "pointerdown", (ev: PointerEvent) => {
    ev.preventDefault();
    startReload();
  });
  on(hud.tSwap, "pointerdown", (ev: PointerEvent) => {
    ev.preventDefault();
    shoulder = -shoulder;
  });

  // ------------------------------------------------------------ gamepad
  // Standard mapping: LS move, RS look, RT fire, LT aim, L3 sprint, X reload, Y shoulder, A confirm, Start pause.
  let padActive = false;
  let padPrev: boolean[] = [];
  const padDrove = { move: false, fire: false, ads: false };
  const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : (Math.sign(v) * (Math.abs(v) - 0.14)) / 0.86);
  function pollPad(dt: number) {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) pad = pad ?? p;
    if (!pad) {
      padActive = false;
      return;
    }
    const b = (i: number) => !!pad!.buttons[i]?.pressed || (pad!.buttons[i]?.value ?? 0) > 0.35;
    const edge = (i: number) => b(i) && !padPrev[i];
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    const rx = dz(pad.axes[2] ?? 0);
    const ry = dz(pad.axes[3] ?? 0);
    const any = lx || ly || rx || ry || pad.buttons.some((x) => x.pressed);
    if (any && !padActive) {
      padActive = true;
      if (stage === "playing") feed("CONTROLLER CONNECTED", "");
    }
    if (stage === "menu" && edge(0)) deploy("op");
    else if (stage === "menu" && edge(3)) deploy("daily");
    else if (stage === "paused" && (edge(0) || edge(9))) resume();
    else if (stage === "debrief" && edge(0)) {
      resetMission();
      startPlay();
    } else if (stage === "playing") {
      if (lx || ly) {
        moveIn.set(lx, -ly);
        padDrove.move = true;
      } else if (padDrove.move) {
        moveIn.set(0, 0);
        padDrove.move = false;
      }
      if (rx || ry) {
        const k = settings.sens * (ads ? 0.5 : 1);
        yaw -= Math.sign(rx) * rx * rx * 3.2 * k * dt;
        pitch = THREE.MathUtils.clamp(pitch - Math.sign(ry) * ry * ry * 2.2 * k * dt, -0.95, 0.8);
      }
      const rt = b(7);
      const lt = b(6);
      if (rt || padDrove.fire) {
        firing = rt;
        padDrove.fire = rt;
      }
      if (lt || padDrove.ads) {
        ads = lt;
        padDrove.ads = lt;
      }
      if (edge(10)) sprintHeld = !sprintHeld;
      if (!lx && !ly) sprintHeld = sprintHeld && keys.has("shift");
      if (edge(2)) startReload();
      if (edge(3)) shoulder = -shoulder;
      if (edge(9)) pause();
    }
    padPrev = pad.buttons.map((x) => x.pressed || x.value > 0.35);
  }

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
      console.error("[NEXUS] post-processing unavailable", err);
      composer = null;
      grade = null;
    }
  }

  if (window.visualViewport) {
    on(window.visualViewport, "resize", () => updateVisibleBottom());
    on(window.visualViewport, "scroll", () => updateVisibleBottom());
  }
  const onResize = () => {
    updateVisibleBottom();
    if (mobile && stage === "playing" && window.innerHeight > window.innerWidth) pause();
    viewW = Math.max(1, container.clientWidth);
    viewH = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(viewW, viewH);
    composer?.setPixelRatio(pixelRatio());
    composer?.setSize(viewW, viewH);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(container);
  else on(window, "resize", onResize);

  // --------------------------------------------------------------- loop
  let raf = 0;
  let last = performance.now();
  let hudAcc = 0;
  let scoreAcc = 0;

  function updateRain(dt: number) {
    const cx = camera.position.x;
    const cz = camera.position.z;
    const fall = 21 * dt;
    for (let i = 0; i < RAIN; i++) {
      const o = i * 6;
      let y = rainPos[o + 1] - fall;
      let x = rainPos[o] - fall * 0.08;
      let z = rainPos[o + 2] + fall * 0.03;
      if (y < 0 || Math.abs(x - cx) > 18 || Math.abs(z - cz) > 18) {
        x = cx + (fx() - 0.5) * 36;
        z = cz + (fx() - 0.5) * 36;
        if (y < 0) y = 14 + fx() * 3;
      }
      rainPos[o] = x;
      rainPos[o + 1] = y;
      rainPos[o + 2] = z;
      rainPos[o + 3] = x - 0.04;
      rainPos[o + 4] = y + 0.5;
      rainPos[o + 5] = z + 0.015;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  function separate() {
    for (let i = 0; i < soldiers.length; i++) {
      const A = soldiers[i];
      if (!A.alive || A.down || A.kind === "drone") continue;
      for (let j = i + 1; j < soldiers.length; j++) {
        const B = soldiers[j];
        if (!B.alive || B.down || B.kind === "drone") continue;
        const dx = B.root.position.x - A.root.position.x;
        const dz = B.root.position.z - A.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.75) {
          const push = (0.75 - d) * 0.5;
          const nx = (dx / d) * push;
          const nz = (dz / d) * push;
          if (A !== player) moveBy(A, -nx, -nz);
          if (B !== player) moveBy(B, nx, nz);
        }
      }
    }
  }

  function updateExtraction(dt: number, t: number) {
    padInner.rotation.y += dt * 0.6;
    if (phase < 3) {
      padMat.opacity = 0.28 + Math.sin(t * 1.4) * 0.06;
      beamMat.opacity = 0;
      return;
    }
    padMat.opacity = 0.65 + Math.sin(t * 4) * 0.25;
    // Fade the beam out as the camera enters it so it never tints the whole view.
    const camD = Math.hypot(camera.position.x - EXTRACT.x, camera.position.z - EXTRACT.z);
    beamMat.opacity = (0.3 + Math.sin(t * 2.5) * 0.06) * THREE.MathUtils.smoothstep(camD, 1.4, 4.5);
    progGeo.setDrawRange(0, Math.floor(uplink * 96) * 6);
  }

  function tick(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const realDt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const t = now / 1000;
    if (slowTimer > 0) {
      slowTimer -= realDt;
      if (slowTimer <= 0) timeScale = 1;
    }
    pollPad(realDt);
    const simulate = stage === "playing" || stage === "dead";
    const dt = simulate ? realDt * timeScale : 0;

    if (stage === "playing") {
      elapsed += realDt;
      if (pendingWave) {
        phaseTimer -= realDt;
        if (phaseTimer <= 0) {
          spawnWave(WAVE2, true);
          pendingWave = 0;
        }
      } else if (phase === 2 && hostilesLeft() === 0) {
        advancePhase();
      }
      // Don't let the player hunt for stragglers: reveal the last hostiles after a lull.
      const left = hostilesLeft();
      quietTime = enemies.some((e) => e.alive && e.state === "combat") ? 0 : quietTime + realDt;
      if (left > 0 && left <= 2 && quietTime > 6) {
        quietTime = -999;
        for (const e of enemies) {
          if (!e.alive) continue;
          e.spotted = 999;
          alertEnemy(e, 0.5);
        }
        banner("INTEL", left === 1 ? "LAST HOSTILE MARKED" : "LAST HOSTILES MARKED", "Uplink drone has painted their position", false, 2.4);
      }
    }
    if (stage === "dead") {
      deathTimer += realDt;
      if (deathTimer > (success ? 2.6 : 2.8)) showDebrief();
    }

    if (simulate) {
      aimAssist(realDt);
      updatePlayer(dt);
      allies.forEach((a, i) => updateAlly(a, i, dt));
      for (const e of [...enemies]) updateEnemy(e, dt);
      separate();
      updatePickups(dt);
      updateCamera(realDt);
    } else if (stage === "menu" || stage === "loading") {
      menuCamera(realDt);
    }
    // Animate + pose every soldier (also in the menu so idles breathe).
    const animDt = stage === "paused" || stage === "debrief" ? 0 : simulate ? dt : realDt;
    if (animDt > 0) {
      for (const s of soldiers) {
        if (s.alive && !s.down) {
          s.actor.mixer.update(animDt);
          upperBody(s, animDt);
        }
        updateBodyPose(s, animDt);
      }
    }
    if (stage !== "paused" && stage !== "debrief") {
      updateFx(realDt);
      updateRain(realDt);
      updateExtraction(realDt, t);
      audio.update(realDt);
    }
    if (simulate) {
      updateFastHud(realDt);
      updateMedals(realDt);
      updateCompass();
      updateObjectiveMarker();
      hudAcc += realDt;
      if (hudAcc > 0.1) {
        hudAcc = 0;
        updateHud();
      }
      scoreAcc += realDt;
      if (scoreAcc > 0.25) {
        scoreAcc = 0;
        hooks.onScore(bonus);
      }
    }
    if (grade) {
      grade.uniforms.uTime.value = t;
      grade.uniforms.uFade.value = stage === "dead" ? Math.min(0.55, deathTimer * 0.2) : 0;
    }
    if (composer) composer.render(realDt);
    else renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(tick);
  void boot();

  if (process.env.NODE_ENV !== "production") {
    // Dev-only test handle (used for automated screenshots).
    (window as unknown as Record<string, unknown>).__nx = {
      get stage() {
        return stage;
      },
      get phase() {
        return phase;
      },
      get player() {
        return player;
      },
      soldiers,
      enemies,
      allies,
      camera,
      start: () => startPlay(),
      killWave: () => enemies.filter((e) => e.alive).forEach((e) => damage(e, 999, player, false)),
      god: () => {
        if (player) player.hp = player.maxHp = 1e6;
      },
      teleport: (x: number, z: number) => player?.root.position.set(x, 0, z),
      setView: (y: number, p: number) => {
        yaw = y;
        pitch = p;
      },
      setAds: (v: boolean) => (ads = v),
      setFiring: (v: boolean) => (firing = v),
      hurt: (n: number) => player && damage(player, n, enemies[0] ?? null),
      cam: (p: number[] | null, l?: number[]) => {
        debugCam = p && l ? { pos: new THREE.Vector3(p[0], p[1], p[2]), look: new THREE.Vector3(l[0], l[1], l[2]) } : null;
      },
    };
  }

  // ------------------------------------------------------------ dispose
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const off of listeners) off();
      ro?.disconnect();
      if (document.pointerLockElement === canvas) {
        try {
          document.exitPointerLock();
        } catch {
          /* ignore */
        }
      }
      clearMission();
      const srcGeos = new Set<THREE.BufferGeometry>();
      const srcMats = new Set<THREE.Material>();
      const srcTex = new Set<THREE.Texture>();
      for (const obj of sourceObjects) {
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) srcGeos.add(mesh.geometry);
          if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => srcMats.add(m));
        });
      }
      for (const m of srcMats) {
        for (const v of Object.values(m as unknown as Record<string, unknown>)) {
          if (v && typeof v === "object" && (v as THREE.Texture).isTexture) srcTex.add(v as THREE.Texture);
        }
      }
      srcGeos.forEach((g) => g.dispose());
      srcMats.forEach((m) => m.dispose());
      srcTex.forEach((t) => t.dispose());
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
      if (process.env.NODE_ENV !== "production") delete (window as unknown as Record<string, unknown>).__nx;
    },
  };
}

"use client";

/**
 * GRIDLOCK — tower defence across District 07.
 *
 * Drone swarms pour in through three edge gates and follow the avenues to the Reactor Core. Build five
 * tower lines on rooftops (height = range, but also cost), chain arcs, slow with EMP, snipe with rails,
 * and hold twenty waves. Simulation runs on a fixed 60 Hz step so the speed toggle and the dev bot are
 * deterministic; rendering is instanced (towers, enemies, HP bars, pads) with one bloom post stack.
 */

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GradeShader } from "./nexus-lib/grade";
import { softDot, verticalFade } from "./nexus-lib/textures";
import { esc } from "./nexus-lib/hud";
import {
  BUILD_TIME,
  CORE_HP,
  ENEMIES,
  PITCH,
  SELL_RATE,
  SHIELD_R,
  START_CREDITS,
  STOMP_R,
  TOTAL_WAVES,
  TOWERS,
  TOWER_ORDER,
  buildLots,
  buildPaths,
  mulberry32,
  pathAt,
  stars as starsFor,
  towerStats,
  upgradeCost,
  waveClearBonus,
  waveDef,
  type EnemyDef,
  type EnemyId,
  type Path,
  type TargetMode,
  type TierStats,
  type TowerId,
  type WaveDef,
} from "./gridlock-lib/data";
import { buildCity, buildGround, type Reg } from "./gridlock-lib/city";
import { buildReactor, createEnemyGeos, createTowerKit, type TowerModel } from "./gridlock-lib/models";
import { createBeams, createParticles, createRings } from "./gridlock-lib/fx";
import { buildGlHud, icon } from "./gridlock-lib/hud";
import { createSfx } from "./gridlock-lib/sfx";

type RunStat = { label: string; value: string };
type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number, stats: RunStat[], opts?: { ownScreen?: boolean }) => void;
  best?: number;
};
type GameInstance = { dispose: () => void };
type Mode = "campaign" | "endless";
type Stage = "loading" | "menu" | "play" | "paused" | "ending" | "results";

type Enemy = {
  id: number;
  type: EnemyId;
  def: EnemyDef;
  path: Path;
  d: number;
  lat: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  slow: number;
  slowT: number;
  vuln: number;
  vulnT: number;
  stunT: number;
  stripT: number;
  shielded: boolean;
  wave: number;
  reward: number;
  alive: boolean;
  flying: boolean;
  flash: number;
  stompCd: number;
  stompAnim: number;
  bob: number;
  robot: Robot | null;
  bubble: THREE.Mesh | null;
};
type Robot = { root: THREE.Object3D; mixer: THREE.AnimationMixer; walk: THREE.AnimationAction; punch: THREE.AnimationAction | null; kind: "walker" | "boss"; used: boolean };
type Tower = {
  id: TowerId;
  pad: number;
  tier: number;
  branch: number;
  mode: TargetMode;
  cd: number;
  st: TierStats;
  range: number;
  x: number;
  y: number;
  z: number;
  spent: number;
  disabledT: number;
  model: TowerModel;
  target: Enemy | null;
  recoil: number;
  charge: number;
};
type Spawn = { t: number; type: EnemyId; gate: number; wave: number; hpMul: number; rewardMul: number };

const ASSET = "/assets";
const SAVE_KEY = "playverse:gridlock:save";
const SET_KEY = "playverse:gridlock:settings";
const SEEN_KEY = "playverse:gridlock:seen";
const SIM_DT = 1 / 60;
const FLY_Y = 13;
const MODES: Array<TargetMode> = ["first", "strong", "close"];

function store<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* quota / private mode */
  }
}
const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");

const HpBarShader = {
  vertex: `
    attribute float aFill; varying vec2 vUv; varying float vFill; uniform vec3 uRight; uniform vec3 uUp;
    void main(){ vUv = uv; vFill = aFill;
      vec3 c = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
      float sx = length(instanceMatrix[0].xyz); float sy = length(instanceMatrix[1].xyz);
      vec3 wp = c + uRight * position.x * sx + uUp * position.y * sy;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
  fragment: `
    varying vec2 vUv; varying float vFill;
    void main(){
      float inside = step(0.07, vUv.x) * step(vUv.x, 0.93) * step(0.2, vUv.y) * step(vUv.y, 0.8);
      float f = step((vUv.x - 0.07) / 0.86, vFill);
      vec3 col = mix(vec3(1.0, 0.25, 0.2), vec3(0.35, 1.0, 0.5), smoothstep(0.25, 0.7, vFill));
      vec3 c = mix(vec3(0.02, 0.03, 0.05), col * 0.8, f);
      gl_FragColor = vec4(mix(vec3(0.0), c, inside), 0.92); }`,
};

const FlowShader = {
  vertex: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragment: `
    uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
    void main(){
      float across = abs(vUv.x - 0.5) * 2.0;
      float edge = smoothstep(0.7, 0.92, across) * (1.0 - smoothstep(0.96, 1.0, across));
      float p = fract(vUv.y * 0.55 - uTime * 0.55 + across * 0.32);
      float chev = smoothstep(0.0, 0.07, p) * (1.0 - smoothstep(0.1, 0.3, p));
      float fillA = 0.07 + chev * 0.5 * (1.0 - across * 0.4);
      float a = max(edge * 0.75, fillA);
      gl_FragColor = vec4(uColor * (1.1 + edge * 0.6), a * (1.0 - smoothstep(0.97, 1.0, across)));
    }`,
};

export function createGame(container: HTMLElement, hooks: GameHooks): GameInstance {
  const rng = mulberry32(5150);
  const fx = Math.random;
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const mobile = coarse || container.clientWidth < 720;

  // ----------------------------------------------------------------- registries
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const listeners: Array<() => void> = [];
  const reg: Reg = {
    G: (g) => (geometries.add(g), g),
    M: (m) => (materials.add(m), m),
    T: (t) => (textures.add(t), t),
  };
  const { G, M, T } = reg;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = (el: EventTarget, type: string, fn: (ev: any) => void, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };

  const settings = store(SET_KEY, { vol: 0.8, muted: false });
  const progress = store<{ best: number; bestWave: number; bestStars: number; wins: number; endlessBest: number; endlessWave: number }>(SAVE_KEY, {
    best: 0,
    bestWave: 0,
    bestStars: 0,
    wins: 0,
    endlessBest: 0,
    endlessWave: 0,
  });
  let seen = false;
  try {
    seen = localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    /* ignore */
  }

  // ----------------------------------------------------------------- state
  let stage: Stage = "loading";
  let pausedFrom: Stage = "play";
  let disposed = false;
  let mode: Mode = "campaign";
  let simSpeed = 1;
  let simBot = 1; // dev: extra sim multiplier
  let clock = 0; // wall clock for shaders
  let simTime = 0;
  let shake = 0;
  let coreHit = 0;
  let endT = 0;
  let endWin = false;

  let viewW = Math.max(1, container.clientWidth);
  let viewH = Math.max(1, container.clientHeight);

  // run state
  let credits = START_CREDITS;
  let integrity = CORE_HP;
  let score = 0;
  let kills = 0;
  let creditsEarned = 0;
  let waveNum = 0; // waves launched
  let phase: "build" | "active" = "build";
  let buildT = 40;
  let earlyCalls = 0;
  let leaked = 0;
  let wavesCleared = 0;
  const outstanding = new Map<number, number>();
  const spawnQ: Spawn[] = [];
  const enemies: Enemy[] = [];
  const towers: Tower[] = [];
  let enemyId = 0;
  let sellConfirm = 0;
  let scoreSent = 0;
  let totalSpawned = 0;
  let waveTotal = 0;
  let waveDone = 0;

  // selection / placement
  let armed: TowerId | null = null;
  let selPad = -1;
  let hoverPad = -1;
  let hoverX = -999;
  let hoverY = -999;
  let tutorStep = seen ? 99 : 0;
  let botOn = false;
  let botT = 0;

  // ----------------------------------------------------------------- HUD / audio
  const hud = buildGlHud(container, mobile);
  const sfx = createSfx();
  sfx.setVolume(settings.vol);
  sfx.setMuted(settings.muted);
  const prevOverflow = document.body.style.overflow;
  const prevOverscroll = document.documentElement.style.overscrollBehavior;
  if (mobile) {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
  }

  // ----------------------------------------------------------------- renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.5);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(viewW, viewH);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  container.insertBefore(canvas, hud.style);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d0a1e, 0.0021);
  const camera = new THREE.PerspectiveCamera(42, viewW / viewH, 1, 1400);
  scene.add(camera);
  {
    const cv = document.createElement("canvas");
    cv.width = 16;
    cv.height = 512;
    const c = cv.getContext("2d")!;
    const g = c.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#03030a");
    g.addColorStop(0.35, "#0b0820");
    g.addColorStop(0.47, "#2a1845");
    g.addColorStop(0.5, "#5a2a5c");
    g.addColorStop(0.53, "#1a1230");
    g.addColorStop(1, "#08060f");
    c.fillStyle = g;
    c.fillRect(0, 0, 16, 512);
    const sky = T(new THREE.CanvasTexture(cv));
    sky.colorSpace = THREE.SRGBColorSpace;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = sky;
  }
  scene.add(new THREE.HemisphereLight(0x8a7ad8, 0x0a0812, 0.8));
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.9);
  moon.position.set(-160, 260, -120);
  scene.add(moon);
  const dotTex = T(softDot());
  const fadeTex = T(verticalFade());

  // ----------------------------------------------------------------- map data
  const paths = buildPaths();
  const { lots, pads } = buildLots(paths);
  const hoverPaths: Path[] = paths.map((p) => {
    const a = p.gate;
    const end = p.pts[p.pts.length - 1];
    const len = Math.hypot(end.x - a.x, end.z - a.z);
    return { ...p, pts: [a, end], cum: [0, len], len };
  });
  const padTower: Array<Tower | null> = pads.map(() => null);
  let gatesOpen = 2;

  // ----------------------------------------------------------------- scenery
  const ground = buildGround(reg, lots, paths, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  scene.add(ground);
  const city = buildCity(reg, lots, paths, mobile);
  scene.add(city.group);

  // neon signs on facades that face an avenue
  {
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 256;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#000";
    c.fillRect(0, 0, 64, 256);
    c.fillStyle = "#fff";
    for (let y = 12; y < 244; y += 34) {
      const w = 14 + Math.floor(rng() * 30);
      c.fillRect(32 - w / 2, y, w, 6 + Math.floor(rng() * 14));
    }
    c.strokeStyle = "#fff";
    c.lineWidth = 3;
    c.strokeRect(3, 3, 58, 250);
    const tex = T(new THREE.CanvasTexture(cv));
    const NEON = [0xff3fc8, 0x35f0ff, 0xffb547, 0x9a5cff, 0x4ade80, 0xff4d5c];
    const signMat = M(new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const tall = lots.filter((l) => !l.plaza && l.h > 13);
    const inst = new THREE.InstancedMesh(G(new THREE.PlaneGeometry(1, 1)), signMat, tall.length);
    const ax = [-96, -48, 0, 48, 96];
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    tall.forEach((l, i) => {
      const nx = ax.reduce((b, a) => (Math.abs(a - l.x) < Math.abs(b - l.x) ? a : b), 0);
      const nz = ax.reduce((b, a) => (Math.abs(a - l.z) < Math.abs(b - l.z) ? a : b), 0);
      const alongX = Math.abs(nx - l.x) < Math.abs(nz - l.z);
      const sgn = alongX ? Math.sign(nx - l.x) : Math.sign(nz - l.z);
      const sh = 6 + rng() * 6;
      const y = Math.max(sh / 2 + 3, l.h * (0.45 + rng() * 0.3));
      const off = 8.05;
      const pos = new THREE.Vector3(l.x + (alongX ? sgn * off : (rng() - 0.5) * 8), y, l.z + (alongX ? (rng() - 0.5) * 8 : sgn * off));
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? (sgn > 0 ? Math.PI / 2 : -Math.PI / 2) : sgn > 0 ? 0 : Math.PI);
      m4.compose(pos, q, new THREE.Vector3(sh * 0.3, sh, 1));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, col.setHex(NEON[Math.floor(rng() * NEON.length)]).multiplyScalar(1.5));
    });
    inst.frustumCulled = false;
    scene.add(inst);
  }

  // flying traffic layer
  type Car = { lane: number; axis: 0 | 1; t: number; speed: number; y: number };
  const cars: Car[] = [];
  const carMesh = new THREE.InstancedMesh(G(new THREE.BoxGeometry(1, 0.4, 2.4)), M(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })), mobile ? 26 : 56);
  {
    const COLS = [0xff3fc8, 0x35f0ff, 0xffb547, 0xffffff, 0xff4d5c];
    const col = new THREE.Color();
    for (let i = 0; i < carMesh.count; i++) {
      const axis = (i % 2) as 0 | 1;
      cars.push({ lane: (rng() - 0.5) * 520, axis, t: (rng() - 0.5) * 600, speed: (14 + rng() * 30) * (rng() < 0.5 ? -1 : 1), y: 55 + rng() * 60 });
      carMesh.setColorAt(i, col.setHex(COLS[Math.floor(rng() * COLS.length)]).multiplyScalar(2));
    }
    carMesh.frustumCulled = false;
    scene.add(carMesh);
  }

  // rain
  const RAIN = mobile ? 900 : 2000;
  const rainPos = new Float32Array(RAIN * 6);
  const rainSeed = new Float32Array(RAIN * 3);
  for (let i = 0; i < RAIN; i++) rainSeed.set([fx() * 2 - 1, fx(), fx() * 2 - 1], i * 3);
  const rainGeo = G(new THREE.BufferGeometry());
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, M(new THREE.LineBasicMaterial({ color: 0xb8c8ff, transparent: true, opacity: 0.3, depthWrite: false })));
  rain.frustumCulled = false;
  scene.add(rain);

  // enemy lanes (animated flow ribbons) + gates
  const flowMats: THREE.ShaderMaterial[] = [];
  const xrayMats: THREE.ShaderMaterial[] = [];
  const gateObjs: Array<{ beam: THREE.Mesh; ring: THREE.Mesh; light: THREE.PointLight; group: THREE.Group }> = [];
  paths.forEach((p, gi) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const W = 2.6;
    // miter-joined ribbon along the polyline
    const pts = p.pts;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[i];
      const c = pts[Math.min(pts.length - 1, i + 1)];
      const d1x = b.x - a.x;
      const d1z = b.z - a.z;
      const d2x = c.x - b.x;
      const d2z = c.z - b.z;
      const l1 = Math.hypot(d1x, d1z) || 1;
      const l2 = Math.hypot(d2x, d2z) || 1;
      const n1 = { x: -d1z / l1, z: d1x / l1 };
      const n2 = { x: -d2z / l2, z: d2x / l2 };
      let mx = n1.x + n2.x;
      let mz = n1.z + n2.z;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      const dot = Math.max(0.35, mx * n1.x + mz * n1.z);
      const k = W / 2 / dot;
      pos.push(b.x - mx * k, 0.07, b.z - mz * k, b.x + mx * k, 0.07, b.z + mz * k);
      uv.push(0, p.cum[i], 1, p.cum[i]);
      if (i < pts.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = G(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = M(
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(p.color) } },
        vertexShader: FlowShader.vertex,
        fragmentShader: FlowShader.fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    flowMats.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    scene.add(mesh);
    const mx = M(m.clone());
    mx.depthTest = false;
    (mx as THREE.ShaderMaterial).uniforms = { uTime: m.uniforms.uTime, uColor: { value: m.uniforms.uColor.value.clone().multiplyScalar(0.3) } };
    xrayMats.push(mx as THREE.ShaderMaterial);
    const mesh2 = new THREE.Mesh(geo, mx);
    mesh2.renderOrder = 1;
    mesh2.frustumCulled = false;
    scene.add(mesh2);
    // gate beacon
    const grp = new THREE.Group();
    grp.position.set(p.gate.x, 0, p.gate.z);
    const bm = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(1.5), map: fadeTex, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    const beam = new THREE.Mesh(G(new THREE.CylinderGeometry(1.6, 2.4, 70, 16, 1, true).translate(0, 35, 0)), bm);
    grp.add(beam);
    const ring = new THREE.Mesh(G(new THREE.TorusGeometry(5.2, 0.22, 8, 40).rotateX(Math.PI / 2)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(1.8), toneMapped: false })));
    ring.position.y = 0.4;
    grp.add(ring);
    const light = new THREE.PointLight(p.color, 60, 50, 1.6);
    light.position.y = 6;
    grp.add(light);
    scene.add(grp);
    gateObjs.push({ beam, ring, light, group: grp });
    void gi;
  });

  // reactor
  const reactor = buildReactor(reg, fadeTex);
  reactor.group.scale.setScalar(1.35);
  scene.add(reactor.group);
  const coreBar = (() => {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 64;
    const tex = T(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(M(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false, fog: false })));
    sp.scale.set(14, 3.5, 1);
    sp.position.set(0, 21, 0);
    sp.renderOrder = 10;
    reactor.group.add(sp);
    return { cv, tex, draw() {
      const c = cv.getContext("2d")!;
      c.clearRect(0, 0, 256, 64);
      c.fillStyle = "rgba(4,10,14,.75)";
      c.fillRect(8, 20, 240, 36);
      const f = integrity / CORE_HP;
      c.fillStyle = f > 0.5 ? "#4ade80" : f > 0.25 ? "#ffb547" : "#ff4d5c";
      c.fillRect(12, 24, 232 * f, 28);
      c.font = "700 20px sans-serif";
      c.fillStyle = "#fff";
      c.textAlign = "center";
      c.fillText(`CORE ${integrity}/${CORE_HP}`, 128, 17);
      tex.needsUpdate = true;
    } };
  })();
  coreBar.draw();

  // pads
  const padGeoRing = G(new THREE.RingGeometry(4.6, 5.5, 6).rotateX(-Math.PI / 2));
  const padGeoFill = G(new THREE.CircleGeometry(4.6, 6).rotateX(-Math.PI / 2));
  const padMatRing = M(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
  const padMatFill = M(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
  const padRing = new THREE.InstancedMesh(padGeoRing, padMatRing, pads.length);
  const padFill = new THREE.InstancedMesh(padGeoFill, padMatFill, pads.length);
  for (const m of [padRing, padFill]) {
    m.frustumCulled = false;
    m.renderOrder = 4;
    scene.add(m);
  }
  const padM = new THREE.Matrix4();
  const padCol = new THREE.Color();

  // range indicator + hover marker
  const rangeRing = new THREE.Mesh(G(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2)), M(new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })));
  const rangeFill = new THREE.Mesh(G(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2)), M(new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })));
  rangeRing.visible = rangeFill.visible = false;
  rangeRing.renderOrder = rangeFill.renderOrder = 3;
  scene.add(rangeRing, rangeFill);

  // effects
  const beams = createBeams(scene, 1400);
  const parts = createParticles(scene, mobile ? 1500 : 2800);
  const rings = createRings(scene, 28);

  // ----------------------------------------------------------------- enemies (instanced)
  const eg = createEnemyGeos(reg);
  type InstType = "skitter" | "hover" | "shield" | "splitter";
  const INST: InstType[] = ["skitter", "hover", "shield", "splitter"];
  const instMeshes = {} as Record<InstType, { body: THREE.InstancedMesh; glow: THREE.InstancedMesh; n: number; cap: number }>;
  const bodyCols: Record<InstType, number> = { skitter: 0x2a1c22, hover: 0x2a1a32, shield: 0x1a2840, splitter: 0x22301a };
  for (const t of INST) {
    const cap = t === "skitter" ? 360 : 140;
    const def = ENEMIES[t];
    const body = new THREE.InstancedMesh(eg[t].body, M(new THREE.MeshStandardMaterial({ color: bodyCols[t], roughness: 0.4, metalness: 0.7, flatShading: t === "splitter" })), cap);
    const glow = new THREE.InstancedMesh(eg[t].glow, M(new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(2.1), toneMapped: false })), cap);
    for (const m of [body, glow]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    instMeshes[t] = { body, glow, n: 0, cap };
  }
  // hp bars
  const BAR_CAP = 260;
  const barGeo = G(new THREE.PlaneGeometry(1, 1));
  const barFill = new Float32Array(BAR_CAP);
  barGeo.setAttribute("aFill", new THREE.InstancedBufferAttribute(barFill, 1).setUsage(THREE.DynamicDrawUsage));
  const barMat = M(new THREE.ShaderMaterial({ vertexShader: HpBarShader.vertex, fragmentShader: HpBarShader.fragment, uniforms: { uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) } }, transparent: true, depthTest: false, depthWrite: false }));
  const bars = new THREE.InstancedMesh(barGeo, barMat, BAR_CAP);
  bars.frustumCulled = false;
  bars.renderOrder = 12;
  bars.count = 0;
  scene.add(bars);
  // shield bubble
  const bubbleGeo = G(new THREE.SphereGeometry(SHIELD_R, 28, 18));
  const bubbleMat = M(
    new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(0x6aa8ff) }, uA: { value: 1 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uC; uniform float uA; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(uC * (f * 1.4 + 0.1), (f * 0.42 + 0.03) * uA); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  // robots (walker + juggernaut)
  let robotGltf: GLTF | null = null;
  const robotMats = new Map<string, THREE.Material>();
  const robotPool: Robot[] = [];
  function tintedMaterial(src: THREE.Material, kind: "walker" | "boss") {
    const key = `${kind}:${src.uuid}`;
    let m = robotMats.get(key);
    if (!m) {
      const c = (src as THREE.MeshStandardMaterial).clone();
      if (kind === "boss") {
        c.color.multiply(new THREE.Color(0.85, 0.4, 0.38));
        c.emissive = new THREE.Color(0xff1f30).multiplyScalar(0.1);
      } else {
        c.color.multiply(new THREE.Color(0.8, 0.85, 0.95));
        c.emissive = new THREE.Color(0xffa020).multiplyScalar(0.05);
      }
      c.metalness = Math.max(c.metalness, 0.4);
      robotMats.set(key, M(c));
      m = c;
    }
    return m;
  }
  function acquireRobot(kind: "walker" | "boss"): Robot | null {
    if (!robotGltf) return null;
    let r = robotPool.find((x) => x.kind === kind && !x.used);
    if (!r) {
      const root = cloneSkeleton(robotGltf.scene);
      root.scale.setScalar(kind === "boss" ? 3.4 : 0.95);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) {
          mesh.frustumCulled = false;
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => tintedMaterial(m, kind)) : tintedMaterial(mesh.material, kind);
        }
      });
      const mixer = new THREE.AnimationMixer(root);
      const find = (n: string) => robotGltf!.animations.find((a) => a.name === n);
      const wc = find("Walking") ?? find("Running") ?? robotGltf.animations[0];
      const walk = mixer.clipAction(wc);
      walk.play();
      const pc = find("Punch");
      const punch = pc ? mixer.clipAction(pc) : null;
      if (punch) punch.setLoop(THREE.LoopOnce, 1);
      scene.add(root);
      r = { root, mixer, walk, punch, kind, used: false };
      robotPool.push(r);
    }
    r.used = true;
    r.root.visible = true;
    return r;
  }
  function releaseRobot(r: Robot | null) {
    if (!r) return;
    r.used = false;
    r.root.visible = false;
  }

  // towers
  let turretSrc: THREE.Object3D | null = null;
  let kit = createTowerKit(reg, null);
  const ghosts = new Map<TowerId, TowerModel>();

  // ----------------------------------------------------------------- composer
  let composer: EffectComposer | null = null;
  let grade: ShaderPass | null = null;
  let bloom: UnrealBloomPass | null = null;
  try {
    const rt = new THREE.WebGLRenderTarget(viewW * pixelRatio(), viewH * pixelRatio(), { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(viewW, viewH), mobile ? 0.5 : 0.62, 0.55, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
  } catch (err) {
    console.error("[GRIDLOCK] post unavailable", err);
    composer = null;
  }
  const partScale = () => (viewH * pixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  parts.setScale(partScale());

  // ----------------------------------------------------------------- camera rig
  const cam = { tx: 0, tz: 0, gx: 0, gz: 0, dist: mobile ? 140 : 170, gdist: mobile ? 140 : 170, yaw: Math.PI / 4, gyaw: Math.PI / 4, pitch: (64 * Math.PI) / 180, gpitch: (64 * Math.PI) / 180 };
  const DMIN = 42;
  const DMAX = 230;
  const keys = new Set<string>();
  let edgeX = 0;
  let edgeZ = 0;
  function applyCamera() {
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.tx, 0, cam.tz);
    camera.updateMatrixWorld();
  }
  const clampCam = () => {
    cam.gx = Math.max(-105, Math.min(105, cam.gx));
    cam.gz = Math.max(-105, Math.min(105, cam.gz));
    cam.gdist = Math.max(DMIN, Math.min(DMAX, cam.gdist));
  };
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hitV = new THREE.Vector3();
  function groundAt(px: number, py: number, out: THREE.Vector3) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, out);
  }
  function updateCamera(dt: number) {
    if (stage === "menu" || stage === "loading") {
      cam.gyaw += dt * 0.06;
      cam.yaw = cam.gyaw;
      cam.gx = Math.sin(clock * 0.07) * 18;
      cam.gz = Math.cos(clock * 0.05) * 12;
      cam.gdist = mobile ? 105 : 92;
      cam.gpitch = (34 * Math.PI) / 180;
    } else if (cam.gpitch < 0.9 && stage !== "ending") {
      cam.gpitch = (64 * Math.PI) / 180;
    }
    if (stage === "play") {
      const sp = cam.dist * 0.9 * dt;
      let mx = 0;
      let mz = 0;
      if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
      if (keys.has("d") || keys.has("arrowright")) mx += 1;
      if (keys.has("w") || keys.has("arrowup")) mz += 1;
      if ((keys.has("s") && selTower() === null) || keys.has("arrowdown")) mz -= 1;
      mx += edgeX;
      mz += edgeZ;
      if (mx || mz) {
        const l = Math.hypot(mx, mz);
        mx /= l;
        mz /= l;
        // screen-right = (cos yaw, -sin yaw), screen-up = (-sin yaw, -cos yaw)
        cam.gx += (Math.cos(cam.yaw) * mx - Math.sin(cam.yaw) * mz) * sp;
        cam.gz += (-Math.sin(cam.yaw) * mx - Math.cos(cam.yaw) * mz) * sp;
      }
    }
    clampCam();
    const k = 1 - Math.exp(-dt * 9);
    cam.tx += (cam.gx - cam.tx) * k;
    cam.tz += (cam.gz - cam.tz) * k;
    cam.dist += (cam.gdist - cam.dist) * k;
    cam.yaw += (cam.gyaw - cam.yaw) * k;
    cam.pitch += (cam.gpitch - cam.pitch) * k;
    applyCamera();
    if (shake > 0.001) {
      camera.position.x += (fx() - 0.5) * shake * 2.4;
      camera.position.y += (fx() - 0.5) * shake * 2.4;
      camera.position.z += (fx() - 0.5) * shake * 2.4;
      shake *= Math.exp(-dt * 6);
    }
  }
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();

  // ----------------------------------------------------------------- helpers
  const tmpV = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);
  const pad = (i: number) => pads[i];
  const costOf = (id: TowerId, p: number) => Math.round(TOWERS[id].cost * pad(p).costMul);
  const selTower = () => (selPad >= 0 ? padTower[selPad] : null);
  const towerCount = () => towers.length;
  function feed(text: string, cls = "", big = false) {
    const d = document.createElement("div");
    d.textContent = text;
    d.className = (cls ? cls + " " : "") + (big ? "big" : "");
    hud.feed.appendChild(d);
    window.setTimeout(() => d.remove(), 2300);
    while (hud.feed.children.length > 4) hud.feed.firstChild?.remove();
  }
  function hint(html: string, bad = false, ms = 1800) {
    hud.hint.innerHTML = html;
    hud.hint.classList.toggle("bad", bad);
    hud.hint.classList.add("on");
    hintUntil = performance.now() + ms;
  }
  let hintUntil = 0;
  function setScore(add: number) {
    score += add;
  }

  // ----------------------------------------------------------------- run lifecycle
  function clearRun() {
    for (const e of enemies) {
      releaseRobot(e.robot);
      if (e.bubble) scene.remove(e.bubble);
    }
    enemies.length = 0;
    for (const t of towers) {
      scene.remove(t.model.root);
    }
    towers.length = 0;
    padTower.fill(null);
    spawnQ.length = 0;
    outstanding.clear();
  }
  function resetRun(m: Mode) {
    clearRun();
    mode = m;
    credits = START_CREDITS;
    integrity = CORE_HP;
    score = 0;
    kills = 0;
    creditsEarned = 0;
    waveNum = 0;
    wavesCleared = 0;
    phase = "build";
    buildT = 42;
    earlyCalls = 0;
    leaked = 0;
    scoreSent = 0;
    totalSpawned = 0;
    gatesOpen = 2;
    simTime = 0;
    armed = null;
    selPad = -1;
    waveTotal = 0;
    waveDone = 0;
    endT = 0;
    shake = 0;
    coreHit = 0;
    hud.boss.classList.remove("on");
    coreBar.draw();
    refreshHud(true);
    hooks.onScore(0);
  }
  function startRun(m: Mode) {
    sfx.ensure();
    resetRun(m);
    stage = "play";
    hud.root.dataset.mode = "play";
    hud.ov.classList.remove("on");
    hud.ov.innerHTML = "";
    cam.gx = cam.gz = 0;
    cam.gyaw = Math.round((cam.gyaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
    cam.gpitch = (64 * Math.PI) / 180;
    cam.gdist = mobile ? 140 : 170;
    if (tutorStep < 99) tutorStep = 0;
    refreshTutor();
    refreshHud(true);
    renderSel();
    updateBar();
  }

  function launchWave(early: boolean) {
    if (stage !== "play") return;
    if (mode === "campaign" && waveNum >= TOTAL_WAVES) return;
    const w = waveNum + 1;
    if (early && phase === "build") {
      const bonus = Math.max(0, Math.floor(buildT * 1.5));
      if (bonus > 0) {
        credits += bonus;
        creditsEarned += bonus;
        feed(`EARLY CALL  +${bonus}`, "a");
      }
      earlyCalls++;
      setScore(25);
    } else if (early) {
      earlyCalls++;
      setScore(25);
    }
    waveNum = w;
    gatesOpen = w >= 10 ? 3 : 2;
    const def = waveDef(w);
    let n = 0;
    for (const g of def.groups) {
      for (let i = 0; i < g.count; i++) {
        spawnQ.push({ t: simTime + g.delay + i * g.gap, type: g.type, gate: g.gate, wave: w, hpMul: def.hpMul, rewardMul: def.rewardMul });
        n++;
      }
    }
    spawnQ.sort((a, b) => a.t - b.t);
    outstanding.set(w, n);
    waveTotal = n;
    waveDone = 0;
    phase = "active";
    sfx.wave(def.boss);
    feed(def.boss ? `WAVE ${w} · JUGGERNAUT` : def.note ? `WAVE ${w} · ${def.note}` : `WAVE ${w}`, def.boss ? "r" : "g", true);
    if (w === 10) feed("THIRD GATE OPENED · SOUTH", "a");
    if (tutorStep === 1) {
      tutorStep = 2;
      refreshTutor();
    }
    refreshHud(true);
  }

  function waveCleared(w: number) {
    wavesCleared++;
    const bonus = waveClearBonus(w);
    credits += bonus;
    creditsEarned += bonus;
    setScore(100 + w * 10);
    sfx.clear();
    feed(`WAVE ${w} CLEARED  +${bonus}`, "g");
    if (tutorStep === 2) {
      tutorStep = 3;
      refreshTutor();
    }
    if (mode === "campaign" && w >= TOTAL_WAVES && integrity > 0) {
      endRun(true);
    }
  }

  function endRun(win: boolean) {
    if (stage !== "play") return;
    stage = "ending";
    endWin = win;
    endT = win ? 2.2 : 3.2;
    armed = null;
    selPad = -1;
    renderSel();
    updateBar();
    hud.boss.classList.remove("on");
    if (win) {
      sfx.win();
      for (let i = 0; i < 6; i++) rings.spawn(0, 1 + i * 2, 0, 6, 40 + i * 12, 1.4 + i * 0.1, 0x4ade80, 0.7);
      parts.burst(0, 14, 0, 160, 40, 1.8, 2.2, 0x4ade80, { grav: 6 });
    } else {
      sfx.lose();
      shake = 3;
      for (let i = 0; i < 5; i++) rings.spawn(0, 1 + i, 0, 4, 55 + i * 14, 1.2 + i * 0.2, 0xff4d5c, 0.9);
      parts.burst(0, 10, 0, 240, 60, 2, 3, 0xff6a3a, { grav: 12 });
      parts.burst(0, 14, 0, 100, 30, 2.4, 3, 0xffffff, { grav: 4 });
    }
    cam.gx = cam.gz = 0;
    cam.gdist = 80;
  }

  function finishRun() {
    const win = endWin;
    const bonusInt = win || mode === "endless" ? integrity * 250 : 0;
    const finalScore = Math.round(score + (win ? bonusInt : 0));
    const st = win ? starsFor(integrity) : 0;
    const wavesReached = mode === "endless" ? Math.max(0, waveNum - (outstanding.size ? 1 : 0)) : win ? TOTAL_WAVES : Math.max(0, waveNum - 1);
    if (mode === "campaign") {
      if (finalScore > progress.best) progress.best = finalScore;
      if (wavesReached > progress.bestWave) progress.bestWave = wavesReached;
      if (st > progress.bestStars) progress.bestStars = st;
      if (win) progress.wins++;
    } else {
      if (finalScore > progress.endlessBest) progress.endlessBest = finalScore;
      if (wavesReached > progress.endlessWave) progress.endlessWave = wavesReached;
    }
    save(SAVE_KEY, progress);
    stage = "results";
    hud.root.dataset.mode = "results";
    const unlockedNow = win && progress.wins === 1;
    hud.ov.className = "gl-ov dim on";
    hud.ov.innerHTML = `<div class="gl-center">
      <div class="gl-kick ${win ? "" : "r"}">${win ? "DISTRICT 07 HOLDS" : mode === "endless" ? "ENDLESS MODE" : "REACTOR CORE LOST"}</div>
      <div class="gl-h2">${win ? "VICTORY" : mode === "endless" ? `SURVIVED ${wavesReached} WAVES` : "DEFENCE BROKEN"}</div>
      <div class="gl-stars">${[0, 1, 2].map((i) => `<i class="${i < st ? "on" : ""}" style="animation-delay:${0.2 + i * 0.25}s">★</i>`).join("")}</div>
      <div class="gl-res">
        <div class="big">SCORE<b>${fmtN(finalScore)}</b></div>
        <div>WAVES<b>${wavesReached}${mode === "campaign" ? ` / ${TOTAL_WAVES}` : ""}</b></div>
        <div>INTEGRITY<b>${integrity} / ${CORE_HP}</b></div>
        <div>KILLS<b>${fmtN(kills)}</b></div>
        <div>CREDITS EARNED<b>${fmtN(creditsEarned)}</b></div>
      </div>
      ${unlockedNow ? `<div class="gl-sub" style="color:#4ade80">ENDLESS MODE UNLOCKED</div>` : ""}
      <div class="gl-acts"><button class="gl-btn" data-go="retry">${win ? "PLAY AGAIN" : "RETRY"}</button><button class="gl-btn ghost" data-go="menu">MENU</button></div>
      <div class="gl-best" style="margin-top:14px">BEST <b>${fmtN(mode === "campaign" ? progress.best : progress.endlessBest)}</b> · WAVE <b>${mode === "campaign" ? progress.bestWave : progress.endlessWave}</b></div></div>`;
    hooks.onScore(finalScore);
    hooks.onGameOver(finalScore, [
      { label: "Waves", value: `${wavesReached}${mode === "campaign" ? "/" + TOTAL_WAVES : ""}` },
      { label: "Integrity", value: `${integrity}/${CORE_HP}` },
      { label: "Kills", value: String(kills) },
      { label: "Stars", value: "★".repeat(st) || "—" },
    ], { ownScreen: true });
  }

  // ----------------------------------------------------------------- enemies
  const pa = { x: 0, z: 0, dx: 0, dz: 1 };
  function spawnEnemy(type: EnemyId, gate: number, wave: number, hpMul: number, rewardMul: number, d0 = 0, split = false) {
    const def = ENEMIES[type];
    const g = Math.min(gate, gatesOpen - 1);
    const path = def.air ? hoverPaths[g] : paths[g];
    const hp = def.hp * hpMul * (split ? 0.55 : 1);
    const e: Enemy = {
      id: ++enemyId,
      type,
      def,
      path,
      d: d0,
      lat: (fx() - 0.5) * (type === "boss" ? 1 : 3.2),
      hp,
      maxHp: hp,
      x: path.gate.x,
      y: def.air ? FLY_Y : 0,
      z: path.gate.z,
      dx: 0,
      dz: 1,
      slow: 0,
      slowT: 0,
      vuln: 0,
      vulnT: 0,
      stunT: 0,
      stripT: 0,
      shielded: false,
      wave,
      reward: Math.max(1, Math.round(def.reward * rewardMul * (split ? 0.5 : 1))),
      alive: true,
      flying: def.air,
      flash: 0,
      stompCd: 5,
      stompAnim: 0,
      bob: fx() * 6.28,
      robot: null,
      bubble: null,
    };
    if (type === "walker" || type === "boss") e.robot = acquireRobot(type);
    if (type === "shield") {
      e.bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
      e.bubble.renderOrder = 3;
      scene.add(e.bubble);
    }
    enemies.push(e);
    totalSpawned++;
    if (!split) rings.spawn(path.gate.x, 0.5, path.gate.z, 2, 9, 0.6, path.color, 0.6);
    return e;
  }

  function damage(e: Enemy, raw: number, pierce = 0, noArmor = false) {
    if (!e.alive) return;
    let d = raw;
    if (!noArmor) d = Math.max(raw * 0.22, raw - Math.max(0, e.def.armor - pierce));
    if (e.shielded) d *= 0.35;
    if (e.vulnT > 0) d *= 1 + e.vuln;
    e.hp -= d;
    e.flash = 1;
    if (e.hp <= 0) kill(e);
  }

  function kill(e: Enemy) {
    if (!e.alive) return;
    e.alive = false;
    kills++;
    credits += e.reward;
    creditsEarned += e.reward;
    setScore(e.def.score * (1 + 0.02 * e.wave));
    const big = e.type === "boss";
    const col = e.def.color;
    const y = e.y + (e.flying ? 0 : 1.2);
    if (big) {
      parts.burst(e.x, y + 3, e.z, 160, 38, 1.8, 3.2, 0xff6a3a, { grav: 8 });
      parts.burst(e.x, y + 3, e.z, 80, 24, 1.4, 3.2, 0xffffff, { grav: 4 });
      for (let i = 0; i < 4; i++) rings.spawn(e.x, 0.6, e.z, 3, 26 + i * 8, 0.8 + i * 0.12, 0xff4d3a, 0.85);
      shake = Math.max(shake, 1.6);
      feed("JUGGERNAUT DESTROYED", "r", true);
    } else {
      const n = e.type === "skitter" ? 9 : 22;
      parts.burst(e.x, y, e.z, n, e.type === "skitter" ? 11 : 17, 0.7, e.type === "skitter" ? 0.9 : 1.5, col, { grav: 10 });
      parts.spawn(e.x, y, e.z, 0, 0, 0, 0.16, e.type === "skitter" ? 4 : 7, 0xffffff, { drag: 0, bright: 1.8 });
      if (e.type !== "skitter") rings.spawn(e.x, e.flying ? y : 0.5, e.z, 1, e.type === "shield" ? SHIELD_R * 0.7 : 6, 0.5, col, 0.7);
    }
    parts.spawn(e.x, y + 1, e.z, 0, 7, 0, 0.7, 1.1, 0xffd35a, { drag: 1.5, bright: 1.7 });
    sfx.kill(big || e.type === "shield", 0);
    if (e.type === "splitter") {
      for (let i = 0; i < 3; i++) {
        const c = spawnEnemy("skitter", 0, e.wave, waveDef(e.wave).hpMul, waveDef(e.wave).rewardMul, Math.max(0, e.d - 1 - i * 1.5), true);
        c.path = e.path;
        c.lat = e.lat + (i - 1) * 1.1;
        outstanding.set(e.wave, (outstanding.get(e.wave) ?? 0) + 1);
        parts.burst(e.x, 1.2, e.z, 6, 9, 0.5, 1, 0xb6ff4d, { grav: 10 });
      }
    }
    retire(e);
  }
  function retire(e: Enemy) {
    e.alive = false;
    releaseRobot(e.robot);
    e.robot = null;
    if (e.bubble) {
      scene.remove(e.bubble);
      e.bubble = null;
    }
    const left = (outstanding.get(e.wave) ?? 1) - 1;
    outstanding.set(e.wave, left);
    waveDone++;
    if (left <= 0) {
      outstanding.delete(e.wave);
      if (stage === "play") waveCleared(e.wave);
    }
  }

  function leak(e: Enemy) {
    e.alive = false;
    const dmg = e.def.leak;
    integrity = Math.max(0, integrity - dmg);
    leaked += dmg;
    coreHit = 1;
    shake = Math.max(shake, 0.5 + dmg * 0.12);
    sfx.leak();
    hud.flash.classList.remove("on");
    void hud.flash.offsetWidth;
    hud.flash.classList.add("on");
    rings.spawn(0, 0.7, 0, 4, 22, 0.7, 0xff4d5c, 0.9);
    parts.burst(e.x, 2, e.z, 24, 16, 0.8, 1.6, 0xff5a3a, { grav: 6 });
    feed(`CORE HIT  −${dmg}`, "r");
    coreBar.draw();
    retire(e);
    if (integrity <= 0) endRun(false);
  }

  const shieldSrc: Enemy[] = [];
  function updateEnemies(dt: number) {
    // shield projection
    shieldSrc.length = 0;
    for (const e of enemies) {
      e.shielded = false;
      if (e.alive && e.type === "shield" && e.stripT <= 0) shieldSrc.push(e);
    }
    if (shieldSrc.length) {
      for (const e of enemies) {
        if (!e.alive || e.type === "shield") continue;
        for (const s of shieldSrc) {
          const dx = e.x - s.x;
          const dz = e.z - s.z;
          if (dx * dx + dz * dz < SHIELD_R * SHIELD_R) {
            e.shielded = true;
            break;
          }
        }
      }
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e.alive) {
        enemies.splice(i, 1);
        continue;
      }
      e.flash = Math.max(0, e.flash - dt * 6);
      if (e.slowT > 0) {
        e.slowT -= dt;
        if (e.slowT <= 0) e.slow = 0;
      }
      if (e.vulnT > 0) e.vulnT -= dt;
      if (e.stripT > 0) e.stripT -= dt;
      let sp = e.def.speed;
      if (e.stunT > 0) {
        e.stunT -= dt;
        sp = 0;
      } else if (!e.flying) {
        sp *= 1 - e.slow * (e.type === "boss" ? 0.55 : 1);
      }
      if (e.stompAnim > 0) {
        e.stompAnim -= dt;
        sp *= 0.2;
      }
      e.d += sp * dt;
      if (e.d >= e.path.len) {
        leak(e);
        enemies.splice(i, 1);
        continue;
      }
      pathAt(e.path, e.d, pa);
      e.dx = pa.dx;
      e.dz = pa.dz;
      e.x = pa.x - pa.dz * e.lat;
      e.z = pa.z + pa.dx * e.lat;
      e.bob += dt * 3;
      e.y = e.flying ? FLY_Y + Math.sin(e.bob) * 0.7 : 0;
      if (e.type === "boss") {
        e.stompCd -= dt;
        if (e.stompCd <= 0) {
          let near = 0;
          for (const t of towers) if (Math.hypot(t.x - e.x, t.z - e.z) < STOMP_R) near++;
          if (near > 0) {
            e.stompCd = 7;
            e.stompAnim = 0.7;
            shake = Math.max(shake, 1.1);
            sfx.stomp();
            rings.spawn(e.x, 0.6, e.z, 2, STOMP_R, 0.9, 0xff4d3a, 0.9);
            rings.spawn(e.x, 0.6, e.z, 2, STOMP_R * 0.7, 0.7, 0xffb547, 0.7);
            parts.burst(e.x, 1, e.z, 40, 22, 0.8, 1.5, 0xffb547, { grav: 12 });
            for (const t of towers) if (Math.hypot(t.x - e.x, t.z - e.z) < STOMP_R) t.disabledT = 3.2;
            if (e.robot?.punch) {
              e.robot.punch.reset().play();
            }
          } else e.stompCd = 1;
        }
      }
    }
  }

  // ----------------------------------------------------------------- towers
  function placeTower(id: TowerId, p: number, free = false): boolean {
    if (padTower[p]) return false;
    const cost = costOf(id, p);
    if (!free && credits < cost) {
      sfx.deny();
      hint(`NOT ENOUGH CREDITS · NEED <b>${cost}</b>`, true);
      return false;
    }
    if (!free) credits -= cost;
    const model = kit.build(id);
    const pd = pad(p);
    model.root.position.set(pd.x, pd.h, pd.z);
    model.root.rotation.y = fx() * 6;
    scene.add(model.root);
    const st = towerStats(id, 1, 0);
    const t: Tower = {
      id,
      pad: p,
      tier: 1,
      branch: 0,
      mode: id === "rail" ? "strong" : "first",
      cd: 0.3,
      st,
      range: st.range * pd.rangeMul,
      x: pd.x,
      y: pd.h,
      z: pd.z,
      spent: free ? 0 : cost,
      disabledT: 0,
      model,
      target: null,
      recoil: 0,
      charge: 0,
    };
    model.root.rotation.y = 0;
    model.setTier(1, 0);
    model.root.updateMatrixWorld(true);
    towers.push(t);
    padTower[p] = t;
    sfx.place();
    rings.spawn(pd.x, pd.h + 0.6, pd.z, 1, 7, 0.5, TOWERS[id].color, 0.9);
    parts.burst(pd.x, pd.h + 1, pd.z, 26, 12, 0.7, 1.1, TOWERS[id].color, { up: 6, grav: 8 });
    if (tutorStep === 0) {
      tutorStep = 1;
      refreshTutor();
    }
    if (armed && credits < costOf(armed, p)) disarm();
    return true;
  }
  function upgradeTower(t: Tower, branch = 0): boolean {
    if (t.tier >= 3) return false;
    const b = t.tier === 2 ? branch : 0;
    const cost = upgradeCost(t.id, t.tier, b);
    if (credits < cost) {
      sfx.deny();
      hint(`NOT ENOUGH CREDITS · NEED <b>${cost}</b>`, true);
      return false;
    }
    credits -= cost;
    t.spent += cost;
    t.tier++;
    if (t.tier === 3) t.branch = b;
    t.st = towerStats(t.id, t.tier, t.branch);
    t.range = t.st.range * pad(t.pad).rangeMul;
    t.model.setTier(t.tier, t.branch);
    sfx.upgrade();
    rings.spawn(t.x, t.y + 0.6, t.z, 1, 9, 0.6, 0xffffff, 0.9);
    parts.burst(t.x, t.y + 2, t.z, 30, 14, 0.8, 1.2, TOWERS[t.id].color, { up: 8, grav: 8 });
    if (selPad === t.pad) renderSel();
    return true;
  }
  function sellTower(t: Tower) {
    const gain = Math.round(t.spent * SELL_RATE);
    credits += gain;
    scene.remove(t.model.root);
    const i = towers.indexOf(t);
    if (i >= 0) towers.splice(i, 1);
    padTower[t.pad] = null;
    sfx.sell();
    parts.burst(t.x, t.y + 1.5, t.z, 24, 11, 0.6, 1, 0xffd35a, { grav: 6 });
    feed(`SOLD  +${gain}`, "a");
    selPad = -1;
    renderSel();
  }

  function acquire(t: Tower): Enemy | null {
    const air = TOWERS[t.id].air;
    const gnd = TOWERS[t.id].ground;
    const r2 = t.range * t.range;
    let best: Enemy | null = null;
    let score = -1e9;
    for (const e of enemies) {
      if (!e.alive || e.d <= 0.1) continue;
      if (e.flying ? !air : !gnd) continue;
      const dx = e.x - t.x;
      const dz = e.z - t.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const s = t.mode === "first" ? e.d / e.path.len : t.mode === "strong" ? e.hp : -d2;
      if (s > score) {
        score = s;
        best = e;
      }
    }
    return best;
  }

  const mz = new THREE.Vector3();
  function muzzleOf(t: Tower, tx: number, ty: number, tz: number) {
    const m = t.model;
    const dx = tx - t.x;
    const dz = tz - t.z;
    m.aim.rotation.y = Math.atan2(dx, dz) - m.root.rotation.y;
    if (m.pitch) {
      const hd = Math.hypot(dx, dz);
      m.pitch.rotation.x = -Math.atan2(ty - (t.y + 2.4), Math.max(1, hd)) * (t.id === "flak" ? 1 : 0.9);
    }
    m.root.updateMatrixWorld(true);
    m.muzzle.getWorldPosition(mz);
    return mz;
  }
  function pan(x: number) {
    return Math.max(-1, Math.min(1, (x - cam.tx) / 90));
  }

  function fire(t: Tower, e: Enemy) {
    const st = t.st;
    const color = TOWERS[t.id].color;
    const ty = e.y + (e.flying ? 0 : 1.2);
    const m = muzzleOf(t, e.x, ty, e.z);
    const mx = m.x;
    const my = m.y;
    const mzz = m.z;
    t.recoil = 1;
    switch (t.id) {
      case "pulse": {
        beams.seg(mx, my, mzz, e.x, ty, e.z, 0.32, color, 0.07, 0.12, 2.4);
        parts.spawn(mx, my, mzz, 0, 0, 0, 0.08, 1.4, 0xffffff, { drag: 0, bright: 1.8 });
        parts.burst(e.x, ty, e.z, 2, 7, 0.25, 0.5, color, { grav: 8 });
        damage(e, st.dmg, st.pierce ?? 0);
        sfx.pulse(pan(t.x));
        break;
      }
      case "arc": {
        const hit = new Set<Enemy>([e]);
        let from = { x: mx, y: my, z: mzz };
        let cur: Enemy = e;
        let dmg = st.dmg;
        const links = st.chain ?? 3;
        for (let i = 0; i < links; i++) {
          const cy = cur.y + 1.4;
          beams.bolt(from.x, from.y, from.z, cur.x, cy, cur.z, 0.5, color, 0.16, 1.2, 6, 0.4);
          beams.bolt(from.x, from.y, from.z, cur.x, cy, cur.z, 0.18, 0xffffff, 0.1, 0.8, 6, 0);
          parts.burst(cur.x, cy, cur.z, 4, 9, 0.35, 0.8, color, { grav: 4 });
          damage(cur, dmg);
          if (st.stun) cur.stunT = Math.max(cur.stunT, st.stun);
          from = { x: cur.x, y: cy, z: cur.z };
          dmg *= st.stun ? 0.8 : 0.82;
          // nearest unhit ground enemy within 13 m
          let nx: Enemy | null = null;
          let nd = 13 * 13;
          for (const o of enemies) {
            if (!o.alive || o.flying || hit.has(o) || o.d <= 0.1) continue;
            const d2 = (o.x - cur.x) ** 2 + (o.z - cur.z) ** 2;
            if (d2 < nd) {
              nd = d2;
              nx = o;
            }
          }
          if (!nx) break;
          hit.add(nx);
          cur = nx;
        }
        sfx.arc(pan(t.x));
        t.charge = 1;
        break;
      }
      case "rail": {
        const dx = e.x - mx;
        const dy = ty - my;
        const dz = e.z - mzz;
        const l = Math.hypot(dx, dy, dz) || 1;
        const ext = Math.min(t.range * 1.15, l + 20);
        const ex = mx + (dx / l) * ext;
        const ey = my + (dy / l) * ext;
        const ez = mzz + (dz / l) * ext;
        beams.seg(mx, my, mzz, ex, ey, ez, 1.1, color, 0.34, 0.1, 2.6);
        beams.seg(mx, my, mzz, ex, ey, ez, 0.4, 0xffffff, 0.22, 0.05, 3);
        parts.burst(mx, my, mzz, 14, 16, 0.4, 1.4, color, { grav: 0 });
        rings.spawn(mx, my, mzz, 0.5, 5, 0.35, color, 0.8);
        const ux = dx / l;
        const uz = dz / l;
        for (const o of enemies) {
          if (!o.alive || o.d <= 0.1) continue;
          const rx = o.x - mx;
          const rz = o.z - mzz;
          const along = rx * ux + rz * uz;
          if (along < 0 || along > ext) continue;
          const perp = Math.abs(rx * uz - rz * ux);
          if (perp < o.def.radius + 1.2) {
            parts.burst(o.x, o.y + 1.2, o.z, 6, 12, 0.35, 0.9, color, { grav: 6 });
            damage(o, st.dmg);
          }
        }
        sfx.rail(pan(t.x));
        shake = Math.max(shake, 0.12);
        break;
      }
      case "flak": {
        const shells = st.burst ?? 1;
        for (let s = 0; s < shells; s++) {
          const ox = s === 0 ? 0 : (fx() - 0.5) * 7;
          const oz = s === 0 ? 0 : (fx() - 0.5) * 7;
          const bx = e.x + ox;
          const bz = e.z + oz;
          const by = ty + (s === 0 ? 0 : (fx() - 0.5) * 3);
          beams.seg(mx, my, mzz, bx, by, bz, 0.28, color, 0.1, 0.12, 2);
          parts.burst(bx, by, bz, 18, 18, 0.5, 1.4, 0xffd08a, { grav: 2 });
          parts.spawn(bx, by, bz, 0, 0, 0, 0.22, 7, 0xffffff, { drag: 0, grow: 1.5, bright: 1.8 });
          rings.spawn(bx, by, bz, 0.6, (st.splash ?? 6) * 0.9, 0.35, color, 0.7);
          const sr = st.splash ?? 6;
          for (const o of enemies) {
            if (!o.alive || !o.flying) continue;
            if ((o.x - bx) ** 2 + (o.y - by) ** 2 + (o.z - bz) ** 2 <= sr * sr) damage(o, st.dmg);
          }
        }
        sfx.flak(pan(t.x));
        break;
      }
      default:
        break;
    }
  }

  function fireEmp(t: Tower) {
    const st = t.st;
    const r = t.range;
    let any = false;
    const r2 = r * r;
    for (const e of enemies) {
      if (!e.alive || e.d <= 0.1 || e.flying) continue;
      if ((e.x - t.x) ** 2 + (e.z - t.z) ** 2 > r2) continue;
      any = true;
      break;
    }
    if (!any) return false;
    const color = TOWERS.emp.color;
    rings.spawn(t.x, t.y + 3, t.z, 1, r, 0.55, color, 0.9);
    rings.spawn(t.x, t.y + 0.8, t.z, 1, r * 0.8, 0.7, color, 0.5);
    parts.burst(t.x, t.y + 3, t.z, 20, 22, 0.6, 1.4, color, { grav: 0 });
    sfx.emp(pan(t.x));
    for (const e of enemies) {
      if (!e.alive || e.d <= 0.1) continue;
      if ((e.x - t.x) ** 2 + (e.z - t.z) ** 2 > r2) continue;
      if (e.type === "shield") e.stripT = Math.max(e.stripT, 4);
      if (e.flying) continue;
      e.slow = Math.max(e.slowT > 0 ? e.slow : 0, st.slow ?? 0.4);
      e.slowT = st.slowT ?? 2;
      if (st.vuln) {
        e.vuln = st.vuln;
        e.vulnT = st.slowT ?? 2;
      }
      parts.burst(e.x, e.y + 1.5, e.z, 5, 8, 0.4, 0.8, color, { grav: 0 });
    }
    return true;
  }

  function updateTowers(dt: number) {
    for (const t of towers) {
      t.recoil = Math.max(0, t.recoil - dt * 8);
      t.charge = Math.max(0, t.charge - dt * 4);
      if (t.disabledT > 0) {
        t.disabledT -= dt;
        t.target = null;
        if (fx() < dt * 14) parts.spawn(t.x + (fx() - 0.5) * 3, t.y + 2 + fx() * 2, t.z + (fx() - 0.5) * 3, 0, 4, 0, 0.35, 1, 0xffd35a, { drag: 1 });
        continue;
      }
      t.cd -= dt;
      if (t.id === "emp") {
        if (t.cd <= 0 && fireEmp(t)) t.cd = 1 / t.st.rate;
        else if (t.cd <= 0) t.cd = 0.15;
        continue;
      }
      const tgt = acquire(t);
      t.target = tgt;
      if (tgt && t.cd <= 0) {
        fire(t, tgt);
        t.cd = 1 / t.st.rate;
      }
    }
  }

  // ----------------------------------------------------------------- simulation step
  function simStep(dt: number) {
    simTime += dt;
    // spawns
    while (spawnQ.length && spawnQ[0].t <= simTime) {
      const s = spawnQ.shift()!;
      spawnEnemy(s.type, s.gate, s.wave, s.hpMul, s.rewardMul);
    }
    updateEnemies(dt);
    updateTowers(dt);
    if (phase === "active" && outstanding.size === 0 && spawnQ.length === 0) {
      phase = "build";
      buildT = BUILD_TIME;
    }
    if (phase === "build" && stage === "play") {
      buildT -= dt;
      if (buildT <= 0 && (mode === "endless" || waveNum < TOTAL_WAVES)) launchWave(false);
    }
    if (botOn) botStep(dt);
  }

  // ----------------------------------------------------------------- dev bot
  const samples: Array<{ x: number; z: number; w: number }> = [];
  for (const p of paths) for (let d = 0; d < p.len; d += 4) {
    pathAt(p, d, pa);
    samples.push({ x: pa.x, z: pa.z, w: 1 + (d / p.len) * 1.5 });
  }
  function coverage(id: TowerId, p: number, tier = 1) {
    const r = towerStats(id, tier, 0).range * pad(p).rangeMul;
    let s = 0;
    for (const q of samples) if ((q.x - pad(p).x) ** 2 + (q.z - pad(p).z) ** 2 < r * r) s += q.w;
    return s;
  }
  let botSeq = 0;
  function botStep(dt: number) {
    botT -= dt;
    if (stage !== "play") return;
    if (botT > 0) return;
    botT = 0.3;
    const count = towerCount();
    const nextW = waveNum + 1;
    const wantAir = waveNum >= 4;
    const flaks = towers.filter((t) => t.id === "flak").length;
    const cycle: TowerId[] = ["pulse", "arc", "pulse", "emp", "arc", "rail", "pulse", "arc", "emp", "rail"];
    // upgrade vs build: build up to a target count first, then upgrade
    const wantBuild = count < 5 + Math.floor(waveNum * 0.9) && count < pads.length * 0.85;
    let acted = false;
    if (wantAir && flaks < Math.min(4, Math.ceil((waveNum - 3) / 3)) && flaks <= towers.length / 3) {
      acted = botBuild("flak");
    }
    if (!acted && wantBuild) acted = botBuild(cycle[botSeq % cycle.length]) && ++botSeq > 0;
    if (!acted) {
      // upgrade the cheapest-per-benefit tower
      let pick: Tower | null = null;
      let pc = 1e9;
      for (const t of towers) {
        if (t.tier >= 3) continue;
        const c = upgradeCost(t.id, t.tier, 0);
        const val = t.tier === 1 ? 0.8 : 1;
        if (c / val < pc && c <= credits) {
          pc = c / val;
          pick = t;
        }
      }
      if (pick) acted = upgradeTower(pick, pick.id === "rail" || pick.id === "emp" ? 0 : pick.id === "flak" ? 1 : 0);
    }
    if (phase === "build" && !acted && waveNum < (mode === "endless" ? 1e9 : TOTAL_WAVES) && (buildT < BUILD_TIME - 6 || credits < 60)) launchWave(true);
    else if (phase === "active" && !acted && enemies.length < 30 && credits < 60 && waveNum < TOTAL_WAVES && integrity > 0 && nextW > 0 && simTime > 0) {
      /* stay put while a wave is on */
    }
  }
  function botBuild(id: TowerId): boolean {
    let best = -1;
    let bs = -1;
    for (let i = 0; i < pads.length; i++) {
      if (padTower[i]) continue;
      const cost = costOf(id, i);
      if (cost > credits) continue;
      let cov = coverage(id, i);
      if (id === "flak") cov *= 1.1;
      // spread: penalise pads next to existing towers of the same kind
      let near = 0;
      for (const t of towers) if (t.id === id && (t.x - pad(i).x) ** 2 + (t.z - pad(i).z) ** 2 < 28 * 28) near++;
      const sc = cov / Math.pow(cost, 0.7) / (1 + near * 0.35);
      if (sc > bs) {
        bs = sc;
        best = i;
      }
    }
    if (best < 0 || bs <= 0) return false;
    return placeTower(id, best);
  }

  // ----------------------------------------------------------------- render sync
  const camPosV = new THREE.Vector3();
  function syncRender(dt: number) {
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    barMat.uniforms.uRight.value.copy(camRight);
    barMat.uniforms.uUp.value.copy(camUp);
    for (const t of INST) instMeshes[t].n = 0;
    let nb = 0;
    const tt = clock;
    for (const e of enemies) {
      if (!e.alive) continue;
      const yaw = Math.atan2(e.dx, e.dz);
      if (e.robot) {
        const r = e.robot;
        r.root.position.set(e.x, 0, e.z);
        r.root.rotation.y = yaw;
        r.walk.timeScale = Math.max(0.2, (e.def.speed * (1 - e.slow * 0.9)) / (e.type === "boss" ? 2.2 : 3.2)) * (e.stunT > 0 ? 0 : 1);
        r.mixer.update(dt);
      } else {
        const type = e.type as InstType;
        const im = instMeshes[type];
        if (im.n >= im.cap) continue;
        const wob = type === "skitter" ? Math.sin(tt * 18 + e.id) * 0.06 : 0;
        const sc = type === "skitter" ? 2.1 : type === "hover" ? 1.7 : 1.6;
        tmpQ.setFromAxisAngle(Y, yaw + wob);
        const lift = type === "hover" ? e.y : e.flash > 0.5 ? 0 : 0;
        tmpM.compose(tmpV.set(e.x, lift + (type === "skitter" ? Math.abs(Math.sin(tt * 14 + e.id)) * 0.12 : 0), e.z), tmpQ, tmpS.set(sc, sc, sc));
        im.body.setMatrixAt(im.n, tmpM);
        im.glow.setMatrixAt(im.n, tmpM);
        const f = 1 + e.flash * 3.5;
        (im.body.instanceColor as THREE.BufferAttribute).setXYZ(im.n, f, f, f);
        im.n++;
        if (e.bubble) {
          e.bubble.position.set(e.x, 3, e.z);
          e.bubble.scale.setScalar(e.stripT > 0 ? 0.001 : 1 + Math.sin(tt * 3 + e.id) * 0.015);
        }
      }
      if ((e.hp < e.maxHp || e.type === "boss") && nb < BAR_CAP) {
        const hh = e.type === "boss" ? 19 : e.type === "walker" ? 7.2 : e.type === "shield" ? 8.4 : e.type === "hover" ? e.y + 4.6 : e.type === "splitter" ? 6.4 : 3.6;
        const w = e.type === "boss" ? 14 : e.type === "skitter" ? 4.2 : 6.2;
        tmpM.compose(tmpV.set(e.x, hh, e.z), tmpQ.identity(), tmpS.set(w, w * 0.22, 1));
        bars.setMatrixAt(nb, tmpM);
        barFill[nb] = Math.max(0, e.hp / e.maxHp);
        nb++;
      }
    }
    for (const t of INST) {
      const im = instMeshes[t];
      im.body.count = im.glow.count = im.n;
      im.body.instanceMatrix.needsUpdate = im.glow.instanceMatrix.needsUpdate = true;
      if (im.body.instanceColor) im.body.instanceColor.needsUpdate = true;
    }
    bars.count = nb;
    bars.instanceMatrix.needsUpdate = true;
    (barGeo.getAttribute("aFill") as THREE.BufferAttribute).needsUpdate = true;
    // towers
    for (const t of towers) {
      const m = t.model;
      if (t.target && t.target.alive && t.disabledT <= 0) {
        const want = Math.atan2(t.target.x - t.x, t.target.z - t.z) - m.root.rotation.y;
        let d = want - m.aim.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        m.aim.rotation.y += d * Math.min(1, dt * 14);
        if (m.pitch) {
          const hd = Math.hypot(t.target.x - t.x, t.target.z - t.z);
          const wp = -Math.atan2(t.target.y + 1 - (t.y + 2.4), Math.max(1, hd)) * (t.id === "flak" ? 1 : 0.9);
          m.pitch.rotation.x += (wp - m.pitch.rotation.x) * Math.min(1, dt * 10);
        }
      }
      if (m.spin) m.spin.rotation.y += dt * (2 + t.tier);
      if (m.orb) m.orb.scale.setScalar(1 + t.charge * 0.5 + Math.sin(tt * 6 + t.pad) * 0.06);
      const rc = t.recoil * 0.12;
      m.aim.position.z = -rc * (t.id === "rail" ? 3 : 1);
      m.disabledRing.visible = t.disabledT > 0;
      if (t.disabledT > 0) m.disabledRing.rotation.z += dt * 6;
    }
    // pads
    const buildMode = armed !== null || (selPad >= 0 && !padTower[selPad]);
    const pulse = 0.65 + 0.35 * Math.sin(tt * 3);
    padMatRing.opacity = buildMode ? 0.95 : 0.5;
    padMatFill.opacity = buildMode ? 0.22 : 0.08;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      const occupied = !!padTower[i];
      const sel = i === selPad;
      const hov = i === hoverPad;
      const show = !occupied;
      const sc = show ? (hov || sel ? 1.18 : 1) : 0.0001;
      tmpM.compose(tmpV.set(p.x, p.h + 0.22, p.z), tmpQ.identity(), tmpS.set(sc, 1, sc));
      padRing.setMatrixAt(i, tmpM);
      padFill.setMatrixAt(i, tmpM);
      let r = 0.25;
      let g = 1;
      let b = 0.5;
      if (armed && show) {
        const ok = credits >= costOf(armed, i);
        if (!ok) {
          r = 1;
          g = 0.35;
          b = 0.3;
        }
      }
      const k = hov || sel ? 1.8 : buildMode ? 0.8 + pulse * 0.5 : 0.55 + pulse * 0.25;
      padCol.setRGB(r * k, g * k, b * k);
      padRing.setColorAt(i, padCol);
      padFill.setColorAt(i, padCol);
    }
    padRing.instanceMatrix.needsUpdate = padFill.instanceMatrix.needsUpdate = true;
    if (padRing.instanceColor) padRing.instanceColor.needsUpdate = true;
    if (padFill.instanceColor) padFill.instanceColor.needsUpdate = true;
    // ghost + range ring
    let ringPad = -1;
    let ringRange = 0;
    let ringCol = 0x4ade80;
    const g = armed ? getGhost(armed) : null;
    for (const [, gm] of ghosts) gm.root.visible = false;
    if (armed && hoverPad >= 0 && !padTower[hoverPad] && g) {
      const p = pad(hoverPad);
      g.root.visible = true;
      g.root.position.set(p.x, p.h, p.z);
      g.setTier(1, 0);
      g.root.rotation.y = 0;
      g.aim.rotation.y = tt * 0.6;
      ringPad = hoverPad;
      ringRange = TOWERS[armed].tiers[0].range * p.rangeMul;
      ringCol = credits >= costOf(armed, hoverPad) ? 0x4ade80 : 0xff4d5c;
    } else if (selPad >= 0 && padTower[selPad]) {
      const t = padTower[selPad]!;
      ringPad = selPad;
      ringRange = t.range;
      ringCol = TOWERS[t.id].color;
    } else if (selPad >= 0 && hoverPad < 0) {
      ringPad = -1;
    }
    rangeRing.visible = rangeFill.visible = ringPad >= 0;
    if (ringPad >= 0) {
      const p = pad(ringPad);
      rangeRing.position.set(p.x, p.h + 0.3, p.z);
      rangeFill.position.set(p.x, p.h + 0.25, p.z);
      rangeRing.scale.set(ringRange, 1, ringRange);
      rangeFill.scale.set(ringRange, 1, ringRange);
      (rangeRing.material as THREE.MeshBasicMaterial).color.setHex(ringCol).multiplyScalar(1.4);
      (rangeFill.material as THREE.MeshBasicMaterial).color.setHex(ringCol);
    }
    // core
    reactor.update(clock, integrity / CORE_HP, coreHit);
    coreHit = Math.max(0, coreHit - dt * 2.5);
    // gates
    gateObjs.forEach((g2, i) => {
      const open = i < gatesOpen;
      g2.group.visible = open || stage === "menu";
      g2.ring.rotation.z = clock * 0.7;
      g2.ring.scale.setScalar(1 + Math.sin(clock * 3 + i) * 0.05);
    });
    for (const m of flowMats) m.uniforms.uTime.value = clock;
    // paths beyond the open gates fade out
    flowMats.forEach((m, i) => {
      const k = i < gatesOpen || stage === "menu" ? 1 : 0;
      (m.uniforms.uColor.value as THREE.Color).setHex(paths[i].color).multiplyScalar(k);
      (xrayMats[i].uniforms.uColor.value as THREE.Color).setHex(paths[i].color).multiplyScalar(0.17 * k);
    });
    void camPosV;
  }
  function getGhost(id: TowerId) {
    let g = ghosts.get(id);
    if (!g) {
      g = kit.build(id);
      g.root.visible = false;
      scene.add(g.root);
      ghosts.set(id, g);
    }
    return g;
  }

  function updateCars(dt: number) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.t += c.speed * dt;
      if (c.t > 300) c.t -= 600;
      if (c.t < -300) c.t += 600;
      const x = c.axis === 0 ? c.t : c.lane;
      const z = c.axis === 0 ? c.lane : c.t;
      q.setFromAxisAngle(Y, c.axis === 0 ? Math.PI / 2 : 0);
      m.compose(tmpV.set(x, c.y, z), q, tmpS.set(1, 1, 1));
      carMesh.setMatrixAt(i, m);
    }
    carMesh.instanceMatrix.needsUpdate = true;
  }

  const rainT = { t: 0 };
  function updateRain(dt: number) {
    rainT.t += dt;
    const S = 70;
    const H = 90;
    const cx = cam.tx;
    const cz = cam.tz;
    for (let i = 0; i < RAIN; i++) {
      const yf = (((rainSeed[i * 3 + 1] - rainT.t * 1.4) % 1) + 1) % 1;
      const x = cx + ((((rainSeed[i * 3] * S - cx) % (2 * S)) + 3 * S) % (2 * S)) - S;
      const z = cz + ((((rainSeed[i * 3 + 2] * S - cz) % (2 * S)) + 3 * S) % (2 * S)) - S;
      const y = yf * H;
      rainPos[i * 6] = x;
      rainPos[i * 6 + 1] = y;
      rainPos[i * 6 + 2] = z;
      rainPos[i * 6 + 3] = x - 0.25;
      rainPos[i * 6 + 4] = y - 2.2;
      rainPos[i * 6 + 5] = z;
    }
    (rainGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  // ----------------------------------------------------------------- HUD logic
  let lastCredits = -1;
  let lastIntegrity = -1;
  let lastWaveKey = "";
  let selDirty = true;
  let hudAcc = 0;
  const KIND_NAME: Record<EnemyId, string> = { skitter: "SKITTER", walker: "WALKER", hover: "HOVER", shield: "SHIELD", splitter: "SPLITTER", boss: "BOSS" };
  function chipsFor(def: WaveDef) {
    const by = new Map<EnemyId, number>();
    for (const g of def.groups) by.set(g.type, (by.get(g.type) ?? 0) + g.count);
    return [...by.entries()]
      .map(([t, n]) => `<span class="${ENEMIES[t].air ? "air" : ""}" title="${KIND_NAME[t]}"><i style="background:#${ENEMIES[t].color.toString(16).padStart(6, "0")}"></i>${KIND_NAME[t]} ×${n}</span>`)
      .join("");
  }
  function liveChips() {
    const by = new Map<EnemyId, number>();
    for (const e of enemies) if (e.alive) by.set(e.type, (by.get(e.type) ?? 0) + 1);
    for (const s of spawnQ) by.set(s.type, (by.get(s.type) ?? 0) + 1);
    return [...by.entries()]
      .map(([t, n]) => `<span class="${ENEMIES[t].air ? "air" : ""}"><i style="background:#${ENEMIES[t].color.toString(16).padStart(6, "0")}"></i>${KIND_NAME[t]} ×${n}</span>`)
      .join("");
  }
  function refreshHud(force = false) {
    if (stage === "loading" || stage === "menu") return;
    if (credits !== lastCredits || force) {
      if (credits > lastCredits && lastCredits >= 0) {
        hud.credits.classList.remove("bump");
        void hud.credits.offsetWidth;
        hud.credits.classList.add("bump");
      }
      hud.creditsV.textContent = fmtN(credits);
      lastCredits = credits;
      selDirty = true;
      updateBar();
    }
    if (integrity !== lastIntegrity || force) {
      hud.integV.textContent = String(integrity);
      hud.integ.classList.toggle("low", integrity <= 6);
      if (!hud.pips.firstChild) hud.pips.innerHTML = Array.from({ length: CORE_HP }, () => "<i></i>").join("");
      Array.from(hud.pips.children).forEach((c, i) => c.classList.toggle("on", i < integrity));
      lastIntegrity = integrity;
      sfx.intensity(1 - integrity / CORE_HP);
    }
    hud.scoreV.textContent = fmtN(score);
    const total = mode === "campaign" ? `/ ${TOTAL_WAVES}` : "· ENDLESS";
    const shown = phase === "build" ? waveNum + 1 : waveNum;
    const key = `${phase}:${shown}:${Math.ceil(buildT)}:${enemies.length}:${spawnQ.length}`;
    if (key !== lastWaveKey || force) {
      lastWaveKey = key;
      hud.waveT.innerHTML = `WAVE <b>${Math.min(shown, mode === "campaign" ? TOTAL_WAVES : 999)}</b> ${total}`;
      if (phase === "build") {
        const nextN = waveNum + 1;
        if (mode === "campaign" && nextN > TOTAL_WAVES) {
          hud.waveS.textContent = "ALL WAVES REPELLED";
          hud.wavePrev.innerHTML = "";
        } else {
          const def = waveDef(nextN);
          hud.waveS.textContent = `NEXT WAVE IN ${Math.max(0, Math.ceil(buildT))}s · ${def.total} HOSTILES${def.note ? " · " + def.note : ""}`;
          hud.wavePrev.innerHTML = chipsFor(def);
        }
        hud.waveProg.style.width = "0%";
      } else {
        const alive = enemies.length + spawnQ.length;
        hud.waveS.textContent = `${alive} HOSTILES REMAINING`;
        hud.wavePrev.innerHTML = liveChips();
        hud.waveProg.style.width = `${Math.min(100, (waveDone / Math.max(1, waveTotal)) * 100)}%`;
      }
      const nb = phase === "build" ? Math.max(0, Math.floor(buildT * 1.5)) : 0;
      const done = mode === "campaign" && waveNum >= TOTAL_WAVES;
      hud.next.style.display = done ? "none" : "";
      hud.nextT.textContent = phase === "build" ? "START WAVE " + (waveNum + 1) : "CALL NEXT WAVE";
      hud.nextS.textContent = phase === "build" ? `EARLY BONUS +${nb}` : "STACK THE WAVES · +25 SCORE";
      hud.next.classList.toggle("wait", phase === "active");
    }
    // boss bar
    let boss: Enemy | null = null;
    for (const e of enemies) if (e.alive && e.type === "boss") boss = e;
    hud.boss.classList.toggle("on", !!boss);
    if (boss) hud.bossBar.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
    if (selDirty) {
      selDirty = false;
      if (selPad >= 0) renderSel();
    }
    if (score - scoreSent >= 1) {
      hooks.onScore(Math.round(score));
      scoreSent = score;
    }
  }
  function updateBar() {
    hud.bar.querySelectorAll<HTMLElement>(".gl-tb").forEach((b) => {
      const id = b.dataset.tower as TowerId;
      b.classList.toggle("on", armed === id);
      b.classList.toggle("poor", credits < TOWERS[id].cost);
    });
  }
  function tutorHtml() {
    if (tutorStep === 0) return mobile ? `<b>BUILD:</b> tap a glowing rooftop pad, then pick a tower. Drag to pan, pinch to zoom.` : `<b>BUILD:</b> pick a tower below (keys 1–5), then click a glowing rooftop pad. Taller roofs = longer range.`;
    if (tutorStep === 1) return `<b>READY?</b> Press <b>START WAVE</b> (Space) — or wait for the timer. Enemies follow the glowing lanes to the reactor.`;
    if (tutorStep === 2) return `Click a tower to <b>upgrade</b> it. Credits come from kills. Lose all ${CORE_HP} integrity and the district falls.`;
    if (tutorStep === 3) return `Well done. Mix tower types: <b>EMP</b> slows, <b>ARC</b> chains swarms, <b>FLAK</b> kills air, <b>RAIL</b> pierces armour.`;
    return "";
  }
  function refreshTutor() {
    const h = tutorHtml();
    hud.tutor.innerHTML = h;
    hud.tutor.classList.toggle("on", !!h && stage === "play");
    if (tutorStep === 3) {
      window.setTimeout(() => {
        if (tutorStep === 3) {
          tutorStep = 99;
          refreshTutor();
          try {
            localStorage.setItem(SEEN_KEY, "1");
          } catch {
            /* ignore */
          }
        }
      }, 9000);
    }
  }

  const statRows = (id: TowerId, st: TierStats, rangeMul: number, prev?: TierStats) => {
    const rows: string[] = [];
    const d = (a: number, b: number | undefined, fmt: (n: number) => string) => (b !== undefined && Math.abs(a - b) > 1e-6 ? `<em>${a > b ? "+" : "−"}${fmt(Math.abs(a - b))}</em>` : "");
    if (id !== "emp") rows.push(`<div>DAMAGE<b>${Math.round(st.dmg)}${d(st.dmg, prev?.dmg, (n) => String(Math.round(n)))}</b></div>`);
    else rows.push(`<div>SLOW<b>${Math.round((st.slow ?? 0) * 100)}%${d(st.slow ?? 0, prev?.slow, (n) => Math.round(n * 100) + "%")}</b></div>`);
    rows.push(`<div>${id === "emp" ? "PULSES/S" : "RATE /S"}<b>${st.rate.toFixed(2)}${d(st.rate, prev?.rate, (n) => n.toFixed(2))}</b></div>`);
    rows.push(`<div>RANGE<b>${Math.round(st.range * rangeMul)} m${d(st.range * rangeMul, prev ? prev.range * rangeMul : undefined, (n) => Math.round(n) + "")}</b></div>`);
    if (st.chain) rows.push(`<div>CHAIN<b>${st.chain}${d(st.chain, prev?.chain, (n) => String(n))}</b></div>`);
    else if (st.splash) rows.push(`<div>SPLASH<b>${st.splash} m</b></div>`);
    else if (id === "emp") rows.push(`<div>DURATION<b>${(st.slowT ?? 0).toFixed(1)}s</b></div>`);
    else rows.push(`<div>DPS<b>${Math.round(st.dmg * st.rate)}</b></div>`);
    return rows.join("");
  };

  function renderSel() {
    const el = hud.sel;
    hud.root.classList.toggle("sel", selPad >= 0);
    if (selPad < 0 || stage !== "play") {
      el.classList.remove("on");
      el.innerHTML = "";
      return;
    }
    const p = pad(selPad);
    const t = padTower[selPad];
    el.classList.add("on");
    if (!t) {
      el.style.setProperty("--tc", "#4ade80");
      el.innerHTML = `<div class="hd"><div class="nm">${p.plaza ? "STREET PAD" : "ROOFTOP PAD"}</div><div class="tr">${p.h} M</div><button class="x" data-a="close">✕</button></div>
        <div class="ds">Range <b style="color:#4ade80">+${Math.round((p.rangeMul - 1) * 100)}%</b> from height · build cost <b style="color:#ffb547">×${p.costMul.toFixed(2)}</b></div>
        <div class="bl">${TOWER_ORDER.map((id) => {
          const d = TOWERS[id];
          const c = costOf(id, selPad);
          return `<button class="bi ${credits < c ? "dis" : ""}" data-a="build" data-t="${id}" style="--tc:${d.css}">${icon(id, d.css, 24)}<div><b>${d.name}</b><span>${esc(d.desc)}</span></div><em>${c}</em></button>`;
        }).join("")}</div>`;
      return;
    }
    const d = TOWERS[t.id];
    el.style.setProperty("--tc", d.css);
    const sell = Math.round(t.spent * SELL_RATE);
    let up = "";
    if (t.tier === 1) {
      const nx = d.tiers[1];
      const c = upgradeCost(t.id, 1, 0);
      up = `<div class="row"><button class="act up ${credits < c ? "dis" : ""}" data-a="up" data-b="0">UPGRADE → TIER 2<small>${c}</small></button></div>`;
      void nx;
    } else if (t.tier === 2) {
      up = `<div class="lbl">CHOOSE SPECIALISATION</div><div class="row">${[0, 1]
        .map((b) => {
          const s = d.branches[b];
          const c = upgradeCost(t.id, 2, b);
          return `<button class="act br ${credits < c ? "dis" : ""}" data-a="up" data-b="${b}"><b>${s.label}</b><span>${esc(s.blurb ?? "")}</span><small>${c}</small></button>`;
        })
        .join("")}</div>`;
    }
    const nextSt = t.tier === 1 ? d.tiers[1] : undefined;
    const tgt = t.id === "emp" ? "" : `<div class="tgt">${MODES.map((m) => `<button class="${t.mode === m ? "on" : ""}" data-a="mode" data-m="${m}">${m.toUpperCase()}</button>`).join("")}</div>`;
    el.innerHTML = `<div class="hd">${icon(t.id, d.css, 26)}<div class="nm">${d.name}${t.st.label ? ` · ${t.st.label}` : ""}</div><div class="tr">T${t.tier}</div><button class="x" data-a="close">✕</button></div>
      <div class="ds">${esc(d.desc)}</div>
      <div class="st">${statRows(t.id, t.st, p.rangeMul, nextSt ? undefined : undefined)}</div>
      ${nextSt ? `<div class="ht">NEXT: ${statRowsInline(t.id, nextSt, p.rangeMul, t.st)}</div>` : ""}
      ${t.disabledT > 0 ? `<div class="ht" style="color:#ff4d5c">DISABLED BY STOMP</div>` : ""}
      ${up}${tgt}
      <div class="row"><button class="act sell" data-a="sell">SELL<small>+${sell}</small></button></div>`;
  }
  function statRowsInline(id: TowerId, st: TierStats, rm: number, cur: TierStats) {
    const bits: string[] = [];
    if (id !== "emp" && st.dmg !== cur.dmg) bits.push(`DMG ${Math.round(cur.dmg)}→${Math.round(st.dmg)}`);
    if (st.rate !== cur.rate) bits.push(`RATE ${cur.rate.toFixed(1)}→${st.rate.toFixed(1)}`);
    if (st.range !== cur.range) bits.push(`RANGE ${Math.round(cur.range * rm)}→${Math.round(st.range * rm)}`);
    if (st.chain && st.chain !== cur.chain) bits.push(`CHAIN ${cur.chain}→${st.chain}`);
    if (id === "emp" && st.slow !== cur.slow) bits.push(`SLOW ${Math.round((cur.slow ?? 0) * 100)}→${Math.round((st.slow ?? 0) * 100)}%`);
    return bits.join(" · ");
  }

  function arm(id: TowerId | null) {
    armed = id;
    if (id) {
      selPad = -1;
      renderSel();
      sfx.click();
      hint(mobile ? "" : `PLACE <b>${TOWERS[id].name}</b> · CLICK A PAD · <b>RMB/ESC</b> CANCEL`, false, 4000);
    } else hud.hint.classList.remove("on");
    updateBar();
  }
  function disarm() {
    armed = null;
    updateBar();
    hud.hint.classList.remove("on");
  }
  function selectPad(p: number) {
    selPad = p;
    armed = null;
    updateBar();
    hud.hint.classList.remove("on");
    sellConfirm = 0;
    renderSel();
  }

  // ----------------------------------------------------------------- picking + input
  const scr = new THREE.Vector3();
  function pickPad(px: number, py: number): number {
    const r = canvas.getBoundingClientRect();
    let best = -1;
    let bd = (mobile ? 64 : 46) ** 2;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      scr.set(p.x, p.h + 1.5, p.z).project(camera);
      if (scr.z > 1) continue;
      const sx = (scr.x * 0.5 + 0.5) * r.width + r.left;
      const sy = (-scr.y * 0.5 + 0.5) * r.height + r.top;
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  function clickWorld(px: number, py: number) {
    if (stage !== "play") return;
    sfx.ensure();
    const p = pickPad(px, py);
    if (p < 0) {
      if (armed) {
        disarm();
      } else if (selPad >= 0) selectPad(-1);
      return;
    }
    if (armed) {
      if (padTower[p]) {
        selectPad(p);
        return;
      }
      if (placeTower(armed, p)) {
        refreshHud(true);
        if (!armed) selectPad(-1);
        updateBar();
      }
      return;
    }
    selectPad(p);
    sfx.click();
  }

  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let dragMoved = false;
  let pinching = false;
  let pinchD = 0;
  const grab = new THREE.Vector3();
  let hasGrab = false;
  on(canvas, "pointerdown", (e: PointerEvent) => {
    sfx.ensure();
    if (e.button === 2) {
      if (armed) disarm();
      else if (selPad >= 0) selectPad(-1);
      return;
    }
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pointers.size === 1) {
      dragMoved = false;
      pinching = false;
      hasGrab = !!groundAt(e.clientX, e.clientY, grab);
    } else if (pointers.size === 2) {
      pinching = true;
      const [a, b] = [...pointers.values()];
      pinchD = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  on(canvas, "pointermove", (e: PointerEvent) => {
    hoverX = e.clientX;
    hoverY = e.clientY;
    const pt = pointers.get(e.pointerId);
    if (e.pointerType === "mouse" && !pt && stage === "play") {
      hoverPad = pickPad(e.clientX, e.clientY);
      const r = container.getBoundingClientRect();
      edgeX = e.clientX - r.left < 6 ? -1 : e.clientX - r.left > r.width - 6 ? 1 : 0;
      edgeZ = e.clientY - r.top < 6 ? 1 : e.clientY - r.top > r.height - 6 ? -1 : 0;
    }
    if (!pt) return;
    pt.x = e.clientX;
    pt.y = e.clientY;
    if (pinching && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0 && d > 0) cam.gdist = Math.max(DMIN, Math.min(DMAX, cam.gdist * (pinchD / d)));
      pinchD = d;
      dragMoved = true;
      return;
    }
    if (!dragMoved && Math.hypot(pt.x - pt.sx, pt.y - pt.sy) > 9) dragMoved = true;
    if (dragMoved && hasGrab && stage !== "loading") {
      const h = groundAt(e.clientX, e.clientY, hitV);
      if (h) {
        cam.gx += grab.x - h.x;
        cam.gz += grab.z - h.z;
        clampCam();
        // apply immediately so the grabbed point stays under the finger
        cam.tx = cam.gx;
        cam.tz = cam.gz;
        applyCamera();
      }
    }
  });
  const pUp = (e: PointerEvent) => {
    const pt = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinching = pointers.size === 1 ? false : pinching;
    if (pt && !dragMoved && !pinching && pointers.size === 0 && e.type === "pointerup") clickWorld(e.clientX, e.clientY);
    if (pointers.size === 0) {
      pinching = false;
      if (e.pointerType !== "mouse") hoverPad = -1;
    }
    if (pointers.size === 1) {
      // re-anchor the remaining finger
      const rem = [...pointers.values()][0];
      hasGrab = !!groundAt(rem.x, rem.y, grab);
      rem.sx = rem.x;
      rem.sy = rem.y;
      dragMoved = true;
    }
  };
  on(canvas, "pointerup", pUp);
  on(canvas, "pointercancel", pUp);
  on(canvas, "pointerleave", (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      edgeX = edgeZ = 0;
      hoverPad = -1;
    }
  });
  on(canvas, "contextmenu", (e: Event) => e.preventDefault());
  on(
    canvas,
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      if (stage === "loading") return;
      cam.gdist = Math.max(DMIN, Math.min(DMAX, cam.gdist * Math.exp(e.deltaY * 0.0012)));
    },
    { passive: false },
  );

  function rotate(dir: number) {
    cam.gyaw += dir * (Math.PI / 2);
    sfx.click();
  }
  function setSpeed(n: number) {
    simSpeed = n;
    hud.speedB.textContent = `${n}×`;
    hud.speedB.classList.toggle("on", n > 1);
  }
  function togglePause(force?: boolean) {
    if (stage === "play" || stage === "ending") {
      pausedFrom = stage;
      stage = "paused";
      sfx.pause(true);
      hud.ov.className = "gl-ov dim on";
      hud.ov.innerHTML = `<div class="gl-center"><div class="gl-kick">PAUSED</div><div class="gl-h2">GRIDLOCK</div>
        <div class="gl-acts"><button class="gl-btn" data-go="resume">RESUME</button><button class="gl-btn ghost" data-go="restart">RESTART</button><button class="gl-btn ghost" data-go="menu">MENU</button></div></div>`;
    } else if (stage === "paused" && force !== true) {
      stage = pausedFrom;
      sfx.pause(false);
      hud.ov.classList.remove("on");
      hud.ov.innerHTML = "";
    }
  }
  function nextWavePress() {
    if (stage !== "play") return;
    sfx.ensure();
    if (mode === "campaign" && waveNum >= TOTAL_WAVES) return;
    launchWave(true);
    sfx.click();
  }

  on(hud.root, "click", (ev: MouseEvent) => {
    const tgt = ev.target as HTMLElement;
    const btn = tgt.closest<HTMLElement>("[data-act],[data-tower],[data-a],[data-go],[data-mode],.gl-next");
    if (!btn) return;
    sfx.ensure();
    if (btn.classList.contains("gl-next")) return nextWavePress();
    const act = btn.dataset.act;
    if (act === "rotl") return rotate(1);
    if (act === "rotr") return rotate(-1);
    if (act === "speed") {
      setSpeed(simSpeed === 1 ? 2 : simSpeed === 2 ? 3 : 1);
      return sfx.click();
    }
    if (act === "mute") {
      settings.muted = !settings.muted;
      sfx.setMuted(settings.muted);
      hud.muteB.textContent = settings.muted ? "🔇" : "🔊";
      save(SET_KEY, settings);
      return;
    }
    if (act === "pause") return togglePause();
    const tw = btn.dataset.tower as TowerId | undefined;
    if (tw && stage === "play") return arm(armed === tw ? null : tw);
    const a = btn.dataset.a;
    if (a && stage === "play") {
      if (a === "close") return selectPad(-1);
      if (a === "build" && selPad >= 0) {
        const id = btn.dataset.t as TowerId;
        const p = selPad;
        if (placeTower(id, p)) {
          selectPad(p);
          refreshHud(true);
        }
        return;
      }
      const t = selTower();
      if (!t) return;
      if (a === "up") {
        upgradeTower(t, Number(btn.dataset.b ?? 0));
        return refreshHud(true);
      }
      if (a === "sell") return sellTower(t);
      if (a === "mode") {
        t.mode = btn.dataset.m as TargetMode;
        sfx.click();
        return renderSel();
      }
    }
    const go = btn.dataset.go;
    if (go === "go") {
      const m = (hud.ov.querySelector(".gl-modes .on") as HTMLElement | null)?.dataset.mode as Mode | undefined;
      return startRun(m ?? "campaign");
    }
    if (go === "retry") return startRun(mode);
    if (go === "restart") {
      sfx.pause(false);
      return startRun(mode);
    }
    if (go === "resume") return togglePause();
    if (go === "menu") {
      sfx.pause(false);
      return showMenu();
    }
    const md = btn.dataset.mode;
    if (md) {
      if (md === "endless" && progress.wins < 1) return sfx.deny();
      hud.ov.querySelectorAll(".gl-modes button").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.mode === md));
      sfx.click();
    }
  });

  on(window, "keydown", (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (stage === "menu" && (k === "enter" || k === " ")) {
      e.preventDefault();
      return startRun((hud.ov.querySelector(".gl-modes .on") as HTMLElement | null)?.dataset.mode === "endless" ? "endless" : "campaign");
    }
    if (k === "escape") {
      if (stage === "play") {
        if (armed) return disarm();
        if (selPad >= 0) return selectPad(-1);
        return togglePause();
      }
      if (stage === "paused") return togglePause();
      return;
    }
    if (k === "p") return togglePause();
    if (stage !== "play") return;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    keys.add(k);
    if (k >= "1" && k <= "5") {
      const id = TOWER_ORDER[Number(k) - 1];
      return arm(armed === id ? null : id);
    }
    if (k === "q") return rotate(1);
    if (k === "e") return rotate(-1);
    if (k === " ") return nextWavePress();
    if (k === "f") return setSpeed(simSpeed === 1 ? 2 : simSpeed === 2 ? 3 : 1);
    if (k === "m") {
      settings.muted = !settings.muted;
      sfx.setMuted(settings.muted);
      hud.muteB.textContent = settings.muted ? "🔇" : "🔊";
      save(SET_KEY, settings);
      return;
    }
    const t = selTower();
    if (t) {
      if (k === "u") {
        upgradeTower(t, 0);
        return refreshHud(true);
      }
      if (k === "i" && t.tier === 2) {
        upgradeTower(t, 1);
        return refreshHud(true);
      }
      if (k === "t") {
        t.mode = MODES[(MODES.indexOf(t.mode) + 1) % 3];
        return renderSel();
      }
      if (k === "s") {
        if (sellConfirm > performance.now()) return sellTower(t);
        sellConfirm = performance.now() + 2000;
        hint(`PRESS <b>S</b> AGAIN TO SELL FOR <b>${Math.round(t.spent * SELL_RATE)}</b>`, false, 2000);
      }
    }
  });
  on(window, "keyup", (e: KeyboardEvent) => keys.delete(e.key.toLowerCase()));
  on(window, "blur", () => {
    keys.clear();
    if (stage === "play") togglePause();
  });

  // tooltip / hint tick for hover
  function updateHover() {
    if (stage !== "play" || mobile) {
      hud.tip.style.display = "none";
      return;
    }
    if (hoverPad >= 0 && !pointers.size) {
      const p = pad(hoverPad);
      const t = padTower[hoverPad];
      scr.set(p.x, p.h + 4, p.z).project(camera);
      const r = container.getBoundingClientRect();
      hud.tip.style.display = "block";
      hud.tip.style.left = `${(scr.x * 0.5 + 0.5) * r.width}px`;
      hud.tip.style.top = `${(-scr.y * 0.5 + 0.5) * r.height}px`;
      if (t) hud.tip.innerHTML = `${TOWERS[t.id].name} · T${t.tier} · <b>CLICK TO SELECT</b>`;
      else hud.tip.innerHTML = `${p.plaza ? "STREET" : "ROOF"} ${p.h}m · RANGE <b>+${Math.round((p.rangeMul - 1) * 100)}%</b> · COST <b>×${p.costMul.toFixed(2)}</b>${armed ? ` · <b>${costOf(armed, hoverPad)}</b>` : ""}`;
    } else hud.tip.style.display = "none";
  }

  // ----------------------------------------------------------------- menu
  function showMenu() {
    stage = "menu";
    clearRun();
    selPad = -1;
    armed = null;
    hud.root.dataset.mode = "menu";
    hud.root.classList.remove("sel");
    hud.sel.classList.remove("on");
    hud.boss.classList.remove("on");
    hud.tutor.classList.remove("on");
    const endless = progress.wins >= 1;
    hud.ov.className = "gl-ov menu on";
    hud.ov.innerHTML = `<div class="gl-col">
      <div class="gl-kick">DISTRICT 07 · TACTICAL DEFENCE</div>
      <div class="gl-h1">GRID<span>LOCK</span></div>
      <div class="gl-sub">Night falls and the drone swarms pour down the avenues toward the reactor. Build turrets on the rooftops, chain the arcs, upgrade between waves and hold the core.</div>
      <div class="gl-modes">
        <button data-mode="campaign" class="on"><b>CAMPAIGN</b>${TOTAL_WAVES} WAVES · 2 JUGGERNAUTS</button>
        <button data-mode="endless" class="${endless ? "" : "lock"}"><b>ENDLESS</b>${endless ? "SCALING HP · NO END" : "WIN THE CAMPAIGN TO UNLOCK"}</button>
      </div>
      <div class="gl-keys"><div>BUILD<b>1–5 / CLICK PAD</b></div><div>UPGRADE / SELL<b>U / S</b></div><div>NEXT WAVE<b>SPACE</b></div><div>SPEED<b>F</b></div><div>PAN / ROTATE<b>WASD · DRAG / Q E</b></div><div>ZOOM / PAUSE<b>WHEEL / P</b></div></div>
      <div class="gl-acts"><button class="gl-btn" data-go="go">DEPLOY</button><div class="gl-best">BEST <b>${fmtN(progress.best)}</b> · WAVE <b>${progress.bestWave}</b>${progress.bestStars ? ` · ${"★".repeat(progress.bestStars)}` : ""}</div></div></div>`;
  }

  // ----------------------------------------------------------------- loop
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  const onResize = () => {
    viewW = Math.max(1, container.clientWidth);
    viewH = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(viewW, viewH);
    composer?.setPixelRatio(pixelRatio());
    composer?.setSize(viewW, viewH);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
    parts.setScale(partScale());
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(container);
  else on(window, "resize", onResize);
  camera.aspect = viewW / viewH;
  camera.updateProjectionMatrix();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (stage !== "paused") clock += realDt;
    if (stage === "play" || stage === "ending") {
      acc += realDt * simSpeed * simBot;
      let steps = 0;
      const maxSteps = 600;
      while (acc >= SIM_DT && steps < maxSteps) {
        simStep(SIM_DT);
        acc -= SIM_DT;
        steps++;
        if (stage === "ending") break;
      }
      if (steps >= maxSteps) acc = 0;
      if (stage === "ending") {
        acc = 0;
        endT -= realDt;
        // keep enemies frozen but let FX play
        if (endT <= 0) finishRun();
      }
    }
    if (stage !== "paused") {
      updateCamera(realDt);
      const fxDt = realDt * Math.min(simSpeed * Math.min(simBot, 3), 3);
      beams.update(fxDt, camera);
      parts.update(fxDt);
      rings.update(fxDt);
      updateCars(realDt);
      updateRain(realDt);
      syncRender(realDt);
      hudAcc += realDt;
      if (hudAcc > 0.1) {
        hudAcc = 0;
        refreshHud();
        if (hud.hint.classList.contains("on") && performance.now() > hintUntil) hud.hint.classList.remove("on");
      }
      updateHover();
      if (grade) {
        grade.uniforms.uTime.value = clock;
        grade.uniforms.uDamage.value = Math.max(0, coreHit) * 0.9;
        grade.uniforms.uLowHp.value = stage === "play" || stage === "ending" ? Math.max(0, (6 - integrity) / 6) * 0.5 : 0;
      }
      sfx.intensity(Math.min(1, enemies.length / 50 + (1 - integrity / CORE_HP) * 0.5));
    }
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  // ----------------------------------------------------------------- boot (assets)
  async function boot() {
    const bar = hud.ov.querySelector<HTMLElement>(".gl-load .bar i");
    const setBar = (p: number) => {
      if (bar) bar.style.width = `${p}%`;
    };
    const loader = new GLTFLoader();
    const [rob, tur] = await Promise.all([
      loader.loadAsync(`${ASSET}/models/robot.glb`).catch((e) => {
        console.error("[GRIDLOCK] robot", e);
        return null;
      }),
      loader.loadAsync(`${ASSET}/env/turret_gun.glb`).catch((e) => {
        console.error("[GRIDLOCK] turret", e);
        return null;
      }),
      new HDRLoader()
        .loadAsync(`${ASSET}/hdr/city_sunset.hdr`)
        .then((tex) => {
          if (disposed) return;
          tex.mapping = THREE.EquirectangularReflectionMapping;
          const pm = new THREE.PMREMGenerator(renderer);
          const rt = pm.fromEquirectangular(tex);
          tex.dispose();
          scene.environment = rt.texture;
          scene.environmentIntensity = 0.35;
          envRT = rt;
          pmrem = pm;
        })
        .catch(() => {}),
    ]);
    if (disposed) return;
    setBar(70);
    robotGltf = rob;
    if (tur) {
      turretSrc = tur.scene;
      kit = createTowerKit(reg, turretSrc);
    }
    setBar(100);
    // warm up GPU programs once so the first wave doesn't hitch
    const warm = kit.build("pulse");
    scene.add(warm.root);
    renderer.compile(scene, camera);
    scene.remove(warm.root);
    showMenu();
    applyCamera();
    hud.muteB.textContent = settings.muted ? "🔇" : "🔊";
  }
  let envRT: THREE.WebGLRenderTarget | null = null;
  let pmrem: THREE.PMREMGenerator | null = null;
  clock = 0;
  applyCamera();
  raf = requestAnimationFrame(frame);
  void boot();

  // ----------------------------------------------------------------- dev hooks
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as Record<string, unknown>).__gl = {
      start: (m: Mode = "campaign") => startRun(m),
      speed: (n: number) => {
        simBot = Math.max(1, n);
        return simBot;
      },
      autoBuild: (b: boolean) => {
        botOn = b;
        botT = 0;
        return botOn;
      },
      nextWave: () => launchWave(true),
      cheat: (c: number) => {
        credits += c;
      },
      place: (id: TowerId, p: number) => placeTower(id, p, true),
      upgrade: (p: number, b = 0) => {
        const t = padTower[p];
        if (t) {
          credits += 9999;
          upgradeTower(t, b);
        }
      },
      select: (p: number) => selectPad(p),
      arm: (id: TowerId | null) => arm(id),
      hover: (p: number) => {
        hoverPad = p;
      },
      view: (x: number, z: number, dist: number, yaw?: number, pitchDeg?: number, snap = true) => {
        cam.gx = x;
        cam.gz = z;
        cam.gdist = dist;
        if (yaw !== undefined) cam.gyaw = yaw;
        if (pitchDeg !== undefined) cam.gpitch = (pitchDeg * Math.PI) / 180;
        if (snap) {
          cam.tx = cam.gx;
          cam.tz = cam.gz;
          cam.dist = cam.gdist;
          cam.yaw = cam.gyaw;
          cam.pitch = cam.gpitch;
        }
      },
      pause: () => togglePause(),
      menu: () => showMenu(),
      kill: () => enemies.forEach((e) => e.alive && damage(e, 1e9, 99, true)),
      hurt: (n: number) => {
        integrity = Math.max(0, integrity - n);
        coreBar.draw();
        if (integrity <= 0) endRun(false);
      },
      spawn: (t: EnemyId, gate = 0, n = 1) => {
        const def = waveDef(Math.max(1, waveNum));
        for (let i = 0; i < n; i++) {
          outstanding.set(99, (outstanding.get(99) ?? 0) + 1);
          spawnEnemy(t, gate, 99, def.hpMul, def.rewardMul, i * -2);
        }
        phase = "active";
      },
      skipTo: (w: number) => {
        waveNum = w - 1;
        gatesOpen = w >= 10 ? 3 : 2;
      },
      win: () => endRun(true),
      lose: () => endRun(false),
      enemyPos: () => enemies.filter((e) => e.alive).map((e) => ({ t: e.type, x: e.x, z: e.z, hp: Math.round(e.hp) })),
      pads: () => pads.map((p) => ({ i: p.index, x: p.x, z: p.z, h: p.h })),
      get state() {
        return {
          stage,
          mode,
          wave: waveNum,
          phase,
          buildT: Math.round(buildT),
          integrity,
          credits,
          score: Math.round(score),
          kills,
          enemies: enemies.length,
          queued: spawnQ.length,
          towers: towers.map((t) => `${t.id}${t.tier}${t.tier === 3 ? "ab"[t.branch] : ""}`).join(","),
          towerCount: towers.length,
          simTime: Math.round(simTime),
          leaked,
          earlyCalls,
          cam: { x: cam.tx, z: cam.tz, d: cam.dist, yaw: cam.yaw },
        };
      },
    };
  }

  // ----------------------------------------------------------------- dispose
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const off of listeners) off();
      ro?.disconnect();
      clearRun();
      for (const r of robotPool) scene.remove(r.root);
      for (const g of ghosts.values()) scene.remove(g.root);
      beams.dispose();
      parts.dispose();
      rings.dispose();
      const srcGeos = new Set<THREE.BufferGeometry>();
      const srcMats = new Set<THREE.Material>();
      for (const src of [robotGltf?.scene, turretSrc])
        src?.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) srcGeos.add(m.geometry);
          if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => srcMats.add(x));
        });
      srcGeos.forEach((g) => g.dispose());
      srcMats.forEach((m) => m.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
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
      if (process.env.NODE_ENV !== "production") delete (window as unknown as Record<string, unknown>).__gl;
      void dotTex;
      void PITCH;
      void tmpC;
    },
  };
}

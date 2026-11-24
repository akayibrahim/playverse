"use client";

/**
 * VELOCITY — anti-grav sky-lane racing through the District 07 megacity at night.
 *
 * Tracks are banked ribbons along closed Catmull-Rom splines hung between procedural megablocks.
 * The bike lives in track space (distance s, lateral x): grip vs. v²κ decides whether you hold the
 * line, drifting trades grip for boost, walls scrape speed off. Five rivals drive a precomputed
 * speed profile; time trials race your saved ghost.
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
import { esc } from "./nexus-lib/hud";
import { GradeShader } from "./nexus-lib/grade";
import { softDot, verticalFade } from "./nexus-lib/textures";
import { solveArm } from "./nexus-lib/rig";
import { buildVlHud } from "./velocity-lib/hud";
import { RIVALS, TRACKS, trackById, type TrackDef, type TrackId } from "./velocity-lib/tracks";

type RunStat = { label: string; value: string };
type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number, stats: RunStat[], opts?: { ownScreen?: boolean }) => void;
  best?: number;
};
type GameInstance = { dispose: () => void };
type Mode = "race" | "trial";

type Racer = {
  name: string;
  color: number;
  skill: number;
  player: boolean;
  d: number; // total distance travelled (s = d mod L)
  x: number;
  vx: number;
  v: number;
  steer: number;
  slip: number;
  boost: number;
  boosting: boolean;
  drifting: boolean;
  finished: number; // race time when finished, 0 = running
  lapStart: number;
  laps: number[];
  bike: Bike;
  lineBias: number;
};
type Bike = {
  root: THREE.Group;
  lean: THREE.Group;
  glow: THREE.Sprite[];
  flame: THREE.Mesh[];
  flameMat: THREE.MeshBasicMaterial;
  accent: THREE.MeshStandardMaterial;
  rider: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  trail: Trail;
  mats: THREE.Material[];
};
type Trail = { mesh: THREE.Mesh; pts: THREE.Vector3[]; ups: THREE.Vector3[]; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial; head: number; n: number };
type Ghost = { time: number; s: number[]; x: number[]; dt: number };

const ASSET = "/assets";
const VMAX = 88; // m/s ≈ 317 km/h
const VBOOST = 112; // ≈ 403 km/h
const GRIP_S = 44; // lateral control (m/s²)
const DRIFT_S = 62;
const HOVER = 0.75;
const SETTINGS_KEY = "playverse:velocitySettings";
const SAVE_KEY = "playverse:velocity";
const SEEN_KEY = "playverse:velocitySeen";
const KMH = 3.6;

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
    /* ignore (quota) */
  }
}
function fmt(t: number) {
  if (!isFinite(t) || t <= 0) return "—";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Radial blur toward screen centre, scaled by speed. */
const SpeedBlurShader = {
  name: "SpeedBlur",
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uAmt: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt; varying vec2 vUv;
    void main(){
      vec2 c = vec2(0.5, 0.52); vec2 d = vUv - c; float r = length(d);
      vec4 acc = vec4(0.0); float w = 0.0;
      for (int i = 0; i < 8; i++) { float k = float(i) / 7.0; float s = 1.0 - k * uAmt * smoothstep(0.12, 0.7, r);
        float wi = 1.0 - k * 0.6; acc += texture2D(tDiffuse, c + d * s) * wi; w += wi; }
      gl_FragColor = acc / w;
    }`,
};

export function createGame(container: HTMLElement, hooks: GameHooks): GameInstance {
  const rng = mulberry32(7300);
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

  const settings = store(SETTINGS_KEY, { vol: 0.8, muted: false, music: 0.6 });
  const progress = store<{ stars: Record<string, number>; bestLap: Record<string, number>; bestRace: Record<string, number> }>(SAVE_KEY, {
    stars: {},
    bestLap: {},
    bestRace: {},
  });
  const loadGhost = (id: TrackId): Ghost | null => {
    try {
      const raw = localStorage.getItem(`${SAVE_KEY}:ghost:${id}`);
      return raw ? (JSON.parse(raw) as Ghost) : null;
    } catch {
      return null;
    }
  };
  let firstRun = true;
  try {
    firstRun = localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    /* ignore */
  }
  const unlocked = (t: TrackDef) => t.n === 1 || (progress.stars[TRACKS[t.n - 2].id] ?? 0) > 0;
  let trackId: TrackId = "neon";
  let mode: Mode = "race";

  type Stage = "loading" | "menu" | "countdown" | "racing" | "finished" | "paused" | "results";
  let stage: Stage = "loading";
  let pausedFrom: Stage = "racing";
  let disposed = false;
  let menuTime = 0;
  let raceTime = 0;
  let countT = 0;
  let finishT = 0;
  let shake = 0;
  let wallT = 0;
  let autopilot = false;
  let simBoost = 1;
  let hintStep = firstRun ? 0 : 99;
  let hintT = 0;
  const keys = new Set<string>();
  const touch = { l: false, r: false, boost: false, drift: false, brake: false };

  let viewW = Math.max(1, container.clientWidth);
  let viewH = Math.max(1, container.clientHeight);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  // --------------------------------------------------------------- HUD / audio
  const hud = buildVlHud(container, mobile);
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
  const renderer = new THREE.WebGLRenderer({ antialias: mobile, powerPreference: "high-performance" });
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.5);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(viewW, viewH);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.insertBefore(renderer.domElement, hud.style);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const FOG = 0x120c24;
  scene.fog = new THREE.FogExp2(FOG, 0.0017);
  const camera = new THREE.PerspectiveCamera(72, viewW / viewH, 0.1, 2600);
  scene.add(camera);

  // night sky: gradient dome with a city-glow horizon
  {
    const cv = document.createElement("canvas");
    cv.width = 16;
    cv.height = 512;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#03030a");
    g.addColorStop(0.35, "#0b0820");
    g.addColorStop(0.47, "#2a1845");
    g.addColorStop(0.5, "#5a2a5c");
    g.addColorStop(0.53, "#1a1230");
    g.addColorStop(1, "#08060f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 512);
    const sky = T(new THREE.CanvasTexture(cv));
    sky.colorSpace = THREE.SRGBColorSpace;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = sky;
  }
  const hemi = new THREE.HemisphereLight(0x8a7ad8, 0x0a0812, 0.7);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.7);
  moon.position.set(-300, 400, -200);
  scene.add(moon);
  const dotTex = T(softDot());
  const fadeTex = T(verticalFade());

  // ------------------------------------------------------------ track
  type Built = {
    def: TrackDef;
    L: number;
    N: number;
    ds: number;
    P: THREE.Vector3[];
    Tn: THREE.Vector3[];
    R: THREE.Vector3[];
    U: THREE.Vector3[];
    k: Float32Array; // signed curvature (+ = turning toward +R)
    prof: Float32Array; // AI speed profile
    ideal: number;
    group: THREE.Group;
    gates: THREE.Group[];
    pads: Array<{ s: number; x: number }>;
    mapPath: string;
    mapXY: (p: THREE.Vector3) => [number, number];
  };
  let track: Built | null = null;
  const cityGroup = new THREE.Group();
  scene.add(cityGroup);

  function roadTextures(rail: number) {
    const W = 256;
    const H = 512;
    const a = document.createElement("canvas");
    a.width = W;
    a.height = H;
    const c = a.getContext("2d")!;
    c.fillStyle = "#10141c";
    c.fillRect(0, 0, W, H);
    // hex-panel micro detail
    c.strokeStyle = "rgba(120,140,170,.10)";
    c.lineWidth = 1;
    for (let y = 0; y < H; y += 32) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    for (let x = 32; x < W; x += 64) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
    const e = document.createElement("canvas");
    e.width = W;
    e.height = H;
    const ec = e.getContext("2d")!;
    ec.fillStyle = "#000";
    ec.fillRect(0, 0, W, H);
    const col = `#${rail.toString(16).padStart(6, "0")}`;
    ec.fillStyle = col;
    ec.fillRect(4, 0, 5, H);
    ec.fillRect(W - 9, 0, 5, H);
    ec.globalAlpha = 0.5;
    for (let y = 0; y < H; y += 128) ec.fillRect(W / 2 - 2, y, 4, 64);
    // forward chevrons
    ec.globalAlpha = 0.22;
    ec.lineWidth = 6;
    ec.strokeStyle = col;
    for (let y = 40; y < H; y += 256) {
      ec.beginPath();
      ec.moveTo(W * 0.3, y + 40);
      ec.lineTo(W * 0.5, y);
      ec.lineTo(W * 0.7, y + 40);
      ec.stroke();
    }
    const map = T(new THREE.CanvasTexture(a));
    map.colorSpace = THREE.SRGBColorSpace;
    const emap = T(new THREE.CanvasTexture(e));
    emap.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, emap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
    return { map, emap };
  }

  function padTexture() {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 256;
    const c = cv.getContext("2d")!;
    c.clearRect(0, 0, 128, 256);
    c.strokeStyle = "#fff";
    c.lineWidth = 14;
    c.lineCap = "round";
    for (let y = 30; y < 256; y += 70) {
      c.beginPath();
      c.moveTo(20, y + 40);
      c.lineTo(64, y);
      c.lineTo(108, y + 40);
      c.stroke();
    }
    return T(new THREE.CanvasTexture(cv));
  }
  const padTex = padTexture();

  function buildTrack(def: TrackDef): Built {
    const group = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(
      def.pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      "centripetal",
    );
    const L = curve.getLength();
    const N = Math.ceil(L / 2);
    const ds = L / N;
    const P: THREE.Vector3[] = [];
    const Tn: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      P.push(curve.getPointAt(i / N));
      Tn.push(curve.getTangentAt(i / N).normalize());
    }
    // signed horizontal curvature, smoothed
    const kRaw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Tn[i];
      const b = Tn[(i + 1) % N];
      const cy = a.x * b.z - a.z * b.x; // (a × b).y
      kRaw[i] = -cy / ds;
    }
    const k = new Float32Array(N);
    const win = 6;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = -win; j <= win; j++) s += kRaw[(i + j + N) % N];
      k[i] = s / (win * 2 + 1);
    }
    // banked frames
    const R: THREE.Vector3[] = [];
    const U: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const r0 = new THREE.Vector3().crossVectors(Tn[i], UP).normalize();
      const u0 = new THREE.Vector3().crossVectors(r0, Tn[i]).normalize();
      const b = THREE.MathUtils.clamp(k[i] * 26, -0.55, 0.55);
      const u = u0.clone().multiplyScalar(Math.cos(b)).addScaledVector(r0, Math.sin(b)).normalize();
      const r = new THREE.Vector3().crossVectors(Tn[i], u).normalize();
      R.push(r);
      U.push(u);
    }
    // speed profile (what a clean, unboosted line can carry)
    const prof = new Float32Array(N);
    for (let i = 0; i < N; i++) prof[i] = Math.min(VMAX, Math.sqrt((GRIP_S * 0.97) / Math.max(1e-5, Math.abs(k[i]))));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const nx = prof[(i + 1) % N];
        prof[i] = Math.min(prof[i], Math.sqrt(nx * nx + 2 * 38 * ds));
      }
      for (let i = 0; i < N; i++) {
        const pv = prof[(i - 1 + N) % N];
        prof[i] = Math.min(prof[i], Math.sqrt(pv * pv + 2 * 24 * ds));
      }
    }
    let ideal = 0;
    for (let i = 0; i < N; i++) ideal += ds / Math.max(5, prof[i]);

    // ---- road ribbon
    const W = def.width;
    const { map, emap } = roadTextures(def.rail);
    const roadMat = M(
      new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.28, metalness: 0.55, envMapIntensity: 0.8 }),
    );
    const sideMat = M(new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.5, metalness: 0.7 }));
    const top: number[] = [];
    const topUv: number[] = [];
    const sides: number[] = [];
    const idxTop: number[] = [];
    const idxSide: number[] = [];
    const TH = 0.9;
    for (let i = 0; i <= N; i++) {
      const j = i % N;
      const p = P[j];
      const l = p.clone().addScaledVector(R[j], -W / 2);
      const r = p.clone().addScaledVector(R[j], W / 2);
      top.push(l.x, l.y, l.z, r.x, r.y, r.z);
      const v = (i * ds) / 24;
      topUv.push(0, v, 1, v);
      const lb = l.clone().addScaledVector(U[j], -TH);
      const rb = r.clone().addScaledVector(U[j], -TH);
      sides.push(l.x, l.y, l.z, lb.x, lb.y, lb.z, rb.x, rb.y, rb.z, r.x, r.y, r.z);
      if (i < N) {
        const a = i * 2;
        idxTop.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        const b = i * 4;
        const n = b + 4;
        // left wall, bottom, right wall
        idxSide.push(b, b + 1, n, n, b + 1, n + 1);
        idxSide.push(b + 1, b + 2, n + 1, n + 1, b + 2, n + 2);
        idxSide.push(b + 2, b + 3, n + 2, n + 2, b + 3, n + 3);
      }
    }
    const tg = G(new THREE.BufferGeometry());
    tg.setAttribute("position", new THREE.Float32BufferAttribute(top, 3));
    tg.setAttribute("uv", new THREE.Float32BufferAttribute(topUv, 2));
    tg.setIndex(idxTop);
    tg.computeVertexNormals();
    const road = new THREE.Mesh(tg, roadMat);
    group.add(road);
    const sg = G(new THREE.BufferGeometry());
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sides, 3));
    sg.setIndex(idxSide);
    sg.computeVertexNormals();
    group.add(new THREE.Mesh(sg, sideMat));

    // ---- energy fences + rails
    const fenceMat = M(
      new THREE.MeshBasicMaterial({ color: def.rail, alphaMap: fadeTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    for (const side of [-1, 1]) {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= N; i++) {
        const j = i % N;
        const b = P[j].clone().addScaledVector(R[j], side * (W / 2 + 0.15));
        const t = b.clone().addScaledVector(U[j], 1.25);
        pos.push(b.x, b.y, b.z, t.x, t.y, t.z);
        uv.push(i / 8, 1, i / 8, 0);
        if (i < N) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const fg = G(new THREE.BufferGeometry());
      fg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      fg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      fg.setIndex(idx);
      const fence = new THREE.Mesh(fg, fenceMat);
      fence.frustumCulled = false;
      group.add(fence);
      const railPts: THREE.Vector3[] = [];
      for (let i = 0; i < N; i += 3) railPts.push(P[i].clone().addScaledVector(R[i], side * (W / 2 + 0.15)).addScaledVector(U[i], 1.25));
      const rc = new THREE.CatmullRomCurve3(railPts, true);
      const tube = new THREE.Mesh(G(new THREE.TubeGeometry(rc, Math.floor(railPts.length * 1.5), 0.09, 6, true)), M(new THREE.MeshBasicMaterial({ color: side < 0 ? def.rail : def.rail2 })));
      group.add(tube);
    }

    // ---- pylons down to the street
    const pylonGeo = G(new THREE.CylinderGeometry(1, 1.3, 1, 10));
    const pylonMat = M(new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.6, metalness: 0.7 }));
    const ringGeo = G(new THREE.TorusGeometry(1.25, 0.07, 6, 20));
    const ringMat = M(new THREE.MeshBasicMaterial({ color: def.rail }));
    for (let i = 0; i < N; i += 32) {
      const base = P[i].clone().addScaledVector(U[i], -TH);
      if (base.y < 6) continue;
      const py = new THREE.Mesh(pylonGeo, pylonMat);
      py.scale.set(1, base.y, 1);
      py.position.set(base.x, base.y / 2, base.z);
      group.add(py);
      for (const f of [0.35, 0.7]) {
        const r = new THREE.Mesh(ringGeo, ringMat);
        r.rotation.x = Math.PI / 2;
        r.position.set(base.x, base.y * f, base.z);
        group.add(r);
      }
    }

    // ---- checkpoint arches (index 0 = start/finish)
    const gates: THREE.Group[] = [];
    const archMat = M(new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.4, metalness: 0.8 }));
    const stripMat = M(new THREE.MeshBasicMaterial({ color: def.rail }));
    const startMat = M(new THREE.MeshBasicMaterial({ color: 0x7f8ea6 }));
    const colGeo = G(new THREE.BoxGeometry(1.2, 10, 1.2));
    const beamGeo = G(new THREE.BoxGeometry(W + 4, 1.4, 1.4));
    const stripGeo = G(new THREE.BoxGeometry(W + 3.6, 0.18, 1.45));
    const colStrip = G(new THREE.BoxGeometry(0.2, 9.4, 1.25));
    for (let g = 0; g < 8; g++) {
      const i = Math.floor((g / 8) * N);
      const arch = new THREE.Group();
      for (const side of [-1, 1]) {
        const c = new THREE.Mesh(colGeo, archMat);
        c.position.set(side * (W / 2 + 1.4), 5, 0);
        arch.add(c);
        const cs = new THREE.Mesh(colStrip, g === 0 ? startMat : stripMat);
        cs.position.set(side * (W / 2 + 0.75), 5, 0);
        arch.add(cs);
      }
      const beam = new THREE.Mesh(beamGeo, archMat);
      beam.position.y = 10.4;
      arch.add(beam);
      const st = new THREE.Mesh(stripGeo, g === 0 ? startMat : stripMat);
      st.position.y = 9.65;
      arch.add(st);
      const m = new THREE.Matrix4().makeBasis(R[i], U[i], Tn[i].clone().negate());
      arch.quaternion.setFromRotationMatrix(m);
      arch.position.copy(P[i]);
      group.add(arch);
      gates.push(arch);
    }
    // start grid chequer
    {
      const cv = document.createElement("canvas");
      cv.width = 128;
      cv.height = 16;
      const c = cv.getContext("2d")!;
      for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
        c.fillStyle = (x + y) % 2 ? "#ffffff" : "#000000";
        c.fillRect(x * 8, y * 8, 8, 8);
      }
      const tex = T(new THREE.CanvasTexture(cv));
      const chk = new THREE.Mesh(G(new THREE.PlaneGeometry(W, 2)), M(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8 })));
      chk.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R[0], Tn[0].clone().negate(), U[0]));
      chk.position.copy(P[0]).addScaledVector(U[0], 0.04);
      group.add(chk);
    }

    // ---- boost pads
    const pads: Array<{ s: number; x: number }> = [];
    const padMat = M(new THREE.MeshBasicMaterial({ map: padTex, color: 0xffb547, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    const padGeo = G(new THREE.PlaneGeometry(5, 12));
    for (const [f, lat] of def.pads) {
      const i = Math.floor(f * N);
      const x = lat * (W / 2 - 3);
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R[i], Tn[i], U[i]));
      pad.position.copy(P[i]).addScaledVector(R[i], x).addScaledVector(U[i], 0.05);
      group.add(pad);
      pads.push({ s: i * ds, x });
    }

    // minimap projection
    let minX = 1e9;
    let maxX = -1e9;
    let minZ = 1e9;
    let maxZ = -1e9;
    for (const p of P) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    const mapXY = (p: THREE.Vector3): [number, number] => [6 + ((p.x - minX) / span) * 88, 6 + ((p.z - minZ) / span) * 88];
    let mapPath = "";
    for (let i = 0; i < N; i += 6) {
      const [x, y] = mapXY(P[i]);
      mapPath += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    mapPath += "Z";

    scene.add(group);
    return { def, L, N, ds, P, Tn, R, U, k, prof, ideal, group, gates, pads, mapPath, mapXY };
  }

  function disposeTrack() {
    if (!track) return;
    scene.remove(track.group);
    track.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) {
        m.geometry.dispose();
        geometries.delete(m.geometry);
      }
    });
    track = null;
  }

  /** Frame at distance s (interpolated). */
  const fr = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), k: 0, prof: 0 };
  function frameAt(s: number) {
    const t = track!;
    const f = (((s % t.L) + t.L) % t.L) / t.ds;
    const i = Math.floor(f) % t.N;
    const j = (i + 1) % t.N;
    const a = f - Math.floor(f);
    fr.p.lerpVectors(t.P[i], t.P[j], a);
    fr.t.lerpVectors(t.Tn[i], t.Tn[j], a).normalize();
    fr.r.lerpVectors(t.R[i], t.R[j], a).normalize();
    fr.u.lerpVectors(t.U[i], t.U[j], a).normalize();
    fr.k = t.k[i] * (1 - a) + t.k[j] * a;
    fr.prof = t.prof[i] * (1 - a) + t.prof[j] * a;
    return fr;
  }

  // ------------------------------------------------------------ city
  /** Window-grid shader for instanced towers: procedural, crisp at any distance, one draw call. */
  function towerMaterial() {
    const m = M(new THREE.MeshStandardMaterial({ color: 0x151822, roughness: 0.55, metalness: 0.5 }));
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vSeed;")
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          vec4 wp4 = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            wp4 = instanceMatrix * wp4; wn = mat3(instanceMatrix) * wn;
            vSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.027;
          #else
            vSeed = 0.0;
          #endif
          vWP = (modelMatrix * wp4).xyz; vWN = normalize(mat3(modelMatrix) * wn);`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vWP; varying vec3 vWN; varying float vSeed;
          float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          {
            vec3 n = normalize(vWN);
            if (abs(n.y) < 0.5) {
              float hx = abs(n.x) > 0.5 ? vWP.z : vWP.x;
              vec2 g = vec2(hx / 2.3, vWP.y / 3.1);
              vec2 cell = floor(g);
              vec2 f = fract(g);
              float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
              float hsh = h21(cell + vSeed * 17.0);
              float lit = step(0.84, hsh) * (0.55 + 0.45 * h21(cell.yx + 3.1));
              float band = h21(vec2(floor(vWP.y / 26.0), vSeed));
              vec3 col = hsh > 0.975 ? vec3(1.0, 0.25, 0.8) : hsh > 0.95 ? vec3(0.3, 0.9, 1.0) : mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.85, 1.0), band);
              float px = length(fwidth(g));
              float far = smoothstep(0.25, 0.75, px);
              vec3 near = col * win * lit;
              vec3 avg = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.85, 1.0), band) * 0.11;
              totalEmissiveRadiance += mix(near, avg * 0.8, far) * 0.95;
              diffuseColor.rgb *= mix(1.0, 0.75, win);
            }
          }`,
        );
    };
    m.customProgramCacheKey = () => "vl-tower";
    return m;
  }

  function signTexture() {
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
      if (rng() < 0.5) c.fillRect(32 - w / 2, y + 22, 4, 6);
    }
    c.strokeStyle = "#fff";
    c.lineWidth = 3;
    c.strokeRect(3, 3, 58, 250);
    return T(new THREE.CanvasTexture(cv));
  }

  type Car = { lane: number; t: number; speed: number; axis: 0 | 1; off: number; y: number; dir: number };
  const cars: Car[] = [];
  let carBody: THREE.InstancedMesh | null = null;
  let carLight: THREE.InstancedMesh | null = null;
  const towerMat = towerMaterial();
  const towerGeo = G(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));

  function buildCity(t: Built) {
    cityGroup.clear();
    const SIGN_COLORS = [0xff3fc8, 0x35f0ff, 0xffb547, 0x9a5cff, 0x7dffb0, 0xff4d5c];
    const samples: THREE.Vector3[] = [];
    for (let i = 0; i < t.N; i += 3) samples.push(t.P[i]);
    const towers: THREE.Matrix4[] = [];
    const signs: Array<{ m: THREE.Matrix4; c: number }> = [];
    const STEP = 34;
    const R = 700;
    for (let gx = -R; gx <= R; gx += STEP) {
      for (let gz = -R; gz <= R; gz += STEP) {
        const cx = gx + (rng() - 0.5) * 6;
        const cz = gz + (rng() - 0.5) * 6;
        const w = 14 + rng() * 12;
        const d = 14 + rng() * 12;
        const dist2 = Math.hypot(cx - 60, cz - 100);
        let h = 18 + rng() * 60 + Math.max(0, 1 - dist2 / 600) * rng() * 140;
        // clearance against the sky lane
        let blocked = false;
        const half = Math.max(w, d) * 0.72 + t.def.width / 2 + 7;
        for (const p of samples) {
          const hd = Math.hypot(p.x - cx, p.z - cz);
          if (hd < half) {
            if (h > p.y - 9) {
              if (p.y - 9 > 8 && rng() < 0.85) h = p.y - 9 - rng() * 6; // flatten under the lane
              else blocked = true;
            }
            if (blocked) break;
          }
        }
        if (blocked || h < 6) continue;
        towers.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, 0, cz), new THREE.Quaternion(), new THREE.Vector3(w, h, d)));
        if (h > 30 && rng() < 0.45) {
          const face = Math.floor(rng() * 4);
          const sh = 8 + rng() * 14;
          const y = 8 + rng() * Math.max(1, h - sh - 10);
          const nrm = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)][face];
          const off = nrm.x !== 0 ? w / 2 + 0.3 : d / 2 + 0.3;
          const pos = new THREE.Vector3(cx + nrm.x * off, y + sh / 2, cz + nrm.z * off);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
          signs.push({ m: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(sh * 0.28, sh, 1)), c: SIGN_COLORS[Math.floor(rng() * SIGN_COLORS.length)] });
        }
      }
    }
    const tw = new THREE.InstancedMesh(towerGeo, towerMat, towers.length);
    towers.forEach((m, i) => tw.setMatrixAt(i, m));
    tw.instanceMatrix.needsUpdate = true;
    tw.computeBoundingSphere();
    cityGroup.add(tw);
    const signMat = M(new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false, side: THREE.DoubleSide }));
    const sg = new THREE.InstancedMesh(G(new THREE.PlaneGeometry(1, 1)), signMat, Math.max(1, signs.length));
    signs.forEach((s, i) => {
      sg.setMatrixAt(i, s.m);
      sg.setColorAt(i, new THREE.Color(s.c).multiplyScalar(1.6));
    });
    sg.count = signs.length;
    sg.instanceMatrix.needsUpdate = true;
    if (sg.instanceColor) sg.instanceColor.needsUpdate = true;
    cityGroup.add(sg);
    // street floor
    const floor = new THREE.Mesh(G(new THREE.PlaneGeometry(1800, 1800)), M(new THREE.MeshStandardMaterial({ color: 0x07080c, roughness: 0.35, metalness: 0.6 })));
    floor.rotation.x = -Math.PI / 2;
    cityGroup.add(floor);
    // aircraft beacons on the tallest
    const bm = M(new THREE.SpriteMaterial({ map: dotTex, color: 0xff2a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    towers.forEach((m) => {
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      m.decompose(p, new THREE.Quaternion(), s);
      if (s.y > 110 && rng() < 0.6) {
        const b = new THREE.Sprite(bm);
        b.position.set(p.x, s.y + 1.5, p.z);
        b.scale.setScalar(5);
        cityGroup.add(b);
      }
    });
    // flying traffic: high skyways above the lane + street level below
    cars.length = 0;
    const CN = mobile ? 120 : 260;
    for (let i = 0; i < CN; i++) {
      const high = rng() < 0.65;
      cars.push({
        lane: i,
        t: rng() * 1400,
        speed: 22 + rng() * 30,
        axis: rng() < 0.5 ? 0 : 1,
        off: (Math.round((rng() - 0.5) * 40) + 0.5) * STEP + (rng() - 0.5) * 4,
        y: high ? 95 + Math.floor(rng() * 5) * 18 : 3 + rng() * 2,
        dir: rng() < 0.5 ? 1 : -1,
      });
    }
    const bodyMat = M(new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.4, metalness: 0.8 }));
    carBody = new THREE.InstancedMesh(G(new THREE.BoxGeometry(2, 1.1, 4.4)), bodyMat, CN);
    carLight = new THREE.InstancedMesh(G(new THREE.BoxGeometry(2.05, 0.18, 4.45)), M(new THREE.MeshBasicMaterial({ toneMapped: false })), CN);
    for (let i = 0; i < CN; i++) carLight.setColorAt(i, new THREE.Color(cars[i].dir > 0 ? 0xff3344 : 0xbfe9ff).multiplyScalar(2));
    carBody.frustumCulled = carLight.frustumCulled = false;
    cityGroup.add(carBody, carLight);
  }
  const carM = new THREE.Matrix4();
  const carQ = [new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2), new THREE.Quaternion()];
  const carP = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1);
  function updateCars(dt: number) {
    if (!carBody || !carLight) return;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.t = (c.t + c.speed * dt) % 1400;
      const along = (c.t - 700) * c.dir;
      if (c.axis === 0) carP.set(along, c.y, c.off);
      else carP.set(c.off, c.y, along);
      carM.compose(carP, carQ[c.axis], ONE);
      carBody.setMatrixAt(i, carM);
      carLight.setMatrixAt(i, carM);
    }
    carBody.instanceMatrix.needsUpdate = true;
    carLight.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ loading
  hud.overlay.className = "nx-ov load on";
  hud.overlay.innerHTML = `<div class="nx-load"><div class="nx-kick">SKY-LANE GRID // DISTRICT 07</div>
    <div class="nx-h2" style="margin-top:14px">SPOOLING THRUSTERS</div>
    <div class="bar"><i></i></div><div class="st"><span>BIKES · LANES · CITY</span><span class="pc">0%</span></div><div class="err"></div></div>`;
  const loadFill = hud.overlay.querySelector(".bar i") as HTMLElement;
  const loadPct = hud.overlay.querySelector(".pc") as HTMLElement;
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, l, t) => {
    const p = t ? Math.round((l / t) * 100) : 0;
    loadFill.style.width = `${p}%`;
    loadPct.textContent = `${p}%`;
  };
  const gltfLoader = new GLTFLoader(manager);
  let soldierSrc: THREE.Group | null = null;
  let clips: THREE.AnimationClip[] = [];
  let envRT: THREE.WebGLRenderTarget | null = null;
  let pmrem: THREE.PMREMGenerator | null = null;

  async function boot() {
    const solP = gltfLoader.loadAsync(`${ASSET}/models/soldier.glb`).catch((e) => {
      console.error("[VELOCITY] soldier", e);
      return null;
    });
    const mocapP = fetch(`${ASSET}/models/anims.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((l: THREE.AnimationClipJSON[]) => l.map((j) => THREE.AnimationClip.parse(j)))
      .catch(() => [] as THREE.AnimationClip[]);
    const hdrP = new HDRLoader(manager)
      .loadAsync(`${ASSET}/hdr/city_sunset.hdr`)
      .then((tex) => {
        if (disposed) return;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        pmrem = new THREE.PMREMGenerator(renderer);
        envRT = pmrem.fromEquirectangular(tex);
        tex.dispose();
        scene.environment = envRT.texture;
        scene.environmentIntensity = 0.35;
      })
      .catch(() => {});
    const [sol, mocap] = await Promise.all([solP, mocapP, hdrP]);
    if (disposed) return;
    if (sol) {
      soldierSrc = sol.scene;
      sourceObjects.push(sol.scene);
      clips = [...sol.animations, ...(mocap as THREE.AnimationClip[])];
    }
    loadTrack(trackId);
    showMenu();
  }

  function loadTrack(id: TrackId) {
    disposeTrack();
    track = buildTrack(trackById(id));
    buildCity(track);
    hud.map.innerHTML = `<path d="${track.mapPath}" fill="none" stroke="rgba(220,240,255,.35)" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="${track.mapPath}" fill="none" stroke="#${track.def.rail.toString(16).padStart(6, "0")}" stroke-width="0.8" opacity=".9"/><g class="dots"></g>`;
  }

  // ------------------------------------------------------------ bikes
  const hullGeo = (() => {
    const s = new THREE.Shape();
    const pts: Array<[number, number]> = [
      [-1.3, 0.22],
      [-1.18, 0.5],
      [-0.55, 0.62],
      [-0.1, 0.56],
      [0.35, 0.48],
      [0.95, 0.34],
      [1.38, 0.18],
      [1.24, 0.06],
      [0.2, 0.02],
      [-1.22, 0.08],
    ];
    s.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.52, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 3, curveSegments: 4 });
    g.translate(0, 0, -0.26);
    g.rotateY(Math.PI / 2);
    return G(g);
  })();
  const podGeo = G(new THREE.CylinderGeometry(0.17, 0.21, 0.9, 14).rotateX(Math.PI / 2));
  const nozzleGeo = G(new THREE.CircleGeometry(0.15, 16));
  const flameGeo = G(new THREE.ConeGeometry(0.14, 1, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5));
  const canopyGeo = G(new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  const stripGeo = G(new THREE.BoxGeometry(0.03, 0.05, 1.9));
  const padGeoB = G(new THREE.CircleGeometry(0.32, 18).rotateX(Math.PI / 2));
  const bodyMatBase = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.25, metalness: 0.85, envMapIntensity: 1.2 });
  const glassMat = M(new THREE.MeshStandardMaterial({ color: 0x050a10, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.6 }));

  function findBone(m: THREE.Object3D, n: string) {
    return m.getObjectByName(`mixamorig${n}`) ?? m.getObjectByName(`mixamorig:${n}`) ?? null;
  }

  function makeTrail(color: number): Trail {
    const n = 14;
    const geo = G(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const col = new Float32Array(n * 2 * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = Math.pow(1 - i / (n - 1), 1.6);
      for (let j = 0; j < 2; j++) col.set([c.r * k, c.g * k, c.b * k], (i * 2 + j) * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const pts = Array.from({ length: n }, () => new THREE.Vector3());
    const ups = Array.from({ length: n }, () => new THREE.Vector3(0, 1, 0));
    return { mesh, pts, ups, geo, mat, head: 0, n };
  }
  function pushTrail(tr: Trail, p: THREE.Vector3, up: THREE.Vector3, width: number, reset = false) {
    if (reset) for (let i = 0; i < tr.n; i++) tr.pts[i].copy(p);
    for (let i = tr.n - 1; i > 0; i--) {
      tr.pts[i].copy(tr.pts[i - 1]);
      tr.ups[i].copy(tr.ups[i - 1]);
    }
    tr.pts[0].copy(p);
    tr.ups[0].copy(up).multiplyScalar(width);
    const a = tr.geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < tr.n; i++) {
      const w = 1 - i / tr.n;
      a.setXYZ(i * 2, tr.pts[i].x + tr.ups[i].x * w, tr.pts[i].y + tr.ups[i].y * w, tr.pts[i].z + tr.ups[i].z * w);
      a.setXYZ(i * 2 + 1, tr.pts[i].x - tr.ups[i].x * w, tr.pts[i].y - tr.ups[i].y * w, tr.pts[i].z - tr.ups[i].z * w);
    }
    a.needsUpdate = true;
  }

  function makeBike(color: number, withRider: boolean, ghost = false): Bike {
    const mats: THREE.Material[] = [];
    const root = new THREE.Group();
    const lean = new THREE.Group();
    root.add(lean);
    const body = bodyMatBase.clone();
    if (ghost) {
      body.transparent = true;
      body.opacity = 0.35;
      body.color.setHex(color);
      body.emissive.setHex(color);
      body.emissiveIntensity = 0.6;
      body.depthWrite = false;
    }
    const accent = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, roughness: 0.3 });
    const flameMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const nozMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.6), toneMapped: false });
    mats.push(body, accent, flameMat, nozMat);
    const hull = new THREE.Mesh(hullGeo, body);
    lean.add(hull);
    const canopy = new THREE.Mesh(canopyGeo, ghost ? body : glassMat);
    canopy.scale.set(0.75, 0.6, 1.5);
    canopy.position.set(0, 0.55, -0.55);
    lean.add(canopy);
    const glow: THREE.Sprite[] = [];
    const flame: THREE.Mesh[] = [];
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(podGeo, body);
      pod.position.set(sx * 0.42, 0.3, 0.75);
      lean.add(pod);
      const noz = new THREE.Mesh(nozzleGeo, nozMat);
      noz.position.set(sx * 0.42, 0.3, 1.205);
      lean.add(noz);
      const fl = new THREE.Mesh(flameGeo, flameMat);
      fl.position.set(sx * 0.42, 0.3, 1.21);
      lean.add(fl);
      flame.push(fl);
      const st = new THREE.Mesh(stripGeo, accent);
      st.position.set(sx * 0.3, 0.42, -0.05);
      lean.add(st);
      const gs = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mats.push(gs.material);
      gs.position.set(sx * 0.42, 0.3, 1.3);
      gs.scale.setScalar(0.9);
      lean.add(gs);
      glow.push(gs);
    }
    for (const z of [-0.85, 0.55]) {
      const pd = new THREE.Mesh(padGeoB, accent);
      pd.position.set(0, -0.02, z);
      lean.add(pd);
    }
    let rider: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    if (withRider && soldierSrc) {
      rider = cloneSkeleton(soldierSrc);
      rider.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        const mm = src.clone();
        if (/visor/i.test(m.name) || /visor/i.test(src.name)) {
          mm.emissive = new THREE.Color(color);
          mm.emissiveIntensity = 1.4;
          mm.color.setHex(0x0a0d10);
        } else mm.color.lerp(new THREE.Color(0x22252c), 0.55);
        if (ghost) {
          mm.transparent = true;
          mm.opacity = 0.3;
          mm.depthWrite = false;
        }
        mats.push(mm);
        m.material = mm;
        m.frustumCulled = false;
      });
      rider.scale.setScalar(0.9);
      rider.position.set(0, 0.12, 0.3);
      rider.rotation.y = Math.PI; // model faces -Z after flip → forward
      lean.add(rider);
      mixer = new THREE.AnimationMixer(rider);
      const crouch = clips.find((c) => c.name === "crouch_idle") ?? clips.find((c) => c.name === "Idle");
      if (crouch) {
        const a = mixer.clipAction(crouch);
        a.play();
        mixer.update(0.3);
      }
    }
    root.scale.setScalar(1.22);
    scene.add(root);
    for (const m of mats) materials.add(m);
    const trail = makeTrail(color);
    materials.add(trail.mat);
    return { root, lean, glow, flame, flameMat, accent, rider, mixer, trail, mats };
  }

  function removeBike(b: Bike) {
    scene.remove(b.root);
    scene.remove(b.trail.mesh);
    b.mixer?.stopAllAction();
    for (const m of b.mats) {
      m.dispose();
      materials.delete(m);
    }
  }

  const riderHands = { l: new THREE.Vector3(), r: new THREE.Vector3(), pole: new THREE.Vector3() };
  /** Lean the rider into the bike and clamp the hands to the bars (2-bone IK). */
  function poseRider(b: Bike, lean: number) {
    if (!b.rider) return;
    const r = b.rider;
    const spine = findBone(r, "Spine1");
    const hips = findBone(r, "Hips");
    b.mixer?.update(0);
    if (hips) hips.rotation.x += 0.0;
    if (spine) {
      spine.rotation.x += 0.55;
      spine.rotation.z += lean * 0.4;
    }
    r.updateMatrixWorld(true);
    const bones = ["RightArm", "RightForeArm", "RightHand", "LeftArm", "LeftForeArm", "LeftHand"].map((n) => findBone(r, n));
    if (bones.some((x) => !x)) return;
    b.lean.updateMatrixWorld(true);
    riderHands.r.set(0.24, 0.72, -0.72);
    riderHands.l.set(-0.24, 0.72, -0.72);
    b.lean.localToWorld(riderHands.r);
    b.lean.localToWorld(riderHands.l);
    riderHands.pole.set(0.9, 0.2, 0.2);
    b.lean.localToWorld(riderHands.pole);
    solveArm(bones[0]!, bones[1]!, bones[2]!, riderHands.r, riderHands.pole);
    riderHands.pole.set(-0.9, 0.2, 0.2);
    b.lean.localToWorld(riderHands.pole);
    solveArm(bones[3]!, bones[4]!, bones[5]!, riderHands.l, riderHands.pole);
  }

  // ------------------------------------------------------------ racers
  const racers: Racer[] = [];
  let player: Racer | null = null;
  let ghostBike: Bike | null = null;
  let ghost: Ghost | null = null;
  let rec: { s: number[]; x: number[]; t: number } = { s: [], x: [], t: 0 };
  let bestLapRun = Infinity;
  let lastLap = 0;
  let splitBest: number[] = [];
  let splitNow: number[] = [];
  let nextGate = 1;

  function clearRace() {
    for (const r of racers) removeBike(r.bike);
    racers.length = 0;
    player = null;
    if (ghostBike) removeBike(ghostBike);
    ghostBike = null;
    audio.engineStop();
  }

  function setupRace() {
    clearRace();
    const t = track!;
    const slots = mode === "race" ? 6 : 1;
    const playerSlot = mode === "race" ? 3 : 0;
    const rivalList = RIVALS.slice();
    for (let i = 0; i < slots; i++) {
      const isP = i === playerSlot;
      const rv = isP ? null : rivalList.shift()!;
      const d = mode === "race" ? -6 - Math.floor(i / 2) * 9 : -4;
      const r: Racer = {
        name: isP ? "YOU" : rv!.name,
        color: isP ? 0x35f0ff : rv!.color,
        skill: isP ? 1 : rv!.skill * (trackId === "skyfall" ? 1.01 : 1),
        player: isP,
        d,
        x: mode === "race" ? (i % 2 ? 3.8 : -3.8) : 0,
        vx: 0,
        v: 0,
        steer: 0,
        slip: 0,
        boost: 0.35,
        boosting: false,
        drifting: false,
        finished: 0,
        lapStart: 0,
        laps: [],
        bike: makeBike(isP ? 0x35f0ff : rv!.color, true),
        lineBias: (fx() - 0.5) * 3,
      };
      racers.push(r);
      if (isP) player = r;
    }
    ghost = mode === "trial" ? loadGhost(trackId) : null;
    if (ghost) ghostBike = makeBike(0x9fb4ff, true, true);
    rec = { s: [], x: [], t: 0 };
    bestLapRun = Infinity;
    lastLap = 0;
    splitNow = [];
    splitBest = ghost ? computeSplits(ghost) : [];
    nextGate = 1;
    for (const r of racers) placeBike(r.bike, r.d, r.x, 0, 0, 0, true);
    void t;
  }

  function computeSplits(g: Ghost) {
    const L = track!.L;
    const out: number[] = [];
    for (let k = 1; k < 8; k++) {
      const target = (k / 8) * L;
      let i = g.s.findIndex((v) => v >= target);
      if (i < 0) i = g.s.length - 1;
      out[k] = i * g.dt;
    }
    return out;
  }

  const bM = new THREE.Matrix4();
  const negT = new THREE.Vector3();
  function placeBike(b: Bike, d: number, x: number, lean: number, slip: number, bob: number, resetTrail = false) {
    const f = frameAt(d);
    b.root.position.copy(f.p).addScaledVector(f.r, x).addScaledVector(f.u, HOVER + bob);
    negT.copy(f.t).negate();
    bM.makeBasis(f.r, f.u, negT);
    b.root.quaternion.setFromRotationMatrix(bM);
    b.root.rotateY(-slip);
    b.lean.rotation.z = -lean;
    b.root.updateMatrixWorld(true);
    tmp.set(0, 0.3, 1.25);
    b.root.localToWorld(tmp);
    pushTrail(b.trail, tmp, f.u, 0.09, resetTrail);
  }

  const underGlow = new THREE.PointLight(0x35f0ff, 40, 12, 1.6);
  scene.add(underGlow);
  const keyLight = new THREE.PointLight(0xdfe8ff, 18, 16, 1.4);
  camera.add(keyLight);
  keyLight.position.set(0, 1.5, -2);

  // input
  function readInput() {
    const pad = navigator.getGamepads?.()[0] ?? null;
    let steer = 0;
    let thr = 0;
    let brk = 0;
    let drift = false;
    let boost = false;
    if (keys.has("a") || keys.has("arrowleft") || touch.l) steer -= 1;
    if (keys.has("d") || keys.has("arrowright") || touch.r) steer += 1;
    if (keys.has("w") || keys.has("arrowup")) thr = 1;
    if (keys.has("s") || keys.has("arrowdown") || touch.brake) brk = 1;
    if (keys.has("shift") || touch.drift) drift = true;
    if (keys.has(" ") || touch.boost) boost = true;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steer = ax;
      thr = Math.max(thr, pad.buttons[7]?.value ?? 0);
      brk = Math.max(brk, pad.buttons[6]?.value ?? 0);
      if (pad.buttons[5]?.pressed || pad.buttons[2]?.pressed) drift = true;
      if (pad.buttons[0]?.pressed) boost = true;
    }
    if (mobile && brk === 0) thr = 1; // auto-throttle on touch
    return { steer: THREE.MathUtils.clamp(steer, -1, 1), thr, brk, drift, boost };
  }

  let wallSoundT = 0;
  function stepPlayer(r: Racer, dt: number) {
    const inp = autopilot ? aiInput(r) : readInput();
    if (stage !== "racing") {
      inp.thr = stage === "finished" ? 0.6 : 0;
      inp.boost = false;
      if (stage === "finished") Object.assign(inp, aiInput(r), { boost: false });
    }
    physics(r, dt, inp);
    if (r.player && stage === "racing") {
      if (hintStep === 0 && r.v > 30) hintStep = 1;
      if (hintStep === 1 && r.drifting) hintStep = 2;
      if (hintStep === 2 && r.boosting) hintStep = 3;
    }
  }

  function aiInput(r: Racer) {
    const look = frameAt(r.d + Math.max(12, r.v * 0.55));
    const here = frameAt(r.d);
    const kk = here.k;
    const vt = look.prof * r.skill * rubber(r);
    const line = THREE.MathUtils.clamp(Math.sign(look.k) * Math.min(1, Math.abs(look.k) * 95) * (track!.def.width / 2 - 2.6) + r.lineBias, -track!.def.width / 2 + 1.5, track!.def.width / 2 - 1.5);
    // steer needed to hold v²κ plus a PD term toward the racing line
    const need = (r.v * r.v * kk) / GRIP_S;
    const steer = THREE.MathUtils.clamp(need + (line - r.x) * 0.25 - r.vx * 0.12, -1, 1);
    const thr = r.v < vt ? 1 : 0;
    const brk = r.v > vt + 4 ? Math.min(1, (r.v - vt) / 12) : 0;
    const boost = !r.player && r.boost > 0.5 && Math.abs(look.k) < 0.004 && r.v > 60;
    return { steer, thr, brk, drift: false, boost };
  }
  function rubber(r: Racer) {
    if (r.player || !player || mode !== "race") return 1;
    const gap = r.d - player.d;
    return gap > 120 ? 0.96 : gap < -120 ? 1.035 : 1;
  }

  function physics(r: Racer, dt: number, inp: { steer: number; thr: number; brk: number; drift: boolean; boost: boolean }) {
    const t = track!;
    const f = frameAt(r.d);
    const W = t.def.width;
    r.steer += (inp.steer - r.steer) * Math.min(1, dt * (r.player ? 9 : 6));
    r.drifting = inp.drift && Math.abs(r.steer) > 0.25 && r.v > 32;
    r.boosting = inp.boost && r.boost > 0.02 && r.v > 5;
    const S = r.drifting ? DRIFT_S : GRIP_S;
    const grip = r.drifting ? 1.0 : 3.4;
    const ax = r.steer * S - r.v * r.v * f.k;
    r.vx += ax * dt;
    r.vx *= Math.exp(-grip * dt);
    r.x += r.vx * dt;
    // speed
    const cap = (r.boosting ? VBOOST : VMAX) * (r.drifting ? 0.94 : 1) * (r.player ? 1 : 1);
    const acc = r.boosting ? 46 : 30;
    if (r.v < cap) r.v += inp.thr * acc * (1 - (r.v / cap) ** 2) * dt;
    else r.v -= (r.v - cap) * 1.4 * dt;
    r.v -= inp.brk * 52 * dt + (inp.thr < 0.1 ? 5 * dt : 0);
    // boost economy
    if (r.boosting) {
      r.boost = Math.max(0, r.boost - 0.32 * dt);
      if (r.player && !boostWas) {
        audio.boost();
        shake = Math.max(shake, 0.25);
      }
    } else if (r.drifting) r.boost = Math.min(1, r.boost + 0.2 * dt * Math.min(1, r.v / 60));
    else r.boost = Math.min(1, r.boost + 0.015 * dt);
    if (r.player) boostWas = r.boosting;
    // pads
    const s = ((r.d % t.L) + t.L) % t.L;
    for (const p of t.pads) {
      const ds = s - p.s;
      if (ds >= -6 && ds <= 6 && Math.abs(r.x - p.x) < 3 && r.v > 10) {
        if (!(r as Racer & { padHit?: number }).padHit || menuTime - ((r as Racer & { padHit?: number }).padHit ?? 0) > 1) {
          (r as Racer & { padHit?: number }).padHit = menuTime;
          r.v = Math.min(VBOOST, r.v + 14);
          r.boost = Math.min(1, r.boost + 0.3);
          if (r.player) {
            audio.boost();
            shake = Math.max(shake, 0.35);
            feed("BOOST PAD", "hs");
          }
        }
      }
    }
    // walls
    const lim = W / 2 - 0.95;
    if (Math.abs(r.x) > lim) {
      const impact = Math.abs(r.vx);
      r.x = Math.sign(r.x) * lim;
      r.vx = -r.vx * 0.25;
      r.v = Math.max(0, r.v - impact * 1.1 - 20 * dt);
      if (r.player) {
        wallT = 0.25;
        shake = Math.max(shake, Math.min(0.6, 0.1 + impact * 0.05));
        wallSoundT -= dt;
        if (wallSoundT <= 0) {
          audio.scrape(Math.min(1, impact / 10 + 0.3));
          wallSoundT = 0.12;
        }
        sparkAt(r, Math.sign(r.x));
      }
    }
    r.v = Math.max(0, r.v);
    r.d += r.v * dt;
    r.slip += ((r.drifting ? r.steer * 0.38 : r.vx * 0.012) - r.slip) * Math.min(1, dt * 6);
  }
  let boostWas = false;

  // sparks on wall contact
  const sparkGeo = G(new THREE.BufferGeometry());
  const SPK = 60;
  const sparkPos = new Float32Array(SPK * 3);
  const sparkVel = new Float32Array(SPK * 3);
  const sparkLife = new Float32Array(SPK);
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparkPts = new THREE.Points(sparkGeo, M(new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  sparkPts.frustumCulled = false;
  scene.add(sparkPts);
  let sparkI = 0;
  function sparkAt(r: Racer, side: number) {
    const f = frameAt(r.d);
    for (let n = 0; n < 4; n++) {
      const i = sparkI++ % SPK;
      tmp.copy(f.p).addScaledVector(f.r, side * (track!.def.width / 2 - 0.4)).addScaledVector(f.u, 0.6);
      sparkPos.set([tmp.x, tmp.y, tmp.z], i * 3);
      sparkVel.set([f.t.x * r.v * 0.6 + (fx() - 0.5) * 6, 2 + fx() * 4, f.t.z * r.v * 0.6 + (fx() - 0.5) * 6], i * 3);
      sparkLife[i] = 0.4 + fx() * 0.3;
    }
  }
  function updateSparks(dt: number) {
    for (let i = 0; i < SPK; i++) {
      if (sparkLife[i] <= 0) {
        sparkPos[i * 3 + 1] = -999;
        continue;
      }
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 12 * dt;
      for (let a = 0; a < 3; a++) sparkPos[i * 3 + a] += sparkVel[i * 3 + a] * dt;
    }
    (sparkGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  function collide() {
    const L = track!.L;
    for (let i = 0; i < racers.length; i++) {
      for (let j = i + 1; j < racers.length; j++) {
        const a = racers[i];
        const b = racers[j];
        let dd = a.d - b.d;
        dd -= Math.round(dd / L) * L;
        const dx = a.x - b.x;
        if (Math.abs(dd) < 3.2 && Math.abs(dx) < 1.7) {
          const push = (1.7 - Math.abs(dx)) * 0.5 * (Math.sign(dx) || 1);
          a.x += push;
          b.x -= push;
          a.vx += push * 4;
          b.vx -= push * 4;
          const rear = dd < 0 ? a : b;
          rear.v *= 0.985;
          if (a.player || b.player) {
            shake = Math.max(shake, 0.3);
            if (fx() < 0.25) audio.scrape(0.4);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ rain
  const RAIN = mobile ? 700 : 1600;
  const rainPos = new Float32Array(RAIN * 6);
  const rainSeed = new Float32Array(RAIN * 3);
  for (let i = 0; i < RAIN; i++) rainSeed.set([fx() * 2 - 1, fx(), fx() * 2 - 1], i * 3);
  const rainGeo = G(new THREE.BufferGeometry());
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, M(new THREE.LineBasicMaterial({ color: 0xb8c8ff, transparent: true, opacity: 0.32, depthWrite: false })));
  rain.frustumCulled = false;
  scene.add(rain);
  let rainT = 0;
  const camVel = new THREE.Vector3();
  const lastCam = new THREE.Vector3();
  function updateRain(dt: number) {
    rainT += dt;
    const c = camera.position;
    const S = 34;
    const H = 30;
    const sx = -camVel.x * 0.022;
    const sy = -camVel.y * 0.022 + 0.9;
    const sz = -camVel.z * 0.022;
    for (let i = 0; i < RAIN; i++) {
      const yf = (((rainSeed[i * 3 + 1] - rainT * 0.9) % 1) + 1) % 1;
      // wrap drops around the camera so the field never runs out at 300 km/h
      const x = c.x + ((((rainSeed[i * 3] * S - c.x) % (2 * S)) + 3 * S) % (2 * S)) - S;
      const z = c.z + ((((rainSeed[i * 3 + 2] * S - c.z) % (2 * S)) + 3 * S) % (2 * S)) - S;
      const y = c.y - H / 2 + yf * H;
      rainPos.set([x, y, z, x + sx, y + sy, z + sz], i * 6);
    }
    (rainGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  // ------------------------------------------------------------ race flow
  function startRace() {
    if (!track) return;
    setupRace();
    stage = "countdown";
    countT = 3.6;
    raceTime = 0;
    finishT = 0;
    lastCount = 4;
    hud.root.dataset.mode = "play";
    hud.overlay.className = "nx-ov";
    hud.overlay.innerHTML = "";
    hud.modeK.textContent = mode === "race" ? "RACE" : "TIME TRIAL";
    hud.posWrap.style.display = mode === "race" ? "" : "none";
    audio.ensure();
    audio.startAmbient();
    audio.engineStart();
    hooks.onScore(0);
    camInit = true;
  }
  let lastCount = 4;
  let camInit = true;

  function lapsOf(r: Racer) {
    return Math.floor(r.d / track!.L);
  }

  function onLaps(r: Racer) {
    const L = track!.L;
    const done = Math.max(0, lapsOf(r));
    while (r.laps.length < done && r.d >= 0) {
      const lt = raceTime - r.lapStart;
      r.laps.push(lt);
      r.lapStart = raceTime;
      if (r.player) {
        lastLap = lt;
        const improved = lt < bestLapRun;
        bestLapRun = Math.min(bestLapRun, lt);
        const prev = progress.bestLap[trackId] ?? Infinity;
        if (lt < prev) {
          progress.bestLap[trackId] = lt;
          save(SAVE_KEY, progress);
          // ghost of the new best lap
          const g: Ghost = { time: lt, s: rec.s.map((v) => Math.round(v * 10) / 10), x: rec.x.map((v) => Math.round(v * 100) / 100), dt: 0.05 };
          try {
            localStorage.setItem(`${SAVE_KEY}:ghost:${trackId}`, JSON.stringify(g));
          } catch {
            /* quota */
          }
          if (mode === "trial") {
            ghost = g;
            splitBest = computeSplits(g);
            if (!ghostBike) ghostBike = makeBike(0x9fb4ff, true, true);
          }
          medal("PERSONAL BEST", fmt(lt));
        } else if (improved && r.laps.length > 1) feed(`FASTEST LAP · ${fmt(lt)}`, "hs");
        rec = { s: [], x: [], t: 0 };
        splitNow = [];
        nextGate = 1;
        const lapsLeft = track!.def.laps - r.laps.length;
        if (lapsLeft === 1) banner("FINAL LAP", mode === "race" ? `P${rankOf(r)} · ${fmt(lt)}` : fmt(lt), false);
        else if (lapsLeft > 1) feed(`LAP ${r.laps.length} · <u>${fmt(lt)}</u>`, "");
      }
      if (r.laps.length >= track!.def.laps && !r.finished) {
        r.finished = raceTime;
        if (r.player) finishRace();
      }
    }
    void L;
  }

  function rankOf(r: Racer) {
    const order = standings();
    return order.indexOf(r) + 1;
  }
  function standings() {
    return racers.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finished - b.finished;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.d - a.d;
    });
  }

  function finishRace() {
    stage = "finished";
    finishT = 0;
    const p = player!;
    audio.musicStinger(mode === "trial" || rankOf(p) <= 3);
    banner(mode === "race" ? `P${rankOf(p)} · FINISH` : "SESSION COMPLETE", `TOTAL ${fmt(p.finished)} · BEST LAP ${fmt(bestLapRun)}`, false);
  }

  // checkpoint splits + ghost recording (player)
  function trackPlayer(dt: number) {
    const p = player!;
    const t = track!;
    const s = ((p.d % t.L) + t.L) % t.L;
    rec.t += dt;
    while (rec.t >= 0.05) {
      rec.t -= 0.05;
      rec.s.push(p.d < 0 ? 0 : s);
      rec.x.push(p.x);
    }
    if (p.d >= 0 && nextGate < 8 && s >= (nextGate / 8) * t.L && s < (nextGate / 8) * t.L + 60) {
      const now = raceTime - p.lapStart;
      splitNow[nextGate] = now;
      const ref = splitBest[nextGate];
      if (ref) {
        const dlt = now - ref;
        hud.delta.textContent = `${dlt <= 0 ? "−" : "+"}${Math.abs(dlt).toFixed(2)}`;
        hud.delta.className = `vl-delta on ${dlt <= 0 ? "good" : "bad"}`;
        deltaT = 1.6;
        audio.gate(dlt <= 0);
      } else audio.gate(true);
      flashGate(nextGate);
      nextGate++;
    }
  }
  let deltaT = 0;
  const gateFlash: number[] = [];
  function flashGate(i: number) {
    gateFlash[i] = 0.6;
  }

  // ------------------------------------------------------------ camera
  const camUp = new THREE.Vector3(0, 1, 0);
  let camX = 0;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  function updateCamera(dt: number) {
    if (!track) return;
    if (stage === "menu" || stage === "loading" || stage === "results" || !player) {
      const d = menuTime * 26;
      const f = frameAt(d);
      tmp.copy(f.p).addScaledVector(f.u, 7).addScaledVector(f.r, Math.sin(menuTime * 0.2) * 6);
      const la = frameAt(d + 40);
      camera.position.copy(tmp);
      camera.up.copy(f.u);
      camera.lookAt(tmp2.copy(la.p).addScaledVector(la.u, 3));
      if (camera.fov !== 70) {
        camera.fov = 70;
        camera.updateProjectionMatrix();
      }
      return;
    }
    const p = player;
    const back = 5.6 + p.v * 0.016;
    const fb = frameAt(p.d - back);
    camX += (p.x * 0.85 - p.slip * 1.4 - camX) * (1 - Math.exp(-dt * 6));
    const ideal = tmp.copy(fb.p).addScaledVector(fb.r, camX).addScaledVector(fb.u, HOVER + 2.1 + p.v * 0.004);
    if (camInit) {
      camPos.copy(ideal);
      camUp.copy(fb.u);
      camInit = false;
    }
    camPos.lerp(ideal, 1 - Math.exp(-dt * 30));
    camUp.lerp(tmp2.copy(fb.u).applyAxisAngle(fb.t, p.steer * 0.05), 1 - Math.exp(-dt * 5)).normalize();
    const fa = frameAt(p.d + 16);
    camLook.copy(fa.p).addScaledVector(fa.r, p.x * 0.75).addScaledVector(fa.u, 1.5);
    camera.position.copy(camPos);
    if (shake > 0) {
      camera.position.x += (fx() - 0.5) * shake * 0.5;
      camera.position.y += (fx() - 0.5) * shake * 0.5;
      shake = Math.max(0, shake - dt * 1.6);
    }
    const hiSpeed = Math.max(0, (p.v - 70) / 40);
    camera.position.x += (fx() - 0.5) * hiSpeed * 0.05;
    camera.position.y += (fx() - 0.5) * hiSpeed * 0.05;
    camera.up.copy(camUp);
    camera.lookAt(camLook);
    const fov = 70 + (p.v / VMAX) * 14 + (p.boosting ? 9 : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ HUD
  function feed(html: string, cls: string) {
    const d = document.createElement("div");
    d.className = cls;
    d.innerHTML = html;
    hud.feed.prepend(d);
    while (hud.feed.children.length > 4) hud.feed.lastElementChild?.remove();
    setTimeout(() => {
      d.style.opacity = "0";
      setTimeout(() => d.remove(), 450);
    }, 3200);
  }
  let bannerT = 0;
  function banner(t: string, s: string, alert: boolean) {
    hud.banner.className = "nx-banner on" + (alert ? " alert" : "");
    (hud.banner.querySelector(".k") as HTMLElement).textContent = alert ? "◆ WARNING" : "◆ VELOCITY";
    (hud.banner.querySelector(".t") as HTMLElement).textContent = t;
    (hud.banner.querySelector(".s") as HTMLElement).textContent = s;
    bannerT = 2.8;
  }
  function medal(name: string, sub: string) {
    hud.medal.innerHTML = `<i>★</i><div><b>${esc(name)}</b><span>${esc(sub)}</span></div>`;
    hud.medal.classList.remove("on");
    void hud.medal.offsetWidth;
    hud.medal.classList.add("on");
    audio.medal();
  }
  let lastRank = 0;
  function updateHud(dt: number) {
    const p = player;
    if (!p || !track) return;
    const kmh = Math.round(p.v * KMH);
    hud.spd.textContent = String(kmh);
    hud.arc.setAttribute("stroke-dasharray", `${Math.min(100, (p.v / VBOOST) * 100).toFixed(1)} 100`);
    hud.boost.style.width = `${p.boost * 100}%`;
    hud.root.classList.toggle("boosting", p.boosting);
    const laps = track.def.laps;
    const lapN = Math.min(laps, Math.max(1, p.laps.length + 1));
    hud.lapK.textContent = `LAP ${lapN}/${laps}`;
    hud.lapT.textContent = fmt(stage === "countdown" ? 0 : stage === "finished" ? p.finished : raceTime);
    hud.best.textContent = `BEST ${fmt(Math.min(bestLapRun, progress.bestLap[trackId] ?? Infinity))}`;
    hud.last.textContent = `LAST ${fmt(lastLap)}`;
    if (mode === "race") {
      const order = standings();
      const rank = order.indexOf(p) + 1;
      hud.pos.innerHTML = `${rank}<small>/${racers.length}</small>`;
      if (lastRank && rank !== lastRank && stage === "racing") audio.pass(rank < lastRank ? 0.5 : -0.5);
      lastRank = rank;
      hud.posList.innerHTML = order
        .map((r, i) => `<div class="${r.player ? "me" : ""}"><span>${i + 1}</span><i style="background:#${r.color.toString(16).padStart(6, "0")}"></i><span>${r.name}</span></div>`)
        .join("");
    }
    if (deltaT > 0) {
      deltaT -= dt;
      if (deltaT <= 0) hud.delta.classList.remove("on");
    }
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) hud.banner.classList.remove("on");
    }
    hud.warn.classList.toggle("on", wallT > 0);
    // minimap dots
    const dots = hud.map.querySelector(".dots");
    if (dots) {
      dots.innerHTML = racers
        .map((r) => {
          const [x, y] = track!.mapXY(frameAt(r.d).p);
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.player ? 3.4 : 2.4}" fill="#${(r.player ? 0xffffff : r.color).toString(16).padStart(6, "0")}" ${r.player ? 'stroke="#35f0ff" stroke-width="1.4"' : ""}/>`;
        })
        .join("");
    }
    if (hintStep < 4 && stage === "racing") {
      const tips = mobile
        ? ["<span>HOLD <kbd>◀</kbd> <kbd>▶</kbd> TO STEER · THROTTLE IS AUTOMATIC</span>", "<span>HOLD <kbd>DRIFT</kbd> THROUGH CORNERS TO CHARGE BOOST</span>", "<span>HOLD <kbd>BOOST</kbd> ON THE STRAIGHTS</span>", ""]
        : ["<span><kbd>W</kbd> THROTTLE</span><span><kbd>A</kbd><kbd>D</kbd> STEER</span><span><kbd>S</kbd> BRAKE</span>", "<span>HOLD <kbd>SHIFT</kbd> + STEER TO DRIFT — CHARGES BOOST</span>", "<span><kbd>SPACE</kbd> BOOST ON THE STRAIGHTS</span>", ""];
      const html = tips[hintStep];
      if (hud.hint.innerHTML !== html) hud.hint.innerHTML = html;
      hud.hint.classList.toggle("on", !!html);
      if (hintStep === 3) {
        hintT += dt;
        if (hintT > 2) hintStep = 4;
      }
    } else hud.hint.classList.remove("on");
    const sl = Math.max(0, (p.v - 55) / 55) + (p.boosting ? 0.4 : 0);
    hud.lines.style.opacity = String(Math.min(1, sl));
  }

  // ------------------------------------------------------------ menus
  const medals = (t: TrackDef) => {
    const b = trackById(t.id);
    void b;
    const ideal = track && track.def.id === t.id ? track.ideal : idealCache[t.id] ?? 0;
    return { gold: ideal * 1.0, silver: ideal * 1.06, bronze: ideal * 1.15 };
  };
  const idealCache: Record<string, number> = {};
  function starHtml(n: number) {
    return [0, 1, 2].map((i) => `<i class="${i < n ? "on" : ""}" style="font-style:normal;color:${i < n ? "#ffb547" : "rgba(255,255,255,.18)"}">★</i>`).join("");
  }

  function showMenu() {
    stage = "menu";
    clearRace();
    hud.root.dataset.mode = "menu";
    if (track) idealCache[track.def.id] = track.ideal;
    hud.overlay.className = "nx-ov menu on";
    hud.overlay.innerHTML = `<div class="nx-col">
      <div class="nx-kick">PLAYVERSE // SKY-LANE CIRCUIT · DISTRICT 07</div>
      <div class="nx-h1">VELO<span>CITY</span></div>
      <div class="nx-sub">Anti-grav bikes on banked neon lanes, two hundred metres above a city that never turns its lights off. Drift the corners, bank the boost, own the line.</div>
      <div class="vl-tracks">${TRACKS.map((t) => {
        const lock = !unlocked(t);
        const m = medals(t);
        const best = progress.bestLap[t.id];
        return `<button type="button" class="vl-track ${t.id === trackId ? "on" : ""} ${lock ? "lock" : ""}" data-t="${t.id}">
          <b class="n">0${t.n}</b><div><div class="t">${t.name}</div><div class="s">${lock ? "FINISH THE PREVIOUS CIRCUIT" : esc(t.tag)}</div></div>
          <div class="md">${starHtml(progress.stars[t.id] ?? 0)}<br>${best ? `BEST <b>${fmt(best)}</b>` : m.gold ? `GOLD <b style="color:#ffd86b">${fmt(m.gold)}</b>` : ""}</div></button>`;
      }).join("")}</div>
      <div class="vl-modes"><button type="button" data-m="race" class="${mode === "race" ? "on" : ""}"><b>RACE</b>6 RIDERS · ${trackById(trackId).laps} LAPS</button>
        <button type="button" data-m="trial" class="${mode === "trial" ? "on" : ""}"><b>TIME TRIAL</b>SOLO · BEAT YOUR GHOST</button></div>
      <div class="nx-actions"><button type="button" class="nx-btn" data-go="go">RIDE ▸</button>
        <button type="button" class="nx-btn ghost" data-go="settings">SETTINGS</button></div>
      <div class="nx-ctrl">${(mobile
        ? [["STEER", "◀ ▶"], ["THROTTLE", "AUTO"], ["DRIFT", "DRIFT"], ["BOOST", "BOOST"], ["BRAKE", "BRAKE"]]
        : [["THROTTLE", "W / ↑"], ["STEER", "A D / ← →"], ["BRAKE", "S / ↓"], ["DRIFT", "SHIFT"], ["BOOST", "SPACE"], ["PAUSE", "P / ESC"], ["GAMEPAD", "RT LT · RB · A"], ["RESTART", "R"]]
      )
        .map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`)
        .join("")}</div></div>`;
    hud.overlay.querySelectorAll<HTMLButtonElement>(".vl-track").forEach((b) =>
      b.addEventListener("click", () => {
        const t = trackById(b.dataset.t as TrackId);
        if (!unlocked(t) || t.id === trackId) return;
        audio.ui();
        trackId = t.id;
        loadTrack(trackId);
        showMenu();
      }),
    );
    hud.overlay.querySelectorAll<HTMLButtonElement>(".vl-modes button").forEach((b) =>
      b.addEventListener("click", () => {
        mode = b.dataset.m as Mode;
        audio.ui();
        showMenu();
      }),
    );
    (hud.overlay.querySelector('[data-go="go"]') as HTMLElement).addEventListener("click", () => {
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
      startRace();
    });
    (hud.overlay.querySelector('[data-go="settings"]') as HTMLElement).addEventListener("click", () => showSettings(showMenu));
  }

  function showSettings(back: () => void) {
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center"><div class="nx-kick">SETTINGS</div><div class="nx-h2">AUDIO</div>
      <div class="nx-set">
        <label><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" value="${settings.vol}" data-k="vol"><span>${Math.round(settings.vol * 100)}</span></label>
        <label><span>MUSIC</span><input type="range" min="0" max="1" step="0.05" value="${settings.music}" data-k="music"><span>${Math.round(settings.music * 100)}</span></label>
      </div><div class="nx-actions"><button type="button" class="nx-btn" data-go="back">DONE</button></div></div>`;
    hud.overlay.querySelectorAll<HTMLInputElement>("input").forEach((inp) =>
      inp.addEventListener("input", () => {
        const k = inp.dataset.k as "vol" | "music";
        settings[k] = Number(inp.value);
        (inp.nextElementSibling as HTMLElement).textContent = String(Math.round(settings[k] * 100));
        if (k === "vol") audio.setVolume(settings.muted ? 0 : settings.vol);
        else audio.setMusicVolume(settings.music);
        save(SETTINGS_KEY, settings);
      }),
    );
    (hud.overlay.querySelector('[data-go="back"]') as HTMLElement).addEventListener("click", back);
  }

  function pause() {
    if (stage !== "racing" && stage !== "countdown" && stage !== "finished") return;
    pausedFrom = stage;
    stage = "paused";
    audio.pause(true);
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center"><div class="nx-kick">PAUSED · ${trackById(trackId).name}</div><div class="nx-h2">PIT STOP</div>
      <div class="nx-actions"><button type="button" class="nx-btn" data-go="resume">RESUME</button>
      <button type="button" class="nx-btn ghost" data-go="restart">RESTART</button>
      <button type="button" class="nx-btn ghost" data-go="menu">QUIT</button></div></div>`;
    const go = (k: string, fn: () => void) => (hud.overlay.querySelector(`[data-go="${k}"]`) as HTMLElement).addEventListener("click", fn);
    go("resume", resume);
    go("restart", () => {
      audio.pause(false);
      startRace();
    });
    go("menu", () => {
      audio.pause(false);
      showMenu();
    });
  }
  function resume() {
    if (stage !== "paused") return;
    stage = pausedFrom;
    audio.pause(false);
    hud.overlay.className = "nx-ov";
    hud.overlay.innerHTML = "";
  }

  function showResults() {
    stage = "results";
    audio.engineStop();
    const p = player!;
    const t = track!;
    const m = medals(t.def);
    const order = standings();
    const rank = order.indexOf(p) + 1;
    const best = bestLapRun;
    let stars: boolean[];
    let score: number;
    if (mode === "race") {
      stars = [true, rank <= 3, rank === 1];
      score = (7 - rank) * 1000 + Math.max(0, Math.round((t.ideal * t.def.laps * 1.25 - p.finished) * 40));
    } else {
      stars = [best <= m.bronze, best <= m.silver, best <= m.gold];
      score = Math.max(0, Math.round((t.ideal * 1.3 - best) * 200));
    }
    const n = stars.filter(Boolean).length;
    const prev = progress.stars[trackId] ?? 0;
    progress.stars[trackId] = Math.max(prev, n, mode === "race" ? 1 : 0);
    if (mode === "race") progress.bestRace[trackId] = Math.min(progress.bestRace[trackId] ?? Infinity, p.finished);
    save(SAVE_KEY, progress);
    hooks.onScore(score);
    hooks.onGameOver(score, [
      { label: "RESULT", value: "SUCCESS" },
      { label: mode === "race" ? "POSITION" : "BEST LAP", value: mode === "race" ? `P${rank}` : fmt(best) },
    ], { ownScreen: true });
    // estimate finish for riders still on track
    const timeOf = (r: Racer) => r.finished || raceTime + Math.max(0, t.def.laps * t.L - r.d) / Math.max(30, r.v || 60);
    const nextT = TRACKS[t.def.n];
    const canNext = nextT && unlocked(nextT);
    hud.root.dataset.mode = "menu";
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center deb"><div class="nx-kick">${mode === "race" ? "RACE RESULT" : "TIME TRIAL"} · ${t.def.name}</div>
      <div class="nx-deb"><div>
        <div class="nx-grade">${mode === "race" ? `P${rank}` : n === 3 ? "G" : n === 2 ? "S" : n === 1 ? "B" : "—"}</div>
        <div class="nx-score">${mode === "race" ? fmt(p.finished) : fmt(best)}</div>
        <div class="nx-tiny">${mode === "race" ? `BEST LAP ${fmt(best)}` : `GOLD ${fmt(m.gold)} · SILVER ${fmt(m.silver)} · BRONZE ${fmt(m.bronze)}`}</div>
        ${mode === "race" ? `<div class="vl-res">${order.map((r, i) => `<div class="${r.player ? "me" : ""}"><span>${i + 1}</span><span style="color:#${r.color.toString(16).padStart(6, "0")}">${r.name}</span><b>${fmt(timeOf(r))}</b></div>`).join("")}</div>` : `<div class="nx-stats">${p.laps.map((l, i) => `<div><b>${fmt(l)}</b><span>LAP ${i + 1}${l === best ? " ★" : ""}</span></div>`).join("")}</div>`}
      </div>
      <div class="r"><div class="nx-starrow">${(mode === "race" ? ["Finish the race", "Podium", "Win"] : [`Bronze · ${fmt(m.bronze)}`, `Silver · ${fmt(m.silver)}`, `Gold · ${fmt(m.gold)}`])
        .map((s, i) => `<div class="${stars[i] ? "on" : ""}"><i>★</i>${esc(s)}</div>`)
        .join("")}</div>
        ${prev === 0 && nextT ? `<div class="nx-unlock">UNLOCKED · ${nextT.name}</div>` : ""}
        <div class="nx-actions">${canNext ? `<button type="button" class="nx-btn" data-go="next">NEXT CIRCUIT ▸</button>` : ""}
          <button type="button" class="nx-btn ${canNext ? "ghost" : ""}" data-go="retry">RETRY</button>
          <button type="button" class="nx-btn ghost" data-go="mode">${mode === "race" ? "TIME TRIAL" : "RACE"}</button>
          <button type="button" class="nx-btn ghost" data-go="menu">MENU</button></div></div></div></div>`;
    const go = (k: string, fn: () => void) => hud.overlay.querySelector(`[data-go="${k}"]`)?.addEventListener("click", fn);
    go("next", () => {
      trackId = nextT!.id;
      loadTrack(trackId);
      startRace();
    });
    go("retry", startRace);
    go("mode", () => {
      mode = mode === "race" ? "trial" : "race";
      startRace();
    });
    go("menu", showMenu);
  }

  // ------------------------------------------------------------ input
  const toggleMute = () => {
    settings.muted = !settings.muted;
    audio.setVolume(settings.muted ? 0 : settings.vol);
    save(SETTINGS_KEY, settings);
    const b = hud.sys.querySelector('[data-act="mute"]') as HTMLElement;
    b.textContent = settings.muted ? "🔇" : "🔊";
  };
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void container.requestFullscreen?.().catch(() => {});
  };
  on(window, "keydown", (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    if (stage !== "menu" && stage !== "results" && ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    keys.add(k);
    if (k === "m") toggleMute();
    if (k === "f") toggleFs();
    if (k === "p" || k === "escape") {
      if (stage === "paused") resume();
      else pause();
    }
    if (k === "r" && (stage === "racing" || stage === "finished")) startRace();
  });
  on(window, "keyup", (e: KeyboardEvent) => keys.delete(e.key.toLowerCase()));
  on(window, "blur", () => keys.clear());
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
  const hold = (el: HTMLElement, key: keyof typeof touch) => {
    const down = (e: Event) => {
      e.preventDefault();
      touch[key] = true;
      el.classList.add("on");
      audio.ensure();
    };
    const up = (e: Event) => {
      e.preventDefault();
      touch[key] = false;
      el.classList.remove("on");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  };
  hold(hud.tL, "l");
  hold(hud.tR, "r");
  hold(hud.tBoost, "boost");
  hold(hud.tDrift, "drift");
  hold(hud.tBrake, "brake");

  // ------------------------------------------------------------ composer
  let composer: EffectComposer | null = null;
  let blur: ShaderPass | null = null;
  let grade: ShaderPass | null = null;
  try {
    const rt = new THREE.WebGLRenderTarget(viewW * pixelRatio(), viewH * pixelRatio(), { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(viewW, viewH), mobile ? 0.55 : 0.62, 0.5, 0.86));
    if (!mobile) {
      blur = new ShaderPass(SpeedBlurShader);
      composer.addPass(blur);
    }
    composer.addPass(new OutputPass());
    if (!mobile) {
      grade = new ShaderPass(GradeShader);
      composer.addPass(grade);
    }
  } catch (err) {
    console.error("[VELOCITY] post unavailable", err);
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
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(container);
  else on(window, "resize", onResize);

  // --------------------------------------------------------------- loop
  let raf = 0;
  let last = performance.now();
  let hudAcc = 0;

  function update(dt: number) {
    if (!track) return;
    if (stage === "countdown") {
      countT -= dt;
      const n = Math.ceil(countT - 0.6);
      if (n !== lastCount && n >= 0) {
        lastCount = n;
        hud.count.textContent = n > 0 ? String(n) : "GO";
        hud.count.className = n > 0 ? "on" : "on go";
        void hud.count.offsetWidth;
        audio.countdown(n === 0);
      }
      if (countT <= 0.6) {
        stage = "racing";
        raceTime = 0;
        for (const r of racers) r.lapStart = 0;
      }
    }
    const live = stage === "racing" || stage === "finished";
    if (live) raceTime += dt;
    for (const r of racers) {
      if (live) {
        if (r.player) stepPlayer(r, dt);
        else if (r.finished && stage === "finished") physics(r, dt, { ...aiInput(r), thr: 0.4, boost: false });
        else physics(r, dt, aiInput(r));
        onLaps(r);
      }
    }
    if (live) collide();
    if (player && stage === "racing") trackPlayer(dt);
    if (stage === "finished") {
      finishT += dt;
      if (finishT > 4.5) showResults();
    }
    wallT = Math.max(0, wallT - dt);
    // place bikes
    racers.forEach((r, i) => {
      const lean = THREE.MathUtils.clamp(r.steer * 0.5 + (r.drifting ? r.steer * 0.25 : 0), -0.75, 0.75);
      placeBike(r.bike, r.d, r.x, lean, r.slip, Math.sin(menuTime * 3.1 + i) * 0.04);
      const thrust = r.boosting ? 2.6 : 0.6 + (r.v / VMAX) * 0.9;
      for (const fl of r.bike.flame) fl.scale.set(1, 1, thrust * (0.85 + fx() * 0.3));
      r.bike.flameMat.opacity = r.boosting ? 0.95 : 0.7;
      for (const g of r.bike.glow) g.scale.setScalar(r.boosting ? 1.8 : 0.9);
      r.bike.trail.mat.opacity = r.boosting ? 0.95 : r.drifting ? 0.7 : 0.12;
      if (r.player) underGlow.position.copy(r.bike.root.position).addScaledVector(frameAt(r.d).u, -0.3);
      const near = !player || Math.abs(r.d - player.d) < 160;
      if (r.bike.rider) r.bike.rider.visible = near;
      if (near) poseRider(r.bike, lean);
    });
    if (ghostBike && ghost && player && stage === "racing") {
      const lt = raceTime - player.lapStart;
      const fi = lt / ghost.dt;
      const i = Math.min(ghost.s.length - 1, Math.floor(fi));
      const j = Math.min(ghost.s.length - 1, i + 1);
      const a = fi - Math.floor(fi);
      let gs = ghost.s[i] + (ghost.s[j] - ghost.s[i]) * (ghost.s[j] < ghost.s[i] ? 0 : a);
      const gx = ghost.x[i] + (ghost.x[j] - ghost.x[i]) * a;
      gs += Math.max(0, player.laps.length) * track.L;
      ghostBike.root.visible = lt < ghost.time + 0.5;
      placeBike(ghostBike, gs, gx, 0, 0, 0);
      poseRider(ghostBike, 0);
    }
    // gates flash
    track.gates.forEach((g, i) => {
      const f = gateFlash[i] ?? 0;
      if (f > 0) {
        gateFlash[i] = f - dt;
        g.scale.setScalar(1 + f * 0.08);
      } else g.scale.setScalar(1);
    });
    updateCars(dt);
    updateSparks(dt);
    if (player && (stage === "racing" || stage === "countdown" || stage === "finished")) {
      audio.engineSet(Math.min(1, player.v / VBOOST), stage === "racing" ? readInput().thr : 0.2, player.boosting);
    }
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
    if (stage !== "paused") {
      for (let i = 0; i < simBoost; i++) update(realDt);
      updateCamera(realDt);
      camVel.subVectors(camera.position, lastCam).divideScalar(Math.max(1e-3, realDt));
      if (camVel.length() > 200) camVel.set(0, 0, 0);
      lastCam.copy(camera.position);
      updateRain(realDt);
      audio.update(realDt);
      audio.music(stage === "racing" || stage === "countdown" ? 0.9 : stage === "finished" ? 0.6 : 0.3);
      hudAcc += realDt;
      if (hudAcc > 0.05 && player) {
        hudAcc = 0;
        updateHud(0.05);
      }
      const v = player ? player.v : 0;
      if (blur) blur.uniforms.uAmt.value = Math.min(1, Math.max(0, (v - 50) / 60)) * 0.05 + (player?.boosting ? 0.035 : 0);
      if (grade) grade.uniforms.uTime.value = menuTime;
    }
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ dev hooks
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as Record<string, unknown>).__vl = {
      start: (id: TrackId, m: Mode = "race") => {
        mode = m;
        if (id !== trackId) {
          trackId = id;
          loadTrack(id);
        }
        startRace();
      },
      autopilot: (b: boolean) => (autopilot = b),
      sim: (n: number) => (simBoost = Math.max(1, Math.floor(n))),
      get state() {
        return {
          stage,
          raceTime,
          track: trackId,
          mode,
          L: track?.L,
          ideal: track?.ideal,
          minR: track ? 1 / Math.max(...Array.from(track.k).map(Math.abs)) : 0,
          player: player ? { d: player.d, v: player.v, x: player.x, laps: player.laps, rank: rankOf(player), boost: player.boost } : null,
          rivals: racers.filter((r) => !r.player).map((r) => ({ n: r.name, d: Math.round(r.d), laps: r.laps.length, fin: r.finished })),
        };
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
      clearRace();
      disposeTrack();
      const srcGeos = new Set<THREE.BufferGeometry>();
      const srcMats = new Set<THREE.Material>();
      for (const obj of sourceObjects)
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) srcGeos.add(m.geometry);
          if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => srcMats.add(x));
        });
      srcGeos.forEach((g) => g.dispose());
      srcMats.forEach((m) => m.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      bodyMatBase.dispose();
      envRT?.dispose();
      pmrem?.dispose();
      scene.environment = null;
      for (const p of composer?.passes ?? []) p.dispose();
      composer?.dispose();
      renderer.dispose();
      audio.dispose();
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      hud.root.remove();
      hud.style.remove();
      canvas.remove();
      if (process.env.NODE_ENV !== "production") delete (window as unknown as Record<string, unknown>).__vl;
    },
  };
}

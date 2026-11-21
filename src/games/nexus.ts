"use client";

/**
 * NEXUS 2100 — tactical squad simulation.
 *
 * All characters and all architecture are real downloaded GLB assets (see
 * public/assets/ASSETS.md). Procedural geometry is restricted to the ground
 * surface, tracers, impact sparks, UI markers and ground decals.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

type RunStat = { label: string; value: string };

type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number, stats: RunStat[]) => void;
  onBoost?: (meter: number, active: boolean) => void;
  onPopup?: (text: string) => void;
  best?: number;
};

type GameInstance = { dispose: () => void };

type Actor = {
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  current: string;
};

type Unit = {
  id: number;
  root: THREE.Group;
  tilt: THREE.Group;
  model: THREE.Object3D;
  actor: Actor;
  ring: THREE.Mesh;
  bracket: THREE.Group;
  label: THREE.Sprite;
  accent: number;
  hp: number;
  ammo: number;
  fireCd: number;
  reloadCd: number;
  moveTarget: THREE.Vector3 | null;
  target: Enemy | null;
  down: boolean;
  avoidSign: number;
  avoidTime: number;
  speed: number;
  materials: THREE.Material[];
};

type Enemy = {
  id: number;
  root: THREE.Group;
  model: THREE.Object3D;
  actor: Actor;
  ring: THREE.Mesh;
  hp: number;
  fireCd: number;
  target: Unit | null;
  patrol: THREE.Vector3[];
  patrolIndex: number;
  waitTime: number;
  dead: boolean;
  deathTimer: number;
  avoidSign: number;
  avoidTime: number;
  speed: number;
  materials: THREE.Material[];
};

type Tracer = { mesh: THREE.Mesh; life: number; material: THREE.MeshBasicMaterial };
type Spark = {
  points: THREE.Points;
  vel: THREE.Vector3[];
  life: number;
  material: THREE.PointsMaterial;
};
type Flash = { sprite: THREE.Sprite; life: number; material: THREE.SpriteMaterial };

const ASSET = "/assets";
const WORLD_SIZE = 70;
const WORLD_HALF = WORLD_SIZE / 2;
const EXTRACTION = new THREE.Vector3(23, 0, -23);
const SPAWN = new THREE.Vector3(-22, 0, 22);
const HOSTILE_COUNT = 6;
const OPERATOR_COUNT = 4;
const UP = new THREE.Vector3(0, 1, 0);
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ACCENTS = [0x57e0d8, 0x4fd1a5, 0xe3ad5c, 0x6aa7e8];

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

/** Small deterministic PRNG so every session rebuilds the same district. */
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

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Self-contained HUD styling, scoped with the nx- prefix. */
const HUD_CSS = `
.nx-root{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#b9c6d4;
  -webkit-user-select:none;user-select:none;}
.nx-root *{box-sizing:border-box;}
.nx-loading{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:14px;background:radial-gradient(ellipse at 50% 35%,#101822 0%,#05080e 70%);
  pointer-events:auto;text-align:center;padding:24px;}
.nx-kicker{font-size:9px;letter-spacing:.42em;color:#6f8496;}
.nx-heading{font-size:clamp(15px,3.2vw,24px);letter-spacing:.32em;color:#dfe9f2;font-weight:600;}
.nx-rule{width:min(340px,72vw);height:1px;background:linear-gradient(90deg,transparent,#3c5b6a,transparent);}
.nx-bar{width:min(340px,72vw);height:3px;background:rgba(255,255,255,.09);overflow:hidden;}
.nx-bar>i{display:block;height:100%;width:0;background:#67c9c2;transition:width .22s linear;}
.nx-loadlines{display:flex;flex-direction:column;gap:5px;align-items:flex-start;
  width:min(340px,72vw);font-size:9px;letter-spacing:.18em;color:#7b8d9d;}
.nx-loadlines>div{width:100%;display:flex;justify-content:space-between;}
.nx-loadlines b{font-weight:400;color:#66c9c2;}
.nx-pct{font-size:9px;letter-spacing:.24em;color:#8ea1b1;}
.nx-btn{pointer-events:auto;cursor:pointer;border:1px solid rgba(120,190,200,.42);
  background:rgba(12,26,34,.75);color:#d8e8ee;padding:11px 24px;font:inherit;
  letter-spacing:.24em;text-transform:uppercase;transition:background .15s,border-color .15s;}
.nx-btn:hover{background:rgba(24,58,66,.85);border-color:#7fd6d0;}
.nx-btn:active{transform:translateY(1px);}
.nx-btn:disabled{opacity:.4;cursor:default;}
.nx-top{position:absolute;top:0;left:0;right:0;display:grid;
  grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;
  padding:12px 16px;background:linear-gradient(180deg,rgba(4,8,13,.78),transparent);}
.nx-top-l{color:#8fa6b6;font-size:9px;letter-spacing:.22em;}
.nx-top-l em{font-style:normal;color:#d5e3ec;}
.nx-obj{color:#cfdde7;font-size:10px;letter-spacing:.22em;text-align:center;
  border-bottom:1px solid rgba(110,170,180,.28);padding-bottom:4px;}
.nx-obj.hot{color:#79e0d0;border-color:rgba(120,224,208,.5);}
.nx-top-r{text-align:right;color:#8fa6b6;font-size:9px;letter-spacing:.16em;}
.nx-top-r strong{color:#dbe8f1;font-weight:500;}
.nx-cards{position:absolute;left:14px;bottom:14px;display:flex;flex-direction:column;gap:5px;
  pointer-events:none;}
.nx-card{pointer-events:auto;cursor:pointer;width:186px;padding:7px 9px;
  border:1px solid rgba(140,170,190,.18);border-left:2px solid var(--nx-accent);
  background:linear-gradient(90deg,rgba(9,16,24,.84),rgba(9,16,24,.55));
  display:grid;grid-template-columns:22px 1fr auto;gap:7px;align-items:center;
  transition:border-color .15s,background .15s;}
.nx-card.sel{background:linear-gradient(90deg,rgba(16,34,42,.94),rgba(12,24,32,.7));
  border-color:rgba(150,220,215,.45);border-left-color:var(--nx-accent);}
.nx-card.down{opacity:.45;filter:grayscale(1);}
.nx-num{font-size:15px;color:var(--nx-accent);letter-spacing:0;}
.nx-cardmid{min-width:0;}
.nx-nameline{display:flex;justify-content:space-between;font-size:8px;color:#8ba1b0;letter-spacing:.14em;}
.nx-hp{height:3px;margin-top:4px;background:rgba(255,255,255,.1);}
.nx-hp>i{display:block;height:100%;background:var(--nx-accent);transition:width .18s;}
.nx-card.down .nx-hp>i{background:#8b8b8b;}
.nx-stat{font-size:8px;color:#92a7b6;text-align:right;line-height:1.5;letter-spacing:.12em;}
.nx-stat b{color:#d4e2eb;font-weight:500;}
.nx-actions{position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column;
  align-items:flex-end;gap:6px;pointer-events:none;}
.nx-hint{font-size:8px;line-height:1.65;color:#738797;text-align:right;letter-spacing:.12em;
  background:rgba(6,11,17,.5);padding:6px 8px;border:1px solid rgba(140,170,190,.12);white-space:nowrap;}
.nx-hint kbd{font:inherit;color:#b8cbd8;border:1px solid rgba(150,180,195,.25);padding:0 3px;}
.nx-buttons{display:none;gap:6px;pointer-events:auto;}
.nx-buttons .nx-btn{padding:10px 14px;font-size:10px;}
.nx-reticle{position:absolute;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;
  display:none;pointer-events:none;}
.nx-reticle::before,.nx-reticle::after{content:"";position:absolute;inset:0;
  border:1px solid rgba(255,126,104,.6);clip-path:polygon(0 0,32% 0,32% 8%,8% 8%,8% 32%,0 32%,0 0,100% 0,100% 32%,92% 32%,92% 8%,68% 8%,68% 0,100% 0,100% 100%,68% 100%,68% 92%,92% 92%,92% 68%,100% 68%,100% 100%,0 100%,0 68%,8% 68%,8% 92%,32% 92%,32% 100%,0 100%);}
.nx-reticle::after{inset:8px;border-color:rgba(255,126,104,.3);border-radius:50%;clip-path:none;}
.nx-error{color:#d98b8b;font-size:10px;letter-spacing:.2em;max-width:340px;}
@media (max-width:720px),(pointer:coarse){
  .nx-top{padding:9px 10px;grid-template-columns:1fr auto;row-gap:5px;}
  .nx-top-l{font-size:8px;}
  .nx-obj{grid-column:1/-1;grid-row:2;font-size:9px;text-align:left;}
  .nx-top-r{font-size:8px;}
  .nx-cards{left:8px;right:8px;bottom:62px;flex-direction:row;gap:4px;}
  .nx-card{flex:1;width:auto;min-width:0;padding:5px 4px;grid-template-columns:14px 1fr;gap:3px;}
  .nx-num{font-size:11px;}
  .nx-nameline{font-size:7px;}
  .nx-nameline span:last-child{display:none;}
  .nx-stat{grid-column:1/-1;text-align:left;display:flex;gap:8px;font-size:7px;}
  .nx-hint{display:none;}
  .nx-buttons{display:flex;pointer-events:auto;}
  .nx-actions{right:8px;bottom:8px;}
}
`;

function makeCanvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) paint(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabelTexture(text: string, color: string) {
  return makeCanvasTexture(128, 64, (ctx) => {
    ctx.clearRect(0, 0, 128, 64);
    ctx.fillStyle = "rgba(4,10,15,0.45)";
    ctx.fillRect(28, 10, 72, 38);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 10, 72, 38);
    ctx.fillStyle = color;
    ctx.font = "bold 24px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 30);
    ctx.fillRect(52, 53, 24, 2);
  });
}

function makeFlashTexture() {
  return makeCanvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0, "rgba(255,255,240,1)");
    g.addColorStop(0.28, "rgba(255,210,140,0.8)");
    g.addColorStop(1, "rgba(255,160,80,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

function makeDecalTexture() {
  return makeCanvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(10,12,15,0.55)");
    g.addColorStop(0.6, "rgba(16,18,22,0.24)");
    g.addColorStop(1, "rgba(20,22,26,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

function makeBracketGeometry(radius: number, seg: number) {
  const pts: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * radius;
      const z = sz * radius;
      pts.push(x, 0.03, z, x - sx * seg, 0.03, z);
      pts.push(x, 0.03, z, x, 0.03, z - sz * seg);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

export function createGame(container: HTMLElement, hooks: GameHooks): GameInstance {
  // ------------------------------------------------------------------ state
  const rng = mulberry32(210007);
  const coarse =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  const mobile = coarse || container.clientWidth < 720;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const sourceObjects: THREE.Object3D[] = [];
  const gltfSources = new Map<string, THREE.Group>();
  const listeners: Array<() => void> = [];

  const ownGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.add(g);
    return g;
  };
  const ownMat = <T extends THREE.Material>(m: T): T => {
    materials.add(m);
    return m;
  };
  const ownTex = <T extends THREE.Texture>(t: T): T => {
    textures.add(t);
    return t;
  };

  let disposed = false;
  let started = false;
  let ended = false;
  let success = false;
  let elapsed = 0;
  let kills = 0;
  let scoreClock = 0;
  let timeScale = 1;
  let slowTimer = 0;
  let shake = 0;
  let selectedIndex = 0;
  let hoveredEnemy: Enemy | null = null;

  const units: Unit[] = [];
  const enemies: Enemy[] = [];
  const coverMeshes: THREE.Object3D[] = [];
  const solidBoxes: THREE.Box3[] = [];
  const enemyByMesh = new Map<THREE.Object3D, Enemy>();
  const popupTimes = new Map<string, number>();

  // ------------------------------------------------------------------- HUD
  const style = document.createElement("style");
  style.textContent = HUD_CSS;
  container.appendChild(style);

  const root = document.createElement("div");
  root.className = "nx-root";
  container.appendChild(root);

  const top = document.createElement("div");
  top.className = "nx-top";
  top.innerHTML =
    '<div class="nx-top-l">OPERATION <em>NIGHTFALL</em> · DISTRICT 07</div>' +
    '<div class="nx-obj" id="nx-objective">ELIMINATE HOSTILES 0/6</div>' +
    '<div class="nx-top-r">T <strong id="nx-time">00:00</strong> · SCORE <strong id="nx-score">0</strong></div>';
  root.appendChild(top);
  const objectiveEl = top.querySelector("#nx-objective") as HTMLElement;
  const timeEl = top.querySelector("#nx-time") as HTMLElement;
  const scoreEl = top.querySelector("#nx-score") as HTMLElement;

  const cardsEl = document.createElement("div");
  cardsEl.className = "nx-cards";
  root.appendChild(cardsEl);
  const cards: Array<{
    el: HTMLElement;
    hp: HTMLElement;
    ammo: HTMLElement;
    status: HTMLElement;
  }> = [];
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const card = document.createElement("div");
    card.className = "nx-card";
    card.style.setProperty("--nx-accent", `#${ACCENTS[i].toString(16).padStart(6, "0")}`);
    card.innerHTML =
      `<div class="nx-num">0${i + 1}</div>` +
      '<div class="nx-cardmid"><div class="nx-nameline"><span>OPERATOR</span><span class="nx-status">READY</span></div>' +
      '<div class="nx-hp"><i></i></div></div>' +
      '<div class="nx-stat">AMMO<b class="nx-ammo">12</b><br>HP<b class="nx-hpnum">100</b></div>';
    cardsEl.appendChild(card);
    cards.push({
      el: card,
      hp: card.querySelector(".nx-hp > i") as HTMLElement,
      ammo: card.querySelector(".nx-ammo") as HTMLElement,
      status: card.querySelector(".nx-status") as HTMLElement,
    });
    card.addEventListener("click", () => selectUnit(i, true));
  }

  const actions = document.createElement("div");
  actions.className = "nx-actions";
  const hint = document.createElement("div");
  hint.className = "nx-hint";
  hint.innerHTML =
    "<kbd>1-4</kbd> SELECT · <kbd>TAB</kbd> CYCLE<br>" +
    "LMB MOVE / TARGET · RMB SQUAD<br>" +
    "<kbd>F</kbd> FIRE · <kbd>R</kbd> RELOAD · <kbd>Q/E</kbd> ORBIT<br>" +
    "WHEEL ZOOM · <kbd>TAB</kbd> NEXT OPERATOR";
  actions.appendChild(hint);
  const buttons = document.createElement("div");
  buttons.className = "nx-buttons";
  const fireBtn = document.createElement("button");
  fireBtn.type = "button";
  fireBtn.className = "nx-btn";
  fireBtn.textContent = "FIRE";
  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.className = "nx-btn";
  reloadBtn.textContent = "RELOAD";
  buttons.appendChild(fireBtn);
  buttons.appendChild(reloadBtn);
  actions.appendChild(buttons);
  root.appendChild(actions);

  const reticleEl = document.createElement("div");
  reticleEl.className = "nx-reticle";
  root.appendChild(reticleEl);

  const loading = document.createElement("div");
  loading.className = "nx-loading";
  loading.innerHTML =
    '<div class="nx-kicker">TACTICAL NETWORK // DISTRICT 07</div>' +
    '<div class="nx-heading">INITIALIZING SIMULATION</div>' +
    '<div class="nx-rule"></div>' +
    '<div class="nx-bar"><i id="nx-barfill"></i></div>' +
    '<div class="nx-pct" id="nx-pct">0%</div>' +
    '<div class="nx-loadlines">' +
    '<div><span>LOADING OPERATORS</span><b id="nx-l-op">···</b></div>' +
    '<div><span>LOADING DISTRICT</span><b id="nx-l-env">···</b></div>' +
    '<div><span>LOADING LIGHT</span><b id="nx-l-hdr">···</b></div>' +
    "</div>" +
    '<div class="nx-error" id="nx-error"></div>' +
    '<button type="button" class="nx-btn" id="nx-begin" disabled>BEGIN MISSION</button>';
  root.appendChild(loading);
  const barFill = loading.querySelector("#nx-barfill") as HTMLElement;
  const pctEl = loading.querySelector("#nx-pct") as HTMLElement;
  const lineOp = loading.querySelector("#nx-l-op") as HTMLElement;
  const lineEnv = loading.querySelector("#nx-l-env") as HTMLElement;
  const lineHdr = loading.querySelector("#nx-l-hdr") as HTMLElement;
  const errorEl = loading.querySelector("#nx-error") as HTMLElement;
  const beginBtn = loading.querySelector("#nx-begin") as HTMLButtonElement;

  function popup(text: string) {
    if (!hooks.onPopup) return;
    const now = performance.now();
    if (now - (popupTimes.get(text) ?? -9999) < 900) return;
    popupTimes.set(text, now);
    hooks.onPopup(text);
  }

  // --------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: !mobile,
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.insertBefore(renderer.domElement, style);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080d16);
  scene.fog = new THREE.FogExp2(0x080d16, 0.016);

  const camera = new THREE.PerspectiveCamera(
    50,
    Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
    0.1,
    260,
  );
  let camHeight = 17;
  let camYaw = -0.42;
  let camPitch = 0.82;
  const camBase = new THREE.Vector3();
  const camLook = new THREE.Vector3(SPAWN.x, 1, SPAWN.z);
  camera.position.set(10, 18, 36);
  camera.lookAt(camLook);

  const sun = new THREE.DirectionalLight(0xffd1a0, 1.5);
  sun.position.set(-26, 34, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x8fbfff, 0x141922, 0.45);
  scene.add(hemi);

  // Ground: procedural asphalt only (no procedural architecture).
  const groundTex = ownTex(
    makeCanvasTexture(512, 512, (ctx) => {
      ctx.fillStyle = "#191f27";
      ctx.fillRect(0, 0, 512, 512);
      const img = ctx.getImageData(0, 0, 512, 512);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rng() - 0.5) * 24;
        img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
      }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = "rgba(150,178,196,0.075)";
      ctx.lineWidth = 2;
      for (let p = 0; p <= 512; p += 128) {
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, 512);
        ctx.moveTo(0, p);
        ctx.lineTo(512, p);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(214,194,128,0.11)";
      ctx.lineWidth = 2;
      ctx.setLineDash([20, 26]);
      for (const p of [64, 192, 320, 448]) {
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, 512);
        ctx.moveTo(0, p);
        ctx.lineTo(512, p);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }),
  );
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(2, 2);
  groundTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const ground = new THREE.Mesh(
    ownGeo(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE)),
    ownMat(
      new THREE.MeshStandardMaterial({
        map: groundTex,
        color: 0xffffff,
        roughness: 0.85,
        metalness: 0.06,
      }),
    ),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Faint scorch decals (allowed procedural detail).
  const decalTex = ownTex(makeDecalTexture());
  for (let i = 0; i < 9; i++) {
    const d = new THREE.Mesh(
      ownGeo(new THREE.PlaneGeometry(3 + rng() * 3, 3 + rng() * 3)),
      ownMat(
        new THREE.MeshBasicMaterial({
          map: decalTex,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      ),
    );
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = rng() * Math.PI;
    d.position.set((rng() - 0.5) * 52, 0.012 + i * 0.0004, (rng() - 0.5) * 52);
    scene.add(d);
  }

  // Extraction marker.
  const extractGroup = new THREE.Group();
  extractGroup.position.copy(EXTRACTION);
  scene.add(extractGroup);
  const extractOuter = new THREE.Mesh(
    ownGeo(new THREE.RingGeometry(2.32, 2.48, 64)),
    ownMat(
      new THREE.MeshBasicMaterial({
        color: 0x3c6b72,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  extractOuter.rotation.x = -Math.PI / 2;
  extractOuter.position.y = 0.035;
  extractGroup.add(extractOuter);
  const extractInner = new THREE.Group();
  extractInner.position.y = 0.045;
  extractGroup.add(extractInner);
  const dashMat = ownMat(
    new THREE.MeshBasicMaterial({
      color: 0x4f9fa3,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const dashGeo = ownGeo(new THREE.PlaneGeometry(0.16, 0.62));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.rotation.z = -a;
    dash.position.set(Math.cos(a) * 1.62, 0, Math.sin(a) * 1.62);
    extractInner.add(dash);
  }

  // Right-drag squad destination marker.
  const squadMarker = new THREE.Mesh(
    ownGeo(new THREE.RingGeometry(0.75, 0.86, 32)),
    ownMat(
      new THREE.MeshBasicMaterial({
        color: 0x8fd2cd,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  squadMarker.rotation.x = -Math.PI / 2;
  squadMarker.position.y = 0.05;
  squadMarker.visible = false;
  scene.add(squadMarker);

  // Shared hover bracket.
  const hoverBracket = new THREE.LineSegments(
    ownGeo(makeBracketGeometry(1.25, 0.36)),
    ownMat(new THREE.LineBasicMaterial({ color: 0xff8a6b, transparent: true, opacity: 0.8 })),
  );
  hoverBracket.visible = false;
  scene.add(hoverBracket);

  // ------------------------------------------------------------ pooled FX
  const tracerGeo = ownGeo(new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true));
  const tracers: Tracer[] = [];
  for (let i = 0; i < 56; i++) {
    const material = ownMat(
      new THREE.MeshBasicMaterial({
        color: 0xffd9a8,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(tracerGeo, material);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0, material });
  }
  let tracerCursor = 0;

  const sparkGeoBase = () => new THREE.BufferGeometry();
  const sparks: Spark[] = [];
  for (let i = 0; i < 24; i++) {
    const geo = ownGeo(sparkGeoBase());
    const pos = new Float32Array(14 * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const material = ownMat(
      new THREE.PointsMaterial({
        color: 0xffce8a,
        size: 0.075,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const points = new THREE.Points(geo, material);
    points.visible = false;
    scene.add(points);
    sparks.push({ points, vel: Array.from({ length: 14 }, () => new THREE.Vector3()), life: 0, material });
  }
  let sparkCursor = 0;

  const flashTex = ownTex(makeFlashTexture());
  const flashes: Flash[] = [];
  for (let i = 0; i < 20; i++) {
    const material = ownMat(
      new THREE.SpriteMaterial({
        map: flashTex,
        color: 0xffd2a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(0.55);
    sprite.visible = false;
    scene.add(sprite);
    flashes.push({ sprite, life: 0, material });
  }
  let flashCursor = 0;

  function spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const t = tracers[tracerCursor++ % tracers.length];
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.01) return;
    t.mesh.position.copy(from).addScaledVector(dir, 0.5);
    t.mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    t.mesh.scale.set(1, len, 1);
    t.material.color.setHex(color);
    t.material.opacity = 0.95;
    t.life = 0.12;
    t.mesh.visible = true;
    shake = Math.min(0.35, shake + (from.distanceTo(camera.position) < 18 ? 0.055 : 0.015));
  }

  function spawnSparks(at: THREE.Vector3, color = 0xffce8a) {
    const s = sparks[sparkCursor++ % sparks.length];
    const attr = s.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < s.vel.length; i++) {
      attr.setXYZ(i, at.x, at.y, at.z);
      s.vel[i].set((rng() - 0.5) * 3.4, rng() * 2.6 + 0.4, (rng() - 0.5) * 3.4);
    }
    attr.needsUpdate = true;
    s.material.color.setHex(color);
    s.material.opacity = 1;
    s.life = 0.26;
    s.points.visible = true;
  }

  function spawnFlash(at: THREE.Vector3, enemy: boolean) {
    const f = flashes[flashCursor++ % flashes.length];
    f.sprite.position.copy(at);
    f.sprite.material.color.setHex(enemy ? 0xff8f62 : 0xffd9a8);
    f.material.opacity = 1;
    f.life = 0.09;
    f.sprite.visible = true;
  }

  // ----------------------------------------------------------------- audio
  let actx: AudioContext | null = null;
  let master: GainNode | null = null;

  function ensureAudio() {
    if (actx) {
      if (actx.state === "suspended") void actx.resume();
      return;
    }
    try {
      const ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      actx = new ctor();
      master = actx.createGain();
      master.gain.value = 0.16;
      master.connect(actx.destination);
    } catch {
      actx = null;
      master = null;
    }
  }

  function noise(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType) {
    if (!actx || !master) return;
    const n = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const filter = actx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = actx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  function tone(
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    type: OscillatorType,
    delay = 0,
  ) {
    if (!actx || !master) return;
    const t = actx.currentTime + delay;
    const osc = actx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const gain = actx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  const sfx = {
    rifle() {
      noise(0.055, 1450, 0.9, 0.32, "bandpass");
      tone(115, 55, 0.09, 0.2, "sine");
    },
    enemy() {
      noise(0.085, 520, 0.8, 0.3, "lowpass");
      tone(72, 44, 0.13, 0.22, "sine");
    },
    hit() {
      tone(1500, 820, 0.045, 0.12, "square");
    },
    reload() {
      tone(920, 920, 0.022, 0.14, "square");
      tone(690, 690, 0.022, 0.12, "square", 0.11);
    },
    select() {
      tone(720, 940, 0.065, 0.12, "sine");
    },
    death() {
      tone(220, 48, 0.55, 0.24, "sawtooth");
    },
  };

  // -------------------------------------------------------------- loading
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    const p = total > 0 ? loaded / total : 0;
    barFill.style.width = `${Math.round(p * 100)}%`;
    pctEl.textContent = `${Math.round(p * 100)}%`;
  };
  manager.onError = (url) => console.error(`[NEXUS] Asset request failed: ${url}`);

  const gltfLoader = new GLTFLoader(manager);
  const hdrLoader = new RGBELoader(manager);
  let pmrem: THREE.PMREMGenerator | null = null;
  let envTarget: THREE.WebGLCubeRenderTarget | null = null;
  let hdrTexture: THREE.DataTexture | null = null;

  async function loadGltf(name: string, group: "op" | "env") {
    const url = `${ASSET}/${group === "op" ? "models" : "env"}/${name}.glb`;
    try {
      const gltf = await gltfLoader.loadAsync(url);
      sourceObjects.push(gltf.scene);
      gltfSources.set(name, gltf.scene);
      return gltf;
    } catch (err) {
      console.error(`[NEXUS] Failed to load GLB: ${url}`, err);
      return null;
    }
  }

  async function boot() {
    const soldierP = loadGltf("soldier", "op").then((g) => {
      lineOp.textContent = g ? "OK" : "FAULT";
      return g;
    });
    const robotP = loadGltf("robot", "op");
    const envP = Promise.all(GLB_ENV.map((n) => loadGltf(n, "env"))).then((r) => {
      lineEnv.textContent = r.every(Boolean) ? "OK" : "PARTIAL";
      return r;
    });
    const hdrP = hdrLoader
      .loadAsync(`${ASSET}/hdr/city_sunset.hdr`)
      .then((tex: THREE.DataTexture) => {
        hdrTexture = tex;
        try {
          pmrem = new THREE.PMREMGenerator(renderer);
          pmrem.compileEquirectangularShader();
          envTarget = pmrem.fromEquirectangular(tex);
          scene.environment = envTarget.texture;
          lineHdr.textContent = "OK";
        } catch (err) {
          console.error("[NEXUS] Failed to build environment map", err);
          lineHdr.textContent = "FAULT";
        }
      })
      .catch((err: unknown) => {
        console.error(`[NEXUS] Failed to load HDR: ${ASSET}/hdr/city_sunset.hdr`, err);
        lineHdr.textContent = "FAULT";
      });

    const [soldier, robot, envResults] = await Promise.all([soldierP, robotP, envP, hdrP]);
    if (disposed) return;
    barFill.style.width = "100%";
    pctEl.textContent = "100%";
    if (!soldier || !robot) {
      errorEl.textContent = "CRITICAL ASSET FAULT — SEE CONSOLE";
    }
    buildWorld(
      soldier?.scene ?? null,
      robot?.scene ?? null,
      envResults.map((g) => g?.scene ?? null),
    );
    beginBtn.disabled = false;
    if (!hdrTexture) lineHdr.textContent = "FAULT";
  }

  // ---------------------------------------------------------- world build
  function cloneMaterials(obj: THREE.Object3D): THREE.Material[] {
    const out: THREE.Material[] = [];
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const cloneOne = (m: THREE.Material) => {
        const c = m.clone();
        materials.add(c);
        out.push(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(cloneOne)
        : cloneOne(mesh.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return out;
  }

  function makeActor(model: THREE.Object3D, source: THREE.Group): Actor {
    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of source.animations) {
      actions[clip.name] = mixer.clipAction(clip);
    }
    return { mixer, actions, current: "" };
  }

  function playClip(actor: Actor, name: string, loop = true) {
    if (actor.current === name) return;
    const next = actor.actions[name];
    if (!next) return;
    const prev = actor.actions[actor.current];
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.fadeIn(0.22).play();
    if (prev) prev.fadeOut(0.22);
    actor.current = name;
  }

  function buildWorld(
    soldierSource: THREE.Group | null,
    robotSource: THREE.Group | null,
    envResults: Array<THREE.Group | null>,
  ) {
    // ---- architecture + props from real GLBs
    const boundsCache = new Map<THREE.Object3D, THREE.Box3>();
    const envAt = (i: number) => envResults[i] ?? null;

    function placeEnv(
      source: THREE.Group,
      pos: THREE.Vector3,
      scale: number,
      yaw: number,
      solid: boolean,
      blocksSight: boolean,
    ) {
      let box = boundsCache.get(source);
      if (!box) {
        box = new THREE.Box3().setFromObject(source);
        boundsCache.set(source, box);
      }
      const center = box.getCenter(new THREE.Vector3());
      const wrapper = new THREE.Group();
      const instance = source.clone(true);
      instance.scale.setScalar(scale);
      instance.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      wrapper.add(instance);
      wrapper.position.copy(pos);
      wrapper.rotation.y = yaw;
      wrapper.updateMatrixWorld(true);
      scene.add(wrapper);
      if (solid) {
        const worldBox = new THREE.Box3().setFromObject(wrapper);
        worldBox.min.y = 0;
        solidBoxes.push(worldBox);
      }
      if (blocksSight) {
        wrapper.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) coverMeshes.push(o);
        });
      }
      return wrapper;
    }

    const buildingSlots: Array<[number, number, number, number]> = [
      [-25, -15, 2, 1.45],
      [-12, -17, 1, 1.65],
      [0, -15, 0, 1.75],
      [13, -17, 3, 1.55],
      [25, -9, 2, 1.4],
      [-26, 2, 1, 1.6],
      [-13, 1, 3, 1.5],
      [1, 1, 2, 1.45],
      [14, 2, 0, 1.7],
      [-25, 14, 0, 1.65],
      [-12, 15, 2, 1.4],
      [1, 16, 1, 1.6],
      [14, 15, 3, 1.5],
      [25, 15, 1, 1.45],
    ];
    for (const [x, z, type, scale] of buildingSlots) {
      const src = envAt(type);
      if (!src) continue;
      const jitterX = (rng() - 0.5) * 1.6;
      const jitterZ = (rng() - 0.5) * 1.6;
      const yaw = Math.floor(rng() * 4) * (Math.PI / 2) + (rng() - 0.5) * 0.12;
      placeEnv(src, new THREE.Vector3(x + jitterX, 0, z + jitterZ), scale, yaw, true, true);
    }

    const freeAt = (x: number, z: number, pad: number) => {
      if (Math.abs(x) > WORLD_HALF - 3 || Math.abs(z) > WORLD_HALF - 3) return false;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 6) return false;
      if (Math.hypot(x - EXTRACTION.x, z - EXTRACTION.z) < 6) return false;
      for (const b of solidBoxes) {
        if (
          x > b.min.x - pad &&
          x < b.max.x + pad &&
          z > b.min.z - pad &&
          z < b.max.z + pad
        )
          return false;
      }
      return true;
    };

    // Streetlights first so the few real point lights land on real props.
    const lightAnchors: THREE.Vector3[] = [];
    for (const [x, z] of [
      [-6, -7],
      [7, 8],
      [19, -19],
    ]) {
      const src = envAt(x < 0 ? 4 : 5);
      if (!src) continue;
      const p = new THREE.Vector3(x, 0, z);
      placeEnv(src, p, 1.9, rng() * Math.PI * 2, false, false);
      lightAnchors.push(p);
    }
    for (let i = 0; i < lightAnchors.length; i++) {
      const warm = i === 1;
      const light = new THREE.PointLight(warm ? 0xffc07a : 0x86d9e4, warm ? 15 : 12, 17, 2);
      light.position.copy(lightAnchors[i]).add(new THREE.Vector3(0, 3.1, 0));
      scene.add(light);
    }

    const propIndices = [6, 7, 8, 9, 10, 11, 12, 13];
    let placed = 0;
    for (let attempt = 0; attempt < 260 && placed < 26; attempt++) {
      const idx = propIndices[Math.floor(rng() * propIndices.length)];
      const src = envAt(idx);
      if (!src) break;
      const x = (rng() - 0.5) * 56;
      const z = (rng() - 0.5) * 56;
      if (!freeAt(x, z, 1.6)) continue;
      const isCover = idx === 6 || idx === 7 || idx === 9 || idx === 13;
      placeEnv(
        src,
        new THREE.Vector3(x, 0, z),
        1.1 + rng() * 0.9,
        Math.floor(rng() * 4) * (Math.PI / 2),
        idx === 7 || idx === 9 || idx === 12 || idx === 13,
        isCover,
      );
      placed++;
    }

    scene.updateMatrixWorld(true);

    // ---- operators
    if (soldierSource) {
      const formation: Array<[number, number]> = [
        [-1.6, 1.4],
        [1.6, 1.4],
        [-1.6, -1.4],
        [1.6, -1.4],
      ];
      for (let i = 0; i < OPERATOR_COUNT; i++) {
        const root = new THREE.Group();
        root.position.set(SPAWN.x + formation[i][0], 0, SPAWN.z + formation[i][1]);
        const tilt = new THREE.Group();
        root.add(tilt);
        const model = cloneSkeleton(soldierSource);
        tilt.add(model);
        const materialsForUnit = cloneMaterials(model);
        const actor = makeActor(model, soldierSource);
        playClip(actor, "Idle");

        const color = ACCENTS[i];
        const ring = new THREE.Mesh(
          ownGeo(new THREE.RingGeometry(0.48, 0.6, 32)),
          ownMat(
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.55,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          ),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.025;
        root.add(ring);

        const bracket = new THREE.Group();
        const bracketLine = new THREE.LineSegments(
          ownGeo(makeBracketGeometry(0.82, 0.26)),
          ownMat(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })),
        );
        bracket.add(bracketLine);
        bracket.visible = false;
        root.add(bracket);

        const labelTex = ownTex(
          makeLabelTexture(`0${i + 1}`, `#${color.toString(16).padStart(6, "0")}`),
        );
        const label = new THREE.Sprite(
          ownMat(
            new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false }),
          ),
        );
        label.position.set(0, 2.18, 0);
        label.scale.set(0.62, 0.31, 1);
        root.add(label);

        scene.add(root);
        units.push({
          id: i + 1,
          root,
          tilt,
          model,
          actor,
          ring,
          bracket,
          label,
          accent: color,
          hp: 100,
          ammo: 12,
          fireCd: 0,
          reloadCd: 0,
          moveTarget: null,
          target: null,
          down: false,
          avoidSign: i % 2 === 0 ? 1 : -1,
          avoidTime: 0,
          speed: 0,
          materials: materialsForUnit,
        });
      }
    }

    // ---- hostiles
    if (robotSource) {
      const spawnPoints = [
        [-18, -20],
        [4, -22],
        [19, -18],
        [-19, 4],
        [6, 12],
        [20, 10],
      ];
      const navPoints = [
        new THREE.Vector3(-20, 0, -20),
        new THREE.Vector3(-8, 0, -20),
        new THREE.Vector3(8, 0, -20),
        new THREE.Vector3(20, 0, -20),
        new THREE.Vector3(-20, 0, -7),
        new THREE.Vector3(-7, 0, -6),
        new THREE.Vector3(8, 0, -7),
        new THREE.Vector3(20, 0, -7),
        new THREE.Vector3(-20, 0, 8),
        new THREE.Vector3(-7, 0, 7),
        new THREE.Vector3(8, 0, 8),
        new THREE.Vector3(20, 0, 8),
        new THREE.Vector3(-20, 0, 20),
        new THREE.Vector3(-7, 0, 20),
        new THREE.Vector3(8, 0, 20),
        new THREE.Vector3(20, 0, 20),
      ].filter((p) => freeAt(p.x, p.z, 1.2));

      for (let i = 0; i < HOSTILE_COUNT; i++) {
        const root = new THREE.Group();
        let sx = spawnPoints[i][0];
        let sz = spawnPoints[i][1];
        if (!freeAt(sx, sz, 1.1)) {
          sx += (rng() - 0.5) * 6;
          sz += (rng() - 0.5) * 6;
        }
        root.position.set(sx, 0, sz);
        const model = cloneSkeleton(robotSource);
        model.scale.setScalar(0.41);
        root.add(model);
        const mats = cloneMaterials(model);
        const actor = makeActor(model, robotSource);
        playClip(actor, "Idle");

        const ring = new THREE.Mesh(
          ownGeo(new THREE.RingGeometry(0.6, 0.74, 32)),
          ownMat(
            new THREE.MeshBasicMaterial({
              color: 0xe05a4a,
              transparent: true,
              opacity: 0.5,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          ),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.025;
        root.add(ring);

        scene.add(root);

        const patrol: THREE.Vector3[] = [];
        for (let k = 0; k < 4; k++) {
          const p = navPoints.length
            ? navPoints[Math.floor(rng() * navPoints.length)]
            : new THREE.Vector3((rng() - 0.5) * 40, 0, (rng() - 0.5) * 40);
          patrol.push(p.clone());
        }
        const enemy: Enemy = {
          id: i + 1,
          root,
          model,
          actor,
          ring,
          hp: 100,
          fireCd: 0.6 + rng() * 1.2,
          target: null,
          patrol,
          patrolIndex: 0,
          waitTime: 0,
          dead: false,
          deathTimer: 0,
          avoidSign: i % 2 === 0 ? 1 : -1,
          avoidTime: 0,
          speed: 0,
          materials: mats,
        };
        model.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) enemyByMesh.set(o, enemy);
        });
        enemies.push(enemy);
      }
    }

    updateHud();
  }

  // ----------------------------------------------------------- navigation
  function hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3) {
    if (coverMeshes.length === 0) return true;
    const origin = new THREE.Vector3(from.x, 1.25, from.z);
    const dest = new THREE.Vector3(to.x, 1.1, to.z);
    const delta = new THREE.Vector3().subVectors(dest, origin);
    const dist = delta.length();
    if (dist < 0.001) return true;
    const ray = new THREE.Raycaster(origin, delta.normalize(), 0, dist - 0.45);
    const hits = ray.intersectObjects(coverMeshes, false);
    return hits.length === 0;
  }

  function blockedAt(x: number, z: number, radius: number) {
    for (const b of solidBoxes) {
      if (
        x > b.min.x - radius &&
        x < b.max.x + radius &&
        z > b.min.z - radius &&
        z < b.max.z + radius
      )
        return true;
    }
    return Math.abs(x) > WORLD_HALF - 1.5 || Math.abs(z) > WORLD_HALF - 1.5;
  }

  function steerAround(
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    avoidSign: number,
    avoidTime: number,
    dt: number,
  ): { dir: THREE.Vector3; sign: number; time: number } {
    let sign = avoidSign;
    let time = avoidTime;
    if (time <= 0) {
      const origin = new THREE.Vector3(pos.x, 0.9, pos.z);
      const ray = new THREE.Raycaster(origin, dir, 0, 1.5);
      if (ray.intersectObjects(coverMeshes, false).length > 0) {
        sign = -sign;
        time = 0.55;
      }
    } else {
      time -= dt;
    }
    const out = dir.clone();
    if (time > 0) {
      out.set(-dir.z * sign, 0, dir.x * sign).normalize();
    }
    return { dir: out, sign, time };
  }

  function moveTowards(
    root: THREE.Group,
    target: THREE.Vector3,
    speed: number,
    dt: number,
    agent: { avoidSign: number; avoidTime: number; speed: number },
    arrive: number,
  ) {
    const delta = new THREE.Vector3().subVectors(target, root.position);
    delta.y = 0;
    const dist = delta.length();
    if (dist < arrive) {
      agent.speed = 0;
      return true;
    }
    const dir = delta.normalize();
    const steered = steerAround(root.position, dir, agent.avoidSign, agent.avoidTime, dt);
    agent.avoidSign = steered.sign;
    agent.avoidTime = steered.time;
    const step = Math.min(speed * dt, dist);
    const nx = root.position.x + steered.dir.x * step;
    const nz = root.position.z + steered.dir.z * step;
    const radius = 0.42;
    if (!blockedAt(nx, root.position.z, radius)) root.position.x = nx;
    if (!blockedAt(root.position.x, nz, radius)) root.position.z = nz;
    agent.speed = speed;
    const face = Math.atan2(steered.dir.x, steered.dir.z);
    let diff = face - root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    root.rotation.y += diff * Math.min(1, dt * 9);
    return false;
  }

  // --------------------------------------------------------------- combat
  function bestVisibleTarget(from: Unit): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = from.root.position.distanceTo(e.root.position);
      if (d > 20 || d >= bestDist) continue;
      if (!hasLineOfSight(from.root.position, e.root.position)) continue;
      best = e;
      bestDist = d;
    }
    return best;
  }

  function startReload(u: Unit) {
    if (u.down || u.reloadCd > 0 || u.ammo === 12) return;
    u.reloadCd = 1.8;
    sfx.reload();
    if (u.id === units[selectedIndex]?.id) popup("RELOADING");
  }

  function fireUnit(u: Unit, e: Enemy) {
    if (u.down || u.fireCd > 0 || u.reloadCd > 0) return;
    if (u.ammo <= 0) {
      startReload(u);
      return;
    }
    if (u.root.position.distanceTo(e.root.position) > 20) return;
    if (!hasLineOfSight(u.root.position, e.root.position)) return;

    const yaw = u.root.rotation.y;
    const muzzle = new THREE.Vector3(
      u.root.position.x + Math.sin(yaw) * 0.42,
      1.32,
      u.root.position.z + Math.cos(yaw) * 0.42,
    );
    const hitPoint = e.root.position.clone().add(new THREE.Vector3(0, 1.05, 0));
    u.ammo -= 1;
    u.fireCd = 0.42;
    u.target = e;
    spawnTracer(muzzle, hitPoint, 0xffd9a8);
    spawnFlash(muzzle, false);
    sfx.rifle();
    if (rng() < 0.82) {
      e.hp -= 22 + Math.floor(rng() * 9);
      spawnSparks(hitPoint);
      sfx.hit();
      if (e.hp <= 0) killEnemy(e);
    }
    if (u.ammo === 0) startReload(u);
  }

  function killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    e.target = null;
    e.deathTimer = 0;
    kills += 1;
    playClip(e.actor, "Death", false);
    (e.ring.material as THREE.MeshBasicMaterial).color.setHex(0x6b403b);
    popup("HOSTILE DOWN");
    if (kills >= HOSTILE_COUNT) {
      popup("EXTRACTION OPEN");
      timeScale = 0.4;
      slowTimer = 0.5;
      (extractOuter.material as THREE.MeshBasicMaterial).color.setHex(0x79ffe0);
      (extractOuter.material as THREE.MeshBasicMaterial).opacity = 0.95;
      dashMat.color.setHex(0x79ffe0);
      dashMat.opacity = 0.95;
      objectiveEl.textContent = "REACH EXTRACTION";
      objectiveEl.classList.add("hot");
    }
  }

  function enemyFire(e: Enemy, u: Unit) {
    const yaw = e.root.rotation.y;
    const muzzle = new THREE.Vector3(
      e.root.position.x + Math.sin(yaw) * 0.5,
      1.25,
      e.root.position.z + Math.cos(yaw) * 0.5,
    );
    const dest = u.root.position.clone().add(new THREE.Vector3(0, 1.05, 0));
    e.fireCd = 1.4;
    spawnTracer(muzzle, dest, 0xff8c62);
    spawnFlash(muzzle, true);
    sfx.enemy();
    if (rng() < 0.7) {
      u.hp -= 18 + Math.floor(rng() * 9);
      spawnSparks(dest, 0xff9270);
      sfx.hit();
      if (u.hp <= 0) downUnit(u);
    }
  }

  function downUnit(u: Unit) {
    if (u.down) return;
    u.down = true;
    u.hp = 0;
    u.moveTarget = null;
    u.target = null;
    u.reloadCd = 0;
    u.bracket.visible = false;
    u.label.visible = false;
    (u.ring.material as THREE.MeshBasicMaterial).color.setHex(0x6a4a4a);
    (u.ring.material as THREE.MeshBasicMaterial).opacity = 0.3;
    playClip(u.actor, "Idle");
    for (const m of u.materials) {
      const mm = m as THREE.MeshStandardMaterial;
      if (mm.color) {
        const hsl = { h: 0, s: 0, l: 0 };
        mm.color.getHSL(hsl);
        mm.color.setHSL(hsl.h, hsl.s * 0.18, hsl.l * 0.7);
      }
      mm.needsUpdate = true;
    }
    popup("OPERATOR DOWN");
    sfx.death();
    if (units.every((x) => x.down)) endMission(false);
  }

  // ---------------------------------------------------------- simulation
  function updateUnits(dt: number) {
    for (const u of units) {
      if (u.down) {
        if (u.tilt.rotation.x > -Math.PI / 2 + 0.01) {
          u.tilt.rotation.x = Math.max(-Math.PI / 2, u.tilt.rotation.x - dt * (Math.PI / 2) / 0.7);
          u.root.position.y = -0.02;
        }
        u.actor.mixer.update(dt * 0.25);
        continue;
      }
      u.fireCd = Math.max(0, u.fireCd - dt);
      if (u.reloadCd > 0) {
        u.reloadCd -= dt;
        if (u.reloadCd <= 0) {
          u.reloadCd = 0;
          u.ammo = 12;
        }
      }
      if (u.target && (u.target.dead || u.root.position.distanceTo(u.target.root.position) > 22)) {
        u.target = null;
      }
      if (u.target) {
        const face = Math.atan2(
          u.target.root.position.x - u.root.position.x,
          u.target.root.position.z - u.root.position.z,
        );
        let diff = face - u.root.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        u.root.rotation.y += diff * Math.min(1, dt * 10);
        if (hasLineOfSight(u.root.position, u.target.root.position)) fireUnit(u, u.target);
      }
      if (u.moveTarget) {
        const arrived = moveTowards(u.root, u.moveTarget, 3.2, dt, u, 0.32);
        if (arrived) u.moveTarget = null;
      } else if (!u.target) {
        u.speed = 0;
      }
      const clip = u.speed > 2.5 ? "Run" : u.speed > 0.15 ? "Walk" : "Idle";
      playClip(u.actor, clip);
      u.actor.mixer.update(dt);
      const ringMat = u.ring.material as THREE.MeshBasicMaterial;
      const isSel = u.id === units[selectedIndex]?.id;
      ringMat.opacity = isSel ? 0.95 : 0.5;
      u.bracket.visible = isSel;
      if (isSel) u.bracket.rotation.y += dt * 0.55;
    }
  }

  function updateEnemies(dt: number) {
    for (const e of enemies) {
      if (e.dead) {
        e.deathTimer += dt;
        e.actor.mixer.update(dt);
        if (e.deathTimer > 2) {
          e.root.position.y -= dt * 0.55;
          for (const m of e.materials) {
            const mm = m as THREE.Material & { opacity: number; transparent: boolean };
            mm.transparent = true;
            mm.opacity = Math.max(0, mm.opacity - dt * 0.55);
          }
          (e.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(
            0,
            (e.ring.material as THREE.MeshBasicMaterial).opacity - dt * 0.7,
          );
        }
        continue;
      }
      e.fireCd = Math.max(0, e.fireCd - dt);

      // Detect the closest operator inside the engagement radius with clear LOS.
      let detected: Unit | null = null;
      let bestDist = Infinity;
      for (const u of units) {
        if (u.down) continue;
        const d = e.root.position.distanceTo(u.root.position);
        if (d > 17 || d >= bestDist) continue;
        if (!hasLineOfSight(e.root.position, u.root.position)) continue;
        detected = u;
        bestDist = d;
      }
      e.target = detected;

      if (detected) {
        const face = Math.atan2(
          detected.root.position.x - e.root.position.x,
          detected.root.position.z - e.root.position.z,
        );
        let diff = face - e.root.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        e.root.rotation.y += diff * Math.min(1, dt * 7);
        e.speed = 0;
        playClip(e.actor, "Idle");
        if (e.fireCd <= 0) enemyFire(e, detected);
      } else {
        if (e.waitTime > 0) {
          e.waitTime -= dt;
          e.speed = 0;
          playClip(e.actor, "Idle");
        } else {
          const wp = e.patrol[e.patrolIndex % e.patrol.length];
          if (moveTowards(e.root, wp, 1.9, dt, e, 0.55)) {
            e.patrolIndex += 1;
            e.waitTime = 0.3 + rng() * 0.7;
          }
          playClip(e.actor, e.speed > 0.1 ? "Walking" : "Idle");
        }
      }
      e.actor.mixer.update(dt);
      (e.ring.material as THREE.MeshBasicMaterial).opacity = detected ? 0.8 : 0.45;
    }
  }

  function updateFx(dt: number) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.material.opacity = Math.max(0, t.life / 0.12) * 0.95;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const attr = s.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < s.vel.length; i++) {
        const x = attr.getX(i) + s.vel[i].x * dt;
        const y = attr.getY(i) + s.vel[i].y * dt;
        const z = attr.getZ(i) + s.vel[i].z * dt;
        s.vel[i].y -= 7 * dt;
        attr.setXYZ(i, x, y, z);
      }
      attr.needsUpdate = true;
      s.material.opacity = Math.max(0, s.life / 0.26);
      if (s.life <= 0) s.points.visible = false;
    }
    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.material.opacity = Math.max(0, f.life / 0.09);
      if (f.life <= 0) f.sprite.visible = false;
    }
  }

  function updateExtraction(dt: number) {
    extractInner.rotation.z += dt * 0.55;
    if (kills < HOSTILE_COUNT) {
      (extractOuter.material as THREE.MeshBasicMaterial).opacity = 0.32 + Math.sin(elapsed * 1.2) * 0.07;
      return;
    }
    const pulse = 0.7 + Math.sin(elapsed * 4) * 0.25;
    (extractOuter.material as THREE.MeshBasicMaterial).opacity = pulse;
    dashMat.opacity = 0.55 + Math.sin(elapsed * 4 + 0.8) * 0.3;
    const scale = 1 + Math.sin(elapsed * 2.4) * 0.035;
    extractGroup.scale.set(scale, 1, scale);
    for (const u of units) {
      if (u.down) continue;
      if (u.root.position.distanceTo(EXTRACTION) < 2.45) {
        endMission(true);
        break;
      }
    }
  }

  function updateCamera(dt: number) {
    const center = new THREE.Vector3();
    let n = 0;
    for (const u of units) {
      if (u.down) continue;
      center.add(u.root.position);
      n++;
    }
    if (n === 0) {
      for (const u of units) center.add(u.root.position);
      n = units.length || 1;
    }
    center.divideScalar(n);
    camLook.lerp(center.add(new THREE.Vector3(0, 1.2, 0)), 1 - Math.exp(-3.4 * dt));
    const horizontal = camHeight * (15 / 17);
    const desired = new THREE.Vector3(
      camLook.x + Math.sin(camYaw) * horizontal * Math.cos(camPitch - 0.35),
      camLook.y + camHeight,
      camLook.z + Math.cos(camYaw) * horizontal * Math.cos(camPitch - 0.35),
    );
    camBase.lerp(desired, 1 - Math.exp(-4.2 * dt));
    camera.position.copy(camBase);
    if (shake > 0.001) {
      camera.position.x += (rng() - 0.5) * shake;
      camera.position.y += (rng() - 0.5) * shake * 0.7;
      camera.position.z += (rng() - 0.5) * shake;
      shake *= Math.exp(-9 * dt);
    }
    camera.lookAt(camLook);
    sun.target.position.set(camLook.x, 0, camLook.z);
    sun.position.set(camLook.x - 26, 34, camLook.z + 20);
  }

  function updateHud() {
    timeEl.textContent = formatTime(elapsed);
    scoreEl.textContent = String(kills * 100 + (success ? survivors() * 250 : 0));
    objectiveEl.textContent =
      kills >= HOSTILE_COUNT ? "REACH EXTRACTION" : `ELIMINATE HOSTILES ${kills}/${HOSTILE_COUNT}`;
    if (kills >= HOSTILE_COUNT) objectiveEl.classList.add("hot");
    for (let i = 0; i < cards.length; i++) {
      const u = units[i];
      const c = cards[i];
      if (!u) continue;
      c.el.classList.toggle("sel", i === selectedIndex && !u.down);
      c.el.classList.toggle("down", u.down);
      c.hp.style.width = `${Math.max(0, u.hp)}%`;
      c.ammo.textContent = u.down ? "--" : String(u.ammo).padStart(2, "0");
      const status = u.down
        ? "DOWN"
        : u.reloadCd > 0
          ? "RELOADING"
          : u.moveTarget
            ? "MOVING"
            : "READY";
      c.status.textContent = status;
      const hpNum = c.el.querySelector(".nx-hpnum");
      if (hpNum) hpNum.textContent = String(Math.max(0, Math.round(u.hp)));
    }

    // Reticle tracks the selected operator's current target (or hover).
    const focus = units[selectedIndex]?.target ?? hoveredEnemy;
    if (focus && !focus.dead) {
      const v = focus.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      v.project(camera);
      if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
        const rect = container.getBoundingClientRect();
        reticleEl.style.display = "block";
        reticleEl.style.left = `${((v.x + 1) / 2) * rect.width}px`;
        reticleEl.style.top = `${((-v.y + 1) / 2) * rect.height}px`;
      } else {
        reticleEl.style.display = "none";
      }
    } else {
      reticleEl.style.display = "none";
    }
  }

  function survivors() {
    return units.filter((u) => !u.down).length;
  }

  function endMission(won: boolean) {
    if (ended) return;
    ended = true;
    success = won;
    const final = kills * 100 + (won ? survivors() * 250 : 0);
    hooks.onScore(final);
    hooks.onGameOver(final, [
      { label: "RESULT", value: won ? "SUCCESS" : "FAILED" },
      { label: "KILLS", value: `${kills}/${HOSTILE_COUNT}` },
      { label: "SURVIVORS", value: `${survivors()}/${OPERATOR_COUNT}` },
      { label: "TIME", value: formatTime(elapsed) },
    ]);
    if (won) popup("MISSION COMPLETE");
  }

  // ----------------------------------------------------------------- input
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function setNdc(clientX: number, clientY: number) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    ndc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
  }

  function groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    setNdc(clientX, clientY);
    const out = new THREE.Vector3();
    return raycaster.ray.intersectPlane(GROUND_PLANE, out) ? out : null;
  }

  function pickEnemy(clientX: number, clientY: number): Enemy | null {
    setNdc(clientX, clientY);
    const meshes: THREE.Object3D[] = [];
    for (const e of enemies) {
      if (e.dead) continue;
      e.model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o);
      });
    }
    const hits = raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      const e = enemyByMesh.get(h.object);
      if (e && !e.dead) return e;
    }
    return null;
  }

  function selectUnit(index: number, sound = false) {
    const u = units[index];
    if (!u || u.down) return;
    selectedIndex = index;
    if (sound) sfx.select();
    updateHud();
  }

  function commandPrimary(clientX: number, clientY: number) {
    const u = units[selectedIndex];
    if (!u || u.down) return;
    const e = pickEnemy(clientX, clientY);
    if (e) {
      u.target = e;
      u.moveTarget = null;
      fireUnit(u, e);
    } else {
      const p = groundPoint(clientX, clientY);
      if (!p) return;
      p.x = THREE.MathUtils.clamp(p.x, -WORLD_HALF + 2, WORLD_HALF - 2);
      p.z = THREE.MathUtils.clamp(p.z, -WORLD_HALF + 2, WORLD_HALF - 2);
      u.moveTarget = p;
      u.target = null;
    }
  }

  function commandSquad(clientX: number, clientY: number) {
    const p = groundPoint(clientX, clientY);
    if (!p) return;
    const offsets: Array<[number, number]> = [
      [-1.5, -1.5],
      [1.5, -1.5],
      [-1.5, 1.5],
      [1.5, 1.5],
    ];
    let k = 0;
    for (const u of units) {
      if (u.down) continue;
      const off = offsets[k++ % offsets.length];
      const dest = new THREE.Vector3(
        THREE.MathUtils.clamp(p.x + off[0], -WORLD_HALF + 2, WORLD_HALF - 2),
        0,
        THREE.MathUtils.clamp(p.z + off[1], -WORLD_HALF + 2, WORLD_HALF - 2),
      );
      u.moveTarget = dest;
      u.target = null;
    }
    squadMarker.position.set(p.x, 0.05, p.z);
    squadMarker.visible = true;
    window.setTimeout(() => {
      squadMarker.visible = false;
    }, 650);
  }

  function fireBest() {
    const u = units[selectedIndex];
    if (!u || u.down) return;
    let e = u.target && !u.target.dead ? u.target : null;
    if (!e || !hasLineOfSight(u.root.position, e.root.position)) e = bestVisibleTarget(u);
    if (e) fireUnit(u, e);
    else startReload(u);
  }

  const pointers = new Map<
    number,
    { x: number; y: number; startX: number; startY: number; button: number; type: string; moved: boolean }
  >();
  let pinchDist = 0;
  let lastMidX = 0;
  let lastMidY = 0;

  const onPointerDown = (ev: PointerEvent) => {
    if (!started || ended) return;
    ensureAudio();
    renderer.domElement.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, {
      x: ev.clientX,
      y: ev.clientY,
      startX: ev.clientX,
      startY: ev.clientY,
      button: ev.button,
      type: ev.pointerType,
      moved: false,
    });
    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      lastMidX = (pts[0].x + pts[1].x) / 2;
      lastMidY = (pts[0].y + pts[1].y) / 2;
    }
  };

  const onPointerMove = (ev: PointerEvent) => {
    const p = pointers.get(ev.pointerId);
    if (!p) {
      if (started && !ended && ev.pointerType === "mouse") {
        const hit = pickEnemy(ev.clientX, ev.clientY);
        hoveredEnemy = hit;
        hoverBracket.visible = !!hit;
        if (hit) hoverBracket.position.set(hit.root.position.x, 0, hit.root.position.z);
        renderer.domElement.style.cursor = hit ? "crosshair" : "default";
      }
      return;
    }
    p.x = ev.clientX;
    p.y = ev.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > 8) p.moved = true;

    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchDist > 0 && dist > 0) {
        camHeight = THREE.MathUtils.clamp(camHeight * (pinchDist / dist), 11, 27);
      }
      pinchDist = dist;
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      camYaw -= (mx - lastMidX) * 0.006;
      camPitch = THREE.MathUtils.clamp(camPitch - (my - lastMidY) * 0.004, 0.48, 1.22);
      lastMidX = mx;
      lastMidY = my;
      return;
    }
    if (p.moved && p.button === 2) {
      const gp = groundPoint(p.x, p.y);
      if (gp) {
        squadMarker.position.set(gp.x, 0.05, gp.z);
        squadMarker.visible = true;
      }
    }
  };

  const onPointerUp = (ev: PointerEvent) => {
    const p = pointers.get(ev.pointerId);
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (!p || !started || ended) return;
    if (!p.moved) {
      if (p.button === 2 && p.type === "mouse") commandSquad(p.x, p.y);
      else commandPrimary(p.x, p.y);
    } else if (p.button === 2) {
      commandSquad(p.x, p.y);
    }
  };

  const onPointerCancel = (ev: PointerEvent) => {
    pointers.delete(ev.pointerId);
    pinchDist = 0;
  };

  const onWheel = (ev: WheelEvent) => {
    if (!started) return;
    ev.preventDefault();
    camHeight = THREE.MathUtils.clamp(camHeight + Math.sign(ev.deltaY) * 1.1, 11, 27);
  };

  const onContext = (ev: Event) => ev.preventDefault();

  const keys = new Set<string>();
  const onKeyDown = (ev: KeyboardEvent) => {
    if (!started || ended) return;
    const k = ev.key.toLowerCase();
    if (k === "tab") {
      ev.preventDefault();
      const next = (selectedIndex + (ev.shiftKey ? OPERATOR_COUNT - 1 : 1)) % OPERATOR_COUNT;
      selectUnit(next, true);
      return;
    }
    if (k >= "1" && k <= "4") {
      selectUnit(Number(k) - 1, true);
      return;
    }
    if (k === "f") {
      ensureAudio();
      fireBest();
      return;
    }
    if (k === "r") {
      const u = units[selectedIndex];
      if (u) startReload(u);
      return;
    }
    keys.add(k);
  };
  const onKeyUp = (ev: KeyboardEvent) => keys.delete(ev.key.toLowerCase());
  const onBlur = () => keys.clear();

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerCancel);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("contextmenu", onContext);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  listeners.push(() => {
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("contextmenu", onContext);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  });

  const onFireBtn = () => {
    if (!started || ended) return;
    ensureAudio();
    fireBest();
  };
  const onReloadBtn = () => {
    if (!started || ended) return;
    const u = units[selectedIndex];
    if (u) startReload(u);
  };
  fireBtn.addEventListener("click", onFireBtn);
  reloadBtn.addEventListener("click", onReloadBtn);

  const onBegin = () => {
    if (beginBtn.disabled) return;
    ensureAudio();
    loading.style.display = "none";
    started = true;
    popup("MISSION START");
    sfx.select();
  };
  beginBtn.addEventListener("click", onBegin);

  // ------------------------------------------------------------- composer
  let composer: EffectComposer | null = null;
  if (!mobile) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight)),
        0.22,
        0.45,
        0.9,
      );
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } catch (err) {
      console.error("[NEXUS] Post-processing unavailable, rendering directly", err);
      composer?.dispose();
      composer = null;
    }
  }

  // -------------------------------------------------------------- resize
  let viewW = Math.max(1, container.clientWidth);
  let viewH = Math.max(1, container.clientHeight);
  const onResize = () => {
    viewW = Math.max(1, container.clientWidth);
    viewH = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setSize(viewW, viewH);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
    composer?.setSize(viewW, viewH);
  };
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(onResize);
    observer.observe(container);
  } else {
    window.addEventListener("resize", onResize);
    listeners.push(() => window.removeEventListener("resize", onResize));
  }

  // ---------------------------------------------------------------- loop
  let raf = 0;
  let last = performance.now();
  let hudAccum = 0;

  const frame = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const realDt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;

    if (slowTimer > 0) {
      slowTimer -= realDt;
      if (slowTimer <= 0) timeScale = 1;
    }
    if (keys.has("q")) camYaw -= realDt * 1.25;
    if (keys.has("e")) camYaw += realDt * 1.25;
    camPitch = THREE.MathUtils.clamp(camPitch, 0.48, 1.22);

    const dt = started && !ended ? realDt * timeScale : 0;
    if (started) elapsed += realDt;

    if (dt > 0) {
      updateUnits(dt);
      updateEnemies(dt);
      updateFx(dt);
      updateExtraction(dt);
    } else {
      updateFx(realDt);
    }
    updateCamera(realDt);

    scoreClock += realDt;
    if (scoreClock >= 0.2) {
      scoreClock = 0;
      hooks.onScore(kills * 100 + (success ? survivors() * 250 : 0));
    }
    hudAccum += realDt;
    if (hudAccum >= 0.1) {
      hudAccum = 0;
      updateHud();
    }

    if (composer) composer.render(realDt);
    else renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  void boot();

  // -------------------------------------------------------------- dispose
  function disposeMaterial(m: THREE.Material, texSet: Set<THREE.Texture>) {
    const record = m as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (value && typeof value === "object" && (value as THREE.Texture).isTexture) {
        texSet.add(value as THREE.Texture);
      }
    }
    m.dispose();
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const off of listeners) off();
      observer?.disconnect();
      fireBtn.removeEventListener("click", onFireBtn);
      reloadBtn.removeEventListener("click", onReloadBtn);
      beginBtn.removeEventListener("click", onBegin);

      for (const u of units) {
        u.actor.mixer.stopAllAction();
        u.actor.mixer.uncacheRoot(u.model);
      }
      for (const e of enemies) {
        e.actor.mixer.stopAllAction();
        e.actor.mixer.uncacheRoot(e.model);
      }

      const srcGeos = new Set<THREE.BufferGeometry>();
      const srcMats = new Set<THREE.Material>();
      const srcTex = new Set<THREE.Texture>();
      for (const rootObj of sourceObjects) {
        rootObj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) srcGeos.add(mesh.geometry);
          if (mesh.material) {
            if (Array.isArray(mesh.material)) mesh.material.forEach((m) => srcMats.add(m));
            else srcMats.add(mesh.material);
          }
        });
      }
      for (const g of srcGeos) g.dispose();
      for (const m of srcMats) disposeMaterial(m, srcTex);
      for (const t of srcTex) t.dispose();

      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();

      if (envTarget) envTarget.dispose();
      if (hdrTexture) hdrTexture.dispose();
      if (pmrem) pmrem.dispose();
      scene.environment = null;

      for (const pass of composer?.passes ?? []) pass.dispose();
      composer?.dispose();
      renderer.dispose();
      void actx?.close();

      root.remove();
      style.remove();
      renderer.domElement.remove();
      gltfSources.clear();
    },
  };
}

"use client";

/**
 * NEXUS 2100 — third-person tactical shooter.
 *
 * One directly controlled operator, three autonomous allies, five hostiles.
 * Every character is a SkeletonUtils clone of the real soldier.glb; every
 * building prop comes from the downloaded cyberpunk GLBs. Procedural geometry
 * is limited to the ground plane, FX, ground rings and UI markers.
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

type Team = "player" | "ally" | "hostile";

type Actor = {
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  current: string;
};

type Soldier = {
  id: number;
  team: Team;
  root: THREE.Group;
  model: THREE.Object3D;
  actor: Actor;
  ring: THREE.Mesh;
  marker?: THREE.Sprite;
  hpGroup?: THREE.Group;
  hpFill?: THREE.Sprite;
  hp: number;
  fireCd: number;
  reloadCd: number;
  ammo: number;
  alive: boolean;
  speed: number;
  avoidSign: number;
  avoidTime: number;
  patrol: THREE.Vector3[];
  patrolIndex: number;
  waitTime: number;
  deathTimer: number;
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
const WORLD_HALF = 35;
const STREET_HALF = 6.2;
const HOSTILE_COUNT = 5;
const ALLY_COUNT = 3;
const MAG = 24;
const RELOAD_TIME = 1.7;
const FIRE_INTERVAL = 0.18;
const BULLET_DAMAGE = 34;
const PLAYER_HP = 100;
const RANGE = 45;
const SPAWN = new THREE.Vector3(0, 0, 25);
const EXTRACTION = new THREE.Vector3(0, 0, -29);
const UP = new THREE.Vector3(0, 1, 0);
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const SEEN_KEY = "playverse:nexusSeen";

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

/** Deterministic PRNG so the district is identical on every run. */
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

function readSeen(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeen() {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* storage disabled: tutorial simply repeats */
  }
}

const HUD_CSS = `
.nx-root{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#b9c6d4;
  -webkit-user-select:none;user-select:none;}
.nx-root *{box-sizing:border-box;}
.nx-top{position:absolute;top:0;left:0;right:0;display:grid;
  grid-template-columns:1fr auto 1fr;align-items:start;gap:10px;padding:12px 16px;
  background:linear-gradient(180deg,rgba(4,8,13,.82),transparent);}
.nx-brand{font-size:9px;letter-spacing:.24em;color:#8ea5b5;}
.nx-brand b{font-weight:600;color:#dcebf4;}
.nx-brand span{display:block;margin-top:3px;font-size:8px;color:#5d7384;letter-spacing:.2em;}
.nx-obj{justify-self:center;min-width:220px;padding:6px 14px 5px;text-align:center;
  font-size:10px;letter-spacing:.2em;color:#d2e2ec;
  border:1px solid rgba(116,170,182,.3);border-top:none;
  background:rgba(7,15,22,.66);}
.nx-obj.hot{color:#8ff0dd;border-color:rgba(126,235,211,.55);}
.nx-obj small{display:block;margin-top:3px;font-size:8px;color:#7b95a6;letter-spacing:.16em;}
.nx-clock{text-align:right;font-size:9px;color:#8ea5b5;letter-spacing:.16em;}
.nx-clock strong{color:#dbe8f1;font-weight:500;}
.nx-clock span{display:block;margin-top:4px;font-size:8px;color:#6d8596;}
.nx-bottom{position:absolute;left:16px;bottom:16px;width:234px;padding:9px 11px;
  border:1px solid rgba(126,168,184,.25);border-left:2px solid #63cfc8;
  background:linear-gradient(90deg,rgba(7,15,22,.85),rgba(7,15,22,.55));}
.nx-bottom .nx-lbl{display:flex;justify-content:space-between;font-size:8px;color:#8098a9;}
.nx-hpbar{height:5px;margin:6px 0 9px;background:rgba(255,255,255,.09);overflow:hidden;}
.nx-hpbar>i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#3d8f8c,#85e6d5);
  transition:width .14s linear;}
.nx-hpbar.low>i{background:linear-gradient(90deg,#8c3535,#e0715e);}
.nx-ammo{display:flex;align-items:baseline;justify-content:space-between;font-size:9px;color:#8098a9;}
.nx-ammo b{font-size:20px;letter-spacing:.04em;color:#e3f0f5;font-weight:500;}
.nx-ammo em{font-style:normal;color:#66808f;}
.nx-reticle{position:absolute;left:50%;top:50%;width:26px;height:26px;
  transform:translate(-50%,-50%);opacity:.85;transition:transform .12s,opacity .12s;}
.nx-reticle.ads{transform:translate(-50%,-50%) scale(.55);opacity:1;}
.nx-reticle i{position:absolute;background:#d5e8ec;box-shadow:0 0 3px rgba(0,0,0,.9);}
.nx-reticle i:nth-child(1){left:12px;top:0;width:2px;height:7px;}
.nx-reticle i:nth-child(2){left:12px;bottom:0;width:2px;height:7px;}
.nx-reticle i:nth-child(3){top:12px;left:0;height:2px;width:7px;}
.nx-reticle i:nth-child(4){top:12px;right:0;height:2px;width:7px;}
.nx-reticle i:nth-child(5){left:12px;top:12px;width:2px;height:2px;background:#8ff0dd;}
.nx-hit{position:absolute;left:50%;top:50%;width:20px;height:20px;
  transform:translate(-50%,-50%) rotate(45deg);display:none;pointer-events:none;}
.nx-hit i{position:absolute;background:#f2fafb;}
.nx-hit i:nth-child(1){left:9px;top:0;width:2px;height:20px;}
.nx-hit i:nth-child(2){top:9px;left:0;height:2px;width:20px;}
.nx-hit.kill i{background:#ff6a58;}
.nx-edge{position:absolute;left:50%;top:50%;display:none;pointer-events:none;
  transform:translate(-50%,-50%);text-align:center;white-space:nowrap;}
.nx-edge .nx-arw{display:block;font-size:19px;line-height:1;color:#ff7765;
  text-shadow:0 0 8px rgba(255,80,60,.65);}
.nx-edge .nx-dist{display:block;margin-top:2px;padding:2px 5px;font-size:8px;
  letter-spacing:.14em;color:#ffd0c6;border:1px solid rgba(255,110,90,.42);
  background:rgba(24,6,6,.72);}
.nx-overlay{position:absolute;inset:0;z-index:7;display:flex;align-items:center;
  justify-content:center;padding:20px;background:radial-gradient(ellipse at 50% 40%,rgba(9,17,25,.9),rgba(3,6,11,.96));
  pointer-events:none;text-align:center;}
.nx-panel{width:min(520px,92vw);padding:22px 24px;border:1px solid rgba(122,180,190,.3);
  pointer-events:none;
  background:linear-gradient(180deg,rgba(10,22,30,.94),rgba(6,12,18,.94));
  box-shadow:0 20px 70px rgba(0,0,0,.55);}
.nx-kicker{font-size:9px;letter-spacing:.4em;color:#71909f;}
.nx-title{margin:9px 0 6px;font-size:clamp(16px,3.4vw,25px);letter-spacing:.3em;
  font-weight:600;color:#e4f0f6;}
.nx-rule{height:1px;margin:14px auto;width:100%;
  background:linear-gradient(90deg,transparent,#3d6470,transparent);}
.nx-bar{height:3px;background:rgba(255,255,255,.09);overflow:hidden;}
.nx-bar>i{display:block;height:100%;width:0;background:#67c9c2;transition:width .2s linear;}
.nx-pct{margin-top:8px;font-size:9px;letter-spacing:.22em;color:#90a8b8;}
.nx-loadlines{display:flex;flex-direction:column;gap:5px;margin:14px auto 0;
  width:min(340px,100%);font-size:9px;color:#7b92a2;}
.nx-loadlines>div{display:flex;justify-content:space-between;}
.nx-loadlines b{font-weight:400;color:#67c9c2;}
.nx-error{margin-top:12px;color:#dc8d83;font-size:9px;letter-spacing:.16em;}
.nx-btn{pointer-events:auto;cursor:pointer;margin-top:16px;padding:11px 24px;
  border:1px solid rgba(120,200,200,.5);background:rgba(13,34,40,.85);
  color:#dceef0;font:inherit;letter-spacing:.24em;text-transform:uppercase;
  transition:background .15s,border-color .15s;}
.nx-btn:hover{background:rgba(25,62,68,.92);border-color:#8fe4d8;}
.nx-btn:active{transform:translateY(1px);}
.nx-btn:disabled{opacity:.4;cursor:default;}
.nx-stepnum{font-size:clamp(42px,10vw,68px);line-height:1;letter-spacing:.02em;
  font-weight:600;color:#69d3cb;text-shadow:0 0 26px rgba(70,210,200,.25);}
.nx-stepttl{margin-top:6px;font-size:clamp(15px,3.6vw,22px);letter-spacing:.3em;
  color:#e6f2f7;font-weight:600;}
.nx-steptext{margin:12px auto 0;max-width:430px;font-size:11px;line-height:1.85;
  letter-spacing:.1em;color:#b5c9d5;text-transform:none;}
.nx-keys{margin-top:14px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;}
.nx-keys span{padding:4px 7px;border:1px solid rgba(140,180,195,.28);
  font-size:9px;letter-spacing:.12em;color:#c9dbe4;background:rgba(8,18,26,.6);}
.nx-dots{display:flex;gap:6px;justify-content:center;margin-top:18px;}
.nx-dots i{width:18px;height:2px;background:rgba(255,255,255,.16);}
.nx-dots i.on{background:#6ed8cf;}
.nx-brief{text-align:left;font-size:10px;line-height:2;color:#a9becb;letter-spacing:.12em;}
.nx-brief b{color:#dcecf3;font-weight:500;}
.nx-brief em{font-style:normal;color:#66c9c2;}
.nx-touch{display:none;}
@keyframes nxFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.nx-panel>*{animation:nxFade .22s ease-out both;}
@media (max-width:720px),(pointer:coarse){
  .nx-top{grid-template-columns:1fr auto;padding:8px 10px;gap:6px;}
  .nx-brand{font-size:8px;}
  .nx-brand span{display:none;}
  .nx-obj{grid-column:1/-1;grid-row:2;justify-self:stretch;min-width:0;
    font-size:9px;padding:5px 8px;}
  .nx-obj small{display:inline;margin-left:8px;}
  .nx-clock{font-size:8px;}
  .nx-bottom{left:8px;bottom:8px;width:168px;padding:6px 8px;}
  .nx-ammo b{font-size:16px;}
  .nx-hpbar{margin:4px 0 6px;}
  .nx-panel{padding:16px;}
  .nx-steptext{font-size:10px;line-height:1.7;}
  .nx-touch{display:block;position:absolute;inset:0;pointer-events:none;}
  .nx-stick{position:absolute;left:20px;bottom:92px;width:104px;height:104px;
    border:1px solid rgba(140,190,200,.32);border-radius:50%;pointer-events:auto;
    background:radial-gradient(circle,rgba(30,64,72,.32),rgba(8,18,24,.5));touch-action:none;}
  .nx-knob{position:absolute;left:50%;top:50%;width:42px;height:42px;margin:-21px;
    border:1px solid rgba(140,220,212,.62);border-radius:50%;
    background:rgba(35,92,92,.5);}
  .nx-look{position:absolute;right:0;top:0;width:55%;height:78%;pointer-events:auto;touch-action:none;}
  .nx-lookhint{position:absolute;right:12px;top:44%;font-size:8px;color:#5f7887;
    letter-spacing:.18em;pointer-events:none;}
  .nx-tbtns{position:absolute;right:10px;bottom:10px;display:flex;flex-direction:column;
    gap:7px;align-items:flex-end;pointer-events:none;}
  .nx-tbtn{pointer-events:auto;width:66px;height:38px;padding:0;font-size:9px;
    border:1px solid rgba(120,200,200,.45);background:rgba(10,28,34,.78);
    color:#d9ecef;font:inherit;letter-spacing:.14em;touch-action:none;}
  .nx-tbtn.fire{height:52px;background:rgba(102,38,34,.68);border-color:rgba(255,120,100,.55);}
  .nx-tbtn.on{background:rgba(30,86,88,.9);border-color:#9beee0;}
}
`;

function makeCanvasTexture(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) paint(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelTexture(text: string, color: string) {
  return makeCanvasTexture(256, 96, (ctx) => {
    ctx.clearRect(0, 0, 256, 96);
    ctx.fillStyle = "rgba(4,10,15,.5)";
    ctx.fillRect(62, 12, 132, 54);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(62, 12, 132, 54);
    ctx.fillStyle = color;
    ctx.font = "bold 30px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 40);
    ctx.fillRect(112, 78, 32, 3);
  });
}

function flashTexture() {
  return makeCanvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0, "rgba(255,255,240,1)");
    g.addColorStop(0.28, "rgba(255,212,140,.85)");
    g.addColorStop(1, "rgba(255,160,80,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

function whiteTexture() {
  return makeCanvasTexture(8, 8, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 8, 8);
  });
}

export function createGame(container: HTMLElement, hooks: GameHooks): GameInstance {
  // ------------------------------------------------------------------ state
  const rng = mulberry32(2100);
  const coarse =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  const mobile = coarse || container.clientWidth < 720;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const sourceObjects: THREE.Object3D[] = [];
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
  type Stage = "loading" | "tutorial" | "briefing" | "playing" | "ended";
  let stage: Stage = "loading";
  let ended = false;
  let success = false;
  let elapsed = 0;
  let kills = 0;
  let shots = 0;
  let hits = 0;
  let scoreClock = 0;
  let timeScale = 1;
  let slowTimer = 0;
  let shake = 0;
  let hitTimer = 0;
  let score = 0;

  let tutStep = 0;
  let tutMoved = 0;
  let lastMarkerDist = -1;

  const soldiers: Soldier[] = [];
  const enemies: Soldier[] = [];
  const allies: Soldier[] = [];
  let player: Soldier | null = null;
  const enemyByMesh = new Map<THREE.Object3D, Soldier>();
  const coverMeshes: THREE.Object3D[] = [];
  const solidBoxes: THREE.Box3[] = [];
  const popupTimes = new Map<string, number>();

  let viewW = Math.max(1, container.clientWidth);
  let viewH = Math.max(1, container.clientHeight);

  // Camera state: yaw=PI means facing down the street toward -Z.
  let yaw = Math.PI;
  let pitch = -0.04;
  let ads = false;
  let adsBlend = 0;
  const camForward = new THREE.Vector3(0, 0, -1);
  const camRight = new THREE.Vector3(1, 0, 0);

  const keys = new Set<string>();
  const moveInput = new THREE.Vector2();
  const joy = { active: false, id: -1, x: 0, y: 0 };
  let firing = false;
  let fireCd = 0;
  let lookId = -1;
  let lookX = 0;
  let lookY = 0;
  let mouseDragId = -1;
  let mouseDragX = 0;
  let mouseDragY = 0;

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
    '<div class="nx-brand"><b>NEXUS 2100</b> · DISTRICT 07<span>TACTICAL NETWORK // SECTOR LIVE</span></div>' +
    '<div class="nx-obj" id="nx-obj">HOSTILES 5/5<small>RANGE 45M</small></div>' +
    '<div class="nx-clock">T <strong id="nx-time">00:00</strong><span>SCORE <b id="nx-score">0</b></span></div>';
  root.appendChild(top);
  const objectiveEl = top.querySelector("#nx-obj") as HTMLElement;
  const timeEl = top.querySelector("#nx-time") as HTMLElement;
  const scoreEl = top.querySelector("#nx-score") as HTMLElement;

  const bottom = document.createElement("div");
  bottom.className = "nx-bottom";
  bottom.innerHTML =
    '<div class="nx-lbl"><span>OPERATOR VITALS</span><span class="nx-hpnum">100 / 100</span></div>' +
    '<div class="nx-hpbar"><i></i></div>' +
    '<div class="nx-ammo"><span>AMMO · MK18</span><b class="nx-ammoval">24<em>/24</em></b></div>';
  root.appendChild(bottom);
  const hpBar = bottom.querySelector(".nx-hpbar") as HTMLElement;
  const hpFillEl = bottom.querySelector(".nx-hpbar > i") as HTMLElement;
  const hpNumEl = bottom.querySelector(".nx-hpnum") as HTMLElement;
  const ammoEl = bottom.querySelector(".nx-ammoval") as HTMLElement;

  const reticle = document.createElement("div");
  reticle.className = "nx-reticle";
  reticle.innerHTML = "<i></i><i></i><i></i><i></i><i></i>";
  root.appendChild(reticle);
  const hitmark = document.createElement("div");
  hitmark.className = "nx-hit";
  hitmark.innerHTML = "<i></i><i></i>";
  root.appendChild(hitmark);

  const edge = document.createElement("div");
  edge.className = "nx-edge";
  edge.innerHTML = '<span class="nx-arw">➤</span><span class="nx-dist">HOSTILE 34M</span>';
  root.appendChild(edge);
  const edgeArrow = edge.querySelector(".nx-arw") as HTMLElement;
  const edgeLabel = edge.querySelector(".nx-dist") as HTMLElement;

  // Touch controls (hidden on desktop via CSS).
  const touch = document.createElement("div");
  touch.className = "nx-touch";
  touch.innerHTML =
    '<div class="nx-stick" id="nx-stick"><div class="nx-knob" id="nx-knob"></div></div>' +
    '<div class="nx-look" id="nx-look"></div>' +
    '<div class="nx-lookhint">DRAG TO LOOK</div>' +
    '<div class="nx-tbtns">' +
    '<button type="button" class="nx-tbtn" id="nx-t-reload">RELOAD</button>' +
    '<button type="button" class="nx-tbtn" id="nx-t-ads">ADS</button>' +
    '<button type="button" class="nx-tbtn fire" id="nx-t-fire">FIRE</button>' +
    "</div>";
  root.appendChild(touch);
  const stickEl = touch.querySelector("#nx-stick") as HTMLElement;
  const knobEl = touch.querySelector("#nx-knob") as HTMLElement;
  const lookEl = touch.querySelector("#nx-look") as HTMLElement;
  const tFire = touch.querySelector("#nx-t-fire") as HTMLButtonElement;
  const tAds = touch.querySelector("#nx-t-ads") as HTMLButtonElement;
  const tReload = touch.querySelector("#nx-t-reload") as HTMLButtonElement;

  // Overlay shared by loading / briefing / tutorial.
  const overlay = document.createElement("div");
  overlay.className = "nx-overlay";
  root.appendChild(overlay);

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
  renderer.setSize(viewW, viewH);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.insertBefore(renderer.domElement, style);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1422);
  scene.fog = new THREE.FogExp2(0x0b1422, 0.0135);

  const camera = new THREE.PerspectiveCamera(60, viewW / viewH, 0.08, 220);
  camera.position.set(1.1, 2.4, 29.2);
  camera.lookAt(0, 1.5, 20);

  const sun = new THREE.DirectionalLight(0xffcf9c, 2.2);
  sun.position.set(-24, 32, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0x91bcff, 0x1d2734, 1.15));
  scene.add(new THREE.AmbientLight(0x8ba4bc, 0.35));

  // ------------------------------------------------------------ ground only
  const groundTex = ownTex(
    makeCanvasTexture(512, 512, (ctx) => {
      ctx.fillStyle = "#2a3340";
      ctx.fillRect(0, 0, 512, 512);
      const img = ctx.getImageData(0, 0, 512, 512);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rng() - 0.5) * 22;
        img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
      }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = "rgba(150,178,196,.07)";
      ctx.lineWidth = 2;
      for (let p = 0; p <= 512; p += 128) {
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, 512);
        ctx.moveTo(0, p);
        ctx.lineTo(512, p);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(216,196,132,.13)";
      ctx.lineWidth = 3;
      ctx.setLineDash([26, 34]);
      for (const p of [128, 384]) {
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, 512);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(120,205,210,.055)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 18; i++) {
        const x = rng() * 512;
        const y = rng() * 512;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 40 + rng() * 90, y + (rng() - 0.5) * 12);
        ctx.stroke();
      }
    }),
  );
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(2, 5);
  groundTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const ground = new THREE.Mesh(
    ownGeo(new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2)),
    ownMat(
      new THREE.MeshStandardMaterial({
        map: groundTex,
        roughness: 0.5,
        metalness: 0.12,
      }),
    ),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Street center dashes (ground decal only).
  const dashGeo = ownGeo(new THREE.PlaneGeometry(0.13, 1.5));
  const dashMat = ownMat(
    new THREE.MeshBasicMaterial({
      color: 0xc7b87c,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  for (let z = -32; z <= 32; z += 4) {
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(0, 0.012, z);
    scene.add(d);
  }

  // Extraction pad, dormant until all hostiles are down.
  const extractGroup = new THREE.Group();
  extractGroup.position.copy(EXTRACTION);
  scene.add(extractGroup);
  const extractOuter = new THREE.Mesh(
    ownGeo(new THREE.RingGeometry(2.18, 2.34, 64)),
    ownMat(
      new THREE.MeshBasicMaterial({
        color: 0x3f6d74,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  extractOuter.rotation.x = -Math.PI / 2;
  extractOuter.position.y = 0.04;
  extractGroup.add(extractOuter);
  const extractInner = new THREE.Group();
  extractInner.position.y = 0.05;
  extractGroup.add(extractInner);
  const extractDashMat = ownMat(
    new THREE.MeshBasicMaterial({
      color: 0x4d9ba0,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const extractDashGeo = ownGeo(new THREE.PlaneGeometry(0.15, 0.6));
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const dash = new THREE.Mesh(extractDashGeo, extractDashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.rotation.z = -a;
    dash.position.set(Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55);
    extractInner.add(dash);
  }

  // ------------------------------------------------------------- pooled FX
  const tracerGeo = ownGeo(new THREE.CylinderGeometry(0.015, 0.015, 1, 5, 1, true));
  const tracers: Tracer[] = [];
  for (let i = 0; i < 54; i++) {
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

  const sparks: Spark[] = [];
  for (let i = 0; i < 22; i++) {
    const geo = ownGeo(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
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
    sparks.push({
      points,
      vel: Array.from({ length: 12 }, () => new THREE.Vector3()),
      life: 0,
      material,
    });
  }
  let sparkCursor = 0;

  const flashTex = ownTex(flashTexture());
  const flashes: Flash[] = [];
  for (let i = 0; i < 18; i++) {
    const material = ownMat(
      new THREE.SpriteMaterial({
        map: flashTex,
        color: 0xffd9a8,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(0.62);
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
    t.life = 0.11;
    t.mesh.visible = true;
    shake = Math.min(0.4, shake + 0.035);
  }

  function spawnSparks(at: THREE.Vector3, color = 0xffce8a) {
    const s = sparks[sparkCursor++ % sparks.length];
    const attr = s.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < s.vel.length; i++) {
      attr.setXYZ(i, at.x, at.y, at.z);
      s.vel[i].set((rng() - 0.5) * 3.2, rng() * 2.4 + 0.35, (rng() - 0.5) * 3.2);
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
    f.sprite.material.color.setHex(enemy ? 0xff9270 : 0xffd9a8);
    f.material.opacity = 1;
    f.life = 0.085;
    f.sprite.visible = true;
  }

  function showHit(kill: boolean) {
    hitTimer = 0.15;
    hitmark.classList.toggle("kill", kill);
    hitmark.style.display = "block";
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
      master.gain.value = 0.14;
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

  function tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType, delay = 0) {
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
      noise(0.05, 1500, 0.9, 0.3, "bandpass");
      tone(118, 55, 0.08, 0.18, "sine");
    },
    enemy() {
      noise(0.08, 520, 0.8, 0.26, "lowpass");
      tone(72, 44, 0.12, 0.18, "sine");
    },
    hit() {
      tone(1500, 820, 0.04, 0.11, "square");
    },
    reload() {
      tone(920, 920, 0.02, 0.13, "square");
      tone(690, 690, 0.02, 0.11, "square", 0.11);
    },
    death() {
      tone(220, 46, 0.5, 0.22, "sawtooth");
    },
    ui() {
      tone(760, 960, 0.06, 0.09, "sine");
    },
  };

  // -------------------------------------------------------------- loading UI
  function showLoading() {
    overlay.innerHTML =
      '<div class="nx-panel">' +
      '<div class="nx-kicker">TACTICAL NETWORK // DISTRICT 07</div>' +
      '<div class="nx-title">INITIALIZING SIMULATION</div>' +
      '<div class="nx-rule"></div>' +
      '<div class="nx-bar"><i id="nx-barfill"></i></div>' +
      '<div class="nx-pct" id="nx-pct">0%</div>' +
      '<div class="nx-loadlines">' +
      '<div><span>LOADING OPERATORS</span><b id="nx-l-op">···</b></div>' +
      '<div><span>LOADING DISTRICT</span><b id="nx-l-env">···</b></div>' +
      '<div><span>LOADING LIGHT</span><b id="nx-l-hdr">···</b></div>' +
      "</div>" +
      '<div class="nx-error" id="nx-error"></div>' +
      "</div>";
  }

  function bindBegin(text: string, onBegin: () => void) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nx-btn";
    btn.textContent = text;
    const panel = overlay.querySelector(".nx-panel");
    panel?.appendChild(btn);
    btn.addEventListener("click", () => {
      sfx.ui();
      onBegin();
    });
    listeners.push(() => btn.remove());
  }

  function showBriefing() {
    const lines = mobile
      ? "<div><b>MOVE</b> · <em>LEFT DRAG</em> &nbsp; <b>AIM</b> · <em>RIGHT DRAG</em></div>" +
        "<div><b>FIRE</b> · <em>FIRE BUTTON</em> &nbsp; <b>ADS</b> · <em>ADS BUTTON</em></div>" +
        "<div><b>RELOAD</b> · <em>RELOAD BUTTON</em></div>"
      : "<div><b>MOVE</b> · <em>W A S D</em> &nbsp; <b>SPRINT</b> · <em>SHIFT</em></div>" +
        "<div><b>AIM</b> · <em>MOUSE</em> &nbsp; <b>FIRE</b> · <em>LEFT CLICK</em> &nbsp; <b>ADS</b> · <em>RIGHT CLICK</em></div>" +
        "<div><b>RELOAD</b> · <em>R</em> &nbsp; <b>RELEASE MOUSE</b> · <em>ESC</em></div>";
    overlay.innerHTML =
      '<div class="nx-panel">' +
      '<div class="nx-kicker">FIELD BRIEFING // OPERATION NIGHTFALL</div>' +
      '<div class="nx-title">NEXUS 2100</div>' +
      '<div class="nx-rule"></div>' +
      '<div class="nx-brief">' +
      lines +
      "<div><b>OBJECTIVE</b> · ELIMINATE 5 HOSTILES, THEN REACH EXTRACTION</div>" +
      "</div>" +
      "</div>";
    bindBegin("BEGIN OPERATION", beginOperation);
  }

  function showTutorial() {
    const steps = mobile
      ? [
          {
            num: "01",
            title: "MOVE",
            text: "Drag the LEFT side of the screen to move. Your squad follows you.",
            keys: ["LEFT DRAG", "MOVE"],
          },
          {
            num: "02",
            title: "AIM & FIRE",
            text: "Drag the RIGHT side to aim. Tap FIRE to shoot, ADS to aim down sights.",
            keys: ["RIGHT DRAG", "FIRE", "ADS", "RELOAD"],
          },
          {
            num: "03",
            title: "OBJECTIVE",
            text: "Eliminate 5 hostiles. Red markers show where they are. Then reach extraction.",
            keys: ["5 HOSTILES", "THEN EXTRACTION"],
          },
        ]
      : [
          {
            num: "01",
            title: "MOVE",
            text: "W A S D to move · SHIFT to sprint. Your squad follows you automatically.",
            keys: ["W", "A", "S", "D", "SHIFT"],
          },
          {
            num: "02",
            title: "AIM & FIRE",
            text: "Move mouse to aim · LEFT CLICK to fire · RIGHT CLICK to aim down sights. Click the view to capture the mouse.",
            keys: ["MOUSE", "LMB FIRE", "RMB ADS", "R RELOAD"],
          },
          {
            num: "03",
            title: "OBJECTIVE",
            text: "Eliminate 5 hostiles. Red markers show where they are. Then reach the extraction point.",
            keys: ["5 HOSTILES", "THEN EXTRACTION"],
          },
        ];
    const s = steps[tutStep];
    overlay.innerHTML =
      '<div class="nx-panel">' +
      '<div class="nx-kicker">FIELD TRAINING // STEP ' +
      s.num +
      " OF 03</div>" +
      '<div class="nx-stepnum">' +
      s.num +
      "</div>" +
      '<div class="nx-stepttl">' +
      s.title +
      "</div>" +
      '<div class="nx-rule"></div>' +
      '<div class="nx-steptext">' +
      s.text +
      "</div>" +
      '<div class="nx-keys">' +
      s.keys.map((k) => `<span>${k}</span>`).join("") +
      "</div>" +
      '<div class="nx-dots">' +
      steps.map((_, i) => `<i class="${i <= tutStep ? "on" : ""}"></i>`).join("") +
      "</div>" +
      "</div>";
    if (tutStep === 2) {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      bindBegin("BEGIN OPERATION", beginOperation);
    }
  }

  function beginOperation() {
    if (stage !== "tutorial" && stage !== "briefing") return;
    writeSeen();
    overlay.style.display = "none";
    stage = "playing";
    startedCombat = true;
    elapsed = 0;
    kills = 0;
    shots = 0;
    hits = 0;
    fireCd = 0;
    if (player) {
      player.hp = PLAYER_HP;
      player.ammo = MAG;
      player.reloadCd = 0;
      player.alive = true;
      if (player.marker) player.marker.visible = true;
    }
    for (const a of allies) {
      a.hp = PLAYER_HP;
      a.alive = true;
      a.fireCd = 0.4 + rng() * 0.8;
    }
    for (const e of enemies) {
      e.hp = PLAYER_HP;
      e.alive = true;
      e.fireCd = 0.7 + rng() * 1.1;
      if (e.hpFill) e.hpFill.scale.x = 0.84;
      if (e.hpGroup) e.hpGroup.visible = false;
    }
    updateHud();
  }

  let startedCombat = false;
  showLoading();

  // -------------------------------------------------------------- asset I/O
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    const p = total > 0 ? loaded / total : 0;
    const fill = overlay.querySelector("#nx-barfill") as HTMLElement | null;
    const pct = overlay.querySelector("#nx-pct") as HTMLElement | null;
    if (fill) fill.style.width = `${Math.round(p * 100)}%`;
    if (pct) pct.textContent = `${Math.round(p * 100)}%`;
  };
  manager.onError = (url) => console.error(`[NEXUS] Asset request failed: ${url}`);

  const gltfLoader = new GLTFLoader(manager);
  const hdrLoader = new RGBELoader(manager);
  let pmrem: THREE.PMREMGenerator | null = null;
  let envTarget: THREE.WebGLCubeRenderTarget | null = null;
  let hdrTexture: THREE.DataTexture | null = null;

  async function loadGltf(name: string, kind: "models" | "env") {
    const url = `${ASSET}/${kind}/${name}.glb`;
    try {
      const gltf = await gltfLoader.loadAsync(url);
      sourceObjects.push(gltf.scene);
      return gltf;
    } catch (err) {
      console.error(`[NEXUS] Failed to load GLB: ${url}`, err);
      return null;
    }
  }

  async function boot() {
    const soldierP = loadGltf("soldier", "models").then((g) => {
      const line = overlay.querySelector("#nx-l-op") as HTMLElement | null;
      if (line) line.textContent = g ? "OK" : "FAULT";
      return g;
    });
    const envP = Promise.all(GLB_ENV.map((n) => loadGltf(n, "env"))).then((r) => {
      const line = overlay.querySelector("#nx-l-env") as HTMLElement | null;
      if (line) line.textContent = r.every(Boolean) ? "OK" : "PARTIAL";
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
          const line = overlay.querySelector("#nx-l-hdr") as HTMLElement | null;
          if (line) line.textContent = "OK";
        } catch (err) {
          console.error("[NEXUS] Failed to build environment map", err);
        }
      })
      .catch((err: unknown) => {
        console.error(`[NEXUS] Failed to load HDR: ${ASSET}/hdr/city_sunset.hdr`, err);
      });

    const [soldier, envResults] = await Promise.all([soldierP, envP, hdrP]);
    if (disposed) return;
    const fill = overlay.querySelector("#nx-barfill") as HTMLElement | null;
    const pct = overlay.querySelector("#nx-pct") as HTMLElement | null;
    if (fill) fill.style.width = "100%";
    if (pct) pct.textContent = "100%";
    if (!soldier) {
      const err = overlay.querySelector("#nx-error") as HTMLElement | null;
      if (err) err.textContent = "CRITICAL ASSET FAULT — SEE CONSOLE";
    }
    buildWorld(soldier?.scene ?? null, envResults.map((g) => g?.scene ?? null));
    // overlay, briefing/tutorial için görünür kalmalı — beginOperation gizler
    if (readSeen()) {
      stage = "briefing";
      showBriefing();
    } else {
      stage = "tutorial";
      tutStep = 0;
      tutMoved = 0;
      showTutorial();
    }
    updateHud();
  }

  // ------------------------------------------------------------ world build
  function cloneUnitMaterials(obj: THREE.Object3D): THREE.Material[] {
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

  function tintUnit(mats: THREE.Material[], team: Team) {
    const tint =
      team === "hostile"
        ? new THREE.Color(0x592126)
        : team === "ally"
          ? new THREE.Color(0x8da38d)
          : new THREE.Color(0x63d2d8);
    const glow =
      team === "hostile"
        ? new THREE.Color(0x5a0a0d)
        : team === "ally"
          ? new THREE.Color(0x0b3330)
          : new THREE.Color(0x0e4b52);
    const strength = team === "hostile" ? 0.82 : team === "ally" ? 0.55 : 0.5;
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.color) sm.color.lerp(tint, strength);
      if (sm.emissive) {
        sm.emissive.copy(glow);
        sm.emissiveIntensity = team === "hostile" ? 0.45 : 0.22;
      }
      if (typeof sm.roughness === "number") sm.roughness = team === "player" ? 0.58 : 0.74;
      if (typeof sm.metalness === "number") sm.metalness = 0.15;
      sm.needsUpdate = true;
    }
  }

  function makeActor(model: THREE.Object3D, source: THREE.Group): Actor {
    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of source.animations) actions[clip.name] = mixer.clipAction(clip);
    return { mixer, actions, current: "" };
  }

  function playClip(actor: Actor, name: string) {
    if (actor.current === name) return;
    const next = actor.actions[name];
    if (!next) return;
    const prev = actor.actions[actor.current];
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.enabled = true;
    next.fadeIn(0.22).play();
    if (prev) prev.fadeOut(0.22);
    actor.current = name;
  }

  function buildWorld(soldierSource: THREE.Group | null, envResults: Array<THREE.Group | null>) {
    const boundsCache = new Map<THREE.Object3D, THREE.Box3>();
    const envAt = (i: number) => envResults[i] ?? null;

    function placeEnv(
      source: THREE.Group,
      pos: THREE.Vector3,
      scale: number,
      yawAngle: number,
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
      wrapper.rotation.y = yawAngle;
      scene.add(wrapper);
      wrapper.updateMatrixWorld(true);
      const worldBox = new THREE.Box3().setFromObject(wrapper);
      if (solid) {
        worldBox.min.y = 0;
        solidBoxes.push(worldBox);
      }
      if (blocksSight) {
        wrapper.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) coverMeshes.push(o);
        });
      }
      return { wrapper, worldBox };
    }

    // Two rows of facades forming a real street corridor.
    const roofSpots: Array<{ x: number; z: number; y: number }> = [];
    const zRow = [-29, -21, -13, -5, 3, 11, 19, 27];
    for (const side of [-1, 1]) {
      for (let i = 0; i < zRow.length; i++) {
        if (side === 1 && i === 3) continue; // side alley
        const src = envAt((i + (side < 0 ? 0 : 2)) % 4);
        if (!src) continue;
        const x = side * (9.6 + rng() * 0.9);
        const z = zRow[i] + (rng() - 0.5) * 1.4;
        const scale = 1.8 + rng() * 0.8;
        const yawFace = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        const placed = placeEnv(src, new THREE.Vector3(x, 0, z), scale, yawFace, true, true);
        if (i % 2 === 0) roofSpots.push({ x, z, y: placed.worldBox.max.y });
      }
    }

    // Streetlights on both sidewalks.
    const lampSpots: Array<{ pos: THREE.Vector3; warm: boolean }> = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const src = envAt(i % 2 === 0 ? 4 : 5);
        if (!src) continue;
        const pos = new THREE.Vector3(side * 6.95, 0, -28 + i * 9.2);
        placeEnv(src, pos, 1.25, side < 0 ? 0 : Math.PI, false, false);
        lampSpots.push({ pos, warm: i % 3 === 0 });
      }
    }
    for (let i = 0; i < lampSpots.length; i += 3) {
      const l = lampSpots[i];
      const light = new THREE.PointLight(l.warm ? 0xffbd78 : 0x8edbe6, l.warm ? 14 : 11, 16, 2);
      light.position.copy(l.pos).add(new THREE.Vector3(0, 3.1, 0));
      scene.add(light);
    }

    // Signs mounted on the facades, antennas on the roofs.
    const signSrc = envAt(6);
    for (const side of [-1, 1]) {
      for (const z of [-17, 1, 17]) {
        if (!signSrc) continue;
        placeEnv(
          signSrc,
          new THREE.Vector3(side * 8.05, 2.5 + rng() * 0.8, z),
          0.95 + rng() * 0.35,
          side < 0 ? Math.PI / 2 : -Math.PI / 2,
          false,
          false,
        );
      }
    }
    const antennaSrc = envAt(11);
    for (const spot of roofSpots.slice(0, 6)) {
      if (!antennaSrc) continue;
      placeEnv(
        antennaSrc,
        new THREE.Vector3(spot.x, spot.y + 0.05, spot.z),
        0.85 + rng() * 0.3,
        rng() * Math.PI * 2,
        false,
        false,
      );
    }
    const towerSrc = envAt(8);
    if (towerSrc) placeEnv(towerSrc, new THREE.Vector3(0, 0, -33), 2.1, 0, false, false);

    // Cover: crates, barriers, turrets and AC units in the street.
    const coverSpots: Array<[number, number, number, number]> = [
      [3.1, 16, 7, 2.4],
      [-3.3, 11, 9, 0.85],
      [2.7, 3, 7, 2.2],
      [-3.0, -3, 9, 0.8],
      [3.4, -11, 12, 1.7],
      [-3.2, -16, 7, 2.3],
      [2.0, -23, 13, 1.4],
      [-2.0, 22, 9, 0.8],
    ];
    for (const [x, z, idx, scale] of coverSpots) {
      const src = envAt(idx);
      if (!src) continue;
      placeEnv(src, new THREE.Vector3(x, 0, z), scale, (rng() - 0.5) * 0.5, true, true);
    }
    const railSrc = envAt(10);
    if (railSrc) {
      placeEnv(railSrc, new THREE.Vector3(-5.4, 0, -6), 1.2, Math.PI / 2, true, true);
      placeEnv(railSrc, new THREE.Vector3(5.4, 0, 8), 1.2, Math.PI / 2, true, true);
    }

    function freeAt(x: number, z: number, pad: number) {
      if (Math.abs(x) > STREET_HALF || Math.abs(z) > WORLD_HALF - 3) return false;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 5) return false;
      if (Math.hypot(x - EXTRACTION.x, z - EXTRACTION.z) < 4.5) return false;
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
    }

    const visorGeo = ownGeo(new THREE.BoxGeometry(0.28, 0.055, 0.035));
    const ringGeo = ownGeo(new THREE.RingGeometry(0.5, 0.61, 32));
    const hpTex = ownTex(whiteTexture());

    function makeSoldier(team: Team, id: number, at: THREE.Vector3): Soldier | null {
      if (!soldierSource) return null;
      const root = new THREE.Group();
      root.position.copy(at);
      scene.add(root);
      const model = cloneSkeleton(soldierSource);
      root.add(model);
      const mats = cloneUnitMaterials(model);
      tintUnit(mats, team);
      const actor = makeActor(model, soldierSource);
      playClip(actor, "Idle");

      const accent =
        team === "hostile" ? 0xff5746 : team === "ally" ? 0x62c9bd : 0x8ff3ec;
      const visor = new THREE.Mesh(
        visorGeo,
        ownMat(new THREE.MeshBasicMaterial({ color: accent })),
      );
      visor.position.set(0, 1.63, 0.18);
      model.add(visor);

      const ring = new THREE.Mesh(
        ringGeo,
        ownMat(
          new THREE.MeshBasicMaterial({
            color: team === "hostile" ? 0xd9433b : team === "player" ? 0x8ff3ec : 0x4fb3aa,
            transparent: true,
            opacity: team === "player" ? 0.82 : 0.55,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      root.add(ring);

      let marker: THREE.Sprite | undefined;
      let hpGroup: THREE.Group | undefined;
      let hpFill: THREE.Sprite | undefined;
      if (team === "player") {
        const tex = ownTex(labelTexture("YOU", "#9af6ee"));
        marker = new THREE.Sprite(
          ownMat(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })),
        );
        marker.position.set(0, 2.24, 0);
        marker.scale.set(0.82, 0.31, 1);
        root.add(marker);
      }
      if (team === "hostile") {
        hpGroup = new THREE.Group();
        hpGroup.position.set(0, 2.08, 0);
        hpGroup.visible = false;
        const bg = new THREE.Sprite(
          ownMat(new THREE.SpriteMaterial({ map: hpTex, color: 0x2a1012, depthWrite: false })),
        );
        bg.scale.set(0.94, 0.13, 1);
        hpGroup.add(bg);
        hpFill = new THREE.Sprite(
          ownMat(new THREE.SpriteMaterial({ map: hpTex, color: 0xff5c4c, depthWrite: false })),
        );
        hpFill.scale.set(0.84, 0.075, 1);
        hpFill.position.z = 0.01;
        hpGroup.add(hpFill);
        root.add(hpGroup);
      }

      const unit: Soldier = {
        id,
        team,
        root,
        model,
        actor,
        ring,
        marker,
        hpGroup,
        hpFill,
        hp: PLAYER_HP,
        fireCd: 0,
        reloadCd: 0,
        ammo: team === "player" ? MAG : 12,
        alive: true,
        speed: 0,
        avoidSign: id % 2 === 0 ? 1 : -1,
        avoidTime: 0,
        patrol: [],
        patrolIndex: 0,
        waitTime: 0,
        deathTimer: 0,
        materials: mats,
      };
      if (team === "hostile") {
        model.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) enemyByMesh.set(o, unit);
        });
      }
      soldiers.push(unit);
      return unit;
    }

    // Player + allies.
    player = makeSoldier("player", 0, SPAWN.clone());
    const allyOffsets: Array<[number, number]> = [
      [-1.5, -1.2],
      [1.5, -1.2],
      [0, -2.4],
    ];
    for (let i = 0; i < ALLY_COUNT; i++) {
      const a = makeSoldier(
        "ally",
        i + 1,
        new THREE.Vector3(SPAWN.x + allyOffsets[i][0], 0, SPAWN.z + allyOffsets[i][1]),
      );
      if (a) allies.push(a);
    }

    // Hostiles spread down the corridor so the player must advance.
    const hostileSpots: Array<[number, number]> = [
      [-3.4, 7],
      [3.5, -2],
      [-2.9, -12],
      [3.2, -20],
      [0, -25],
    ];
    for (let i = 0; i < HOSTILE_COUNT; i++) {
      let [x, z] = hostileSpots[i];
      if (!freeAt(x, z, 1.0)) {
        x += (rng() - 0.5) * 2.5;
        z += (rng() - 0.5) * 2.5;
      }
      const e = makeSoldier("hostile", i + 1, new THREE.Vector3(x, 0, z));
      if (!e) continue;
      const patrol: THREE.Vector3[] = [];
      for (let k = 0; k < 4; k++) {
        patrol.push(
          new THREE.Vector3(
            THREE.MathUtils.clamp(x + (rng() - 0.5) * 6, -STREET_HALF + 1, STREET_HALF - 1),
            0,
            THREE.MathUtils.clamp(z + (rng() - 0.5) * 8, -30, 30),
          ),
        );
      }
      e.patrol = patrol;
      e.fireCd = 0.8 + rng() * 1.2;
      enemies.push(e);
    }

    // Shared marker above the closest living hostile.
    const markerCanvas = document.createElement("canvas");
    markerCanvas.width = 256;
    markerCanvas.height = 96;
    const markerCtx = markerCanvas.getContext("2d");
    const markerTex = ownTex(new THREE.CanvasTexture(markerCanvas));
    markerTex.colorSpace = THREE.SRGBColorSpace;
    const nearestMarker = new THREE.Sprite(
      ownMat(new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthWrite: false })),
    );
    nearestMarker.scale.set(0.9, 0.34, 1);
    nearestMarker.visible = false;
    scene.add(nearestMarker);
    const drawNearest = (dist: number) => {
      if (!markerCtx) return;
      const ctx = markerCtx;
      ctx.clearRect(0, 0, 256, 96);
      ctx.fillStyle = "#ff6b58";
      ctx.beginPath();
      ctx.moveTo(128, 4);
      ctx.lineTo(158, 38);
      ctx.lineTo(138, 38);
      ctx.lineTo(138, 62);
      ctx.lineTo(118, 62);
      ctx.lineTo(118, 38);
      ctx.lineTo(98, 38);
      ctx.closePath();
      ctx.fill();
      ctx.font = "bold 26px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(8,4,4,.85)";
      ctx.strokeText(`${Math.round(dist)}M`, 128, 79);
      ctx.fillStyle = "#ffd3ca";
      ctx.fillText(`${Math.round(dist)}M`, 128, 79);
      markerTex.needsUpdate = true;
    };
    markerUpdater = drawNearest;
    nearestSprite = nearestMarker;
    updateHud();
  }

  let markerUpdater: ((dist: number) => void) | null = null;
  let nearestSprite: THREE.Sprite | null = null;

  // ---------------------------------------------------------- navigation
  function hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3) {
    if (coverMeshes.length === 0) return true;
    const origin = new THREE.Vector3(from.x, 1.25, from.z);
    const dest = new THREE.Vector3(to.x, 1.15, to.z);
    const delta = new THREE.Vector3().subVectors(dest, origin);
    const dist = delta.length();
    if (dist < 0.001) return true;
    const ray = new THREE.Raycaster(origin, delta.normalize(), 0, Math.max(0.01, dist - 0.4));
    return ray.intersectObjects(coverMeshes, false).length === 0;
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
    return Math.abs(x) > WORLD_HALF - 1.2 || Math.abs(z) > WORLD_HALF - 1.2;
  }

  function steer(
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    agent: Soldier,
    dt: number,
  ): THREE.Vector3 {
    let sign = agent.avoidSign;
    let time = agent.avoidTime;
    if (time <= 0) {
      const ray = new THREE.Raycaster(new THREE.Vector3(pos.x, 0.9, pos.z), dir, 0, 1.6);
      if (ray.intersectObjects(coverMeshes, false).length > 0) {
        sign = -sign;
        time = 0.6;
      }
    } else {
      time -= dt;
    }
    agent.avoidSign = sign;
    agent.avoidTime = time;
    if (time > 0) return new THREE.Vector3(-dir.z * sign, 0, dir.x * sign).normalize();
    return dir;
  }

  function moveAgent(agent: Soldier, target: THREE.Vector3, speed: number, dt: number, arrive: number) {
    const delta = new THREE.Vector3().subVectors(target, agent.root.position);
    delta.y = 0;
    const dist = delta.length();
    if (dist < arrive) {
      agent.speed = 0;
      return true;
    }
    const dir = delta.normalize();
    const steered = steer(agent.root.position, dir, agent, dt);
    const step = Math.min(speed * dt, dist);
    const nx = agent.root.position.x + steered.x * step;
    const nz = agent.root.position.z + steered.z * step;
    if (!blockedAt(nx, agent.root.position.z, 0.42)) agent.root.position.x = nx;
    if (!blockedAt(agent.root.position.x, nz, 0.42)) agent.root.position.z = nz;
    agent.speed = speed;
    const face = Math.atan2(steered.x, steered.z);
    let diff = face - agent.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    agent.root.rotation.y += diff * Math.min(1, dt * 9);
    return false;
  }

  function faceTarget(agent: Soldier, target: THREE.Vector3, dt: number) {
    const face = Math.atan2(target.x - agent.root.position.x, target.z - agent.root.position.z);
    let diff = face - agent.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    agent.root.rotation.y += diff * Math.min(1, dt * 9);
  }

  function muzzleOf(agent: Soldier) {
    const y = agent.root.rotation.y;
    return new THREE.Vector3(
      agent.root.position.x + Math.sin(y) * 0.42 + Math.cos(y) * 0.16,
      1.34,
      agent.root.position.z + Math.cos(y) * 0.42 - Math.sin(y) * 0.16,
    );
  }

  function chestOf(agent: Soldier) {
    return agent.root.position.clone().add(new THREE.Vector3(0, 1.16, 0));
  }

  // -------------------------------------------------------------- combat
  function currentAimSpread() {
    return (ads ? 0.2 : 0.6) * (Math.PI / 180);
  }

  function playerFire() {
    if (!player || !player.alive || fireCd > 0 || player.reloadCd > 0) return;
    if (player.ammo <= 0) {
      startReload();
      return;
    }
    fireCd = FIRE_INTERVAL;
    player.ammo -= 1;
    shots += 1;
    spawnFlash(muzzleOf(player), false);
    sfx.rifle();
    shake = Math.min(0.4, shake + 0.045);

    const angle = rng() * Math.PI * 2;
    const radius = currentAimSpread() * Math.sqrt(rng());
    const dx = Math.tan(Math.cos(angle) * radius);
    const dy = Math.tan(Math.sin(angle) * radius);
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const ndc = new THREE.Vector2(dx / (tanY * camera.aspect), dy / tanY);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    raycaster.far = RANGE;

    const targets: THREE.Object3D[] = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      e.model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) targets.push(o);
      });
    }
    const allHits = [
      ...raycaster.intersectObjects(targets, false).map((h) => ({ hit: h, enemy: enemyByMesh.get(h.object) })),
      ...raycaster.intersectObjects(coverMeshes, false).map((h) => ({ hit: h, enemy: undefined })),
    ].sort((a, b) => a.hit.distance - b.hit.distance);
    const first = allHits[0];
    const impact = first
      ? first.hit.point.clone()
      : raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, RANGE);
    spawnTracer(muzzleOf(player), impact, 0xffe0b0);
    if (first?.enemy && first.enemy.alive) {
      hits += 1;
      showHit(false);
      spawnSparks(impact);
      sfx.hit();
      damageEnemy(first.enemy, BULLET_DAMAGE);
    } else if (first) {
      spawnSparks(impact, 0xa9b7c2);
    }

    if (stage === "tutorial" && tutStep === 1) {
      tutStep = 2;
      showTutorial();
    }
    if (player.ammo === 0) startReload();
    updateHud();
  }

  function startReload() {
    if (!player || !player.alive || player.reloadCd > 0 || player.ammo === MAG) return;
    player.reloadCd = RELOAD_TIME;
    sfx.reload();
  }

  function damageEnemy(enemy: Soldier, amount: number) {
    if (!enemy.alive) return;
    enemy.hp -= amount;
    if (enemy.hpGroup) enemy.hpGroup.visible = true;
    if (enemy.hpFill) enemy.hpFill.scale.x = 0.84 * Math.max(0, enemy.hp / PLAYER_HP);
    if (enemy.hp > 0) return;
    killEnemy(enemy);
  }

  function killEnemy(enemy: Soldier) {
    if (!enemy.alive) return;
    enemy.alive = false;
    enemy.deathTimer = 0;
    enemy.speed = 0;
    kills += 1;
    playClip(enemy.actor, "Idle");
    (enemy.ring.material as THREE.MeshBasicMaterial).color.setHex(0x5a3532);
    (enemy.ring.material as THREE.MeshBasicMaterial).opacity = 0.3;
    if (enemy.hpGroup) enemy.hpGroup.visible = false;
    showHit(true);
    timeScale = 0.35;
    slowTimer = 0.25;
    shake = Math.min(0.4, shake + 0.14);
    sfx.death();
    const remaining = HOSTILE_COUNT - kills;
    if (remaining > 0) popup(`HOSTILE DOWN · ${remaining} REMAIN`);
    if (remaining === 0) {
      popup("EXTRACTION OPEN");
      (extractOuter.material as THREE.MeshBasicMaterial).color.setHex(0x8fffe9);
      extractDashMat.color.setHex(0x8fffe9);
    }
    updateHud();
  }

  function damageFriendly(unit: Soldier, amount: number) {
    if (!unit.alive) return;
    unit.hp -= amount;
    if (unit.team === "player") {
      shake = Math.min(0.4, shake + 0.11);
      updateHud();
    }
    if (unit.hp > 0) return;
    unit.alive = false;
    unit.hp = 0;
    unit.speed = 0;
    unit.fireCd = 0;
    (unit.ring.material as THREE.MeshBasicMaterial).color.setHex(0x6a4a4a);
    (unit.ring.material as THREE.MeshBasicMaterial).opacity = 0.3;
    if (unit.marker) unit.marker.visible = false;
    for (const m of unit.materials) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.color) sm.color.multiplyScalar(0.45);
    }
    if (unit.team === "player") {
      popup("OPERATOR DOWN");
      endMission(false);
    }
  }

  function nearestHostile(from: THREE.Vector3, maxDist: number) {
    let best: Soldier | null = null;
    let bestDist = maxDist;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = from.distanceTo(e.root.position);
      if (d < bestDist) {
        best = e;
        bestDist = d;
      }
    }
    return { enemy: best, dist: bestDist };
  }

  function allyFire(a: Soldier, target: Soldier) {
    if (a.fireCd > 0 || !a.alive) return;
    a.fireCd = 1.5;
    const from = muzzleOf(a);
    const to = chestOf(target);
    spawnTracer(from, to, 0xbfe9dc);
    spawnFlash(from, false);
    if (rng() < 0.45) {
      spawnSparks(to, 0xbfe9dc);
      damageEnemy(target, 18 + Math.floor(rng() * 7));
    }
  }

  function enemyFire(e: Soldier, target: Soldier) {
    if (e.fireCd > 0 || !e.alive) return;
    e.fireCd = 1.3;
    const from = muzzleOf(e);
    const to = chestOf(target);
    spawnTracer(from, to, 0xff8268);
    spawnFlash(from, true);
    sfx.enemy();
    if (rng() < 0.65) {
      spawnSparks(to, 0xff9270);
      damageFriendly(target, 12 + Math.floor(rng() * 7));
    }
  }

  function endMission(won: boolean) {
    if (ended) return;
    ended = true;
    stage = "ended";
    success = won;
    firing = false;
    if (won) popup("MISSION ACCOMPLISHED");
    const accuracy = shots > 0 ? hits / shots : 0;
    const accuracyBonus = Math.round(accuracy * 300);
    const timeBonus = won ? Math.max(0, 600 - Math.floor(elapsed) * 4) : 0;
    score = kills * 150 + accuracyBonus + timeBonus;
    hooks.onScore(score);
    const alliesAlive = allies.filter((a) => a.alive).length;
    hooks.onGameOver(score, [
      { label: "RESULT", value: won ? "SUCCESS" : "FAILED" },
      { label: "KILLS", value: `${kills}/${HOSTILE_COUNT}` },
      { label: "TIME", value: formatTime(elapsed) },
      { label: "SURVIVORS", value: `${alliesAlive + (player?.alive ? 1 : 0)}/${ALLY_COUNT + 1}` },
    ]);
  }

  // ----------------------------------------------------------- simulation
  function updatePlayer(dt: number) {
    if (!player || !player.alive) return;
    const f = camForward;
    const r = camRight;
    let mx = moveInput.x;
    let mz = moveInput.y;
    if (keys.has("w") || keys.has("arrowup")) mz += 1;
    if (keys.has("s") || keys.has("arrowdown")) mz -= 1;
    if (keys.has("d") || keys.has("arrowright")) mx += 1;
    if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const sprint = keys.has("shift");
    const speed = sprint ? 6.1 : 3.5;
    const dirX = f.x * mz + r.x * mx;
    const dirZ = f.z * mz + r.z * mx;
    const before = player.root.position.clone();
    const nx = before.x + dirX * speed * dt;
    const nz = before.z + dirZ * speed * dt;
    if (!blockedAt(nx, before.z, 0.42)) player.root.position.x = nx;
    if (!blockedAt(player.root.position.x, nz, 0.42)) player.root.position.z = nz;
    const moved = player.root.position.distanceTo(before);
    player.speed = dt > 0 ? moved / dt : 0;
    if (moved > 0.001) {
      faceTarget(player, player.root.position.clone().add(new THREE.Vector3(dirX, 0, dirZ)), dt);
      if (stage === "tutorial" && tutStep === 0) {
        tutMoved += moved;
        if (tutMoved >= 1.2) {
          tutStep = 1;
          showTutorial();
        }
      }
    } else if (len > 0.05) {
      faceTarget(player, player.root.position.clone().add(new THREE.Vector3(dirX, 0, dirZ)), dt);
    }
    playClip(player.actor, player.speed > 4.4 ? "Run" : player.speed > 0.25 ? "Walk" : "Idle");
    player.actor.mixer.update(dt);

    fireCd = Math.max(0, fireCd - dt);
    if (player.reloadCd > 0) {
      player.reloadCd -= dt;
      if (player.reloadCd <= 0) {
        player.reloadCd = 0;
        player.ammo = MAG;
      }
    }
    if (firing && (stage === "playing" || stage === "tutorial")) playerFire();
  }

  function updateAllies(dt: number) {
    for (const a of allies) {
      if (!a.alive) {
        a.deathTimer += dt;
        a.actor.mixer.update(dt * 0.3);
        continue;
      }
      a.fireCd = Math.max(0, a.fireCd - dt);
      const back = new THREE.Vector3(-camForward.x, 0, -camForward.z);
      const side = new THREE.Vector3(camRight.x, 0, camRight.z);
      const offsetIndex = allies.indexOf(a);
      const lateral = offsetIndex === 2 ? 0 : offsetIndex === 0 ? -1.5 : 1.5;
      const behind = offsetIndex === 2 ? 2.6 : 1.4;
      const dest = player
        ? player.root.position
            .clone()
            .addScaledVector(back, behind)
            .addScaledVector(side, lateral)
        : SPAWN.clone();
      const gap = a.root.position.distanceTo(dest);
      if (gap > 0.7) {
        moveAgent(a, dest, gap > 5 ? 6.2 : 4.0, dt, 0.6);
        playClip(a.actor, a.speed > 4.4 ? "Run" : "Walk");
      } else {
        a.speed = 0;
        playClip(a.actor, "Idle");
      }
      const near = nearestHostile(a.root.position, 30);
      if (near.enemy && near.dist < 28 && hasLineOfSight(a.root.position, near.enemy.root.position)) {
        faceTarget(a, near.enemy.root.position, dt);
        if (a.speed < 0.1) allyFire(a, near.enemy);
      }
      a.actor.mixer.update(dt);
    }
  }

  function updateEnemies(dt: number) {
    for (const e of enemies) {
      if (!e.alive) {
        e.deathTimer += dt;
        e.actor.mixer.update(dt);
        if (e.deathTimer > 1.8) {
          e.root.position.y -= dt * 0.5;
          for (const m of e.materials) {
            const mm = m as THREE.Material & { transparent: boolean; opacity: number };
            mm.transparent = true;
            mm.opacity = Math.max(0, mm.opacity - dt * 0.45);
          }
          (e.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(
            0,
            (e.ring.material as THREE.MeshBasicMaterial).opacity - dt * 0.6,
          );
        }
        continue;
      }
      e.fireCd = Math.max(0, e.fireCd - dt);
      const candidates: Soldier[] = [];
      if (player?.alive) candidates.push(player);
      for (const a of allies) if (a.alive) candidates.push(a);
      let target: Soldier | null = null;
      let bestDist = Infinity;
      for (const c of candidates) {
        const d = e.root.position.distanceTo(c.root.position);
        if (d > 30 || d >= bestDist) continue;
        if (!hasLineOfSight(e.root.position, c.root.position)) continue;
        target = c;
        bestDist = d;
      }
      // Keep the player alive long enough to learn the fight.
      if (target && target.team === "player" && candidates.length > 1 && rng() < 0.5) {
        const others = candidates.filter((c) => c !== target);
        target = others[Math.floor(rng() * others.length)];
      }
      if (target) {
        faceTarget(e, target.root.position, dt);
        e.speed = 0;
        playClip(e.actor, "Idle");
        if (e.fireCd <= 0) enemyFire(e, target);
      } else {
        if (player && e.root.position.distanceTo(player.root.position) > 34) {
          moveAgent(e, player.root.position, 2.4, dt, 2);
        } else if (e.waitTime > 0) {
          e.waitTime -= dt;
          e.speed = 0;
        } else {
          const wp = e.patrol[e.patrolIndex % e.patrol.length] ?? e.root.position;
          if (moveAgent(e, wp, 1.6, dt, 0.6)) {
            e.patrolIndex += 1;
            e.waitTime = 0.4 + rng() * 0.8;
          }
        }
        playClip(e.actor, e.speed > 0.1 ? "Walk" : "Idle");
      }
      e.actor.mixer.update(dt);
    }
  }

  function updateFx(dt: number) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.material.opacity = Math.max(0, t.life / 0.11) * 0.95;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const attr = s.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < s.vel.length; i++) {
        attr.setXYZ(
          i,
          attr.getX(i) + s.vel[i].x * dt,
          attr.getY(i) + s.vel[i].y * dt,
          attr.getZ(i) + s.vel[i].z * dt,
        );
        s.vel[i].y -= 7 * dt;
      }
      attr.needsUpdate = true;
      s.material.opacity = Math.max(0, s.life / 0.26);
      if (s.life <= 0) s.points.visible = false;
    }
    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.material.opacity = Math.max(0, f.life / 0.085);
      if (f.life <= 0) f.sprite.visible = false;
    }
    if (hitTimer > 0) {
      hitTimer -= dt;
      if (hitTimer <= 0) hitmark.style.display = "none";
    }
  }

  function updateExtraction(dt: number) {
    extractInner.rotation.y += dt * 0.5;
    if (kills < HOSTILE_COUNT) {
      (extractOuter.material as THREE.MeshBasicMaterial).opacity =
        0.32 + Math.sin(elapsed * 1.3) * 0.06;
      return;
    }
    const pulse = 0.72 + Math.sin(elapsed * 4) * 0.24;
    (extractOuter.material as THREE.MeshBasicMaterial).opacity = pulse;
    extractDashMat.opacity = 0.6 + Math.sin(elapsed * 4 + 0.8) * 0.3;
    const s = 1 + Math.sin(elapsed * 2.4) * 0.035;
    extractGroup.scale.set(s, 1, s);
    if (player?.alive && player.root.position.distanceTo(EXTRACTION) < 2.3) endMission(true);
  }

  function updateCamera(dt: number) {
    if (!player) return;
    camForward.set(Math.sin(yaw), 0, Math.cos(yaw));
    camRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    adsBlend += ((ads ? 1 : 0) - adsBlend) * Math.min(1, dt * 11);
    const shoulder = THREE.MathUtils.lerp(1.1, 0.36, adsBlend);
    const back = THREE.MathUtils.lerp(4.2, 2.25, adsBlend) * Math.max(0.45, Math.cos(pitch));
    const height = THREE.MathUtils.lerp(2.1, 1.86, adsBlend) + pitch * 1.6;
    const head = player.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const desired = player.root.position
      .clone()
      .addScaledVector(camForward, -back)
      .addScaledVector(camRight, shoulder)
      .add(new THREE.Vector3(0, height, 0));

    // Pull in if the camera would clip cover/buildings.
    if (coverMeshes.length) {
      const delta = desired.clone().sub(head);
      const dist = delta.length();
      if (dist > 0.01) {
        const ray = new THREE.Raycaster(head, delta.normalize(), 0, dist);
        const hits = ray.intersectObjects(coverMeshes, false);
        if (hits.length) desired.copy(head).addScaledVector(delta, Math.max(0.4, hits[0].distance - 0.3));
      }
    }
    camera.position.lerp(desired, 1 - Math.exp(-16 * dt));
    if (shake > 0.001) {
      camera.position.x += (rng() - 0.5) * shake;
      camera.position.y += (rng() - 0.5) * shake * 0.7;
      camera.position.z += (rng() - 0.5) * shake;
      shake *= Math.exp(-9 * dt);
    }
    const aimPoint = head
      .clone()
      .addScaledVector(camForward, 7)
      .add(new THREE.Vector3(0, 0.12 + pitch * 5.5, 0));
    camera.lookAt(aimPoint);
    const targetFov = THREE.MathUtils.lerp(60, 45, adsBlend);
    if (Math.abs(camera.fov - targetFov) > 0.02) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    sun.target.position.set(player.root.position.x, 0, player.root.position.z);
    sun.position.set(player.root.position.x - 24, 32, player.root.position.z + 12);
  }

  // ------------------------------------------------------------------- HUD
  function updateMarker() {
    if (!nearestSprite || !markerUpdater) return;
    if (kills >= HOSTILE_COUNT || !player) {
      nearestSprite.visible = false;
      return;
    }
    const near = nearestHostile(player.root.position, Infinity);
    if (!near.enemy) {
      nearestSprite.visible = false;
      return;
    }
    nearestSprite.position.copy(near.enemy.root.position).add(new THREE.Vector3(0, 2.42, 0));
    nearestSprite.visible = true;
    const rounded = Math.round(near.dist);
    if (rounded !== lastMarkerDist) {
      lastMarkerDist = rounded;
      markerUpdater(near.dist);
    }
  }

  function updateEdgeArrow() {
    let target: THREE.Vector3 | null = null;
    let label = "";
    if (kills >= HOSTILE_COUNT) {
      target = EXTRACTION.clone().add(new THREE.Vector3(0, 1.4, 0));
      label = "EXTRACTION";
    } else if (player) {
      const near = nearestHostile(player.root.position, Infinity);
      if (near.enemy) {
        target = near.enemy.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
        label = "HOSTILE";
        const meters = Math.round(near.dist);
        edgeLabel.textContent = `${label} ${meters}M`;
      }
    }
    if (!target) {
      edge.style.display = "none";
      return;
    }
    if (label === "EXTRACTION" && player) {
      edgeLabel.textContent = `${label} ${Math.round(player.root.position.distanceTo(EXTRACTION))}M`;
    }
    const v = target.clone().project(camera);
    const sx = (v.x * 0.5 + 0.5) * viewW;
    const sy = (-v.y * 0.5 + 0.5) * viewH;
    const margin = mobile ? 54 : 62;
    const onScreen = v.z < 1 && sx > margin && sx < viewW - margin && sy > margin && sy < viewH - margin;
    if (onScreen) {
      edge.style.display = "none";
      return;
    }
    let dx = sx - viewW / 2;
    let dy = sy - viewH / 2;
    if (v.z > 1) {
      dx = -dx;
      dy = -dy;
    }
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dy = -1;
    const maxX = viewW / 2 - margin;
    const maxY = viewH / 2 - margin;
    const t = Math.min(maxX / Math.max(0.001, Math.abs(dx)), maxY / Math.max(0.001, Math.abs(dy)));
    edge.style.display = "block";
    edge.style.left = `${viewW / 2 + dx * t}px`;
    edge.style.top = `${viewH / 2 + dy * t}px`;
    edgeArrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }

  function scoreNow() {
    const accuracy = shots > 0 ? hits / shots : 0;
    return kills * 150 + Math.round(accuracy * 300) + (success ? Math.max(0, 600 - Math.floor(elapsed) * 4) : 0);
  }

  function updateHud() {
    timeEl.textContent = formatTime(elapsed);
    scoreEl.textContent = String(ended ? score : scoreNow());
    const alive = HOSTILE_COUNT - kills;
    objectiveEl.classList.toggle("hot", alive === 0);
    if (alive > 0) {
      objectiveEl.innerHTML = `HOSTILES ${alive}/${HOSTILE_COUNT}<small>RANGE ${RANGE}M</small>`;
      const sub = objectiveEl.querySelector("small") as HTMLElement | null;
      if (sub) {
        sub.textContent = player
          ? `NEAREST ${Math.round(nearestHostile(player.root.position, Infinity).dist)}M`
          : `RANGE ${RANGE}M`;
      }
    } else {
      objectiveEl.innerHTML = `EXTRACTION OPEN<small>REACH THE PAD</small>`;
      if (player) {
        (objectiveEl.querySelector("small") as HTMLElement).textContent =
          `PAD ${Math.round(player.root.position.distanceTo(EXTRACTION))}M`;
      }
    }
    if (player) {
      const hp = Math.max(0, Math.round(player.hp));
      hpNumEl.textContent = `${hp} / ${PLAYER_HP}`;
      hpFillEl.style.width = `${Math.max(0, player.hp)}%`;
      hpBar.classList.toggle("low", player.hp < 35);
      ammoEl.innerHTML = `${String(player.ammo).padStart(2, "0")}<em>/${MAG}</em>`;
    }
    reticle.classList.toggle("ads", adsBlend > 0.55);
  }

  // ----------------------------------------------------------------- input
  const canvas = renderer.domElement;
  let documentedLock = false;

  function requestLock() {
    // Eğitim sırasında kilitlenirse alttaki butonlara tıklanamaz
    if (mobile || documentedLock || stage === "tutorial" || stage === "briefing") return;
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof (p as Promise<void>).catch === "function") {
        void (p as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* drag fallback remains available */
    }
  }

  function interactive() {
    return (stage === "playing" || stage === "tutorial") && !ended;
  }

  function applyLook(dx: number, dy: number) {
    yaw -= dx * 0.0022;
    pitch = THREE.MathUtils.clamp(pitch - dy * 0.0019, -0.3, 0.55);
  }

  function onPointerDown(ev: PointerEvent) {
    if (!interactive()) return;
    ensureAudio();
    if (stage === "tutorial" && tutStep === 1 && ev.button === 0) {
      tutStep = 2;
      showTutorial();
    }
    if (ev.pointerType === "mouse") {
      requestLock();
      if (ev.button === 0) {
        firing = true;
        mouseDragId = ev.pointerId;
        mouseDragX = ev.clientX;
        mouseDragY = ev.clientY;
      }
      if (ev.button === 2) ads = true;
      return;
    }
    canvas.setPointerCapture(ev.pointerId);
    if (ev.clientX < viewW * 0.45) {
      joy.active = true;
      joy.id = ev.pointerId;
      joy.x = ev.clientX;
      joy.y = ev.clientY;
    } else {
      lookId = ev.pointerId;
      lookX = ev.clientX;
      lookY = ev.clientY;
    }
  }

  function onPointerMove(ev: PointerEvent) {
    if (!interactive()) return;
    if (ev.pointerType === "mouse" && ev.pointerId === mouseDragId) {
      if (document.pointerLockElement !== canvas) {
        applyLook(ev.clientX - mouseDragX, ev.clientY - mouseDragY);
      }
      mouseDragX = ev.clientX;
      mouseDragY = ev.clientY;
      return;
    }
    if (ev.pointerId === joy.id && joy.active) {
      const rect = stickEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = ev.clientX - cx;
      let dy = ev.clientY - cy;
      const max = rect.width * 0.42;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      moveInput.set(dx / max, -dy / max);
      knobEl.style.transform = `translate(${dx}px,${dy}px)`;
      return;
    }
    if (ev.pointerId === lookId) {
      applyLook(ev.clientX - lookX, ev.clientY - lookY);
      lookX = ev.clientX;
      lookY = ev.clientY;
    }
  }

  function releasePointer(ev: PointerEvent) {
    if (ev.pointerId === mouseDragId) {
      mouseDragId = -1;
      if (ev.button === 0) firing = false;
      if (ev.button === 2) ads = false;
    }
    if (ev.pointerId === joy.id) {
      joy.active = false;
      joy.id = -1;
      moveInput.set(0, 0);
      knobEl.style.transform = "";
    }
    if (ev.pointerId === lookId) lookId = -1;
  }

  function onMouseMove(ev: MouseEvent) {
    if (!interactive()) return;
    if (document.pointerLockElement === canvas) {
      documentedLock = true;
      applyLook(ev.movementX || 0, ev.movementY || 0);
    }
  }

  function onMouseUp(ev: MouseEvent) {
    if (ev.button === 0) firing = false;
    if (ev.button === 2) ads = false;
  }

  function onLockChange() {
    documentedLock = document.pointerLockElement === canvas;
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (stage === "loading" || stage === "ended") return;
    const k = ev.key.toLowerCase();
    if (k === "r") {
      startReload();
      return;
    }
    if (["w", "a", "s", "d", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      ev.preventDefault();
    }
    // Eğitim adımı hareket mesafesine değil tuşa bakar — düşük FPS'te de ilerler
    if (
      stage === "tutorial" &&
      tutStep === 0 &&
      ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)
    ) {
      tutStep = 1;
      showTutorial();
    }
    keys.add(k);
  }

  function onKeyUp(ev: KeyboardEvent) {
    keys.delete(ev.key.toLowerCase());
  }

  function onBlur() {
    keys.clear();
    firing = false;
    ads = false;
  }

  function onContext(ev: Event) {
    ev.preventDefault();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("contextmenu", onContext);
  document.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  document.addEventListener("pointerlockchange", onLockChange);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  listeners.push(() => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", releasePointer);
    canvas.removeEventListener("pointercancel", releasePointer);
    canvas.removeEventListener("contextmenu", onContext);
    document.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("pointerlockchange", onLockChange);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  });

  const onFireDown = (ev: PointerEvent) => {
    ev.preventDefault();
    ensureAudio();
    if (stage === "tutorial" && tutStep === 1) {
      tutStep = 2;
      showTutorial();
    }
    firing = true;
  };
  const onFireUp = () => {
    firing = false;
  };
  const onAdsDown = (ev: PointerEvent) => {
    ev.preventDefault();
    ads = !ads;
    tAds.classList.toggle("on", ads);
  };
  const onReload = (ev: PointerEvent) => {
    ev.preventDefault();
    startReload();
  };
  tFire.addEventListener("pointerdown", onFireDown);
  tFire.addEventListener("pointerup", onFireUp);
  tFire.addEventListener("pointercancel", onFireUp);
  tAds.addEventListener("pointerdown", onAdsDown);
  tReload.addEventListener("pointerdown", onReload);
  listeners.push(() => {
    tFire.removeEventListener("pointerdown", onFireDown);
    tFire.removeEventListener("pointerup", onFireUp);
    tFire.removeEventListener("pointercancel", onFireUp);
    tAds.removeEventListener("pointerdown", onAdsDown);
    tReload.removeEventListener("pointerdown", onReload);
  });

  // ------------------------------------------------------------- composer
  let composer: EffectComposer | null = null;
  if (!mobile) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(
        new UnrealBloomPass(new THREE.Vector2(viewW, viewH), 0.2, 0.5, 0.92),
      );
      composer.addPass(new OutputPass());
    } catch (err) {
      console.error("[NEXUS] Post-processing unavailable, rendering directly", err);
      composer?.dispose();
      composer = null;
    }
  }

  // --------------------------------------------------------------- resize
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
    const canSim = stage === "playing" || stage === "tutorial";
    const dt = canSim ? realDt * timeScale : 0;
    if (stage === "playing") elapsed += realDt;

    if (dt > 0) {
      updateCamera(realDt);
      updatePlayer(dt);
      if (startedCombat) updateAllies(dt);
      if (startedCombat) updateEnemies(dt);
      if (startedCombat) updateExtraction(dt);
    } else {
      updateCamera(realDt);
    }
    updateFx(realDt);
    updateMarker();
    updateEdgeArrow();

    scoreClock += realDt;
    if (scoreClock >= 0.2) {
      scoreClock = 0;
      hooks.onScore(ended ? score : scoreNow());
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
      if (document.pointerLockElement === canvas) {
        try {
          document.exitPointerLock();
        } catch {
          /* ignore */
        }
      }

      for (const s of soldiers) {
        s.actor.mixer.stopAllAction();
        s.actor.mixer.uncacheRoot(s.model);
      }

      const srcGeos = new Set<THREE.BufferGeometry>();
      const srcMats = new Set<THREE.Material>();
      const srcTex = new Set<THREE.Texture>();
      for (const obj of sourceObjects) {
        obj.traverse((o) => {
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
      canvas.remove();
      enemyByMesh.clear();
      popupTimes.clear();
      sourceObjects.length = 0;
      soldiers.length = 0;
      enemies.length = 0;
      allies.length = 0;
      coverMeshes.length = 0;
      solidBoxes.length = 0;
    },
  };
}

"use client";

/**
 * FREEFALL: wingsuit dive through District 07.
 *
 * Step off the Spire, thread the rings, skim the towers for proximity points and pull the chute as late
 * as you dare. The course is generated from a seed (daily seed = UTC date) so everybody flies the same
 * dive; your best run per seed is stored as a ghost.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { createAudio } from "./nexus-lib/audio";
import { esc } from "./nexus-lib/hud";
import { GradeShader } from "./nexus-lib/grade";
import { softDot } from "./nexus-lib/textures";
import { courseHash, dailySeed, generateCourse, type Course } from "./freefall-lib/course";
import { chuteNeed, deployChute, frameOf, newFlight, stepCanopy, stepWing, type Flight, type FlightInput, type Frame } from "./freefall-lib/flight";
import { createWorld, type World } from "./freefall-lib/world";
import { createFlyer, type Flyer, type FlyerPose } from "./freefall-lib/flyer";
import { buildFfHud } from "./freefall-lib/hud";
import { createSfx } from "./freefall-lib/sfx";

type RunStat = { label: string; value: string };
type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number, stats: RunStat[], opts?: { ownScreen?: boolean }) => void;
  best?: number;
};
type GameInstance = { dispose: () => void };
type Mode = "daily" | "practice";
type Stage = "loading" | "menu" | "countdown" | "flying" | "landed" | "crashed" | "paused" | "results";

type GhostData = { score: number; time: number; dt: number; pts: number[]; ringT: number[] };
type Breakdown = { rings: number; perfect: number; prox: number; speed: number; near: number; chute: number; landing: number; time: number };

const ASSET = "/assets";
const KMH = 3.6;
const SETTINGS_KEY = "playverse:freefall:settings";
const SEEN_KEY = "playverse:freefall:seen";
const BEST_KEY = "playverse:freefall:best";
const GHOST_KEY = "playverse:freefall:ghost:";
const GHOST_INDEX = "playverse:freefall:ghosts";
const BODY_R = 0.9;
const PAR_TIME = 80;

function store<T extends object>(key: string, fallback: T): T {
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
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmtT = (t: number) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
};
const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Radial blur toward screen centre, scaled by speed. */
const SpeedBlurShader = {
  name: "FfSpeedBlur",
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uAmt: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt; varying vec2 vUv;
    void main(){
      vec2 c = vec2(0.5, 0.5); vec2 d = vUv - c; float r = length(d);
      vec4 acc = vec4(0.0); float w = 0.0;
      for (int i = 0; i < 8; i++) { float k = float(i) / 7.0; float s = 1.0 - k * uAmt * smoothstep(0.1, 0.7, r);
        float wi = 1.0 - k * 0.6; acc += texture2D(tDiffuse, c + d * s) * wi; w += wi; }
      gl_FragColor = acc / w;
    }`,
};

export function createGame(container: HTMLElement, hooks: GameHooks): GameInstance {
  const fx = Math.random;
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const mobile = coarse || container.clientWidth < 720;

  const listeners: Array<() => void> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = (el: EventTarget, type: string, fn: (ev: any) => void, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };
  const settings = store(SETTINGS_KEY, { vol: 0.8, muted: false, music: 0.55, sens: 1, invert: false });
  const bests = store<Record<string, number>>(BEST_KEY, {});
  let firstRun = true;
  try {
    firstRun = localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    /* ignore */
  }

  let stage: Stage = "loading";
  let pausedFrom: Stage = "flying";
  let disposed = false;
  let mode: Mode = "daily";
  let seed = dailySeed();
  let menuTime = 0;
  let simBoost = 1;
  let autopilot: null | { chuteMargin: number; skill: number; noChute?: boolean } = null;

  let viewW = Math.max(1, container.clientWidth);
  let viewH = Math.max(1, container.clientHeight);

  // --------------------------------------------------------------- HUD / audio
  const hud = buildFfHud(container, mobile);
  const prevBodyOverflow = document.body.style.overflow;
  const prevOverscroll = document.documentElement.style.overscrollBehavior;
  if (mobile) {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
  }
  const audio = createAudio();
  audio.setVolume(settings.muted ? 0 : settings.vol);
  audio.setMusicVolume(settings.music);
  const sfx = createSfx();
  sfx.setVolume(settings.vol);
  sfx.setMuted(settings.muted);

  // ----------------------------------------------------------- renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: mobile, powerPreference: "high-performance" });
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(viewW, viewH);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.info.autoReset = false;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  container.insertBefore(renderer.domElement, hud.style);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(0x2a1840, 0.0003);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(70, viewW / viewH, 0.2, 14000);
  scene.add(camera);
  const hemi = new THREE.HemisphereLight(0x6a5ad0, 0x120a24, 0.55);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xaec0ff, 0.9);
  moon.position.set(-300, 420, -260);
  scene.add(moon);
  const rim = new THREE.DirectionalLight(0xff6fb5, 0.3);
  rim.position.set(300, 100, 260);
  scene.add(rim);
  const dotTex = softDot();

  // --------------------------------------------------------------- assets
  const manager = new THREE.LoadingManager();
  let soldier: THREE.Group | null = null;
  let soldierClips: THREE.AnimationClip[] = [];
  let envRT: THREE.WebGLRenderTarget | null = null;
  let pmrem: THREE.PMREMGenerator | null = null;
  const srcObjs: THREE.Object3D[] = [];

  // --------------------------------------------------------------- run state
  let course: Course;
  let world: World;
  let flyer: Flyer;
  let ghostFlyer: Flyer | null = null;
  let ghost: GhostData | null = null;
  let ghostFor = -1;

  const fl: { s: Flight } = { s: newFlight(0, 0, 0, 0) };
  const frame: Frame = { f: [0, 0, -1], n: [0, 1, 0], r: [1, 0, 0], vhat: [0, 0, -1], speed: 1 };
  let runT = 0; // seconds since jump
  let countT = 0;
  let nextRing = 0;
  let ringsHit = 0;
  let streak = 0;
  let bestStreak = 0;
  let maxSpeed = 0;
  let chuteAgl = -1;
  let chuteSpeed = 0;
  let proxT = 0;
  let proxMult = 1;
  let proxBank = 0;
  let proxGrace = 0;
  let lastNear: unknown = null;
  let nearCool = 0;
  let nearMisses = 0;
  let pts: Breakdown = { rings: 0, perfect: 0, prox: 0, speed: 0, near: 0, chute: 0, landing: 0, time: 0 };
  let hits = 0;
  let nearestHint = 0;
  let jumped = false;
  let jumpGrace = 0;
  let outT = 0;
  let stallBeep = 0;
  let wantChute = false;
  let camMode: 0 | 1 = 0;
  let endT = 0;
  let outcome: "landed" | "crashed" = "landed";
  let crashWhy = "";
  let landDist = -1;
  let landNote = "";
  let shake = 0;
  let damage = 0;
  let fade = 0;
  let poseFly = 0;
  let poseHang = 0;
  const standQ = new THREE.Quaternion();
  const flightQ = new THREE.Quaternion();
  let rec: number[] = [];
  let recT = 0;
  let ringT: number[] = [];
  let newBest = false;
  let hintStep = firstRun ? 0 : 99;
  let hintT = 0;
  let bannerT = 0;
  let deltaT = 0;
  let proxPtsShown = 0;
  let scoreSent = 0;
  let sentT = 0;
  const crash = { p: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3(), q: new THREE.Quaternion(), grounded: false };

  const liveScore = () => pts.rings + pts.perfect + pts.prox + pts.speed + pts.near;

  // --------------------------------------------------------------- input
  const keys = new Set<string>();
  const stick = { x: 0, y: 0 }; // keyboard virtual stick (x roll, y pitch +flare)
  const mouse = { x: 0, y: 0, locked: false };
  const touchSt = { id: -1, ox: 0, oy: 0, x: 0, y: 0, boost: false, brake: false, t0: 0, moved: false };
  const touchIds = new Map<number, { x: number; y: number; t: number }>();
  let lastPadChute = false;

  function readInput(dt: number): FlightInput {
    const kx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    const ky = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
    const rate = (cur: number, tgt: number, up: number, down: number) => {
      const r = tgt === 0 ? down : up;
      const d = tgt - cur;
      return cur + Math.sign(d) * Math.min(Math.abs(d), r * dt);
    };
    stick.x = rate(stick.x, kx, 4.2, 6);
    stick.y = rate(stick.y, ky, 3.4, 5);
    // mouse stick decays toward centre
    mouse.x *= Math.exp(-dt * 1.2);
    mouse.y *= Math.exp(-dt * 1.2);
    let roll = stick.x + mouse.x;
    let pitch = stick.y + mouse.y;
    let boost = keys.has("shift") || keys.has("e");
    let brake = keys.has("x") || keys.has("control") || keys.has("b");
    const pad = navigator.getGamepads?.()[0] ?? null;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > 0.1) roll += ax;
      if (Math.abs(ay) > 0.1) pitch += settings.invert ? -ay : ay;
      if ((pad.buttons[7]?.value ?? 0) > 0.3 || pad.buttons[5]?.pressed) boost = true;
      if ((pad.buttons[6]?.value ?? 0) > 0.3 || pad.buttons[4]?.pressed) brake = true;
      const c = !!pad.buttons[0]?.pressed;
      if (c && !lastPadChute) wantChute = true;
      lastPadChute = c;
    }
    if (touchSt.id >= 0) {
      roll += touchSt.x;
      pitch += touchSt.y;
    }
    if (touchSt.boost) boost = true;
    if (touchSt.brake) brake = true;
    return { roll: clamp(roll, -1, 1), pitch: clamp(pitch, -1, 1), boost, brake };
  }

  // --------------------------------------------------------------- course / world lifecycle
  function ghostLoad(sd: number): GhostData | null {
    try {
      const raw = localStorage.getItem(GHOST_KEY + sd);
      return raw ? (JSON.parse(raw) as GhostData) : null;
    } catch {
      return null;
    }
  }
  function ghostSave(sd: number, g: GhostData) {
    try {
      localStorage.setItem(GHOST_KEY + sd, JSON.stringify(g));
      const idx: number[] = JSON.parse(localStorage.getItem(GHOST_INDEX) ?? "[]");
      const next = [sd, ...idx.filter((x) => x !== sd)];
      for (const old of next.slice(5)) localStorage.removeItem(GHOST_KEY + old);
      localStorage.setItem(GHOST_INDEX, JSON.stringify(next.slice(0, 5)));
    } catch {
      /* quota */
    }
  }

  let worldSeed = -1;
  function buildRun(sd: number) {
    if (worldSeed !== sd || !world) {
      if (world) {
        flyer.dispose();
        ghostFlyer?.dispose();
        ghostFlyer = null;
        ghostFor = -1;
        world.dispose();
      }
      course = generateCourse(sd);
      world = createWorld(scene, course, { mobile });
      flyer = createFlyer(scene, world.res, soldier, soldierClips, { color: 0x38bdf8, mobile, dot: dotTex });
      worldSeed = sd;
    }
    seed = sd;
    ghost = ghostLoad(sd);
    if (ghostFlyer && ghostFor !== sd) {
      ghostFlyer.dispose();
      ghostFlyer = null;
    }
    if (ghost && !ghostFlyer) {
      ghostFlyer = createFlyer(scene, world.res, soldier, soldierClips, { color: 0x7fe9ff, ghost: true, mobile, dot: dotTex });
      ghostFor = sd;
    }
    if (ghostFlyer) ghostFlyer.root.visible = false;
  }

  /** Orientation for a given (forward, up) pair; model axes: X = left, Y = head/forward, Z = chest (down). */
  const bm = new THREE.Matrix4();
  const vF = new THREE.Vector3();
  const vN = new THREE.Vector3();
  const vL = new THREE.Vector3();
  function basisQ(out: THREE.Quaternion, f: ArrayLike<number>, n: ArrayLike<number>) {
    // the soldier model: +X = right, +Y = head, chest faces -Z  →  X = right (f × n), Y = f, Z = n
    vF.set(f[0], f[1], f[2]);
    vN.set(n[0], n[1], n[2]);
    vL.crossVectors(vF, vN);
    bm.makeBasis(vL, vF, vN);
    out.setFromRotationMatrix(bm);
  }

  const start = {
    p: new THREE.Vector3(),
  };

  function prepareRun() {
    buildRun(seed);
    const st = course.start;
    start.p.set(st.x, st.y + flyer.height / 2 + 0.03, st.z);
    fl.s = newFlight(start.p.x, start.p.y, start.p.z, st.psi);
    fl.s.fuel = 55;
    runT = 0;
    nextRing = 0;
    ringsHit = 0;
    streak = 0;
    bestStreak = 0;
    maxSpeed = 0;
    chuteAgl = -1;
    chuteSpeed = 0;
    proxT = 0;
    proxMult = 1;
    proxBank = 0;
    proxGrace = 0;
    lastNear = null;
    nearMisses = 0;
    pts = { rings: 0, perfect: 0, prox: 0, speed: 0, near: 0, chute: 0, landing: 0, time: 0 };
    hits = 0;
    nearestHint = 0;
    jumped = false;
    jumpGrace = 0;
    outT = 0;
    wantChute = false;
    endT = 0;
    damage = 0;
    fade = 0;
    shake = 0;
    poseFly = 0;
    poseHang = 0;
    rec = [];
    recT = 0;
    ringT = [];
    newBest = false;
    scoreSent = 0;
    landDist = -1;
    landNote = "";
    stick.x = stick.y = 0;
    mouse.x = mouse.y = 0;
    world.resetRings();
    world.setActiveChunk(0);
    flyer.root.visible = true;
    flyer.setCanopy(0, 0);
    flyer.resetTrails();
    ghostFlyer?.resetTrails();
    // standing orientation on the ledge, facing out
    const f0 = [Math.sin(st.psi), 0, -Math.cos(st.psi)];
    basisQ(standQ, [0, 1, 0], [-f0[0], 0, -f0[2]]); // head up, chest (−n) facing out (+f0)
    flyer.root.position.copy(start.p);
    flyer.root.quaternion.copy(standQ);
    camInit = true;
    hud.seed.textContent = mode === "daily" ? `DAILY ${seedLabel(seed)}` : `PRACTICE #${seed % 100000}`;
    hud.ringK.textContent = `RING 0/${course.rings.length}`;
    hud.best.textContent = bests[String(seed)] ? fmtN(bests[String(seed)]) : "—";
    hud.root.classList.remove("boosting", "stall");
  }
  const seedLabel = (s: number) => {
    const y = Math.floor(s / 10000);
    const m = Math.floor(s / 100) % 100;
    const d = s % 100;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };

  // --------------------------------------------------------------- feed / banners
  function feed(html: string, cls = "") {
    const d = document.createElement("div");
    d.className = cls;
    d.innerHTML = html;
    hud.feed.prepend(d);
    while (hud.feed.children.length > 5) hud.feed.lastElementChild?.remove();
    setTimeout(() => {
      d.style.opacity = "0";
      setTimeout(() => d.remove(), 450);
    }, 2600);
  }
  function banner(t: string, s: string, alert = false) {
    hud.banner.className = "nx-banner on" + (alert ? " alert" : "");
    (hud.banner.querySelector(".k") as HTMLElement).textContent = alert ? "◆ WARNING" : "◆ FREEFALL";
    (hud.banner.querySelector(".t") as HTMLElement).textContent = t;
    (hud.banner.querySelector(".s") as HTMLElement).textContent = s;
    bannerT = 2.4;
  }
  function medal(name: string, sub: string) {
    hud.medal.innerHTML = `<i>★</i><div><b>${esc(name)}</b><span>${esc(sub)}</span></div>`;
    hud.medal.classList.remove("on");
    void hud.medal.offsetWidth;
    hud.medal.classList.add("on");
    audio.medal();
  }

  // --------------------------------------------------------------- game flow
  let lastCount = 4;
  function startCountdown() {
    prepareRun();
    stage = "countdown";
    countT = 3.6;
    lastCount = 4;
    hud.root.dataset.mode = "play";
    hud.overlay.className = "nx-ov";
    hud.overlay.innerHTML = "";
    audio.ensure();
    sfx.ensure();
    audio.startAmbient();
    hooks.onScore(0);
    flyer.pose({ fly: 0, hang: 0, dive: 0, flare: 0, bank: 0, flap: 0 }, 0.016, 0);
  }

  function jump() {
    jumped = true;
    stage = "flying";
    jumpGrace = 1.4;
    sfx.jump();
    sfx.windStart();
    const f0 = [Math.sin(course.start.psi), 0, -Math.cos(course.start.psi)];
    fl.s.vx = f0[0] * 17;
    fl.s.vz = f0[2] * 17;
    fl.s.vy = 3.5;
    hud.hint.classList.remove("on");
  }

  function addScore(k: keyof Breakdown, v: number) {
    pts[k] += v;
  }
  const streakMult = () => 1 + Math.min(streak, 10) * 0.25;

  function passRing(i: number, lateral: number) {
    const r = course.rings[i];
    const perfect = lateral < r.r * 0.33;
    streak++;
    bestStreak = Math.max(bestStreak, streak);
    ringsHit++;
    const m = streakMult();
    const base = Math.round(200 * m);
    addScore("rings", base);
    let fuelGain = 16;
    if (perfect) {
      addScore("perfect", Math.round(120 * m));
      fuelGain = 26;
    }
    fl.s.fuel = Math.min(100, fl.s.fuel + fuelGain);
    sfx.ring(perfect, streak);
    feed(`${perfect ? "PERFECT RING" : "RING"} <u>+${fmtN(base + (perfect ? Math.round(120 * m) : 0))}</u> · ×${m.toFixed(2)}`, perfect ? "hs" : "");
    ringT[i] = runT;
    if (streak === 5 || streak === 10 || streak === 20) medal(`${streak} RING STREAK`, `MULTIPLIER ×${m.toFixed(2)}`);
    if (ghost && ghost.ringT[i] !== undefined && (i % 3 === 2 || i === course.rings.length - 1)) {
      const d = runT - ghost.ringT[i];
      hud.delta.textContent = `${d <= 0 ? "−" : "+"}${Math.abs(d).toFixed(2)}`;
      hud.delta.className = `ff-delta on ${d <= 0 ? "good" : "bad"}`;
      deltaT = 1.8;
      sfx.split(d <= 0);
    }
    world.setRing(i, "done");
  }
  function missRing(i: number) {
    streak = 0;
    sfx.miss();
    feed("RING MISSED", "bad");
    world.setRing(i, "miss");
    ringT[i] = runT;
  }

  function finishRun(kind: "landed" | "crashed", why = "") {
    if (stage === "landed" || stage === "crashed") return;
    outcome = kind;
    crashWhy = why;
    stage = kind;
    endT = 0;
    sfx.windStop();
    hud.hint.classList.remove("on");
    hud.chuteHint.classList.remove("on");
    hintStep = Math.max(hintStep, 4);
    if (kind === "landed") {
      const p = fl.s;
      const agl = chuteAgl;
      sfx.land(true);
      audio.musicStinger(true);
      // late-pull bonus: how little altitude you left yourself
      if (agl >= 0) addScore("chute", Math.round(2600 * clamp(1 - (agl - 30) / 260, 0, 1)));
      // accuracy
      const d = Math.hypot(p.px - course.pad.x, p.pz - course.pad.z);
      landDist = d;
      if (d <= course.pad.r) {
        const acc = 1 - d / course.pad.r;
        addScore("landing", Math.round(3000 * Math.pow(acc, 0.8)) + (d < 5 ? 1500 : 0));
        landNote = d < 5 ? "BULLSEYE" : "ON THE PAD";
      } else landNote = "OFF THE PAD";
      addScore("time", Math.round(Math.max(0, PAR_TIME - runT) * 60));
      banner("TOUCHDOWN", `${landNote} · ${d.toFixed(0)} M FROM CENTRE`, false);
      shake = 0.3;
      hud.warn.classList.remove("on");
    } else {
      sfx.crash(1);
      audio.musicStinger(false);
      damage = 1;
      shake = 1;
      const p = fl.s;
      crash.p.set(p.px, p.py, p.pz);
      crash.v.set(p.vx * 0.35, Math.max(2, p.vy * 0.2 + 6), p.vz * 0.35);
      crash.w.set((fx() - 0.5) * 14, (fx() - 0.5) * 14, (fx() - 0.5) * 14);
      crash.q.copy(flyer.root.quaternion);
      crash.grounded = false;
      banner("IMPACT", why, true);
      burst(p.px, p.py, p.pz, 70, 18);
      hud.warn.classList.remove("on");
    }
    updateHud(0.05, true);
  }

  function finalize() {
    stage = "results";
    fade = 0;
    damage = 0;
    audio.engineStop?.();
    const crashed = outcome === "crashed";
    const raw = liveScore() + pts.chute + pts.landing + pts.time;
    const total = crashed ? Math.round(liveScore() * 0.5) : Math.round(raw);
    const key = String(seed);
    const prevBest = bests[key] ?? 0;
    newBest = total > prevBest;
    if (newBest) {
      bests[key] = total;
      const keysList = Object.keys(bests);
      if (keysList.length > 60) delete bests[keysList[0]];
      save(BEST_KEY, bests);
    }
    if (!crashed && (!ghost || total > ghost.score)) {
      ghostSave(seed, { score: total, time: runT, dt: 0.05, pts: rec, ringT });
    }
    hooks.onScore(total);
    hooks.onGameOver(
      total,
      [
        { label: "Result", value: crashed ? "CRASH" : "LANDED" },
        { label: "Rings", value: `${ringsHit}/${course.rings.length}` },
        { label: "Time", value: fmtT(runT) },
        { label: "Seed", value: mode === "daily" ? "DAILY" : `#${seed % 100000}` },
      ],
      { ownScreen: true },
    );
    showResults(total, crashed, prevBest);
  }

  // --------------------------------------------------------------- sparks / particles
  const SPK = 160;
  const sparkPos = new Float32Array(SPK * 3);
  const sparkVel = new Float32Array(SPK * 3);
  const sparkLife = new Float32Array(SPK);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.35, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparkPts = new THREE.Points(sparkGeo, sparkMat);
  sparkPts.frustumCulled = false;
  scene.add(sparkPts);
  let sparkI = 0;
  function burst(x: number, y: number, z: number, n: number, speed: number) {
    for (let k = 0; k < n; k++) {
      const i = sparkI++ % SPK;
      sparkPos.set([x, y, z], i * 3);
      const a = fx() * Math.PI * 2;
      const b = fx() * 2 - 1;
      const s = speed * (0.3 + fx());
      sparkVel.set([Math.cos(a) * Math.sqrt(1 - b * b) * s, b * s * 0.8 + 4, Math.sin(a) * Math.sqrt(1 - b * b) * s], i * 3);
      sparkLife[i] = 0.5 + fx() * 0.8;
    }
  }
  function updateSparks(dt: number) {
    for (let i = 0; i < SPK; i++) {
      if (sparkLife[i] <= 0) {
        sparkPos[i * 3 + 1] = -9999;
        continue;
      }
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 18 * dt;
      for (let a = 0; a < 3; a++) sparkPos[i * 3 + a] += sparkVel[i * 3 + a] * dt;
    }
    (sparkGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  // wind / rain streaks: world-anchored cells wrapped around the camera, stretched along the airflow
  const STREAK = mobile ? 320 : 700;
  const stPos = new Float32Array(STREAK * 6);
  const stSeed = new Float32Array(STREAK * 3);
  for (let i = 0; i < STREAK; i++) stSeed.set([fx() * 2 - 1, fx() * 2 - 1, fx() * 2 - 1], i * 3);
  const stGeo = new THREE.BufferGeometry();
  stGeo.setAttribute("position", new THREE.BufferAttribute(stPos, 3));
  const stMat = new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const streaks = new THREE.LineSegments(stGeo, stMat);
  streaks.frustumCulled = false;
  scene.add(streaks);
  const vel = new THREE.Vector3();
  function updateStreaks(speed: number) {
    const c = camera.position;
    const S = 26;
    const len = clamp(speed * 0.022, 0.4, 3.4);
    const dx = -vel.x / Math.max(1, speed);
    const dy = -vel.y / Math.max(1, speed);
    const dz = -vel.z / Math.max(1, speed);
    for (let i = 0; i < STREAK; i++) {
      const x = c.x + ((((stSeed[i * 3] * S - c.x) % (2 * S)) + 3 * S) % (2 * S)) - S;
      const y = c.y + ((((stSeed[i * 3 + 1] * S - c.y) % (2 * S)) + 3 * S) % (2 * S)) - S;
      const z = c.z + ((((stSeed[i * 3 + 2] * S - c.z) % (2 * S)) + 3 * S) % (2 * S)) - S;
      stPos.set([x, y, z, x - dx * len, y - dy * len, z - dz * len], i * 6);
    }
    (stGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    stMat.opacity = clamp((speed - 28) / 60, 0, 0.5);
  }

  // --------------------------------------------------------------- bot
  const botTarget = new THREE.Vector3();
  function botInput(): FlightInput {
    const s = fl.s;
    const o = autopilot!;
    const ringI = nextRing;
    if (s.chute > 0) {
      // under canopy: fly toward the pad, trimming forward speed to arrive as we touch down
      const dx = course.pad.x - s.px;
      const dz = course.pad.z - s.pz;
      const hd = Math.hypot(dx, dz);
      const want = Math.atan2(dx, -dz);
      const e = wrapPi(want - s.hdg);
      const tLeft = Math.max(0.5, (s.py - 1) / 8.4);
      const fwd = hd / tLeft;
      return { roll: clamp(e * 2, -1, 1), pitch: hd < 4 ? 1 : clamp((11 - fwd) / 6, -1, 1), boost: false, brake: false };
    }
    if (ringI < course.rings.length) {
      const r = course.rings[ringI];
      botTarget.set(r.x, r.y, r.z);
    } else {
      // final approach: aim at a point above the pad, a bit short of it
      const hdp = Math.hypot(course.pad.x - s.px, course.pad.z - s.pz);
      botTarget.set(course.pad.x, Math.min(60, hdp * 0.5), course.pad.z);
    }
    const dx = botTarget.x - s.px;
    const dy = botTarget.y - s.py;
    const dz = botTarget.z - s.pz;
    const hd = Math.hypot(dx, dz);
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    const hs = Math.hypot(s.vx, s.vz);
    const psiT = Math.atan2(dx, -dz);
    const psiV = hs > 2 ? Math.atan2(s.vx, -s.vz) : s.psi;
    const e = wrapPi(psiT - psiV);
    const roll = clamp(e * (2.2 + 4 / (1 + hd * 0.02)) * o.skill, -1, 1);
    const gT = Math.atan2(dy, Math.max(8, hd));
    const gV = Math.atan2(s.vy, Math.max(1, hs));
    let pitch = 0.1 + (gT - gV) * 3.2 + Math.abs(s.bank) * 0.5;
    if (sp < 36) pitch = Math.min(pitch, -0.25);
    if (sp > 92) pitch += 0.5;
    // a gentle slow-down for the pad approach
    const agl = s.py;
    if (ringI >= course.rings.length && agl < 320 && sp > 50) pitch += 0.4;
    return { roll, pitch: clamp(pitch, -1, 1), boost: sp < 42 && s.fuel > 30 && gT > gV, brake: false };
  }
  function botChute() {
    const s = fl.s;
    if (s.chute > 0 || autopilot!.noChute) return false;
    const need = chuteNeed(s.vy);
    const hdp = Math.hypot(course.pad.x - s.px, course.pad.z - s.pz);
    // pull late, but early enough that the canopy can still glide onto the pad (≈1.5:1 with brakes)
    const reach = nextRing >= course.rings.length && hdp < s.py * 1.15 + 4 && s.py < 110;
    return s.py < need + autopilot!.chuteMargin || reach;
  }

  // --------------------------------------------------------------- simulation step
  let hudAcc = 0;
  function simulate(dt: number) {
    const s = fl.s;
    const input = autopilot ? botInput() : readInput(dt);
    if (autopilot ? botChute() : false) wantChute = true;
    if (wantChute) {
      wantChute = false;
      if (deployChute(s)) {
        chuteAgl = s.py;
        chuteSpeed = Math.hypot(s.vx, s.vy, s.vz);
        sfx.chute();
        shake = Math.max(shake, 0.5);
        feed(`CHUTE · <u>${Math.round(s.py)} M</u> AGL`, "hs");
      }
    }
    if (s.chute > 0) stepCanopy(s, input, dt);
    else stepWing(s, input, dt);
    frameOf(s, frame);
    runT += dt;
    jumpGrace = Math.max(0, jumpGrace - dt);
    const sp = frame.speed;
    maxSpeed = Math.max(maxSpeed, sp);
    // boost / brake sfx edges
    if (s.boosting && !boostWas) {
      sfx.boost();
      shake = Math.max(shake, 0.25);
    }
    boostWas = s.boosting;
    if (s.brakeAmt > 0.6 && !brakeWas) sfx.brake();
    brakeWas = s.brakeAmt > 0.6;
    if (s.stall > 0.55 && s.chute === 0) {
      stallBeep -= dt;
      if (stallBeep <= 0) {
        sfx.stall();
        stallBeep = 0.18;
      }
    }
    // chunk streaming
    nearestHint = world.nearestIndex(s.px, s.py, s.pz, nearestHint);
    world.setActiveChunk(Math.floor(nearestHint / 24));

    // ring passes
    if (nextRing < course.rings.length) {
      const r = course.rings[nextRing];
      const s1 = (s.px - r.x) * r.tx + (s.py - r.y) * r.ty + (s.pz - r.z) * r.tz;
      const s0 = s1 - (s.vx * r.tx + s.vy * r.ty + s.vz * r.tz) * dt;
      const cross = s0 < 0 && s1 >= 0;
      if (cross) {
        const t = -s0 / Math.max(1e-6, s1 - s0);
        const qx = s.px - s.vx * dt * (1 - t) - r.x;
        const qy = s.py - s.vy * dt * (1 - t) - r.y;
        const qz = s.pz - s.vz * dt * (1 - t) - r.z;
        const lat = Math.hypot(qx, qy, qz);
        if (lat <= r.r + 0.6) passRing(nextRing, lat);
        else missRing(nextRing);
        nextRing++;
        world.setNext(nextRing);
      } else if (s1 > 28) {
        missRing(nextRing);
        nextRing++;
        world.setNext(nextRing);
      }
    }

    // proximity + collisions
    const q = world.query(s.px, s.py, s.pz);
    const d = q.d;
    const agl = s.py;
    let proxD = d;
    if (agl < 6 && s.chute === 0) proxD = Math.min(proxD, agl); // skimming the street counts too
    if (proxD < 6 && sp > 24 && s.chute === 0) {
      proxT += dt;
      proxGrace = 0.8;
      const level = Math.min(8, 1 + Math.floor(proxT / 1.1));
      if (level > proxMult) {
        proxMult = level;
        sfx.whoosh(fx() - 0.5, 0.4);
      }
      const closeness = 1 - proxD / 6;
      const rate = 70 * Math.pow(closeness, 1.3) * (sp / 55) * proxMult;
      addScore("prox", rate * dt);
      proxBank += rate * dt;
      if (proxD < 2.2 && q.box !== lastNear && nearCool <= 0) {
        lastNear = q.box;
        nearCool = 0.9;
        nearMisses++;
        const bonus = Math.round(150 * proxMult);
        addScore("near", bonus);
        feed(`CLOSE CALL <u>+${bonus}</u>`, "hs");
        sfx.whoosh(clamp((q.box ? q.box.cx - s.px : 0) / 30, -1, 1), 0.8);
        shake = Math.max(shake, 0.18);
      }
    } else {
      proxGrace -= dt;
      if (proxGrace <= 0) {
        proxT = Math.max(0, proxT - dt * 2);
        if (proxT <= 0.01) {
          proxMult = 1;
          proxBank = 0;
        }
      }
    }
    nearCool -= dt;
    // speed bonus
    if (sp > 52 && s.chute === 0) addScore("speed", ((sp - 52) / 20) * 22 * dt * 10);

    // hazards (traffic / drones) are glancing hits
    const hz = world.hazardHit(s.px, s.py, s.pz, BODY_R);
    if (hz && hitCool <= 0 && s.chute === 0) {
      hitCool = 1.2;
      hits++;
      streak = 0;
      s.vx *= 0.6;
      s.vy *= 0.7;
      s.vz *= 0.6;
      s.fuel = Math.max(0, s.fuel - 20);
      shake = 0.8;
      damage = Math.max(damage, 0.45);
      sfx.hit();
      burst(s.px, s.py, s.pz, 18, 8);
      feed(hz.kind === "car" ? "TRAFFIC HIT" : "DRONE HIT", "bad");
    }
    hitCool -= dt;
    if (d < BODY_R && jumpGrace <= 0) {
      const b = q.box;
      const top = b ? b.cy + b.hy : 0;
      if (b && s.chute > 0 && s.chuteOpen > 0.55 && s.py > top - 0.3 && s.vy > -18 && Math.abs(s.px - b.cx) < b.hx + 0.5 && Math.abs(s.pz - b.cz) < b.hz + 0.5) {
        s.py = top + BODY_R;
        landDist = Math.hypot(s.px - course.pad.x, s.pz - course.pad.z);
        finishRun("landed");
        return;
      }
      crashBox = b;
      finishRun("crashed", s.chute > 0 ? "CANOPY COLLISION" : "COLLISION");
      return;
    }
    // ground
    if (s.py <= BODY_R) {
      s.py = BODY_R;
      const vyn = -s.vy;
      if (s.chute > 0 && s.chuteOpen > 0.7 && vyn < 16) finishRun("landed");
      else finishRun("crashed", s.chute > 0 ? "CHUTE TOO LATE" : "NO CHUTE");
      return;
    }
    // out of bounds
    const dPath = Math.hypot(course.px[nearestHint] - s.px, course.pz[nearestHint] - s.pz);
    if (dPath > 520 && s.chute === 0) {
      outT += dt;
      if (outT > 6) {
        finishRun("crashed", "SIGNAL LOST");
        return;
      }
    } else outT = Math.max(0, outT - dt * 2);

    // ghost recording
    recT += dt;
    while (recT >= 0.05) {
      recT -= 0.05;
      const f = frame.f;
      const n = frame.n;
      rec.push(Math.round(s.px * 10), Math.round(s.py * 10), Math.round(s.pz * 10), Math.round(f[0] * 100), Math.round(f[1] * 100), Math.round(f[2] * 100), Math.round(n[0] * 100), Math.round(n[1] * 100), Math.round(n[2] * 100), Math.round(s.chuteOpen * 100));
    }
  }
  let crashBox: unknown = null;
  let boostWas = false;
  let brakeWas = false;
  let hitCool = 0;

  // --------------------------------------------------------------- camera
  const camPos = new THREE.Vector3();
  const camUp = new THREE.Vector3(0, 1, 0);
  const camDir = new THREE.Vector3(0, 0, -1);
  const camLook = new THREE.Vector3();
  const tA = new THREE.Vector3();
  const tB = new THREE.Vector3();
  const tC = new THREE.Vector3();
  let camInit = true;
  let shakeT = 0;
  let camOverride: null | { p: number[]; l: number[] } = null;
  function updateCamera(dt: number) {
    if (camOverride) {
      camera.position.set(camOverride.p[0], camOverride.p[1], camOverride.p[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(camOverride.l[0], camOverride.l[1], camOverride.l[2]);
      camera.fov = 60;
      camera.updateProjectionMatrix();
      return;
    }
    const st = course?.start;
    if (!st || stage === "loading") return;
    const lerpK = (r: number) => 1 - Math.exp(-dt * r);
    const f0x = Math.sin(st.psi);
    const f0z = -Math.cos(st.psi);
    if (stage === "menu" || stage === "results") {
      // establishing shot: beside and behind the diver on the lip, looking out and down over the city
      const a = menuTime * 0.12 + 0.4;
      const sw = Math.sin(menuTime * 0.13);
      const rx = Math.cos(st.psi);
      const rz = Math.sin(st.psi);
      // over the shoulder, looking past the diver down the 2 km drop
      tA.set(start.p.x - f0x * 4.2 - rx * (3 + sw * 0.7), start.p.y + 2.3 + Math.sin(menuTime * 0.2) * 0.25, start.p.z - f0z * 4.2 - rz * (3 + sw * 0.7));
      if (stage === "results") {
        // frame the final position instead
        tB.set(fl.s.px, fl.s.py, fl.s.pz);
        tA.set(tB.x + Math.cos(a) * 14, tB.y + 4, tB.z + Math.sin(a) * 14);
        camPos.lerp(tA, lerpK(2));
        camera.position.copy(camPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(tB.x, tB.y + 1.5, tB.z);
        return;
      }
      camPos.copy(tA);
      camera.position.copy(tA);
      camera.up.set(0, 1, 0);
      camera.lookAt(start.p.x + f0x * 30 - rx * 6, start.p.y - 24, start.p.z + f0z * 30 - rz * 6);
      camera.fov = 58;
      camera.updateProjectionMatrix();
      return;
    }
    if (stage === "countdown") {
      // over the shoulder looking out over the city
      const k = clamp(1 - (countT - 0.6) / 3, 0, 1);
      tA.set(start.p.x - f0x * (7 - k * 2.4), start.p.y + 3.0 + k * 0.4, start.p.z - f0z * (7 - k * 2.4));
      camera.position.copy(tA);
      camPos.copy(tA);
      camera.up.set(0, 1, 0);
      camera.lookAt(start.p.x + f0x * 30, start.p.y - 20 - k * 10, start.p.z + f0z * 30);
      camera.fov = 60 + k * 6;
      camera.updateProjectionMatrix();
      return;
    }
    if (stage === "crashed") {
      tA.copy(crash.p);
      tB.set(tA.x - Math.sin(endT * 0.6) * 12, tA.y + 4, tA.z - Math.cos(endT * 0.6) * 12);
      if (endT < 0.01) camPos.set(camera.position.x, camera.position.y, camera.position.z);
      camPos.lerp(tB, lerpK(1.5));
      camera.position.copy(camPos);
      camera.up.set(0, 1, 0);
      camera.lookAt(tA);
      return;
    }
    const s = fl.s;
    const sp = frame.speed;
    const canopy = s.chute > 0;
    tA.set(s.px, s.py, s.pz);
    // smoothed travel direction + up reference
    tB.set(frame.vhat[0], frame.vhat[1], frame.vhat[2]);
    if (canopy) tB.set(Math.sin(s.hdg), -0.12, -Math.cos(s.hdg)).normalize();
    tC.set(frame.n[0], frame.n[1], frame.n[2]);
    if (canopy || stage === "landed") tC.set(0, 1, 0);
    if (camInit) {
      camDir.copy(tB);
      camUp.copy(tC);
    }
    camDir.lerp(tB, lerpK(canopy ? 3 : 5.5)).normalize();
    camUp.lerp(tC, lerpK(4)).normalize();
    // keep the camera "up" reference mostly vertical unless we're falling straight down
    const upRef = tC.set(0, 1, 0).multiplyScalar(0.45).addScaledVector(camUp, 0.55).normalize();
    if (camMode === 1 && !canopy && stage === "flying") {
      camera.position.set(s.px + frame.f[0] * 0.5 + frame.n[0] * 0.28, s.py + frame.f[1] * 0.5 + frame.n[1] * 0.28, s.pz + frame.f[2] * 0.5 + frame.n[2] * 0.28);
      camera.up.set(frame.n[0], frame.n[1], frame.n[2]);
      camera.lookAt(camera.position.x + frame.f[0] * 20, camera.position.y + frame.f[1] * 20, camera.position.z + frame.f[2] * 20);
      camInit = false;
      flyer.root.visible = true;
      applyFov(dt, sp);
      return;
    }
    // sit behind and clearly above the diver so the suit reads from the back, not end-on
    const back = (canopy ? 11 : 4.6 + sp * 0.012) * (stage === "landed" ? 1.2 : 1);
    const lift = canopy ? 3.2 : 2.3;
    const ideal = tB.copy(camDir).multiplyScalar(-back).add(tA).addScaledVector(upRef, lift).addScaledVector(camUp, canopy ? 0 : 0.6);
    if (camInit) camPos.copy(ideal);
    camPos.lerp(ideal, lerpK(canopy ? 6 : 12));
    camInit = false;
    camera.position.copy(camPos);
    if (shake > 0.001) {
      shakeT += dt * 60;
      camera.position.x += (Math.sin(shakeT * 1.7) + (fx() - 0.5)) * shake * 0.35;
      camera.position.y += (Math.cos(shakeT * 2.3) + (fx() - 0.5)) * shake * 0.35;
      camera.position.z += (fx() - 0.5) * shake * 0.2;
      shake = Math.max(0, shake - dt * 1.4);
    }
    const hi = clamp((sp - 70) / 40, 0, 1);
    camera.position.x += (fx() - 0.5) * hi * 0.04;
    camera.position.y += (fx() - 0.5) * hi * 0.04;
    camera.up.copy(upRef);
    camLook.copy(tA).addScaledVector(camDir, canopy ? 16 : 11);
    camera.lookAt(camLook);
    flyer.root.visible = true;
    applyFov(dt, sp);
  }
  function applyFov(dt: number, sp: number) {
    const fov = 64 + clamp(sp / 95, 0, 1.2) * 22 + (fl.s.boosting ? 8 : 0) + (camMode === 1 ? 6 : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }

  // --------------------------------------------------------------- HUD update
  const proj = new THREE.Vector3();
  function updateHud(dt: number, force = false) {
    if (!course) return;
    const s = fl.s;
    const sp = frame.speed;
    hud.spd.textContent = String(Math.round(sp * KMH));
    hud.alt.textContent = String(Math.max(0, Math.round(s.py - 0.9)));
    const frac = clamp((s.py - 0.9) / 2000, 0, 1);
    hud.tapeFill.style.height = `${frac * 100}%`;
    hud.tapeMark.style.bottom = `${frac * 100}%`;
    const need = s.chute > 0 ? 0 : chuteNeed(s.vy);
    hud.tapeNeed.style.bottom = `${clamp(need / 2000, 0, 1) * 100}%`;
    hud.fuel.style.width = `${s.fuel}%`;
    hud.brake.style.width = `${s.brakeE}%`;
    const hs = Math.hypot(s.vx, s.vz);
    const gl = Math.atan2(-s.vy, Math.max(1, hs)) * (180 / Math.PI);
    hud.glide.textContent = `${gl.toFixed(0)}°`;
    hud.gload.textContent = s.g.toFixed(1);
    hud.root.classList.toggle("boosting", s.boosting);
    hud.root.classList.toggle("stall", s.stall > 0.55 && s.chute === 0);
    hud.score.textContent = fmtN(liveScore());
    hud.mul.textContent = `×${streakMult().toFixed(2)}`;
    hud.streak.textContent = String(streak);
    hud.ringK.textContent = `RING ${Math.min(nextRing, course.rings.length)}/${course.rings.length}`;
    // proximity meter
    const prox = proxGrace > 0 && proxT > 0.05;
    hud.prox.classList.toggle("on", prox || proxBank > 1 && proxGrace > -0.6);
    hud.proxN.textContent = `×${proxMult}`;
    hud.proxBar.style.width = `${clamp(((proxT % 1.1) / 1.1) * 100 + (proxMult >= 8 ? 100 : 0), 0, 100)}%`;
    proxPtsShown += (proxBank - proxPtsShown) * 0.4;
    hud.proxPts.textContent = proxBank > 1 ? `+${fmtN(proxPtsShown)}` : "";
    // chute guidance
    if (stage === "flying" && s.chute === 0) {
      const agl = s.py;
      const showHint = agl < 700 && nextRing >= course.rings.length - 3;
      hud.chuteHint.classList.toggle("on", showHint);
      const danger = agl < need * 1.35 + 20;
      hud.chuteHint.classList.toggle("now", danger);
      hud.chuteHintT.textContent = danger ? (mobile ? "PULL CHUTE NOW" : "PULL — SPACE") : mobile ? "PULL CHUTE" : "SPACE: PULL CHUTE";
      hud.chuteHintS.textContent = `MIN SAFE ${Math.round(need)} M · LATER = BIGGER BONUS`;
      hud.need.textContent = agl < 900 ? `MIN PULL ${Math.round(need)} M` : "";
      hud.need.className = "need " + (agl < 900 ? (danger ? "bad" : "on") : "");
    } else {
      hud.chuteHint.classList.remove("on");
      hud.need.textContent = s.chute > 0 ? "CANOPY" : "";
      hud.need.className = "need on";
    }
    // warnings
    const warn: string[] = [];
    if (outT > 0.3) warn.push(`LEAVING THE DISTRICT<small>RETURN TO THE COURSE · ${Math.max(0, 6 - outT).toFixed(1)}</small>`);
    else if (s.stall > 0.55 && s.chute === 0 && stage === "flying") warn.push("STALL");
    hud.warn.innerHTML = warn[0] ?? "";
    hud.warn.classList.toggle("on", warn.length > 0);
    // next-ring indicator
    if (stage === "flying" || stage === "countdown") {
      const r = nextRing < course.rings.length ? course.rings[nextRing] : { x: course.pad.x, y: 6, z: course.pad.z };
      proj.set(r.x, r.y, r.z).project(camera);
      const dist = Math.hypot(r.x - s.px, r.y - s.py, r.z - s.pz);
      let sx = (proj.x * 0.5 + 0.5) * viewW;
      let sy = (-proj.y * 0.5 + 0.5) * viewH;
      const behind = proj.z > 1;
      const margin = 46;
      const onScreen = !behind && sx > margin && sx < viewW - margin && sy > margin + 40 && sy < viewH - margin;
      hud.ringInd.style.display = "block";
      hud.ringInd.classList.toggle("edge", !onScreen);
      if (!onScreen) {
        let dx = sx - viewW / 2;
        let dy = sy - viewH / 2;
        if (behind) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const k = Math.min((viewW / 2 - margin) / Math.max(1e-3, Math.abs(Math.cos(ang))), (viewH / 2 - margin - 20) / Math.max(1e-3, Math.abs(Math.sin(ang))));
        sx = viewW / 2 + Math.cos(ang) * k;
        sy = viewH / 2 + Math.sin(ang) * k;
        (hud.ringInd.querySelector(".a") as HTMLElement).style.transform = `rotate(${ang + Math.PI / 2}rad)`;
      }
      // keep the edge arrow clear of the score panel / altitude readout / speed block
      if (!onScreen) sy = clamp(sy, mobile ? 120 : 150, viewH - (mobile ? 90 : 190));
      hud.ringInd.style.transform = `translate(${sx}px,${sy}px)`;
      hud.ringLbl.textContent = `${Math.round(dist)} M`;
    } else hud.ringInd.style.display = "none";
    // timers
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) hud.banner.classList.remove("on");
    }
    if (deltaT > 0) {
      deltaT -= dt;
      if (deltaT <= 0) hud.delta.classList.remove("on");
    }
    // tutorial hints
    if (hintStep < 4 && stage === "flying" && !force) {
      const tips = mobile
        ? ["<span>DRAG ANYWHERE TO STEER · UP = DIVE · DOWN = FLARE</span>", "<span>FLY THROUGH THE RINGS · HUG THE TOWERS FOR POINTS</span>", "<span>TAP <kbd>PULL CHUTE</kbd> BEFORE THE GROUND · LATER = BIGGER BONUS</span>", ""]
        : ["<span><kbd>W</kbd> DIVE</span><span><kbd>S</kbd> FLARE</span><span><kbd>A</kbd><kbd>D</kbd> BANK</span><span>CLICK = MOUSE</span>", "<span>FLY THROUGH THE RINGS · SKIM THE TOWERS FOR POINTS</span><span><kbd>SHIFT</kbd> BOOST</span><span><kbd>X</kbd> AIR-BRAKE</span>", "<span><kbd>SPACE</kbd> PULL CHUTE · LATER = BIGGER BONUS · <kbd>C</kbd> CAMERA</span>", ""];
      hintT += dt;
      if (hintStep === 0 && hintT > 7) hintStep = 1;
      if (hintStep === 1 && hintT > 14) hintStep = 2;
      if (hintStep === 2 && (s.chute > 0 || hintT > 24)) hintStep = 3;
      if (hintStep === 3) hintStep = 4;
      const html = tips[hintStep] ?? "";
      if (hud.hint.innerHTML !== html) hud.hint.innerHTML = html;
      hud.hint.classList.toggle("on", !!html);
    } else if (hintStep >= 4) hud.hint.classList.remove("on");
    const sl = clamp((sp - 45) / 55, 0, 1) + (s.boosting ? 0.3 : 0);
    hud.lines.style.opacity = String(Math.min(0.9, sl));
  }

  // --------------------------------------------------------------- menus
  function bestFor(sd: number) {
    const b = bests[String(sd)];
    return b ? fmtN(b) : "—";
  }
  function showMenu() {
    stage = "menu";
    sfx.windStop();
    hud.root.dataset.mode = "menu";
    if (mode === "daily") seed = dailySeed();
    prepareMenuWorld();
    const ds = dailySeed();
    hud.overlay.className = "nx-ov menu on";
    hud.overlay.innerHTML = `<div class="nx-col">
      <div class="nx-kick">PLAYVERSE // WINGSUIT DIVE · DISTRICT 07</div>
      <div class="nx-h1">FREE<span>FALL</span></div>
      <div class="nx-sub">Step off the top of the Spire and fall through District 07. Thread the rings, skim the towers for proximity points and pull the chute as late as you dare.</div>
      <div class="ff-modes">
        <button type="button" class="ff-mode ${mode === "daily" ? "on" : ""}" data-m="daily"><div><div class="t">DAILY COURSE</div><div class="s">Same dive for everyone · ${seedLabel(ds)} UTC</div></div><div class="md">BEST<br><b>${bestFor(ds)}</b></div></button>
        <button type="button" class="ff-mode ${mode === "practice" ? "on" : ""}" data-m="practice"><div><div class="t">PRACTICE</div><div class="s">A fresh random course every run</div></div><div class="md">${mode === "practice" ? `SEED<br><b>#${seed % 100000}</b>` : "RANDOM"}</div></button>
      </div>
      <div class="nx-actions"><button type="button" class="nx-btn" data-go="go">JUMP ▸</button>
        <button type="button" class="nx-btn ghost" data-go="settings">SETTINGS</button></div>
      <div class="nx-ctrl">${(mobile
        ? [["STEER", "DRAG"], ["DIVE / FLARE", "UP / DOWN"], ["BOOST", "BOOST"], ["AIR-BRAKE", "BRAKE"], ["CHUTE", "PULL / 2-TAP"]]
        : [["DIVE / FLARE", "W S / ↑ ↓"], ["BANK", "A D / ← →"], ["MOUSE", "CLICK TO AIM"], ["BOOST", "SHIFT"], ["AIR-BRAKE", "X"], ["CHUTE", "SPACE"], ["CAMERA", "C"], ["GAMEPAD", "STICK · RT LT · A"]]
      )
        .map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`)
        .join("")}</div></div>`;
    hud.overlay.querySelectorAll<HTMLButtonElement>(".ff-mode").forEach((b) =>
      b.addEventListener("click", () => {
        audio.ui();
        mode = b.dataset.m as Mode;
        seed = mode === "daily" ? dailySeed() : randomSeed();
        showMenu();
      }),
    );
    (hud.overlay.querySelector('[data-go="go"]') as HTMLElement).addEventListener("click", () => {
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
      startCountdown();
    });
    (hud.overlay.querySelector('[data-go="settings"]') as HTMLElement).addEventListener("click", () => showSettings(showMenu));
  }
  const randomSeed = () => 100000 + Math.floor(Math.random() * 9000000);
  function prepareMenuWorld() {
    prepareRun();
    flyer.pose({ fly: 0, hang: 0, dive: 0, flare: 0, bank: 0, flap: 0 }, 0.016, 0);
    camInit = true;
  }

  function showSettings(back: () => void) {
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center"><div class="nx-kick">SETTINGS</div><div class="nx-h2">AUDIO &amp; CONTROLS</div>
      <div class="nx-set">
        <label><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" value="${settings.vol}" data-k="vol"><span>${Math.round(settings.vol * 100)}</span></label>
        <label><span>MUSIC</span><input type="range" min="0" max="1" step="0.05" value="${settings.music}" data-k="music"><span>${Math.round(settings.music * 100)}</span></label>
        <label><span>MOUSE SENS</span><input type="range" min="0.3" max="2.5" step="0.1" value="${settings.sens}" data-k="sens"><span>${settings.sens.toFixed(1)}</span></label>
        <label><span>INVERT Y</span><input type="checkbox" ${settings.invert ? "checked" : ""} data-k="invert" style="width:20px;height:20px"><span></span></label>
      </div><div class="nx-actions"><button type="button" class="nx-btn" data-go="back">DONE</button></div></div>`;
    hud.overlay.querySelectorAll<HTMLInputElement>("input").forEach((inp) =>
      inp.addEventListener("input", () => {
        const k = inp.dataset.k as "vol" | "music" | "sens" | "invert";
        if (k === "invert") settings.invert = inp.checked;
        else {
          settings[k] = Number(inp.value);
          (inp.nextElementSibling as HTMLElement).textContent = k === "sens" ? settings.sens.toFixed(1) : String(Math.round(settings[k] * 100));
        }
        if (k === "vol") {
          audio.setVolume(settings.muted ? 0 : settings.vol);
          sfx.setVolume(settings.vol);
        }
        if (k === "music") audio.setMusicVolume(settings.music);
        save(SETTINGS_KEY, settings);
      }),
    );
    (hud.overlay.querySelector('[data-go="back"]') as HTMLElement).addEventListener("click", back);
  }

  function pause() {
    if (stage !== "flying" && stage !== "countdown") return;
    pausedFrom = stage;
    stage = "paused";
    audio.pause(true);
    sfx.pause(true);
    if (document.pointerLockElement) document.exitPointerLock?.();
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center"><div class="nx-kick">PAUSED · ${mode === "daily" ? "DAILY" : "PRACTICE"} ${seedLabel(seed).startsWith("0") ? "" : ""}</div><div class="nx-h2">HOLD POSITION</div>
      <div class="nx-actions"><button type="button" class="nx-btn" data-go="resume">RESUME</button>
      <button type="button" class="nx-btn ghost" data-go="restart">RESTART</button>
      <button type="button" class="nx-btn ghost" data-go="menu">QUIT</button></div></div>`;
    const go = (k: string, fn: () => void) => (hud.overlay.querySelector(`[data-go="${k}"]`) as HTMLElement).addEventListener("click", fn);
    go("resume", resume);
    go("restart", () => {
      audio.pause(false);
      sfx.pause(false);
      startCountdown();
    });
    go("menu", () => {
      audio.pause(false);
      sfx.pause(false);
      showMenu();
    });
  }
  function resume() {
    if (stage !== "paused") return;
    stage = pausedFrom;
    audio.pause(false);
    sfx.pause(false);
    hud.overlay.className = "nx-ov";
    hud.overlay.innerHTML = "";
  }

  function grade(total: number, crashed: boolean) {
    if (crashed) return { g: "✕", cls: "f" };
    if (total >= 30000) return { g: "S", cls: "" };
    if (total >= 21000) return { g: "A", cls: "" };
    if (total >= 14000) return { g: "B", cls: "" };
    if (total >= 8000) return { g: "C", cls: "" };
    return { g: "D", cls: "" };
  }

  function showResults(total: number, crashed: boolean, prevBest: number) {
    const gr = grade(total, crashed);
    const rows: Array<[string, number, string?]> = [
      ["RINGS", pts.rings],
      ["PERFECT CENTRE", pts.perfect],
      ["PROXIMITY", pts.prox],
      ["CLOSE CALLS", pts.near],
      ["SPEED", pts.speed],
    ];
    if (!crashed) {
      rows.push(["LATE PULL", pts.chute], ["LANDING", pts.landing], ["TIME BONUS", pts.time]);
    }
    const bd = rows.map(([k, v]) => `<div><span>${k}</span><b>${fmtN(v)}</b></div>`).join("") +
      (crashed ? `<div class="neg"><span>CRASH PENALTY (×0.5)</span><b>−${fmtN(liveScore() - total)}</b></div>` : "") +
      `<div class="t"><span>TOTAL</span><b>${fmtN(total)}</b></div>`;
    hud.root.dataset.mode = "menu";
    hud.overlay.className = "nx-ov dim on";
    hud.overlay.innerHTML = `<div class="nx-center deb"><div class="nx-kick ${crashed ? "r" : ""}">${crashed ? `CRASHED · ${esc(crashWhy)}` : `LANDED · ${esc(landNote)}`} · ${mode === "daily" ? "DAILY " + seedLabel(seed) : "PRACTICE #" + (seed % 100000)}</div>
      <div class="nx-deb"><div>
        <div class="nx-grade ${gr.cls}">${gr.g}</div>
        <div class="nx-score">${fmtN(total)}</div>
        <div class="nx-tiny">${newBest ? "★ NEW BEST FOR THIS COURSE" : `BEST ${fmtN(Math.max(prevBest, total))}`} · TIME ${fmtT(runT)}</div>
        <div class="nx-stats"><div><b>${ringsHit}/${course.rings.length}</b><span>RINGS</span></div><div><b>${Math.round(maxSpeed * KMH)}</b><span>TOP KM/H</span></div><div><b>${bestStreak}</b><span>BEST STREAK</span></div></div>
      </div>
      <div class="r"><div class="ff-bd" style="margin:0 0 14px">${bd}</div>
        <div class="nx-actions"><button type="button" class="nx-btn" data-go="retry">${mode === "daily" ? "FLY IT AGAIN" : "RETRY SEED"} ▸</button>
          ${mode === "practice" ? `<button type="button" class="nx-btn ghost" data-go="new">NEW COURSE</button>` : ""}
          <button type="button" class="nx-btn ghost" data-go="menu">MENU</button></div>
        <div class="ff-credit">${!crashed ? (ghostFlyer || true ? "YOUR BEST RUN ON THIS COURSE RACES AS A GHOST" : "") : "LAND WITHOUT CRASHING TO KEEP THE FULL SCORE + SET A GHOST"}</div>
      </div></div></div>`;
    const go = (k: string, fn: () => void) => hud.overlay.querySelector(`[data-go="${k}"]`)?.addEventListener("click", fn);
    go("retry", startCountdown);
    go("new", () => {
      seed = randomSeed();
      startCountdown();
    });
    go("menu", showMenu);
  }

  // --------------------------------------------------------------- input wiring
  const toggleMute = () => {
    settings.muted = !settings.muted;
    audio.setVolume(settings.muted ? 0 : settings.vol);
    sfx.setMuted(settings.muted);
    save(SETTINGS_KEY, settings);
    (hud.sys.querySelector('[data-act="mute"]') as HTMLElement).textContent = settings.muted ? "🔇" : "🔊";
  };
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void container.requestFullscreen?.().catch(() => {});
  };
  on(window, "keydown", (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    if (stage !== "menu" && stage !== "results" && ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (!e.repeat) {
      if (k === " " && stage === "flying") wantChute = true;
      if (k === "c") camMode = camMode === 0 ? 1 : 0;
      if (k === "m") toggleMute();
      if (k === "f") toggleFs();
      if (k === "p" || k === "escape") {
        if (stage === "paused") resume();
        else pause();
      }
      if (k === "r" && (stage === "flying" || stage === "landed" || stage === "crashed")) startCountdown();
    }
    keys.add(k);
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
  // mouse (pointer lock) steering
  on(canvas, "click", () => {
    if (!mobile && (stage === "flying" || stage === "countdown") && !document.pointerLockElement) void canvas.requestPointerLock?.();
  });
  on(document, "pointerlockchange", () => {
    mouse.locked = document.pointerLockElement === canvas;
    if (!mouse.locked && stage === "flying") pause();
  });
  on(document, "mousemove", (e: MouseEvent) => {
    if (!mouse.locked) return;
    const k = 0.0042 * settings.sens;
    mouse.x = clamp(mouse.x + e.movementX * k, -1, 1);
    mouse.y = clamp(mouse.y + e.movementY * k * (settings.invert ? -1 : 1), -1, 1);
  });
  // touch: one-finger virtual stick anywhere, two-finger tap pulls the chute
  const stickR = 70;
  on(canvas, "pointerdown", (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    audio.ensure();
    sfx.ensure();
    touchIds.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (touchIds.size >= 2 && stage === "flying") {
      const all = [...touchIds.values()];
      if (performance.now() - Math.min(...all.map((p) => p.t)) < 400) wantChute = true;
    }
    if (touchSt.id < 0) {
      touchSt.id = e.pointerId;
      touchSt.ox = e.clientX;
      touchSt.oy = e.clientY;
      touchSt.x = touchSt.y = 0;
      const r = container.getBoundingClientRect();
      hud.stick.style.left = `${e.clientX - r.left}px`;
      hud.stick.style.top = `${e.clientY - r.top}px`;
      hud.stick.classList.add("on");
      hud.stickKnob.style.transform = "translate(0,0)";
    }
  });
  on(window, "pointermove", (e: PointerEvent) => {
    if (e.pointerId !== touchSt.id) return;
    let dx = e.clientX - touchSt.ox;
    let dy = e.clientY - touchSt.oy;
    const l = Math.hypot(dx, dy);
    if (l > stickR) {
      dx = (dx / l) * stickR;
      dy = (dy / l) * stickR;
    }
    touchSt.x = dx / stickR;
    touchSt.y = (dy / stickR) * (settings.invert ? -1 : 1);
    hud.stickKnob.style.transform = `translate(${dx * 0.6}px,${dy * 0.6}px)`;
  });
  const touchEnd = (e: PointerEvent) => {
    touchIds.delete(e.pointerId);
    if (e.pointerId === touchSt.id) {
      touchSt.id = -1;
      touchSt.x = touchSt.y = 0;
      hud.stick.classList.remove("on");
    }
  };
  on(window, "pointerup", touchEnd);
  on(window, "pointercancel", touchEnd);
  const hold = (el: HTMLElement, key: "boost" | "brake") => {
    const down = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      touchSt[key] = true;
      el.classList.add("on");
      audio.ensure();
      sfx.ensure();
    };
    const up = (e: Event) => {
      e.preventDefault();
      touchSt[key] = false;
      el.classList.remove("on");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  };
  hold(hud.tBoost, "boost");
  hold(hud.tBrake, "brake");
  hud.tPull.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hud.tPull.classList.add("on");
    if (stage === "flying") wantChute = true;
  });
  hud.tPull.addEventListener("pointerup", () => hud.tPull.classList.remove("on"));
  hud.tPull.addEventListener("pointercancel", () => hud.tPull.classList.remove("on"));
  // device tilt is intentionally not used: drag steering is more precise and doesn't need a permission prompt

  // --------------------------------------------------------------- composer
  let composer: EffectComposer | null = null;
  let blur: ShaderPass | null = null;
  let grading: ShaderPass | null = null;
  let bloom: UnrealBloomPass | null = null;
  try {
    const rt = new THREE.WebGLRenderTarget(viewW * pixelRatio(), viewH * pixelRatio(), { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(viewW, viewH), mobile ? 0.4 : 0.5, 0.5, 0.92);
    composer.addPass(bloom);
    if (!mobile) {
      blur = new ShaderPass(SpeedBlurShader);
      composer.addPass(blur);
    }
    composer.addPass(new OutputPass());
    grading = new ShaderPass(GradeShader);
    composer.addPass(grading);
  } catch (err) {
    console.error("[FREEFALL] post unavailable", err);
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

  // --------------------------------------------------------------- per-frame visuals
  const poseP: FlyerPose = { fly: 0, hang: 0, dive: 0, flare: 0, bank: 0, flap: 0 };
  const trailUp = new THREE.Vector3();
  const gq = new THREE.Quaternion();
  const gP = new THREE.Vector3();
  const upQ = new THREE.Quaternion();
  const hangQ = new THREE.Quaternion();
  function updateFlyer(dt: number) {
    const s = fl.s;
    const t = menuTime;
    if (stage === "menu" || stage === "countdown" || stage === "loading") {
      flyer.root.position.copy(start.p);
      flyer.root.quaternion.copy(standQ);
      poseP.fly = poseP.hang = 0;
      flyer.pose(poseP, dt, t);
      flyer.setCanopy(0, t);
      flyer.updateTrails(0, trailUp.set(0, 1, 0));
      return;
    }
    if (stage === "crashed") {
      if (!crash.grounded) {
        crash.v.y -= 22 * dt;
        crash.p.addScaledVector(crash.v, dt);
        if (crash.p.y < 0.5) {
          crash.p.y = 0.5;
          if (crash.v.y < -4) {
            crash.v.y *= -0.35;
            crash.v.x *= 0.6;
            crash.v.z *= 0.6;
            crash.w.multiplyScalar(0.6);
            burst(crash.p.x, 0.6, crash.p.z, 14, 8);
          } else {
            crash.v.multiplyScalar(0.9);
            crash.w.multiplyScalar(0.9);
          }
        }
      }
      upQ.setFromEuler(new THREE.Euler(crash.w.x * dt, crash.w.y * dt, crash.w.z * dt));
      crash.q.premultiply(upQ);
      flyer.root.position.copy(crash.p);
      flyer.root.quaternion.copy(crash.q);
      poseP.fly = 1;
      poseP.hang = 0;
      poseP.dive = 0.5;
      poseP.flare = 0;
      poseP.flap = 3;
      poseP.bank = Math.sin(t * 9);
      flyer.pose(poseP, dt, t);
      flyer.updateTrails(0.0, trailUp.set(0, 1, 0));
      flyer.setCanopy(0, t);
      return;
    }
    const canopy = s.chute > 0;
    // blend targets
    const wantFly = stage === "flying" && !canopy ? 1 : 0;
    poseFly += (wantFly - poseFly) * Math.min(1, dt * (jumped && runT < 0.8 ? 4 : 6));
    const wantHang = canopy || stage === "landed" ? 1 : 0;
    poseHang += (stage === "landed" ? 0 - poseHang : wantHang - poseHang) * Math.min(1, dt * 5);
    if (stage === "landed") poseFly = Math.max(0, poseFly - dt * 5);
    // orientation
    basisQ(flightQ, frame.f, frame.n);
    if (canopy || stage === "landed") {
      // hang upright, facing the canopy heading
      const hdg = canopy ? s.hdg : fl.s.hdg;
      basisQ(hangQ, [0, 1, 0], [-Math.sin(hdg), 0, Math.cos(hdg)]);
      flyer.root.quaternion.slerp(hangQ, Math.min(1, dt * 5));
    } else if (runT < 0.9) {
      flyer.root.quaternion.copy(standQ).slerp(flightQ, clamp(runT / 0.9, 0, 1) ** 0.7);
    } else flyer.root.quaternion.copy(flightQ);
    if (stage === "landed") {
      flyer.root.position.set(s.px, 0.02 + flyer.height / 2, s.pz);
    } else flyer.root.position.set(s.px, s.py, s.pz);
    poseP.fly = poseFly;
    poseP.hang = poseHang;
    const sp = frame.speed;
    poseP.dive = clamp((sp - 40) / 50, 0, 1);
    poseP.flare = clamp(s.alpha / 0.5, 0, 1) * (1 - poseP.dive);
    poseP.bank = clamp(s.bank, -1, 1);
    poseP.flap = clamp((sp - 50) / 40, 0, 1) + s.stall * 1.5;
    flyer.pose(poseP, dt, t);
    const canopyOpen = stage === "landed" ? Math.max(0, 1 - endT * 2) : s.chuteOpen;
    flyer.setCanopy(canopy ? canopyOpen : 0, t);
    if (stage === "landed") flyer.canopy.visible = canopyOpen > 0.05;
    trailUp.set(frame.n[0], frame.n[1], frame.n[2]);
    flyer.updateTrails(stage === "flying" && !canopy ? clamp((sp - 20) / 50, 0, 1) : 0, trailUp);
    void gq;
    void gP;
  }

  const gFrame: Frame = { f: [0, 0, -1], n: [0, 1, 0], r: [1, 0, 0], vhat: [0, 0, -1], speed: 1 };
  void gFrame;
  function updateGhost(dt: number) {
    if (!ghostFlyer || !ghost) return;
    const live = stage === "flying" || stage === "landed" || stage === "crashed";
    if (!live || runT <= 0) {
      ghostFlyer.root.visible = false;
      return;
    }
    const g = ghost;
    const n = g.pts.length / 10;
    const fi = runT / g.dt;
    const i = Math.floor(fi);
    if (i >= n - 1) {
      ghostFlyer.root.visible = runT < g.time + 1.5 && false;
      ghostFlyer.root.visible = false;
      return;
    }
    const a = fi - i;
    const at = (k: number, o: number) => g.pts[k * 10 + o];
    const px = (at(i, 0) + (at(i + 1, 0) - at(i, 0)) * a) / 10;
    const py = (at(i, 1) + (at(i + 1, 1) - at(i, 1)) * a) / 10;
    const pz = (at(i, 2) + (at(i + 1, 2) - at(i, 2)) * a) / 10;
    const f = [0, 1, 2].map((o) => (at(i, 3 + o) + (at(i + 1, 3 + o) - at(i, 3 + o)) * a) / 100);
    const nn = [0, 1, 2].map((o) => (at(i, 6 + o) + (at(i + 1, 6 + o) - at(i, 6 + o)) * a) / 100);
    const open = (at(i, 9) + (at(i + 1, 9) - at(i, 9)) * a) / 100;
    ghostFlyer.root.visible = true;
    ghostFlyer.root.position.set(px, py, pz);
    if (open > 0.05) basisQ(upQ, [0, 1, 0], [-f[0], 0, -f[2]]);
    else basisQ(upQ, f, nn);
    ghostFlyer.root.quaternion.copy(upQ);
    const gp: FlyerPose = { fly: open > 0.05 ? 0 : 1, hang: open > 0.05 ? 1 : 0, dive: 0.5, flare: 0, bank: 0, flap: 0 };
    ghostFlyer.pose(gp, dt, menuTime);
    ghostFlyer.setCanopy(open, menuTime);
    ghostFlyer.updateTrails(open > 0.05 ? 0 : 0.7, trailUp.set(nn[0], nn[1], nn[2]));
  }

  // --------------------------------------------------------------- loop
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  const FIXED = 1 / 120;

  function update(dt: number) {
    if (!course) return;
    if (stage === "countdown") {
      countT -= dt;
      const n = Math.ceil(countT - 0.6);
      if (n !== lastCount && n >= 0) {
        lastCount = n;
        hud.count.textContent = n > 0 ? String(n) : "JUMP";
        hud.count.className = n > 0 ? "on" : "on go";
        void hud.count.offsetWidth;
        sfx.countdown(n === 0);
        audio.countdown(n === 0);
      }
      if (countT <= 0.6) jump();
    }
    if (stage === "flying") {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED && steps < 8 && stage === "flying") {
        simulate(FIXED);
        acc -= FIXED;
        steps++;
      }
      if (steps >= 8) acc = 0;
      if (stage === "flying") {
        const s = fl.s;
        sfx.windSet(frame.speed, s.chute > 0 ? 1 : 0, clamp(proxGrace, 0, 1));
        audio.music(0.55 + clamp(frame.speed / 120, 0, 0.45));
        damage = Math.max(0, damage - dt * 1.4);
        fade = 0;
      }
    } else if (stage === "landed") {
      endT += dt;
      // settle to a stand; canopy drifts down
      fl.s.vx *= Math.exp(-dt * 5);
      fl.s.vz *= Math.exp(-dt * 5);
      damage = Math.max(0, damage - dt);
      audio.music(0.3);
      if (endT > 3.4) finalize();
    } else if (stage === "crashed") {
      endT += dt;
      damage = Math.max(0.0, damage - dt * 0.5);
      if (endT > 1.7) fade = clamp((endT - 1.7) / 0.8, 0, 1);
      if (endT > 2.6) finalize();
    } else if (stage === "menu" || stage === "results") audio.music(0.3);
    else if (stage === "countdown") audio.music(0.45);
    nearCool = Math.max(0, nearCool);
  }

  function frameLoop(now: number) {
    raf = requestAnimationFrame(frameLoop);
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    menuTime += realDt;
    if (stage === "loading") {
      renderer.render(scene, camera);
      return;
    }
    if (stage !== "paused") {
      for (let i = 0; i < simBoost; i++) update(realDt);
      updateFlyer(realDt);
      updateGhost(realDt);
      updateCamera(realDt);
      vel.set(fl.s.vx, fl.s.vy, fl.s.vz);
      if (stage !== "flying") vel.multiplyScalar(0);
      updateStreaks(stage === "flying" ? frame.speed : 0);
      updateSparks(realDt);
      if (stage === "crashed" || stage === "flying") {
        // sparks / dust while skimming
      }
      world.update(menuTime, realDt, camera.position);
      const alt = camera.position.y;
      const fg = world.fogFor(alt);
      fog.density = fg.density;
      const dusk = clamp((alt - 300) / 1600, 0, 1);
      fog.color.setRGB(0.012 + 0.05 * dusk + 0.025 * fg.cloud, 0.008 + 0.018 * dusk + 0.02 * fg.cloud, 0.03 + 0.04 * dusk + 0.045 * fg.cloud);
      audio.update(realDt);
      hudAcc += realDt;
      if (hudAcc > 0.05) {
        updateHud(hudAcc);
        hudAcc = 0;
        sentT += 0.05;
        if (sentT > 0.3 && stage === "flying") {
          sentT = 0;
          const sc = Math.round(liveScore());
          if (sc !== scoreSent) {
            scoreSent = sc;
            hooks.onScore(sc);
          }
        }
      }
      const sp = stage === "flying" ? frame.speed : 0;
      if (blur) blur.uniforms.uAmt.value = clamp((sp - 45) / 60, 0, 1) * 0.06 + (fl.s.boosting ? 0.03 : 0);
      if (grading) {
        grading.uniforms.uTime.value = menuTime;
        grading.uniforms.uDamage.value = damage;
        grading.uniforms.uFade.value = fade;
      }
      if (bloom) bloom.strength = (mobile ? 0.4 : 0.5) + clamp((sp - 60) / 100, 0, 0.25);
    }
    renderer.info.reset();
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  // --------------------------------------------------------------- loading
  hud.overlay.className = "nx-ov load on";
  hud.overlay.innerHTML = `<div class="nx-load"><div class="nx-kick">WINGSUIT DIVE // DISTRICT 07</div>
    <div class="nx-h2" style="margin-top:14px">CLIMBING THE SPIRE</div>
    <div class="bar"><i></i></div><div class="st"><span>SKY · CITY · SUIT</span><span class="pc">0%</span></div><div class="err"></div></div>`;
  const loadFill = hud.overlay.querySelector(".bar i") as HTMLElement;
  const loadPct = hud.overlay.querySelector(".pc") as HTMLElement;
  manager.onProgress = (_u, l, t) => {
    const p = t ? Math.round((l / t) * 100) : 0;
    loadFill.style.width = `${p}%`;
    loadPct.textContent = `${p}%`;
  };
  const gltfLoader = new GLTFLoader(manager);
  async function boot() {
    const solP = gltfLoader.loadAsync(`${ASSET}/models/soldier.glb`).catch((e) => {
      console.error("[FREEFALL] soldier", e);
      return null;
    });
    const hdrP = new HDRLoader(manager)
      .loadAsync(`${ASSET}/hdr/city_sunset.hdr`)
      .then((tex) => {
        if (disposed) return;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        pmrem = new THREE.PMREMGenerator(renderer);
        envRT = pmrem.fromEquirectangular(tex);
        tex.dispose();
        scene.environment = envRT.texture;
        scene.environmentIntensity = 0.3;
      })
      .catch(() => {});
    const [sol] = await Promise.all([solP, hdrP]);
    if (disposed) return;
    if (sol) {
      soldier = sol.scene;
      soldierClips = sol.animations;
      srcObjs.push(sol.scene);
    }
    seed = dailySeed();
    showMenu();
  }

  // --------------------------------------------------------------- dev hooks
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as Record<string, unknown>).__ff = {
      start: (o: { seed?: number; mode?: Mode } = {}) => {
        mode = o.mode ?? (o.seed ? "practice" : mode);
        seed = o.seed ?? (mode === "daily" ? dailySeed() : randomSeed());
        startCountdown();
      },
      autopilot: (on: boolean, o: { chuteMargin?: number; skill?: number; noChute?: boolean } = {}) => {
        autopilot = on ? { chuteMargin: o.chuteMargin ?? 38, skill: o.skill ?? 1, noChute: o.noChute } : null;
      },
      sim: (n: number) => (simBoost = Math.max(1, Math.floor(n))),
      menu: () => showMenu(),
      pause: () => pause(),
      resume: () => resume(),
      chute: () => (wantChute = true),
      cam: (m: 0 | 1) => (camMode = m),
      key: (k: string, down: boolean) => (down ? keys.add(k) : keys.delete(k)),
      /** Teleport along the centre line: f in 0..1 of path length; off = lateral/vertical offsets. */
      tp: (f: number, off: { x?: number; y?: number; z?: number } = {}) => {
        const i = clamp(Math.round(f * (course.N - 1)), 0, course.N - 2);
        const s = fl.s;
        const j = i + 1;
        let dx = course.px[j] - course.px[i];
        let dy = course.py[j] - course.py[i];
        let dz = course.pz[j] - course.pz[i];
        const l = Math.hypot(dx, dy, dz);
        dx /= l;
        dy /= l;
        dz /= l;
        s.px = course.px[i] + (off.x ?? 0);
        s.py = course.py[i] + (off.y ?? 0);
        s.pz = course.pz[i] + (off.z ?? 0);
        const v = Math.max(40, frame.speed);
        s.vx = dx * v;
        s.vy = dy * v;
        s.vz = dz * v;
        s.psi = Math.atan2(dx, -dz);
        nearestHint = i;
        camInit = true;
        jumpGrace = 1;
        if (stage === "countdown") jump();
        runT = Math.max(runT, 1.2);
      },
      freeze: (b: boolean) => (simBoost = b ? 0 : 1),
      query: (x: number, y: number, z: number) => world.query(x, y, z).d,
      path: (f: number) => {
        const i = clamp(Math.round(f * (course.N - 1)), 0, course.N - 1);
        return [course.px[i], course.py[i], course.pz[i]];
      },
      camAt: (p: number[] | null, l: number[] = [0, 0, 0]) => (camOverride = p ? { p, l } : null),
      get scene() {
        return scene;
      },
      get bloom() {
        return bloom;
      },
      get camera() {
        return camera;
      },
      get state() {
        const s = fl.s;
        return {
          stage,
          mode,
          seed,
          t: runT,
          pos: [s.px, s.py, s.pz],
          speed: frame.speed,
          kmh: Math.round(frame.speed * KMH),
          vy: s.vy,
          fuel: s.fuel,
          chute: s.chute,
          score: Math.round(liveScore()),
          pts: { ...pts },
          rings: ringsHit,
          ringTotal: course?.rings.length,
          nextRing,
          streak,
          proxMult,
          nearMisses,
          hits,
          outcome,
          crashWhy,
          crashBox,
          landDist,
          chuteAgl,
          chuteSpeed,
          maxSpeed,
          ghost: ghost ? { score: ghost.score, time: ghost.time, n: ghost.pts.length / 10 } : null,
          ghostVisible: ghostFlyer?.root.visible ?? false,
          chunks: world?.chunkCount,
          drawCalls: renderer.info.render.calls,
          tris: renderer.info.render.triangles,
          fps: 0,
        };
      },
      get course() {
        return { seed: course.seed, psi: course.start.psi, start: start.p.toArray(), hash: courseHash(course), N: course.N, rings: course.rings.length, towers: course.towers.length, len: course.plen, pad: course.pad };
      },
      get bests() {
        return bests;
      },
    };
  }

  raf = requestAnimationFrame(frameLoop);
  void boot();

  // --------------------------------------------------------------- dispose
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const off of listeners) off();
      ro?.disconnect();
      if (document.pointerLockElement) document.exitPointerLock?.();
      flyer?.dispose();
      ghostFlyer?.dispose();
      world?.dispose();
      for (const obj of srcObjs)
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
        });
      sparkGeo.dispose();
      sparkMat.dispose();
      stGeo.dispose();
      stMat.dispose();
      dotTex.dispose();
      envRT?.dispose();
      pmrem?.dispose();
      scene.environment = null;
      for (const p of composer?.passes ?? []) p.dispose();
      composer?.dispose();
      renderer.dispose();
      audio.dispose();
      sfx.dispose();
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      hud.root.remove();
      hud.style.remove();
      canvas.remove();
      if (process.env.NODE_ENV !== "production") delete (window as unknown as Record<string, unknown>).__ff;
    },
  };
}

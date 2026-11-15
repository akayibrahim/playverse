import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Ghost Range — v1.1 (upgraded).
 * Stylized-realistic dusk sniper range: 4 lanes (120/220/350/500 m),
 * pop-up HUMANOID targets (procedural low-poly characters: helmet, vest,
 * camo uniform, elbow/knee joints — idle breathing, head turns, weight
 * shifts; body hit = stagger then physical fall, head hit = instant
 * crumple), simplified-real ballistics (gravity drop + wind drift —
 * hold OVER at long range), mil-dot scope reticle, laser rangefinder
 * ("R: 487m"), headshot slow-mo with zoom punch, zoomable scope with
 * breath hold, muzzle smoke, rifle crack with echo. 5-round magazine
 * with reload. 60-second round.
 *
 * Contract (keep):
 *   createGame(container, hooks) => { dispose() }
 *   hooks: { onScore(s), onGameOver(s, stats), onPopup(text), best }
 */

export type SniperHooks = {
  onScore?: (score: number) => void;
  onGameOver?: (
    score: number,
    stats: { label: string; value: string }[],
  ) => void;
  onPopup?: (text: string) => void;
  best?: number; // geçilince onPopup "NEW BEST" tetikler
};

/* ---------- tuning ---------- */

const LANE_DIST = [120, 220, 350, 500];
const LANE_WEIGHT = [0.34, 0.28, 0.22, 0.16];
const ROUND_TIME = 60;
const MAG_SIZE = 5;
const RELOAD_TIME = 2;
const FIRE_COOLDOWN = 1.2;
const MUZZLE_V = 340; // m/s — basit balistik model
const ZOOM_STEPS = [1, 2.5, 6, 10];
const FOV_STEPS = [70, 30, 14, 7];
const YAW_LIMIT = THREE.MathUtils.degToRad(30);
const PITCH_MIN = THREE.MathUtils.degToRad(-10);
const PITCH_MAX = THREE.MathUtils.degToRad(25);
const EYE_H = 1.7;

/* ---------- audio (tiny synth, zero assets) ---------- */

let audioCtx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function ensureAudio() {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    /* audio optional */
  }
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    const len = Math.floor(ctx.sampleRate * 1.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  slideTo?: number,
  at = 0,
) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime + at;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst(
  dur: number,
  vol: number,
  cutoff: number,
  at = 0,
  filterType: BiquadFilterType = "lowpass",
) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime + at;
  const src = audioCtx.createBufferSource();
  src.buffer = getNoiseBuffer(audioCtx);
  const flt = audioCtx.createBiquadFilter();
  flt.type = filterType;
  flt.frequency.value = cutoff;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt).connect(gain).connect(audioCtx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const sfx = {
  fire: () => {
    noiseBurst(0.07, 0.45, 3600); // muzzle crack
    noiseBurst(0.3, 0.3, 480, 0.01); // body
    tone(64, 0.28, "sine", 0.45, 30); // thump
    // distant echo — vadiye çarpıp geri dönen daha sessiz ikinci patlama
    noiseBurst(0.22, 0.16, 900, 0.35);
    noiseBurst(0.45, 0.08, 320, 0.4);
  },
  bolt: () => {
    tone(1300, 0.03, "square", 0.1, undefined, 0.38); // click…
    noiseBurst(0.03, 0.1, 2600, 0.38, "highpass");
    tone(840, 0.05, "square", 0.1, undefined, 0.52); // …clack
    noiseBurst(0.04, 0.09, 2100, 0.52, "highpass");
  },
  empty: () => tone(320, 0.05, "square", 0.13, 210),
  // gövde isabeti: metalik clang — hızlı pes düşen kare dalga
  hit: () => {
    tone(1250, 0.07, "square", 0.2, 430);
    tone(2500, 0.05, "square", 0.07, 1400, 0.015);
  },
  // kafa isabeti: keskin tick + iki nota + yavaşlayan kuyruk
  headshot: () => {
    tone(2400, 0.03, "square", 0.2, 1500);
    tone(880, 0.08, "square", 0.19);
    tone(1320, 0.12, "square", 0.19, undefined, 0.08);
    tone(430, 0.6, "sine", 0.11, 90, 0.12); // slowed tail
  },
  // ıskalama ama hedefin 3m yakınından geçen mermi: whiz
  whiz: () => tone(2600, 0.14, "sine", 0.15, 500),
  // toprağa düşen mermi: uzak "thud"
  thud: () => {
    tone(95, 0.16, "sine", 0.15, 45);
    noiseBurst(0.12, 0.1, 240);
  },
  streak: (n: number) => {
    const p = 520 + Math.min(8, n) * 55;
    tone(p, 0.14, "triangle", 0.15, p * 1.4);
  },
  reload: () => {
    tone(560, 0.04, "square", 0.13);
    tone(420, 0.05, "square", 0.13, undefined, 0.12);
    tone(700, 0.04, "square", 0.13, undefined, 1.5);
    tone(920, 0.06, "square", 0.15, undefined, 1.85);
  },
  zoom: () => tone(1150, 0.035, "sine", 0.05),
  best: () => tone(660, 0.4, "triangle", 0.15, 990),
};

/* ambient wind loop — quiet filtered noise, optional atmosphere */

let windNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

function startWindAmbience() {
  if (!audioCtx || audioCtx.state !== "running" || windNodes) return;
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = getNoiseBuffer(audioCtx);
    src.loop = true;
    const flt = audioCtx.createBiquadFilter();
    flt.type = "lowpass";
    flt.frequency.value = 420;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.03;
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(flt).connect(gain).connect(audioCtx.destination);
    src.start();
    lfo.start();
    windNodes = { src, gain };
  } catch {
    /* optional */
  }
}

function stopWindAmbience() {
  if (!windNodes) return;
  try {
    windNodes.src.stop();
    windNodes.gain.disconnect();
  } catch {
    /* yut */
  }
  windNodes = null;
}

/* ---------- helpers ---------- */

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

function fovForZoom(z: number): number {
  if (z <= ZOOM_STEPS[0]) return FOV_STEPS[0];
  for (let i = 0; i < ZOOM_STEPS.length - 1; i++) {
    const z0 = ZOOM_STEPS[i];
    const z1 = ZOOM_STEPS[i + 1];
    if (z <= z1) {
      const f =
        (Math.log(z) - Math.log(z0)) / (Math.log(z1) - Math.log(z0));
      return FOV_STEPS[i] + (FOV_STEPS[i + 1] - FOV_STEPS[i]) * f;
    }
  }
  return FOV_STEPS[FOV_STEPS.length - 1];
}

function makeSoftTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ---------- game ---------- */

type TargetState = "idle" | "rising" | "up" | "stagger" | "falling" | "sinking";
type HitPart = "head" | "torso" | "arm" | "leg";
type FallMode = "fall" | "crumple";

type TargetObj = {
  group: THREE.Group; // root — ayak tabanları pivot (y=0 zemin)
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  chest: THREE.Mesh;
  arms: { g: THREE.Group; elbow: THREE.Group }[];
  legs: { g: THREE.Group; knee: THREE.Group }[];
  parts: THREE.Mesh[]; // raycast hit zones
  mats: THREE.MeshStandardMaterial[]; // fade için
  state: TargetState;
  t: number;
  upTime: number;
  lane: number;
  dist: number;
  baseZ: number;
  fast: boolean;
  fallMode: FallMode;
  fallDir: number;
  phase: number;
  idleTimer: number;
  headYaw: number;
  shiftX: number;
};

export function createGame(
  container: HTMLElement,
  hooks: SniperHooks = {},
): { dispose: () => void } {
  const width = container.clientWidth;
  const height = container.clientHeight;

  /* renderer — no alpha: sahne kendi arka planını çizer */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1e); // gece lacivert gökyüzü
  scene.fog = new THREE.FogExp2(0x232848, 0.0017); // alacakaranlık pusu

  const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1600);
  camera.rotation.order = "YXZ";
  camera.position.set(0, EYE_H, 0);
  scene.add(camera);

  /* post: çok hafif bloom — neon değil, atmosfer */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.35,
    0.4,
    0.6,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* PBR environment */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  /* lights: alçak güneş + gökyüzü/ground hemisferi */
  const hemi = new THREE.HemisphereLight(0x33405e, 0x141118, 0.9);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xffa065, 0.65);
  sunLight.position.set(-140, 40, -500);
  scene.add(sunLight);

  /* sky dome — ufukta mor alacakaranlık, tepede lacivert */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x0a0f1e) },
      horizonColor: { value: new THREE.Color(0x272b4d) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, 0.55)), 1.0);
      }`,
  });
  const skyGeo = new THREE.SphereGeometry(1200, 24, 16);
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  /* low sun glow on the horizon */
  const sunCoreGeo = new THREE.SphereGeometry(26, 20, 14);
  const sunCoreMat = new THREE.MeshBasicMaterial({
    color: 0xffb36b,
    fog: false,
  });
  const sunCore = new THREE.Mesh(sunCoreGeo, sunCoreMat);
  sunCore.position.set(-140, 34, -900);
  scene.add(sunCore);
  const sunHaloGeo = new THREE.SphereGeometry(85, 20, 14);
  const sunHaloMat = new THREE.MeshBasicMaterial({
    color: 0xff9a4a,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const sunHalo = new THREE.Mesh(sunHaloGeo, sunHaloMat);
  sunHalo.position.copy(sunCore.position);
  scene.add(sunHalo);

  /* distant mountain silhouettes (fog'dan muaf, düz siyah biçimler) */
  const mountainGeo = new THREE.ConeGeometry(1, 1, 5);
  const mountainMat = new THREE.MeshBasicMaterial({
    color: 0x0c111d,
    fog: false,
  });
  for (let i = 0; i < 7; i++) {
    const h = 90 + Math.random() * 130;
    const rad = 170 + Math.random() * 140;
    const m = new THREE.Mesh(mountainGeo, mountainMat);
    m.scale.set(rad, h, rad);
    m.position.set(
      (i - 3) * 270 + (Math.random() - 0.5) * 150,
      h / 2 - 8,
      -800 - Math.random() * 260,
    );
    scene.add(m);
  }

  /* ground — desatüre alacakaranlık çölü */
  const groundGeo = new THREE.PlaneGeometry(1600, 1600);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1a2030,
    roughness: 0.95,
    metalness: 0.05,
    envMapIntensity: 0.25,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  /* scattered rocks — mesafe algısı için derinlik referansı */
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x242a33,
    roughness: 1,
  });
  for (let i = 0; i < 40; i++) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const s = 0.3 + Math.random() * 0.9;
    rock.scale.set(s, s * 0.7, s);
    rock.position.set(
      (Math.random() - 0.5) * 140,
      s * 0.25,
      -(8 + Math.random() * 560),
    );
    rock.rotation.y = Math.random() * Math.PI;
    scene.add(rock);
  }

  /* lane marker posts — amber lampong mesafe referansı */
  const poleGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x2a3020,
    roughness: 0.9,
  });
  const lampGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x442c10,
    emissive: 0xffb84d,
    emissiveIntensity: 1.4,
  });
  for (const dist of LANE_DIST) {
    for (const x of [-24, 0, 24]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 0.5, -dist);
      scene.add(pole);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, 1.06, -dist);
      scene.add(lamp);
    }
  }

  /* pop-up humanoid hedefler — tamamen prosedürel low-poly karakterler
     (1.8m insan oranı; ortak geometriler, hedef başına camo rastgele ton) */
  const rigGeo = {
    head: new THREE.SphereGeometry(0.115, 14, 12),
    helmet: new THREE.SphereGeometry(
      0.14,
      14,
      8,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.55,
    ),
    neck: new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8),
    torso: new THREE.CylinderGeometry(0.19, 0.14, 0.52, 10),
    pelvis: new THREE.BoxGeometry(0.3, 0.2, 0.17),
    vest: new THREE.BoxGeometry(0.27, 0.3, 0.05),
    upperArm: new THREE.CylinderGeometry(0.058, 0.05, 0.3, 8),
    foreArm: new THREE.CylinderGeometry(0.05, 0.042, 0.28, 8),
    hand: new THREE.BoxGeometry(0.08, 0.1, 0.05),
    thigh: new THREE.CylinderGeometry(0.095, 0.08, 0.42, 8),
    shin: new THREE.CylinderGeometry(0.072, 0.055, 0.42, 8),
    boot: new THREE.BoxGeometry(0.12, 0.1, 0.26),
  };

  function makeTargetMats() {
    const jitter = () => Math.random() - 0.5;
    const std = (h: number, s: number, l: number) => {
      const col = new THREE.Color().setHSL(
        h + jitter() * 0.02,
        Math.max(0.05, s + jitter() * 0.05),
        Math.min(0.6, Math.max(0.06, l + jitter() * 0.05)),
      );
      return new THREE.MeshStandardMaterial({
        color: col,
        emissive: col.clone().multiplyScalar(0.4), // alacakaranlıkta okunurluk
        emissiveIntensity: 0.28,
        roughness: 0.85,
        metalness: 0.05,
        transparent: true, // sink fade
      });
    };
    return {
      uniform: std(0.19, 0.3, 0.3), // zeytin/khaki üniforma
      pants: std(0.16, 0.18, 0.19), // koyu pantolon
      skin: std(0.07, 0.4, 0.44), // ten
      helmet: std(0.2, 0.26, 0.23),
      vest: std(0.15, 0.2, 0.15),
      boots: std(0.1, 0.12, 0.11),
    };
  }

  const targets: TargetObj[] = [];
  const meshPart = (
    geo: THREE.BufferGeometry,
    mat: THREE.MeshStandardMaterial,
    part: HitPart,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.userData.part = part;
    return m;
  };

  for (let i = 0; i < 4; i++) {
    const mats = makeTargetMats();
    const root = new THREE.Group();

    // kalça bloğu + üst gövde hiyerarşisi
    const hips = new THREE.Group();
    hips.position.y = 1.0;
    root.add(hips);
    const pelvis = meshPart(rigGeo.pelvis, mats.pants, "torso");
    pelvis.position.y = -0.02;
    hips.add(pelvis);

    const torso = new THREE.Group();
    torso.position.y = 0.2; // dünya ~1.2
    hips.add(torso);
    const chest = meshPart(rigGeo.torso, mats.uniform, "torso");
    chest.position.y = 0.06; // gövde 1.0–1.52 arası
    torso.add(chest);
    const vest = meshPart(rigGeo.vest, mats.vest, "torso");
    vest.position.set(0, 0.12, 0.075); // göğüs önü vest şeridi
    torso.add(vest);
    const neck = meshPart(rigGeo.neck, mats.skin, "torso");
    neck.position.y = 0.38;
    torso.add(neck);

    const head = new THREE.Group();
    head.position.y = 0.47; // dünya ~1.67
    torso.add(head);
    const headMesh = meshPart(rigGeo.head, mats.skin, "head");
    headMesh.position.y = 0.02;
    head.add(headMesh);
    const helmet = meshPart(rigGeo.helmet, mats.helmet, "head");
    helmet.position.y = 0.045;
    head.add(helmet);

    // kollar — omuz pivotu + dirsek bükümü + el
    const arms: TargetObj["arms"] = [];
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const g = new THREE.Group();
      g.position.set(side * 0.21, 0.26, 0);
      g.rotation.z = side * 0.1;
      const upper = meshPart(rigGeo.upperArm, mats.uniform, "arm");
      upper.position.y = -0.15;
      g.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      elbow.rotation.x = -0.35; // doğal dirsek bükümü (öne)
      const fore = meshPart(rigGeo.foreArm, mats.uniform, "arm");
      fore.position.y = -0.14;
      elbow.add(fore);
      const hand = meshPart(rigGeo.hand, mats.skin, "arm");
      hand.position.y = -0.31;
      elbow.add(hand);
      g.add(elbow);
      torso.add(g);
      arms.push({ g, elbow });
    }

    // bacaklar — kalça pivotu + diz + bot (root'a bağlı: hips çöküşü etkilemez)
    const legs: TargetObj["legs"] = [];
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const g = new THREE.Group();
      g.position.set(side * 0.1, 1.0, 0);
      const thigh = meshPart(rigGeo.thigh, mats.pants, "leg");
      thigh.position.y = -0.21;
      g.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      knee.rotation.x = 0.06;
      const shin = meshPart(rigGeo.shin, mats.pants, "leg");
      shin.position.y = -0.21;
      knee.add(shin);
      const boot = meshPart(rigGeo.boot, mats.boots, "leg");
      boot.position.set(0, -0.44, 0.04);
      knee.add(boot);
      g.add(knee);
      root.add(g);
      legs.push({ g, knee });
    }

    root.position.y = -2.4;
    root.visible = false;
    scene.add(root);

    const parts: THREE.Mesh[] = [headMesh, helmet, chest, vest, neck, pelvis];
    for (const a of arms) {
      for (const c of a.g.children) parts.push(c as THREE.Mesh);
    }
    for (const l of legs) {
      for (const c of l.g.children) parts.push(c as THREE.Mesh);
    }

    const tg: TargetObj = {
      group: root,
      hips,
      torso,
      head,
      chest,
      arms,
      legs,
      parts,
      mats: Object.values(mats),
      state: "idle",
      t: 0,
      upTime: 4,
      lane: 0,
      dist: 120,
      baseZ: -120,
      fast: false,
      fallMode: "fall",
      fallDir: -1,
      phase: 0,
      idleTimer: 2,
      headYaw: 0,
      shiftX: 0,
    };
    for (const p of parts) p.userData.tg = tg;
    targets.push(tg);
  }

  function resetPose(tg: TargetObj) {
    tg.group.rotation.set(0, 0, 0);
    tg.hips.position.set(0, 1.0, 0);
    tg.torso.rotation.set(0, 0, 0);
    tg.head.rotation.set(0, 0, 0);
    tg.chest.scale.set(1, 1, 1);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      tg.arms[i].g.rotation.set(0, 0, side * 0.1);
      tg.arms[i].elbow.rotation.set(-0.35, 0, 0);
      tg.legs[i].g.rotation.set(0, 0, 0);
      tg.legs[i].knee.rotation.set(0.06, 0, 0);
    }
    for (const m of tg.mats) m.opacity = 1;
    tg.headYaw = 0;
    tg.shiftX = 0;
  }

  function spawnTarget() {
    const tg = targets.find((x) => x.state === "idle");
    if (!tg) return;
    let lane = 0;
    const r = Math.random();
    let acc = 0;
    for (let i = 0; i < LANE_WEIGHT.length; i++) {
      acc += LANE_WEIGHT[i];
      if (r < acc) {
        lane = i;
        break;
      }
    }
    tg.lane = lane;
    tg.dist = LANE_DIST[lane];
    tg.baseZ = -tg.dist;
    tg.group.position.set(
      (Math.random() * 2 - 1) * 25,
      -2.4,
      tg.baseZ,
    );
    resetPose(tg);
    tg.group.visible = true;
    tg.state = "rising";
    tg.t = 0;
    tg.upTime = 3 + Math.random() * 2;
    tg.fast = false;
    tg.fallMode = "fall";
    tg.fallDir = -1;
    tg.phase = Math.random() * 10;
    tg.idleTimer = 1.5 + Math.random() * 2;
  }

  /* tracers — namludan çarpma noktasına hızla solan parlak çizgi */
  const tracerPool: {
    line: THREE.Line;
    mat: THREE.LineBasicMaterial;
    life: number;
    max: number;
  }[] = [];
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    const mat = new THREE.LineBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, mat, life: 0, max: 0.13 });
  }
  let tracerIdx = 0;

  function spawnTracer(from: THREE.Vector3, to: THREE.Vector3) {
    const tr = tracerPool[tracerIdx % tracerPool.length];
    tracerIdx++;
    const arr = tr.line.geometry.attributes.position
      .array as Float32Array;
    arr[0] = from.x;
    arr[1] = from.y;
    arr[2] = from.z;
    arr[3] = to.x;
    arr[4] = to.y;
    arr[5] = to.z;
    tr.line.geometry.attributes.position.needsUpdate = true;
    tr.life = tr.max;
    tr.line.visible = true;
  }

  /* impact dust + muzzle flash sprite (paylaşılan yumuşak doku) */
  const puffTex = makeSoftTexture();
  const dustPool: {
    sprite: THREE.Sprite;
    mat: THREE.SpriteMaterial;
    life: number;
    max: number;
    size: number;
  }[] = [];
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.SpriteMaterial({
      map: puffTex,
      color: 0x9a8a70,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    dustPool.push({ sprite, mat, life: 0, max: 0.55, size: 1 });
  }
  let dustIdx = 0;

  function spawnDust(pos: THREE.Vector3, dist: number) {
    const d = dustPool[dustIdx % dustPool.length];
    dustIdx++;
    d.sprite.position.copy(pos);
    d.size = 0.35 + dist * 0.011;
    d.sprite.scale.setScalar(d.size * 0.6);
    d.life = d.max;
    d.sprite.visible = true;
  }

  const flashLight = new THREE.PointLight(0xffb46a, 0, 22, 1.6);
  scene.add(flashLight);

  /* muzzle smoke — namluda genişleyip solan additive sprite puff */
  const smokePool: {
    sprite: THREE.Sprite;
    mat: THREE.SpriteMaterial;
    life: number;
    max: number;
    size: number;
    vy: number;
  }[] = [];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.SpriteMaterial({
      map: puffTex,
      color: 0x9a948c,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    smokePool.push({ sprite, mat, life: 0, max: 0.55, size: 0.55, vy: 0.6 });
  }
  let smokeIdx = 0;

  function spawnSmoke(pos: THREE.Vector3) {
    const s = smokePool[smokeIdx % smokePool.length];
    smokeIdx++;
    s.sprite.position.copy(pos);
    s.size = 0.5 + Math.random() * 0.25;
    s.vy = 0.45 + Math.random() * 0.45;
    s.max = 0.5 + Math.random() * 0.2;
    s.life = s.max;
    s.sprite.scale.setScalar(s.size * 0.4);
    s.sprite.visible = true;
  }

  /* ---------- state ---------- */

  let yaw = 0;
  let pitch = 0;
  let rawYaw = 0; // hedef açılar (yumuşatma öncesi)
  let rawPitch = 0;
  let zoomTarget = 1;
  let recoil = 0;
  let swayYaw = 0;
  let swayPitch = 0;
  let shiftHeld = false;
  let longPress = false;
  let breathMul = 1;
  let breathMeter = 1;
  let exhaleT = 0;

  let score = 0;
  let hits = 0;
  let headshots = 0;
  let bestShot = 0;
  let streak = 0;
  let bestBeaten = false;

  let ammo = MAG_SIZE;
  let reloading = false;
  let reloadT = 0;
  let cooldown = 0;

  let timeLeft = ROUND_TIME;
  let spawnT = 1.2;
  let over = false;
  let disposed = false;

  const wind = Math.random() * 5 * (Math.random() < 0.5 ? -1 : 1);

  const raycaster = new THREE.Raycaster();
  raycaster.far = 900;
  const eulerTmp = new THREE.Euler(0, 0, 0, "YXZ");
  const dirTmp = new THREE.Vector3();

  /* ---------- DOM overlays (scope + controls), container içinde ---------- */

  const scopeEl = document.createElement("div");
  scopeEl.style.cssText =
    "position:absolute;inset:0;z-index:4;pointer-events:none;opacity:0;" +
    "transition:opacity 0.25s ease;user-select:none;-webkit-user-select:none";
  /* lens blur ring — dairesel kesitin hemen içinde yumuşak koyu halka */
  const lensBlur = document.createElement("div");
  lensBlur.style.cssText =
    "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
    "border-radius:50%;pointer-events:none";
  const scopeRing = document.createElement("div");
  scopeRing.style.cssText =
    "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
    "border-radius:50%;border:2px solid rgba(215,235,255,0.16)";
  /* ince tam çapraz — gerçek dürbünde olduğu gibi koyu hat */
  const crossH = document.createElement("div");
  crossH.style.cssText =
    "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
    "height:1px;background:rgba(6,10,8,0.78);" +
    "box-shadow:0 0 0 1px rgba(200,255,225,0.1)";
  const crossV = document.createElement("div");
  crossV.style.cssText =
    "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
    "width:1px;background:rgba(6,10,8,0.78);" +
    "box-shadow:0 0 0 1px rgba(200,255,225,0.1)";
  /* kalın stangentlar — kenardan merkeze, klassik mil-dot post'ları */
  const postT = document.createElement("div");
  const postB = document.createElement("div");
  const postL = document.createElement("div");
  const postR = document.createElement("div");
  for (const p of [postT, postB, postL, postR]) {
    p.style.cssText =
      "position:absolute;left:50%;top:50%;background:rgba(5,8,6,0.92);" +
      "box-shadow:0 0 0 1px rgba(200,255,225,0.14)";
  }
  /* alt dikey hatta mil-dot'lar — zoom'a göre gerçek açısal aralık */
  const reticleDots: HTMLDivElement[] = [];
  for (let i = 0; i < 5; i++) {
    const d = document.createElement("div");
    d.style.cssText =
      "position:absolute;left:50%;top:50%;width:3px;height:3px;" +
      "border-radius:50%;background:rgba(255,205,130,0.85);" +
      "box-shadow:0 0 3px rgba(255,180,90,0.6);" +
      "transform:translate(-50%,-50%)";
    reticleDots.push(d);
  }
  const crossDot = document.createElement("div");
  crossDot.style.cssText =
    "position:absolute;left:50%;top:50%;width:3px;height:3px;" +
    "transform:translate(-50%,-50%);border-radius:50%;" +
    "background:rgba(255,210,138,0.95);" +
    "box-shadow:0 0 4px rgba(255,190,110,0.8)";
  const strip = document.createElement("div");
  strip.style.cssText =
    "position:absolute;left:50%;bottom:16px;transform:translateX(-50%);" +
    "display:flex;align-items:center;gap:14px;padding:7px 14px;" +
    "font:600 12px/1 system-ui,sans-serif;color:#cfe0da;" +
    "background:rgba(4,7,12,0.55);border:1px solid rgba(255,255,255,0.1);" +
    "border-radius:8px;white-space:nowrap";
  const windSpan = document.createElement("span");
  const zoomSpan = document.createElement("span");
  const rangeSpan = document.createElement("span");
  rangeSpan.textContent = "R: ---";
  const timeSpan = document.createElement("span");
  const breathWrap = document.createElement("span");
  breathWrap.style.cssText =
    "display:inline-block;width:72px;height:5px;border-radius:3px;" +
    "background:rgba(255,255,255,0.15);overflow:hidden;vertical-align:middle";
  const breathBar = document.createElement("span");
  breathBar.style.cssText =
    "display:block;height:100%;width:100%;background:#8fe0b0";
  breathWrap.appendChild(breathBar);
  strip.append(windSpan, zoomSpan, rangeSpan, timeSpan, breathWrap);
  scopeEl.append(
    lensBlur,
    scopeRing,
    crossH,
    crossV,
    postT,
    postB,
    postL,
    postR,
    ...reticleDots,
    crossDot,
    strip,
  );
  container.appendChild(scopeEl);

  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.setAttribute("aria-label", "Reload");
  reloadBtn.style.cssText =
    "position:absolute;left:50%;bottom:14px;transform:translateX(-50%);" +
    "z-index:6;padding:10px 18px;font:700 12px/1 system-ui,sans-serif;" +
    "color:#ffd9a0;background:rgba(22,16,9,0.6);" +
    "border:1px solid rgba(255,196,110,0.5);border-radius:10px;" +
    "cursor:pointer;touch-action:manipulation;user-select:none;" +
    "-webkit-user-select:none;-webkit-tap-highlight-color:transparent";
  container.appendChild(reloadBtn);

  const hintEl = document.createElement("div");
  hintEl.style.cssText =
    "position:absolute;left:10px;top:10px;z-index:4;pointer-events:none;" +
    "font:500 11px/1.5 system-ui,sans-serif;color:rgba(255,255,255,0.38);" +
    "user-select:none;-webkit-user-select:none;max-width:70%";
  hintEl.textContent =
    "drag aim · tap / right-click / F fire · wheel or pinch zoom · " +
    "hold Shift (or press still) to steady · R reload";
  container.appendChild(hintEl);

  function updateAmmoChip() {
    if (over) {
      reloadBtn.style.display = "none";
      return;
    }
    reloadBtn.style.display = "";
    reloadBtn.textContent = reloading
      ? `RELOADING… ${reloadT.toFixed(1)}s`
      : `AMMO ${ammo}/${MAG_SIZE} · RELOAD`;
    reloadBtn.style.opacity = reloading || ammo === MAG_SIZE ? "0.6" : "1";
  }
  updateAmmoChip();

  function layoutScope() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const r = Math.round(Math.min(w, h) * 0.42);
    scopeEl.style.background =
      `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${r - 2}px, ` +
      `rgba(3,6,10,0.55) ${r - 1}px, rgba(2,4,8,0.97) ${r + 10}px)`;
    scopeRing.style.width = scopeRing.style.height = `${r * 2}px`;
    crossH.style.width = `${r * 2}px`;
    crossV.style.height = `${r * 2}px`;
    lensBlur.style.width = lensBlur.style.height = `${r * 2}px`;
    lensBlur.style.background =
      `radial-gradient(circle, rgba(0,0,0,0) ${Math.round(r * 0.68)}px, ` +
      `rgba(8,14,20,0.2) ${Math.round(r * 0.9)}px, rgba(0,0,0,0) ${r - 3}px)`;
    // kalın post'lar: kenardan merkeze ~%62'si, merkezde ince hat görünür
    const postLen = Math.round(r * 0.62);
    const inner = Math.round(r * 0.38);
    postB.style.width = postT.style.width = "3px";
    postL.style.height = postR.style.height = "3px";
    postB.style.height = postT.style.height = `${postLen}px`;
    postL.style.width = postR.style.width = `${postLen}px`;
    postB.style.transform = `translate(-50%, ${inner}px)`;
    postT.style.transform = `translate(-50%, ${-(inner + postLen)}px)`;
    postR.style.transform = `translate(${inner}px, -50%)`;
    postL.style.transform = `translate(${-(inner + postLen)}px, -50%)`;
  }
  layoutScope();

  /* headshot slow-mo — dünya 0.25x'e düşer, zoom hedefe doğru +1.5x punch */
  let slowmoT = 0;
  let zoomSaved = 0;
  let slowTarget: TargetObj | null = null;

  function triggerSlowMo(tg: TargetObj) {
    if (slowmoT <= 0) {
      zoomSaved = zoomTarget;
      slowTarget = tg;
    }
    slowmoT = 0.7;
    zoomTarget = Math.min(10, zoomTarget * 1.5);
  }

  /* laser rangefinder — dürbün alt şeridi "R: 487m" (~10Hz güncelleme).
     Isın hedefe yeterince yakın geçiyorsa hedefin mesafesi ölçülür. */
  const rangeRay = new THREE.Raycaster();
  rangeRay.far = 900;
  let rangeT = 0;
  const chestTmp = new THREE.Vector3();
  const rayToTmp = new THREE.Vector3();

  function updateRangefinder() {
    camera.getWorldDirection(dirTmp);
    rangeRay.set(camera.position, dirTmp);
    const list: THREE.Object3D[] = [ground];
    for (const tg of targets) {
      if (tg.state === "rising" || tg.state === "up" || tg.state === "stagger") {
        for (const p of tg.parts) list.push(p);
      }
    }
    let m: number | null = null;
    let onTarget = false;
    const first = rangeRay.intersectObjects(list, false)[0];
    if (first) {
      m = first.distance;
      onTarget = !!first.object.userData.part;
    }
    // ışının hedefe 2m'den yakın geçmesi → hedef mesafesi
    for (const tg of targets) {
      if (tg.state !== "up" && tg.state !== "rising" && tg.state !== "stagger") {
        continue;
      }
      tg.torso.getWorldPosition(chestTmp);
      rayToTmp.copy(chestTmp).sub(camera.position);
      const proj = rayToTmp.dot(dirTmp);
      if (proj <= 0) continue;
      const perpSq = rayToTmp.lengthSq() - proj * proj;
      if (perpSq < 4) {
        if (m === null || proj < m) m = proj;
        onTarget = true;
      }
    }
    const str = m === null ? "R: ---" : `R: ${Math.round(m)}m`;
    if (str !== rangeSpan.textContent) rangeSpan.textContent = str;
    rangeSpan.style.color = onTarget ? "#ffd28a" : "#cfe0da";
  }

  /* mil-dot pitch — 1 mil = 0.001 rad'ın ekran karşılığı (zoom'a ölçeklenir);
     okunabilirlik için noktalar 2 mil arayla, min 5.5px */
  let lastPitch = -1;

  function updateReticle() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    const r = Math.min(w, h) * 0.42;
    const milPx = (0.001 / ((camera.fov * Math.PI) / 180)) * (r * 2);
    const pitch = Math.max(milPx * 2, 5.5);
    if (Math.abs(pitch - lastPitch) < 0.25) return;
    lastPitch = pitch;
    for (let i = 0; i < reticleDots.length; i++) {
      reticleDots[i].style.transform = `translate(-50%,-50%) translateY(${(pitch * (i + 1)).toFixed(1)}px)`;
    }
  }

  /* ---------- actions ---------- */

  function startReload() {
    if (over || reloading || ammo >= MAG_SIZE) return;
    reloading = true;
    reloadT = RELOAD_TIME;
    sfx.reload();
    updateAmmoChip();
  }

  function cycleZoom(dir: 1 | -1) {
    if (over) return;
    let idx = 0;
    for (let i = 0; i < ZOOM_STEPS.length; i++) {
      if (ZOOM_STEPS[i] <= zoomTarget + 1e-6) idx = i;
    }
    idx = THREE.MathUtils.clamp(idx + dir, 0, ZOOM_STEPS.length - 1);
    if (ZOOM_STEPS[idx] !== zoomTarget) {
      zoomTarget = ZOOM_STEPS[idx];
      sfx.zoom();
    }
  }

  function tryFire() {
    if (over || reloading || cooldown > 0) return;
    if (ammo <= 0) {
      sfx.empty();
      startReload();
      return;
    }
    ammo--;
    cooldown = FIRE_COOLDOWN;
    recoil = 0.011;
    sfx.fire();
    sfx.bolt();

    /* ballistics: crosshair ray → drop + wind ile saptırılmış mermi rayı.
       İlk mesafe tahmini, sonra telafi, sonra tekrar ışın izleme. */
    const origin = camera.position;
    const pitchEff0 = pitch + swayPitch;
    const yawEff0 = yaw + swayYaw;
    let pitchB = pitchEff0;
    let yawB = yawEff0;

    const hitList: THREE.Object3D[] = [ground];
    for (const tg of targets) {
      if (tg.state === "rising" || tg.state === "up" || tg.state === "stagger") {
        for (const p of tg.parts) hitList.push(p);
      }
    }

    let impact: THREE.Vector3 | null = null;
    let hit: { tg: TargetObj; part: HitPart; point: THREE.Vector3 } | null =
      null;

    for (let iter = 0; iter < 3; iter++) {
      dirTmp.set(0, 0, -1).applyEuler(eulerTmp.set(pitchB, yawB, 0, "YXZ"));
      raycaster.set(origin, dirTmp);
      const objs = raycaster.intersectObjects(hitList, false);
      const first = objs.length ? objs[0] : null;
      if (first) {
        const part = first.object.userData.part as HitPart | undefined;
        if (part) {
          hit = {
            tg: first.object.userData.tg as TargetObj,
            part,
            point: first.point.clone(),
          };
          impact = hit.point;
          break;
        }
        impact = first.point.clone();
      }
      if (iter === 2) break;
      const d = first ? first.distance : 750;
      const drop = 4.9 * Math.pow(d / MUZZLE_V, 2); // m
      const drift = wind * (d / MUZZLE_V) * 0.15; // m
      pitchB = pitchEff0 - Math.atan2(drop, d); // mermi düşer
      yawB = yawEff0 - Math.atan2(drift, d); // rüzgâr sağa +x sürükler
    }

    const muzzle = origin
      .clone()
      .addScaledVector(dirTmp, 1.3);
    muzzle.y -= 0.22;
    const end =
      hit?.point ??
      impact ??
      origin.clone().addScaledVector(dirTmp, 750);
    spawnTracer(muzzle, end);
    flashLight.position.copy(muzzle);
    flashLight.intensity = 28;
    spawnSmoke(muzzle);
    if (impact && !hit) {
      spawnDust(impact, impact.distanceTo(origin));
      sfx.thud(); // zemine düşen mermi — uzak gümleme
      // hedefin 3m yakınından geçen mermi → whiz
      let nearest = Infinity;
      for (const tg of targets) {
        if (
          tg.state !== "up" &&
          tg.state !== "rising" &&
          tg.state !== "stagger"
        ) {
          continue;
        }
        tg.torso.getWorldPosition(chestTmp);
        nearest = Math.min(nearest, impact.distanceTo(chestTmp));
      }
      if (nearest < 3) sfx.whiz();
    }

    if (hit) {
      const tg = hit.tg;
      const isHead = hit.part === "head";
      let pts = (isHead ? 100 : 50) + tg.lane * 25;
      if (hit.part === "leg") pts += 15; // low bonus
      score += pts;
      hits++;
      if (isHead) headshots++;
      if (tg.dist > bestShot) bestShot = tg.dist;
      streak++;
      hooks.onScore?.(score);
      hooks.onPopup?.(
        `${isHead ? "HEADSHOT" : hit.part === "leg" ? "LOW" : "HIT"} +${pts}`,
      );
      if (isHead) {
        sfx.headshot();
        triggerSlowMo(tg);
      } else {
        sfx.hit();
      }
      if (streak % 3 === 0) {
        hooks.onPopup?.(`STREAK x${streak} 🔥`);
        sfx.streak(streak);
      }
      if (!bestBeaten && hooks.best && hooks.best > 0 && score > hooks.best) {
        bestBeaten = true;
        hooks.onPopup?.("🏆 NEW BEST!");
        sfx.best();
      }
      if (isHead) {
        // kafa → anında ragdoll-vari çöküş
        tg.state = "falling";
        tg.t = 0;
        tg.fast = true;
        tg.fallMode = "crumple";
        tg.fallDir = -(0.9 + Math.random() * 0.25);
      } else if (tg.state === "stagger") {
        // sendelerken ikinci isabet → direkt düşüş
        tg.state = "falling";
        tg.t = 0;
        tg.fast = true;
        tg.fallMode = "fall";
        tg.fallDir = -(0.9 + Math.random() * 0.25);
      } else {
        // gövde/kol/bacak → önce sendeleme (twist + geri adım), sonra düşüş
        tg.state = "stagger";
        tg.t = 0;
        tg.fast = true;
        tg.fallDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else {
      streak = 0;
    }

    if (ammo === 0) startReload();
    updateAmmoChip();
  }

  /* ---------- input ---------- */

  const pointers = new Map<
    number,
    { x: number; y: number; moved: number; t0: number }
  >();
  let pinchBase = 0;
  let pinchZoom0 = 1;
  let pinching = false;
  let lastTapAt = 0;

  const onPointerDown = (e: PointerEvent) => {
    ensureAudio();
    startWindAmbience();
    if (over) return;
    if (e.button !== 0) {
      if (e.button === 2) tryFire(); // sağ tık = ateş
      return;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture optional */
    }
    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      moved: 0,
      t0: performance.now(),
    });
    longPress = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchBase = Math.hypot(a.x - b.x, a.y - b.y);
      pinchZoom0 = zoomTarget;
      pinching = true;
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p || over) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);
    if (pinching && pointers.size >= 2 && pinchBase > 0) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomTarget = THREE.MathUtils.clamp(
        pinchZoom0 * (d / pinchBase),
        1,
        10,
      );
      return;
    }
    if (p.moved > 8) longPress = false;
    // ekran genişliğine göre normalize + zoom'a göre incelen hassasiyet
    const sens = (1.6 / Math.max(container.clientWidth, 300)) * (camera.fov / 70);
    rawYaw = THREE.MathUtils.clamp(rawYaw - dx * sens, -YAW_LIMIT, YAW_LIMIT);
    rawPitch = THREE.MathUtils.clamp(
      rawPitch - dy * sens,
      PITCH_MIN,
      PITCH_MAX,
    );
  };

  const onPointerUp = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    const wasPinch = pinching;
    if (pointers.size < 2) pinching = false;
    longPress = false;
    if (!p || over) return;
    const dur = performance.now() - p.t0;
    if (wasPinch || p.moved > 12 || dur > 320) return;
    if (e.pointerType !== "mouse") {
      const now = performance.now();
      if (now - lastTapAt < 320) {
        lastTapAt = 0;
        cycleZoom(1); // çift dokunuş = zoom
        return;
      }
      lastTapAt = now;
    }
    tryFire(); // tap = ateş
  };

  const onPointerCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinching = false;
    longPress = false;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (over) return;
    cycleZoom(e.deltaY < 0 ? 1 : -1);
  };

  const onCtx = (e: Event) => e.preventDefault();

  const onKeyDown = (e: KeyboardEvent) => {
    ensureAudio();
    startWindAmbience();
    if (e.key === "Shift") shiftHeld = true;
    if (over) return;
    if (e.key === "f" || e.key === "F") tryFire();
    if ((e.key === "r" || e.key === "R") && !e.repeat) startReload();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Shift") shiftHeld = false;
  };

  const onReloadBtn = (e: Event) => {
    e.preventDefault();
    ensureAudio();
    startReload();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onCtx);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  reloadBtn.addEventListener("click", onReloadBtn);

  /* ---------- loop ---------- */

  const clock = new THREE.Clock();
  let lastWindStr = "";
  let lastZoomStr = "";
  let lastTimeStr = "";
  let scopeShown = false;

  function tick() {
    if (disposed) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    /* long-press breath (mobile): tek parmak, hareketsiz, >260ms */
    if (!longPress && !pinching && pointers.size === 1) {
      const p = [...pointers.values()][0];
      if (p && performance.now() - p.t0 > 260 && p.moved <= 8) {
        longPress = true;
      }
    }

    /* breath state machine */
    if (exhaleT > 0) {
      exhaleT -= dt;
      breathMul += (1.6 - breathMul) * Math.min(1, dt * 6);
      if (exhaleT <= 0) breathMul = 1.6;
    } else if (longPress || shiftHeld) {
      if (breathMeter > 0) {
        breathMul += (0 - breathMul) * Math.min(1, dt * 5);
        breathMeter = Math.max(0, breathMeter - dt / 5); // 5 sn nefes tutma
        if (breathMeter <= 0) exhaleT = 0.8; // zorla nefes ver
      } else {
        breathMul += (1 - breathMul) * Math.min(1, dt * 4);
        breathMeter = Math.min(1, breathMeter + dt / 2);
      }
    } else {
      breathMul += (1 - breathMul) * Math.min(1, dt * 4);
      breathMeter = Math.min(1, breathMeter + dt / 2);
    }

    /* headshot slow-mo: dünya 0.25x, zoom punch geri döner, nişan yumuşakça
       düşen hedefe çekilir (oyun zamanı değil dünya zamanı yavaşlar) */
    if (slowmoT > 0) {
      slowmoT -= dt;
      if (slowTarget) {
        const p = slowTarget.group.position;
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        const hy = Math.hypot(dx, dz) || 1;
        const wantYaw = Math.atan2(-dx, -dz);
        const wantPitch = Math.atan2(p.y + 1.1 - camera.position.y, hy);
        rawYaw += THREE.MathUtils.clamp(wantYaw - rawYaw, -0.03, 0.03) * Math.min(1, dt * 3);
        rawPitch +=
          THREE.MathUtils.clamp(wantPitch - rawPitch, -0.02, 0.02) *
          Math.min(1, dt * 3);
      }
      if (slowmoT <= 0) {
        slowmoT = 0;
        slowTarget = null;
        if (zoomSaved) {
          zoomTarget = zoomSaved;
          zoomSaved = 0;
        }
      }
    }
    const timeScale = slowmoT > 0 ? 0.25 : 1;
    const sdt = dt * timeScale; // dünya zamanı

    /* aim smoothing — nişan yumuşak oturur, sarsak hissi yok */
    yaw += (rawYaw - yaw) * Math.min(1, dt * 12);
    pitch += (rawPitch - pitch) * Math.min(1, dt * 12);

    /* sway — zoom'la yumuşak ölçeklenir (10x'te bile 2 katı değil), nefes tutunca söner */
    const amp = 0.0015 * (1 + (70 / camera.fov - 1) * 0.125) * breathMul;
    swayYaw =
      amp * (Math.sin(t * 1.1) * 0.7 + Math.sin(t * 2.33 + 1.7) * 0.3);
    swayPitch =
      amp * (Math.sin(t * 1.47 + 0.6) * 0.75 + Math.sin(t * 2.71 + 0.2) * 0.25);

    recoil *= Math.exp(-dt * 9);
    cooldown = Math.max(0, cooldown - dt);

    /* reload */
    if (reloading) {
      reloadT -= dt;
      if (reloadT <= 0) {
        reloading = false;
        ammo = MAG_SIZE;
        updateAmmoChip();
      } else if (Math.floor(reloadT * 10) % 3 === 0) {
        updateAmmoChip();
      }
    }

    /* camera: aim + sway + recoil */
    camera.rotation.set(pitch + swayPitch + recoil, yaw + swayYaw, 0);

    /* zoom FOV lerp */
    camera.fov += (fovForZoom(zoomTarget) - camera.fov) * Math.min(1, dt * 9);
    camera.updateProjectionMatrix();

    /* scope overlay visibility + strip */
    const showScope = camera.fov < 26;
    if (showScope !== scopeShown) {
      scopeShown = showScope;
      scopeEl.style.opacity = showScope ? "1" : "0";
    }
    if (scopeShown) {
      const windDir = wind > 0.05 ? "→" : wind < -0.05 ? "←" : "·";
      const windStr = `WIND ${windDir} ${Math.abs(wind).toFixed(1)} m/s`;
      if (windStr !== lastWindStr) {
        windSpan.textContent = windStr;
        lastWindStr = windStr;
      }
      const zoomStr = `${zoomTarget.toString().replace(/\.0$/, "")}x`;
      if (zoomStr !== lastZoomStr) {
        zoomSpan.textContent = zoomStr;
        lastZoomStr = zoomStr;
      }
      const s = Math.ceil(timeLeft);
      const timeStr = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (timeStr !== lastTimeStr) {
        timeSpan.textContent = timeStr;
        lastTimeStr = timeStr;
      }
      breathBar.style.width = `${Math.round(breathMeter * 100)}%`;
      breathBar.style.background =
        breathMeter < 0.3 ? "#e0a860" : "#8fe0b0";
      // laser rangefinder ~10Hz + mil-dot aralığı (zoom'a bağlı)
      rangeT -= dt;
      if (rangeT <= 0) {
        rangeT = 0.1;
        updateRangefinder();
      }
      updateReticle();
    }

    /* targets — canlı humanoid lifecycle (sdt: slow-mo'dan etkilenir) */
    for (const tg of targets) {
      if (tg.state === "idle") continue;
      tg.t += sdt;
      if (tg.state === "rising") {
        const k = Math.min(1, tg.t / 0.4);
        tg.group.position.y = -2.4 + 2.4 * easeOutCubic(k);
        if (k >= 1) {
          tg.state = "up";
          tg.t = 0;
        }
      } else if (tg.state === "up") {
        // idle life: nefes alma (göğüs scale)
        const it = t * 1.6 + tg.phase;
        tg.chest.scale.y = 1 + 0.03 * Math.sin(it);
        tg.chest.scale.x = 1 + 0.012 * Math.sin(it);
        // arada baş çevirme / ağırlık aktarma
        tg.idleTimer -= sdt;
        if (tg.idleTimer <= 0) {
          tg.idleTimer = 2 + Math.random() * 3;
          const r = Math.random();
          if (r < 0.4) tg.headYaw = (Math.random() - 0.5) * 0.9;
          else if (r < 0.55) tg.headYaw = 0;
          else if (r < 0.8) tg.shiftX = (Math.random() - 0.5) * 0.09;
          else tg.shiftX = 0;
        }
        tg.head.rotation.y +=
          (tg.headYaw - tg.head.rotation.y) * Math.min(1, sdt * 3);
        tg.hips.position.x +=
          (tg.shiftX - tg.hips.position.x) * Math.min(1, sdt * 2.2);
        tg.torso.rotation.z +=
          (-tg.shiftX * 1.4 - tg.torso.rotation.z) * Math.min(1, sdt * 2.2);
        if (tg.t >= tg.upTime) {
          tg.state = "falling";
          tg.t = 0;
          tg.fast = false;
          tg.fallMode = "fall";
          tg.fallDir = -(0.9 + Math.random() * 0.25);
        }
      } else if (tg.state === "stagger") {
        // gövde isabeti: tors twist + geri adım, sonra düşüş
        const k = Math.min(1, tg.t / 0.28);
        const w = Math.sin(k * Math.PI);
        tg.torso.rotation.y = tg.fallDir * 0.45 * w;
        tg.group.rotation.x = -0.12 * w;
        tg.group.position.z = tg.baseZ - 0.3 * easeOutCubic(k);
        if (k >= 1) {
          tg.state = "falling";
          tg.t = 0;
          tg.fallMode = "fall";
          tg.fallDir = -(0.9 + Math.random() * 0.25);
        }
      } else if (tg.state === "falling") {
        // fiziksel düşüş: pivot ayaklarda döner / dizlerden çöker (~0.6s)
        const dur = tg.fast ? 0.55 : 0.75;
        const k = Math.min(1, tg.t / dur);
        const e = easeOutCubic(k);
        if (tg.fallMode === "fall") {
          tg.group.rotation.x = tg.fallDir * 1.35 * e;
          tg.group.rotation.z = tg.fallDir * 0.12 * e;
          tg.group.position.y = -0.06 * e;
          for (let i = 0; i < 2; i++) {
            const side = i === 0 ? 1 : -1;
            tg.arms[i].g.rotation.z = side * (0.1 + 0.9 * e);
            tg.arms[i].elbow.rotation.x = -0.35 - 0.6 * e;
            tg.legs[i].knee.rotation.x = 0.06 + 0.5 * e;
          }
        } else {
          // kafa isabeti çöküşü: dizler katlanır, gövde yığılır, kollar açılır
          tg.group.position.y = -0.6 * k * k;
          tg.group.rotation.x = -0.15 * e;
          tg.torso.rotation.x = 0.5 * e;
          tg.head.rotation.x = 0.7 * e;
          for (let i = 0; i < 2; i++) {
            const side = i === 0 ? 1 : -1;
            tg.arms[i].g.rotation.z = side * (0.1 + 1.1 * e);
            tg.arms[i].elbow.rotation.x = -0.35 - 0.9 * e;
            tg.legs[i].knee.rotation.x = 0.06 + 1.5 * e;
          }
        }
        if (k >= 1) {
          tg.state = "sinking";
          tg.t = 0;
        }
      } else if (tg.state === "sinking") {
        // yere gömül + fade out
        const k = Math.min(1, tg.t / 0.45);
        tg.group.position.y -= sdt * 1.5;
        for (const m of tg.mats) m.opacity = 1 - k;
        if (k >= 1) {
          tg.state = "idle";
          tg.group.visible = false;
          resetPose(tg);
        }
      }
    }

    /* spawn scheduler — aynı anda en fazla 2 hedef (dünya zamanı) */
    if (!over) {
      spawnT -= sdt;
      if (spawnT <= 0) {
        const activeCount = targets.filter((x) => x.state !== "idle").length;
        if (activeCount < 2) {
          spawnTarget();
          spawnT = 1 + Math.random() * 1.3;
        } else {
          spawnT = 0.4;
        }
      }
    }

    /* tracers fade */
    for (const tr of tracerPool) {
      if (!tr.line.visible) continue;
      tr.life -= sdt;
      if (tr.life <= 0) {
        tr.line.visible = false;
        tr.mat.opacity = 0;
        continue;
      }
      tr.mat.opacity = (tr.life / tr.max) * 0.85;
    }

    /* dust puffs expand + fade */
    for (const d of dustPool) {
      if (!d.sprite.visible) continue;
      d.life -= sdt;
      if (d.life <= 0) {
        d.sprite.visible = false;
        d.mat.opacity = 0;
        continue;
      }
      const k = 1 - d.life / d.max;
      d.sprite.scale.setScalar(d.size * (0.6 + 2.4 * k));
      d.mat.opacity = (1 - k) * 0.7;
    }

    /* muzzle smoke — genişler, hafif yükselir, solur */
    for (const s of smokePool) {
      if (!s.sprite.visible) continue;
      s.life -= sdt;
      if (s.life <= 0) {
        s.sprite.visible = false;
        s.mat.opacity = 0;
        continue;
      }
      const k = 1 - s.life / s.max;
      s.sprite.scale.setScalar(s.size * (0.4 + 2.4 * k));
      s.mat.opacity = (1 - k) * 0.3;
      s.sprite.position.y += s.vy * sdt;
    }

    flashLight.intensity *= Math.exp(-dt * 26);

    /* round timer */
    if (!over) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        over = true;
        updateAmmoChip();
        stopWindAmbience();
        hooks.onGameOver?.(score, [
          { label: "🎯", value: `${hits} hits` },
          { label: "💀", value: `${headshots} headshots` },
          { label: "📏", value: `${bestShot}m best` },
        ]);
        return; // RAF durur; StageCanvas restart yönetir
      }
    }

    composer.render();
  }
  tick();

  /* resize */
  const onResize = () => {
    if (disposed || !container.clientWidth) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    layoutScope();
  };
  window.addEventListener("resize", onResize);

  /* ---------- dispose ---------- */

  return {
    dispose() {
      disposed = true;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onCtx);
      reloadBtn.removeEventListener("click", onReloadBtn);
      reloadBtn.remove();
      scopeEl.remove();
      hintEl.remove();
      stopWindAmbience();
      puffTex.dispose();
      for (const g of Object.values(rigGeo)) g.dispose();
      for (const tg of targets) for (const m of tg.mats) m.dispose();
      for (const s of smokePool) s.mat.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      poleGeo.dispose();
      poleMat.dispose();
      lampGeo.dispose();
      lampMat.dispose();
      mountainGeo.dispose();
      mountainMat.dispose();
      sunCoreGeo.dispose();
      sunCoreMat.dispose();
      sunHaloGeo.dispose();
      sunHaloMat.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      for (const tr of tracerPool) {
        tr.line.geometry.dispose();
        tr.mat.dispose();
      }
      for (const d of dustPool) d.mat.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      // sahnede kalan her şeyi (point light'lar hariç) serbest bırak
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose?.();
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const m of mats) {
            (m as THREE.Material | null)?.dispose?.();
          }
        }
      });
      envTex.dispose();
      composer.dispose();
      renderer.dispose();
      canvas.remove();
      audioCtx = null;
      noiseBuf = null;
    },
  };
}

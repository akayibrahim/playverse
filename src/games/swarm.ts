import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * SWARM MIND — v1.0 (flagship).
 * You ARE the hive mind: direct thousands of glowing drones through a
 * dark megacity arena. Absorb violet clusters, overwhelm security drones,
 * dodge EMP shockwaves. Below 30 drones → hive collapse. Endless.
 *
 * The soul: a 6000-agent murmuration (CPU flocking with a spatial hash
 * grid, 8 neighbor samples per agent) that flows like liquid light.
 *
 * Controls: move pointer → goal · hold >150ms → COMPRESS (dense: absorb
 * faster + contact damage, but EMP wipes you) · quick tap → SCATTER burst.
 *
 * Contract (keep):
 *   createGame(container, hooks) => { dispose() }
 *   hooks: { onScore(s), onGameOver(s, stats), onPopup(text), best }
 */

export type SwarmHooks = {
  onScore?: (score: number) => void;
  onGameOver?: (
    score: number,
    stats: { label: string; value: string }[],
  ) => void;
  onPopup?: (text: string) => void;
  best?: number; // geçilince onPopup "NEW BEST" tetikler
};

/* ---------- tuning ---------- */

const ARENA_HALF = 56; // drone soft bound
const CELL = 2.5; // spatial hash cell size
const GN = 48; // grid cells per axis (48 * 2.5 = 120 arena)
const GMIN = -60;
const MAX_SP = 14; // global speed clamp
const GAME_OVER_AT = 30;
const EMP_INTERVAL = 9;
const EMP_RADIUS = 25;
const RING_TIME = 2.8;
const CLUSTER_DRONES = 150;

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
    const len = Math.floor(ctx.sampleRate * 1.2);
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

function noiseBurst(dur: number, vol: number, cutoff: number, type: BiquadFilterType = "bandpass") {
  if (!audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime;
  const src = audioCtx.createBufferSource();
  src.buffer = getNoiseBuffer(audioCtx);
  const flt = audioCtx.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = cutoff;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt).connect(gain).connect(audioCtx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const sfx = {
  empWarn: () => tone(160, 1.5, "sine", 0.16, 760), // yükselen uyarı
  empFire: () => {
    tone(70, 0.9, "sawtooth", 0.28, 26);
    noiseBurst(0.5, 0.22, 300, "lowpass");
  },
  gulp: () => tone(620, 0.45, "sine", 0.2, 110), // emme — pes düşen
  scatter: () => noiseBurst(0.28, 0.3, 2200, "highpass"),
  pop: () => {
    tone(1150, 0.09, "square", 0.2, 240);
    noiseBurst(0.12, 0.16, 1800);
  },
  compress: () => tone(240, 0.22, "triangle", 0.12, 420),
  over: () => {
    tone(300, 1.4, "sawtooth", 0.24, 38);
    tone(150, 1.6, "sine", 0.2, 24);
  },
  best: () => tone(660, 0.4, "triangle", 0.15, 990),
};

/* ---------- game ---------- */

export function createGame(
  container: HTMLElement,
  hooks: SwarmHooks = {},
): { dispose: () => void } {
  const width = container.clientWidth;
  const height = container.clientHeight;

  /* cihaz tespiti: masaüstünde 6000 drone, mobilde 2500 */
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const smallScreen =
    Math.min(window.innerWidth, window.innerHeight) < 760;
  const isMobile =
    coarse || (window.devicePixelRatio > 2.5 && smallScreen);

  const CAP = isMobile ? 2500 : 6000; // player drone capacity
  const SEC_CAP = isMobile ? 36 : 60; // concurrent security drones
  const DYING_CAP = isMobile ? 420 : 800; // death-fx pool
  const CLUSTER_N = 7;

  /* renderer */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.Fog(0x05060f, 80, 235);

  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 420);
  camera.position.set(0, 62, 64);
  camera.lookAt(0, 0, -4);

  /* post: bu oyun neon gösterinin ta kendisi — güçlü bloom */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.9, // strength — flagship parlaklığı
    0.55, // radius
    0.4, // threshold
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* PBR environment */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  /* lights */
  scene.add(new THREE.AmbientLight(0x25305a, 1.1));
  const swarmLight = new THREE.PointLight(0x00e0ff, 0, 70, 1.4); // sürü merkezi parıltısı
  swarmLight.position.y = 3;
  scene.add(swarmLight);

  /* ---------- arena: zemin + devre hatları ---------- */

  const groundGeo = new THREE.PlaneGeometry(124, 124);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x070a18,
    roughness: 0.32,
    metalness: 0.82,
    envMapIntensity: 0.4,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  /* devre-desenli ışıma çizgileri — rastgele L-koşuları, mor/cian */
  {
    const pts: number[] = [];
    const cols: number[] = [];
    const step = CELL;
    const cyan = new THREE.Color(0x00e0ff);
    const violet = new THREE.Color(0x8a5cff);
    for (let li = 0; li < 320; li++) {
      let cx = Math.floor(Math.random() * GN) * step + GMIN;
      let cz = Math.floor(Math.random() * GN) * step + GMIN;
      const horizFirst = Math.random() < 0.5;
      const col = Math.random() < 0.55 ? cyan : violet;
      const jitter = 0.75 + Math.random() * 0.5;
      for (let leg = 0; leg < 2; leg++) {
        const horiz = leg === 0 ? horizFirst : !horizFirst;
        const len = (2 + Math.floor(Math.random() * 5)) * step;
        const dir = Math.random() < 0.5 ? 1 : -1;
        const x0 = cx;
        const z0 = cz;
        if (horiz) cx = THREE.MathUtils.clamp(cx + dir * len, GMIN, -GMIN);
        else cz = THREE.MathUtils.clamp(cz + dir * len, GMIN, -GMIN);
        pts.push(x0, 0.04, z0, cx, 0.04, cz);
        for (let k = 0; k < 6; k++) {
          cols.push(col.r * jitter, col.g * jitter, col.b * jitter);
        }
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    lineGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    scene.add(new THREE.LineSegments(lineGeo, lineMat));
  }

  /* kenar bariyeri — hafif parlak çerçeve */
  const wallGeo = new THREE.BoxGeometry(122, 0.14, 0.14);
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x2a5cff });
  for (const [x, z, rot] of [
    [0, -60, 0],
    [0, 60, 0],
    [-60, 0, Math.PI / 2],
    [60, 0, Math.PI / 2],
  ] as const) {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(x, 0.05, z);
    wall.rotation.y = rot;
    scene.add(wall);
  }

  /* megakent silueti — arena dışı karanlık kuleler */
  const bldgGeo = new THREE.BoxGeometry(1, 1, 1);
  const bldgMat = new THREE.MeshStandardMaterial({
    color: 0x0a0e22,
    roughness: 0.85,
    metalness: 0.3,
    envMapIntensity: 0.25,
  });
  const beaconGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2d55 });
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    const dist = 74 + Math.random() * 46;
    const w = 6 + Math.random() * 10;
    const h = 14 + Math.random() * 34;
    const b = new THREE.Mesh(bldgGeo, bldgMat);
    b.scale.set(w, h, w * (0.7 + Math.random() * 0.6));
    b.position.set(Math.cos(ang) * dist, h / 2 - 2, Math.sin(ang) * dist);
    b.rotation.y = Math.random() * Math.PI;
    scene.add(b);
    if (Math.random() < 0.5) {
      const bc = new THREE.Mesh(beaconGeo, beaconMat);
      bc.scale.setScalar(0.4 + Math.random() * 0.5);
      bc.position.set(b.position.x, h - 2.2, b.position.z);
      scene.add(bc);
    }
  }

  /* güvenlik kuleleri — 3 monolit, tepe fenerli; EMP sırayla onlardan */
  const towerPos = [
    new THREE.Vector3(-52, 0, -38),
    new THREE.Vector3(54, 0, 18),
    new THREE.Vector3(-4, 0, -56),
  ];
  const towerGeo = new THREE.BoxGeometry(3.4, 22, 3.4);
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x0c1026,
    roughness: 0.5,
    metalness: 0.7,
    envMapIntensity: 0.5,
  });
  const beaconTowers: THREE.Mesh[] = [];
  const towerBeaconMat = new THREE.MeshBasicMaterial({ color: 0xff2d95 });
  for (const p of towerPos) {
    const t = new THREE.Mesh(towerGeo, towerMat);
    t.position.set(p.x, 11, p.z);
    scene.add(t);
    const bc = new THREE.Mesh(beaconGeo, towerBeaconMat.clone());
    bc.scale.setScalar(1.4);
    bc.position.set(p.x, 23, p.z);
    scene.add(bc);
    beaconTowers.push(bc);
  }

  /* ---------- player swarm (INSTANCED — tek draw call) ---------- */

  const droneGeo = new THREE.OctahedronGeometry(0.15, 0);
  const droneMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const droneMesh = new THREE.InstancedMesh(droneGeo, droneMat, CAP);
  droneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  droneMesh.frustumCulled = false;
  droneMesh.count = 0;

  /* per-agent state — tümü düz typed diziler, döngüde sıfır allocation */
  const posX = new Float32Array(CAP);
  const posY = new Float32Array(CAP);
  const posZ = new Float32Array(CAP);
  const velX = new Float32Array(CAP);
  const velY = new Float32Array(CAP);
  const velZ = new Float32Array(CAP);
  const speedBase = new Float32Array(CAP); // organik hız çeşitliliği
  const phase = new Float32Array(CAP);
  const colR = new Float32Array(CAP);
  const colG = new Float32Array(CAP);
  const colB = new Float32Array(CAP);

  const colorAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(CAP * 3),
    3,
  );
  droneMesh.instanceColor = colorAttr;

  /* spatial hash — counting-sort grid, çerçeve başına O(n), allocation yok */
  const NUM_CELLS = GN * GN;
  const cellCounts = new Int32Array(NUM_CELLS);
  const cellStart = new Int32Array(NUM_CELLS + 1);
  const order = new Int32Array(CAP);

  let swarmCount = 0;
  let peakSwarm = 0;
  let centroidX = 0;
  let centroidZ = 0;

  function addDrone(x: number, y: number, z: number) {
    if (swarmCount >= CAP) return;
    const i = swarmCount++;
    posX[i] = x;
    posY[i] = y;
    posZ[i] = z;
    const a = Math.random() * Math.PI * 2;
    velX[i] = Math.cos(a) * 2;
    velY[i] = 0;
    velZ[i] = Math.sin(a) * 2;
    speedBase[i] = 7 + Math.random() * 6;
    phase[i] = Math.random() * Math.PI * 2;
    const br = 0.75 + Math.random() * 0.5; // parlaklık çeşitliliği → kaynatma hissi
    colR[i] = 0.15 * br;
    colG[i] = 0.95 * br;
    colB[i] = 1.0 * br;
    const o = i * 3;
    (colorAttr.array as Float32Array)[o] = colR[i];
    (colorAttr.array as Float32Array)[o + 1] = colG[i];
    (colorAttr.array as Float32Array)[o + 2] = colB[i];
    colorAttr.needsUpdate = true;
  }

  /* başlangıç sürüsü — merkezde organik küme */
  for (let i = 0; i < CAP; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 13;
    addDrone(Math.cos(a) * r, 1, Math.sin(a) * r);
  }
  peakSwarm = swarmCount;

  function cellOf(x: number, z: number): number {
    let cx = ((x - GMIN) / CELL) | 0;
    let cz = ((z - GMIN) / CELL) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= GN) cx = GN - 1;
    if (cz < 0) cz = 0;
    else if (cz >= GN) cz = GN - 1;
    return cx + cz * GN;
  }

  function rebuildHash() {
    cellCounts.fill(0);
    for (let i = 0; i < swarmCount; i++) cellCounts[cellOf(posX[i], posZ[i])]++;
    let acc = 0;
    for (let c = 0; c < NUM_CELLS; c++) {
      cellStart[c] = acc;
      acc += cellCounts[c];
    }
    cellStart[NUM_CELLS] = acc;
    for (let c = 0; c < NUM_CELLS; c++) cellCounts[c] = cellStart[c]; // cursor
    for (let i = 0; i < swarmCount; i++) {
      order[cellCounts[cellOf(posX[i], posZ[i])]++] = i;
    }
  }

  /** en yakın drone indeksi (yoksa -1) — XZ düzleminde */
  function queryNearest(x: number, z: number, r: number): number {
    const r2 = r * r;
    let best = -1;
    let bd = r2;
    const cx = ((x - GMIN) / CELL) | 0;
    const cz = ((z - GMIN) / CELL) | 0;
    for (let oz = -1; oz <= 1; oz++) {
      const gz = cz + oz;
      if (gz < 0 || gz >= GN) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox;
        if (gx < 0 || gx >= GN) continue;
        const c = gx + gz * GN;
        const s = cellStart[c];
        const e = cellStart[c + 1];
        for (let k = s; k < e; k++) {
          const j = order[k];
          const dx = x - posX[j];
          const dz = z - posZ[j];
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) {
            bd = d2;
            best = j;
          }
        }
      }
    }
    return best;
  }

  /** yarıçap içindeki drone sayısı — XZ düzleminde */
  function queryCount(x: number, z: number, r: number): number {
    const r2 = r * r;
    let n = 0;
    const cx = ((x - GMIN) / CELL) | 0;
    const cz = ((z - GMIN) / CELL) | 0;
    for (let oz = -1; oz <= 1; oz++) {
      const gz = cz + oz;
      if (gz < 0 || gz >= GN) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox;
        if (gx < 0 || gx >= GN) continue;
        const c = gx + gz * GN;
        const s = cellStart[c];
        const e = cellStart[c + 1];
        for (let k = s; k < e; k++) {
          const j = order[k];
          const dx = x - posX[j];
          const dz = z - posZ[j];
          if (dx * dx + dz * dz < r2) n++;
        }
      }
    }
    return n;
  }

  /* ---------- ölüm efekt havuzu (beyaz flaş + küçülme) ---------- */

  const dyingGeo = droneGeo; // paylaşılan geometri
  const dyingMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dyingMesh = new THREE.InstancedMesh(dyingGeo, dyingMat, DYING_CAP);
  dyingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dyingMesh.frustumCulled = false;
  const dyingColor = new THREE.InstancedBufferAttribute(
    new Float32Array(DYING_CAP * 3),
    3,
  );
  dyingMesh.instanceColor = dyingColor;
  scene.add(dyingMesh);

  const dyX = new Float32Array(DYING_CAP);
  const dyY = new Float32Array(DYING_CAP);
  const dyZ = new Float32Array(DYING_CAP);
  const dyLife = new Float32Array(DYING_CAP);
  const dyMax = new Float32Array(DYING_CAP);
  const dySize = new Float32Array(DYING_CAP);
  let dyIdx = 0;

  function spawnDeath(
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    size = 1,
  ) {
    const s = dyIdx++ % DYING_CAP;
    dyX[s] = x;
    dyY[s] = y;
    dyZ[s] = z;
    dyLife[s] = 0.5;
    dyMax[s] = 0.5;
    dySize[s] = size;
    const o = s * 3;
    (dyingColor.array as Float32Array)[o] = r;
    (dyingColor.array as Float32Array)[o + 1] = g;
    (dyingColor.array as Float32Array)[o + 2] = b;
    dyingColor.needsUpdate = true;
  }

  /** drone ölümü: beyaz flaş + swap-remove (diziler kompakt kalır) */
  function killDrone(i: number) {
    spawnDeath(posX[i], posY[i], posZ[i], 3, 3, 3);
    const last = --swarmCount;
    if (i !== last) {
      posX[i] = posX[last];
      posY[i] = posY[last];
      posZ[i] = posZ[last];
      velX[i] = velX[last];
      velY[i] = velY[last];
      velZ[i] = velZ[last];
      speedBase[i] = speedBase[last];
      phase[i] = phase[last];
      colR[i] = colR[last];
      colG[i] = colG[last];
      colB[i] = colB[last];
      const o = i * 3;
      (colorAttr.array as Float32Array)[o] = colR[i];
      (colorAttr.array as Float32Array)[o + 1] = colG[i];
      (colorAttr.array as Float32Array)[o + 2] = colB[i];
      colorAttr.needsUpdate = true;
    }
  }

  /* ---------- security drones (magenta avcılar) ---------- */

  const secGeo = new THREE.OctahedronGeometry(0.5, 0);
  secGeo.scale(1, 0.6, 1.5);
  const secMat = new THREE.MeshBasicMaterial({ color: 0xff2d95 });
  const secMesh = new THREE.InstancedMesh(secGeo, secMat, SEC_CAP);
  secMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  secMesh.frustumCulled = false;
  scene.add(secMesh);

  interface SecDrone {
    x: number;
    z: number;
    vx: number;
    vz: number;
    yaw: number;
    hp: number;
    kills: number; // yediği player drone — 15'te ölür
    killT: number; // temas kill tempo sayacı
    alive: boolean;
  }
  const secDrones: SecDrone[] = [];
  for (let i = 0; i < SEC_CAP; i++) {
    secDrones.push({
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      yaw: 0,
      hp: 20,
      kills: 0,
      killT: 0,
      alive: false,
    });
  }

  function spawnSecurity(n: number) {
    let spawned = 0;
    for (const s of secDrones) {
      if (spawned >= n) break;
      if (s.alive) continue;
      const edge = Math.floor(Math.random() * 4);
      const off = (Math.random() - 0.5) * 90;
      s.x = edge === 0 ? -58 : edge === 1 ? 58 : off;
      s.z = edge === 2 ? -58 : edge === 3 ? 58 : off;
      s.vx = 0;
      s.vz = 0;
      s.hp = 20;
      s.kills = 0;
      s.killT = 0;
      s.alive = true;
      spawned++;
    }
  }

  function killSecurity(s: SecDrone) {
    s.alive = false;
    kills++; // oyuncunun skoru
    for (let k = 0; k < 7; k++) {
      spawnDeath(
        s.x + (Math.random() - 0.5) * 1.6,
        1.2 + Math.random() * 1.2,
        s.z + (Math.random() - 0.5) * 1.6,
        1.0, 0.18, 0.58, // magenta
        2.6,
      );
    }
    sfx.pop();
  }

  /* ---------- absorb clusters (violet orbs) ---------- */

  interface Cluster {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    x: number;
    z: number;
    vx: number;
    vz: number;
    state: "roam" | "dissolve";
    t: number; // dissolve sayacı
    pending: number;
  }
  const clusterGeo = new THREE.SphereGeometry(0.85, 16, 12);
  const clusters: Cluster[] = [];
  for (let i = 0; i < CLUSTER_N; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8a5cff,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(clusterGeo, mat);
    const x = (Math.random() - 0.5) * 80;
    const z = (Math.random() - 0.5) * 80;
    mesh.position.set(x, 1.4, z);
    scene.add(mesh);
    clusters.push({
      mesh,
      mat,
      x,
      z,
      vx: (Math.random() - 0.5) * 3,
      vz: (Math.random() - 0.5) * 3,
      state: "roam",
      t: 0,
      pending: 0,
    });
  }

  function respawnCluster(c: Cluster) {
    c.x = (Math.random() - 0.5) * 90;
    c.z = (Math.random() - 0.5) * 90;
    c.vx = (Math.random() - 0.5) * 3;
    c.vz = (Math.random() - 0.5) * 3;
    c.state = "roam";
    c.mesh.scale.setScalar(1);
    c.mesh.position.set(c.x, 1.4, c.z);
  }

  /* ---------- EMP halkası ---------- */

  const ringGeo = new THREE.TorusGeometry(1, 0.09, 8, 72);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff2d95,
    transparent: true,
    opacity: 0.95,
  });
  const ringGlowGeo = new THREE.TorusGeometry(1, 0.22, 8, 72);
  const ringGlowMat = new THREE.MeshBasicMaterial({
    color: 0xff5cb0,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const empRing = new THREE.Mesh(ringGeo, ringMat);
  empRing.rotation.x = -Math.PI / 2;
  empRing.visible = false;
  const empGlow = new THREE.Mesh(ringGlowGeo, ringGlowMat);
  empGlow.rotation.x = -Math.PI / 2;
  empGlow.visible = false;
  scene.add(empRing, empGlow);

  /* ---------- imleç halkası (in-world goal) ---------- */

  const cursorGeo = new THREE.TorusGeometry(0.9, 0.06, 8, 40);
  const cursorMat = new THREE.MeshBasicMaterial({
    color: 0x00e0ff,
    transparent: true,
    opacity: 0.75,
  });
  const cursor = new THREE.Mesh(cursorGeo, cursorMat);
  cursor.rotation.x = -Math.PI / 2;
  scene.add(cursor);

  /* ---------- state ---------- */

  let goalX = 0; // sürünün gerçek hedefi (gecikmeli yumuşar)
  let goalZ = 0;
  let targetX = 0; // pointer ham hedefi
  let targetZ = 0;
  let score = 0;
  let absorbed = 0;
  let kills = 0;
  let seconds = 0;
  let over = false;
  let finished = false;
  let disposed = false;
  let overT = 0;

  /* input durumu */
  let pointerActive = false; // basılı tutma
  let pointerSeen = false; // en az bir hareket geldi mi
  let downT = 0;
  let compress = false;
  let wasCompress = false;
  let scatterCd = 0;
  let hasPointerTarget = false;

  /* dalga + EMP sayaçları */
  let waveNum = 0;
  let waveT = 4;
  let empT = EMP_INTERVAL;
  let empState: "idle" | "warn" | "firing" = "idle";
  let empTower = 0;
  let empR = 0;
  let bestBeaten = false;
  let reportT = 0;
  let lastReported = -1;

  /* perf degrade penceresi */
  let frameAccum = 0;
  let frameN = 0;
  let cap = CAP;

  /* temp vectors — döngü dışında tek sefer ayrılır */
  const tmpMat = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();

  /* ---------- input ---------- */

  function pointerToWorld(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const ny = -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    tmpV.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    const t = (0.9 - camera.position.y) / tmpV.y;
    if (t > 0) {
      targetX = THREE.MathUtils.clamp(
        camera.position.x + tmpV.x * t,
        -ARENA_HALF,
        ARENA_HALF,
      );
      targetZ = THREE.MathUtils.clamp(
        camera.position.z + tmpV.z * t,
        -ARENA_HALF,
        ARENA_HALF,
      );
      hasPointerTarget = true;
    }
  }

  const onPointerDown = (e: PointerEvent) => {
    ensureAudio();
    if (over) return;
    pointerActive = true;
    downT = performance.now();
    pointerToWorld(e.clientX, e.clientY);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (over) return;
    pointerSeen = true;
    pointerToWorld(e.clientX, e.clientY);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (over) {
      pointerActive = false;
      return;
    }
    const dur = performance.now() - downT;
    pointerActive = false;
    if (dur < 150 && scatterCd <= 0 && pointerSeen) {
      /* hızlı tap → dağılma darbesi */
      scatterCd = 2;
      const gx = goalX;
      const gz = goalZ;
      for (let i = 0; i < swarmCount; i++) {
        const dx = posX[i] - gx;
        const dz = posZ[i] - gz;
        const d = Math.sqrt(dx * dx + dz * dz) + 1;
        const f = 30 / d;
        velX[i] += (dx / d) * f * 22 + (Math.random() - 0.5) * 8;
        velZ[i] += (dz / d) * f * 22 + (Math.random() - 0.5) * 8;
        velY[i] += Math.random() * 5;
      }
      hooks.onPopup?.("SCATTER");
      sfx.scatter();
    }
  };
  const onPointerCancel = () => {
    pointerActive = false;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  /* ipucu */
  const hintEl = document.createElement("div");
  hintEl.style.cssText =
    "position:absolute;left:10px;bottom:10px;z-index:4;pointer-events:none;" +
    "font:500 11px/1.5 system-ui,sans-serif;color:rgba(140,230,255,0.5);" +
    "user-select:none;-webkit-user-select:none";
  hintEl.textContent =
    "move to guide the hive · hold = COMPRESS (dense: absorb + melee, EMP bait) · tap = SCATTER";
  container.appendChild(hintEl);

  /* ---------- loop ---------- */

  const clock = new THREE.Clock();

  function tick() {
    if (disposed || finished) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    /* degrade ölçümü: 2 sn pencerede ortalama frame > 22ms → %20 küçült */
    if (!over) {
      frameAccum += dt;
      frameN++;
      if (frameAccum >= 2 && frameN > 0) {
        const avg = frameAccum / frameN;
        if (avg > 0.022 && cap > 800) {
          const newCap = Math.max(800, Math.floor(cap * 0.8));
          for (let i = 0; i < Math.min(60, cap - newCap); i++) {
            const j = Math.floor(Math.random() * swarmCount);
            spawnDeath(posX[j], posY[j], posZ[j], 2.5, 2.5, 2.5);
          }
          cap = newCap;
          while (swarmCount > cap) swarmCount--; // sessiz küçültme
        }
        frameAccum = 0;
        frameN = 0;
      }
    }

    if (over) {
      /* oyun sonu: havai fişek cascade biraz daha oynar */
      overT += dt;
      updateDying(dt);
      dyingMesh.instanceMatrix.needsUpdate = true;
      composer.render();
      if (overT > 0.9 && !finished) {
        finished = true;
        hooks.onGameOver?.(Math.floor(score), [
          { label: "🐜", value: `${peakSwarm} peak` },
          { label: "🧲", value: `${absorbed} absorbed` },
          { label: "💀", value: `${kills} kills` },
          { label: "⏱", value: `${Math.floor(seconds)}s` },
        ]);
      }
      return;
    }

    seconds += dt;
    scatterCd = Math.max(0, scatterCd - dt);

    /* COMPRESS algılama: basılı >150ms */
    compress = pointerActive && performance.now() - downT > 150;
    if (compress && !wasCompress) sfx.compress();
    wasCompress = compress;

    /* hedef takibi — sürünün ataleti: goal gecikmeli yumuşar */
    if (hasPointerTarget) {
      goalX += (targetX - goalX) * Math.min(1, dt * 3.5);
      goalZ += (targetZ - goalZ) * Math.min(1, dt * 3.5);
    } else {
      /* hiç hareket yoksa sürü kendi başına dolaşır */
      targetX = Math.sin(t * 0.23) * 18;
      targetZ = Math.cos(t * 0.31) * 18;
    }

    /* ---------- spatial hash ---------- */
    rebuildHash();

    /* ---------- agent güncellemesi (sıcak döngü — allocation yok) ---------- */
    const sepR = compress ? 1.0 : 1.6;
    const sepR2 = sepR * sepR;
    const sepK = compress ? 21 : 60; // compress: separation ×0.35
    const seekA = compress ? 34 : 22;
    const alignK = compress ? 4.5 : 2.8;
    const maxSp = MAX_SP * (compress ? 1.15 : 1);
    const maxSp2 = maxSp * maxSp;
    const n = swarmCount;

    let cxSum = 0;
    let czSum = 0;

    for (let i = 0; i < n; i++) {
      const x = posX[i];
      const y = posY[i];
      const z = posZ[i];

      /* 1) seek — sürü hedefine */
      let dxg = goalX - x;
      let dyg = 1 - y;
      let dzg = goalZ - z;
      const dlg = Math.sqrt(dxg * dxg + dyg * dyg + dzg * dzg) + 1e-5;
      const invG = seekA / dlg;
      let ax = dxg * invG;
      let ay = dyg * invG * 0.4;
      let az = dzg * invG;

      /* 2) separation + alignment — 3x3 hücreden max 8 komşu örneği */
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let alx = 0;
      let aly = 0;
      let alz = 0;
      let alN = 0;
      let sampled = 0;
      const cx0 = ((x - GMIN) / CELL) | 0;
      const cz0 = ((z - GMIN) / CELL) | 0;

      outer: for (let oz = -1; oz <= 1; oz++) {
        const gz = cz0 + oz;
        if (gz < 0 || gz >= GN) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx0 + ox;
          if (gx < 0 || gx >= GN) continue;
          const c = gx + gz * GN;
          const s = cellStart[c];
          const e = cellStart[c + 1];
          for (let k = s; k < e; k++) {
            const j = order[k];
            if (j === i) continue;
            const ddx = x - posX[j];
            const ddy = y - posY[j];
            const ddz = z - posZ[j];
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < sepR2 && d2 > 1e-4) {
              const inv = 1 / d2;
              sx += ddx * inv;
              sy += ddy * inv * 0.5;
              sz += ddz * inv;
            }
            if (d2 < 49) {
              alx += velX[j];
              aly += velY[j];
              alz += velZ[j];
              alN++;
            }
            if (++sampled >= 8) break outer;
          }
        }
      }

      /* 3) cohesion wobble — canlı, organik salınım */
      const ph = phase[i];
      const wob = Math.sin(t * 2.1 + ph);
      const wob2 = Math.cos(t * 1.7 + ph * 1.3);

      ax += sx * sepK + wob * 6;
      ay += sy * sepK * 0.5 + wob2 * 3;
      az += sz * sepK + wob2 * 6;

      /* alignment — sürü dalga gibi akar (murmuration ruhu) */
      if (alN > 0) {
        const invN = alignK / alN;
        ax += (alx * invN - velX[i] * alignK) * 0.5;
        ay += (aly * invN - velY[i] * alignK) * 0.5;
        az += (alz * invN - velZ[i] * alignK) * 0.5;
      }

      /* hız sınırla, pozisyon ilerlet */
      let vx = velX[i] + ax * dt;
      let vy = velY[i] + ay * dt;
      let vz = velZ[i] + az * dt;
      const sp2 = vx * vx + vy * vy + vz * vz;
      if (sp2 > maxSp2) {
        const f = maxSp / Math.sqrt(sp2);
        vx *= f;
        vy *= f;
        vz *= f;
      }
      let nx = x + vx * dt;
      let ny = y + vy * dt;
      let nz = z + vz * dt;

      /* arena kenarı: yumuşak sekme */
      if (nx > ARENA_HALF) {
        nx = ARENA_HALF;
        vx = -Math.abs(vx) * 0.7;
      } else if (nx < -ARENA_HALF) {
        nx = -ARENA_HALF;
        vx = Math.abs(vx) * 0.7;
      }
      if (nz > ARENA_HALF) {
        nz = ARENA_HALF;
        vz = -Math.abs(vz) * 0.7;
      } else if (nz < -ARENA_HALF) {
        nz = -ARENA_HALF;
        vz = Math.abs(vz) * 0.7;
      }
      if (ny < 0.5) {
        ny = 0.5;
        vy = Math.abs(vy);
      } else if (ny > 8) {
        ny = 8;
        vy = -Math.abs(vy);
      }

      velX[i] = vx;
      velY[i] = vy;
      velZ[i] = vz;
      posX[i] = nx;
      posY[i] = ny;
      posZ[i] = nz;

      cxSum += nx;
      czSum += nz;
    }

    if (n > 0) {
      centroidX = cxSum / n;
      centroidZ = czSum / n;
    }
    if (n > peakSwarm) peakSwarm = n;

    /* ---------- matris yazımı (tek geçiş, doğrudan array) ---------- */
    const matArr = droneMesh.instanceMatrix.array as Float32Array;
    const mScale = 0.16 * (compress ? 0.85 : 1);
    for (let i = 0; i < swarmCount; i++) {
      const o = i * 16;
      matArr[o] = mScale;
      matArr[o + 5] = mScale;
      matArr[o + 10] = mScale;
      matArr[o + 12] = posX[i];
      matArr[o + 13] =
        posY[i] + Math.sin(t * 2.6 + phase[i]) * 0.35; // bob
      matArr[o + 14] = posZ[i];
      matArr[o + 15] = 1;
    }
    droneMesh.count = swarmCount;
    droneMesh.instanceMatrix.needsUpdate = true;

    /* sürü ışığı — kütle ne kadar büyükse zemin o kadar parlar */
    swarmLight.position.x = centroidX;
    swarmLight.position.z = centroidZ;
    swarmLight.intensity = Math.min(90, swarmCount * 0.016);

    /* ---------- absorb clusters ---------- */
    for (const c of clusters) {
      if (c.state === "roam") {
        c.x += c.vx * dt;
        c.z += c.vz * dt;
        if (Math.abs(c.x) > 48 || Math.abs(c.z) > 48 || Math.random() < 0.004) {
          c.vx = (Math.random() - 0.5) * 4;
          c.vz = (Math.random() - 0.5) * 4;
        }
        c.x = THREE.MathUtils.clamp(c.x, -48, 48);
        c.z = THREE.MathUtils.clamp(c.z, -48, 48);
        c.mesh.position.set(c.x, 1.4 + Math.sin(t * 2 + c.x) * 0.2, c.z);
        const pulse = 1 + Math.sin(t * 3.5 + c.x * 0.7) * 0.18;
        c.mesh.scale.setScalar(pulse);
        c.mat.opacity = 0.7 + Math.sin(t * 3.5 + c.x * 0.7) * 0.25;

        /* sürü teması → çözülmeye başla */
        if (swarmCount > 0 && queryCount(c.x, c.z, 1.2) > 0) {
          c.state = "dissolve";
          c.t = 1.5;
          c.pending = CLUSTER_DRONES;
          absorbed++;
          hooks.onPopup?.("ABSORBED +150");
          sfx.gulp();
        }
      } else {
        c.t -= dt;
        c.mesh.scale.setScalar(Math.max(0.01, c.t / 1.5));
        c.mat.opacity = Math.max(0, (c.t / 1.5) * 0.9);
        /* +150 drone 1.5 sn boyunca kümeye yayılarak katılır */
        c.pending += dt * 100;
        while (c.pending >= 1) {
          c.pending -= 1;
          const a = Math.random() * Math.PI * 2;
          const r = 1.5 + Math.random() * 3.5;
          addDrone(
            c.x + Math.cos(a) * r,
            1 + Math.random() * 1.5,
            c.z + Math.sin(a) * r,
          );
        }
        if (c.t <= 0) respawnCluster(c);
      }
    }

    /* ---------- security drones ---------- */
    {
      let aliveSec = 0;
      for (const s of secDrones) {
        if (!s.alive) continue;
        aliveSec++;
        /* sürü merkezine saldırır */
        const dx = centroidX - s.x;
        const dz = centroidZ - s.z;
        const d = Math.sqrt(dx * dx + dz * dz) + 1e-5;
        const spd = 9 + waveNum * 0.6;
        s.vx += ((dx / d) * spd - s.vx) * Math.min(1, dt * 2);
        s.vz += ((dz / d) * spd - s.vz) * Math.min(1, dt * 2);
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        s.x = THREE.MathUtils.clamp(s.x, -59, 59);
        s.z = THREE.MathUtils.clamp(s.z, -59, 59);
        s.yaw = Math.atan2(s.vx, s.vz);

        /* temas: en yakın drone — kill 1-3/sn (0.35s tempo) */
        const j = queryNearest(s.x, s.z, 1.7);
        if (j >= 0) {
          s.killT += dt;
          while (s.killT >= 0.35) {
            s.killT -= 0.35;
            killDrone(j);
            s.kills++;
          }
        } else {
          s.killT = Math.max(0, s.killT - dt);
        }

        /* COMPRESS modunda yoğun sürü temas hasarı verir */
        if (compress) {
          const crowd = queryCount(s.x, s.z, 1.1);
          if (crowd > 2) {
            s.hp -= crowd * dt * 0.55;
            if (s.hp <= 0) {
              killSecurity(s);
              continue;
            }
          }
        }

        if (s.kills >= 15) {
          killSecurity(s); // yedikçe yıpranır
          continue;
        }
      }

      /* matrisler */
      let w = 0;
      for (const s of secDrones) {
        if (!s.alive) continue;
        tmpMat.makeRotationY(s.yaw + t * 2);
        tmpMat.setPosition(s.x, 1.2 + Math.sin(t * 4 + s.x) * 0.2, s.z);
        secMesh.setMatrixAt(w++, tmpMat);
      }
      secMesh.count = w;
      secMesh.instanceMatrix.needsUpdate = true;

      /* dalga sistemi */
      waveT -= dt;
      if (aliveSec === 0 && waveT <= 0) {
        waveNum++;
        waveT = 20;
        const count = Math.min(SEC_CAP, 8 + waveNum * 3);
        spawnSecurity(count);
        if (waveNum > 1) hooks.onPopup?.(`WAVE ${waveNum}`);
      }
    }

    /* ---------- EMP döngüsü ---------- */
    empT -= dt;
    if (empState === "idle") {
      if (empT <= 1.6) {
        empState = "warn";
        sfx.empWarn();
      }
    } else if (empState === "warn") {
      /* kule feneri hızla yanıp söner */
      const bc = beaconTowers[empTower];
      (bc.material as THREE.MeshBasicMaterial).color.setScalar(
        0.5 + Math.sin(clock.elapsedTime * 25) * 0.5,
      );
      if (empT <= 0) {
        empState = "firing";
        empR = 1;
        sfx.empFire();
        hooks.onPopup?.("EMP!");
        const p = towerPos[empTower];
        empRing.position.set(p.x, 1.1, p.z);
        empGlow.position.copy(empRing.position);
        empRing.visible = true;
        empGlow.visible = true;
      }
    } else {
      /* firing: halka genişler, süpürdüğü drone'lar ölür */
      empR += (EMP_RADIUS / RING_TIME) * dt;
      const k = empR;
      empRing.scale.set(k, k, 1);
      empGlow.scale.set(k, k, 1);
      (empRing.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0.15,
        1 - empR / EMP_RADIUS,
      );
      (empGlow.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0.05,
        0.35 * (1 - empR / EMP_RADIUS),
      );
      const p = towerPos[empTower];
      const rIn = (empR - 1.4) * (empR - 1.4);
      const rOut = (empR + 1.4) * (empR + 1.4);
      for (let i = swarmCount - 1; i >= 0; i--) {
        const dx = posX[i] - p.x;
        const dz = posZ[i] - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > rIn && d2 < rOut) killDrone(i); // aşağıdan yukarı: swap güvenli
      }
      if (empR >= EMP_RADIUS) {
        empRing.visible = false;
        empGlow.visible = false;
        empState = "idle";
        empT = EMP_INTERVAL;
        empTower = (empTower + 1) % towerPos.length;
        const bc = beaconTowers[(empTower + towerPos.length - 1) % towerPos.length];
        (bc.material as THREE.MeshBasicMaterial).color.setHex(0xff2d95);
      }
    }

    /* ---------- ölüm efektleri ---------- */
    updateDying(dt);
    dyingMesh.instanceMatrix.needsUpdate = true;

    /* ---------- imleç halkası ---------- */
    cursor.position.set(goalX, 0.35, goalZ);
    const cs = compress ? 0.62 : 1 + Math.sin(t * 5) * 0.08;
    cursor.scale.setScalar(cs);
    cursorMat.opacity = compress ? 1 : 0.55 + Math.sin(t * 5) * 0.2;
    cursorMat.color.setHex(compress ? 0xffc94d : 0x00e0ff);

    /* kule fenerleri nabız gibi atar */
    for (let i = 0; i < beaconTowers.length; i++) {
      const bc = beaconTowers[i];
      if (empState === "warn" && i === empTower) continue; // zaten alarmda
      const s = 1.1 + Math.sin(t * 3 + i * 2.1) * 0.35;
      bc.scale.setScalar(s);
    }

    /* kamera — ağır, heybetli süzülme */
    camera.position.x = Math.sin(t * 0.07) * 5;
    camera.position.z = 64 + Math.sin(t * 0.05) * 3;
    camera.lookAt(0, 0, -4);

    /* ---------- HUD ~10Hz ---------- */
    reportT += dt;
    if (reportT > 0.1) {
      reportT = 0;
      score = absorbed * 10 + kills * 25;
      const sc = Math.floor(score);
      if (sc !== lastReported) {
        lastReported = sc;
        hooks.onScore?.(sc);
      }
      if (!bestBeaten && hooks.best && hooks.best > 0 && sc > hooks.best) {
        bestBeaten = true;
        hooks.onPopup?.("🏆 NEW BEST!");
        sfx.best();
      }
    }

    /* ---------- hive collapse kontrolü ---------- */
    if (swarmCount < GAME_OVER_AT) {
      over = true;
      overT = 0;
      sfx.over();
      /* son nefes: tüm sürü havai fişek gibi çöker */
      for (let i = swarmCount - 1; i >= 0; i--) {
        killDrone(i);
      }
      droneMesh.count = 0;
      secMesh.count = 0;
    }

    composer.render();
  }

  function updateDying(dt: number) {
    const arr = dyingMesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < DYING_CAP; i++) {
      const o = i * 16;
      if (dyLife[i] <= 0) {
        arr[o] = 0;
        arr[o + 5] = 0;
        arr[o + 10] = 0;
        arr[o + 15] = 1;
        continue;
      }
      dyLife[i] -= dt;
      const k = Math.max(0, dyLife[i] / dyMax[i]);
      const s = k * dySize[i] * 0.16;
      arr[o] = s;
      arr[o + 5] = s;
      arr[o + 10] = s;
      arr[o + 12] = dyX[i];
      arr[o + 13] = dyY[i];
      arr[o + 14] = dyZ[i];
      arr[o + 15] = 1;
    }
  }

  tick();

  /* ---------- resize & cleanup ---------- */

  const onResize = () => {
    if (disposed || !container.clientWidth) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  };
  window.addEventListener("resize", onResize);

  return {
    dispose() {
      disposed = true;
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      hintEl.remove();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (o as THREE.LineSegments).isLineSegments) {
          mesh.geometry?.dispose?.();
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const m of mats) {
            (m as THREE.Material | null)?.dispose?.();
          }
        }
      });
      groundGeo.dispose();
      groundMat.dispose();
      wallGeo.dispose();
      wallMat.dispose();
      bldgGeo.dispose();
      bldgMat.dispose();
      beaconGeo.dispose();
      beaconMat.dispose();
      towerGeo.dispose();
      towerMat.dispose();
      droneGeo.dispose();
      droneMat.dispose();
      colorAttr.dispose();
      dyingMat.dispose();
      dyingColor.dispose();
      secGeo.dispose();
      secMat.dispose();
      clusterGeo.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      ringGlowGeo.dispose();
      ringGlowMat.dispose();
      cursorGeo.dispose();
      cursorMat.dispose();
      cellCounts.fill(0);
      order.fill(0);
      composer.dispose();
      renderer.dispose();
      canvas.remove();
      audioCtx = null;
      noiseBuf = null;
    },
  };
}

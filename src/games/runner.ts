import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Neon Runner — v1.0 (full game).
 * 3 lanes · swipe / arrow keys · asteroids · coins · rising speed
 * WebAudio SFX (no assets) · crash particles · background planet
 *
 * Contract (keep):
 *   createGame(container, hooks) => { dispose() }
 *   hooks: { onScore(s), onGameOver(s) }
 */

export type RunnerHooks = {
  onScore?: (score: number) => void;
  onGameOver?: (
    score: number,
    stats: { coins: number; nearMisses: number; distance: number },
  ) => void;
  onBoost?: (meter: number, active: boolean) => void; // meter 0..1
  onPopup?: (text: string) => void;
  best?: number; // rekor — geçilince onPopup "NEW BEST" tetikler
};

const LANE_X = [-2.2, 0, 2.2];
const SPAWN_Z = -70;
const DESPAWN_Z = 12;
const BASE_SPEED = 14;
const MAX_SPEED = 44;
const ACCEL = 0.35;
const COIN_VALUE = 50;

/* ---------- audio (tiny synth, zero assets) ---------- */

let audioCtx: AudioContext | null = null;

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

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  slideTo?: number,
) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime;
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

const sfx = {
  coin: (combo = 1) => {
    const pitch = 880 * (1 + 0.09 * (combo - 1)); // combo yükseldikçe tiz
    tone(pitch, 0.12, "square", 0.12, pitch * 1.5);
  },
  nearMiss: () => tone(520, 0.18, "sine", 0.14, 1400),
  best: () => tone(660, 0.4, "triangle", 0.15, 990),
  move: () => tone(340, 0.08, "sine", 0.08, 180),
  crash: () => {
    tone(220, 0.5, "sawtooth", 0.25, 40);
    tone(90, 0.6, "triangle", 0.2, 30);
  },
};

/* ---------- game ---------- */

export function createGame(
  container: HTMLElement,
  hooks: RunnerHooks = {},
): { dispose: () => void } {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)); // bloom ile perf dengesi
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05060f, 14, 75);

  const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 150);
  const CAM_POS = new THREE.Vector3(0, 4.4, 8.5);
  camera.position.copy(CAM_POS);
  camera.lookAt(0, 0.8, -6);

  /* post-processing: bloom = neon estetiğin kalbi */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.45, // strength — 0.85'ten düşürüldü: gemi kayboluyordu
    0.5, // radius
    0.5, // threshold — sadece gerçekten parlak öğeler yayılır
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* PBR environment: metal/parlak yüzeylere gerçek yansımalar */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();

  /* lights */
  scene.add(new THREE.AmbientLight(0x334466, 1.4));
  const key = new THREE.PointLight(0x7c5cff, 40, 60);
  key.position.set(4, 8, 6);
  scene.add(key);

  /* endless neon grid */
  const CELL = 2;
  const grid = new THREE.GridHelper(140, 70, 0x7c5cff, 0x2a2f55);
  grid.position.y = -1;
  scene.add(grid);

  /* solid dark ground under the grid — kills the "void" look */
  const groundGeo = new THREE.PlaneGeometry(220, 220);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d22,
    roughness: 0.25,
    metalness: 0.85,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.05;
  scene.add(ground);

  /* glowing lane edge strips */
  const stripGeo = new THREE.BoxGeometry(0.12, 0.06, 140);
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0x00e0ff,
    emissive: 0x00e0ff,
    emissiveIntensity: 1.2,
  });
  for (const x of [-3.3, 3.3]) {
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.set(x, -0.93, -50);
    scene.add(strip);
  }

  /* background planet (static, slowly rotating) */
  const planetGeo = new THREE.IcosahedronGeometry(5, 1);
  const planetMat = new THREE.MeshBasicMaterial({
    color: 0x7c5cff,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
  });
  const planet = new THREE.Mesh(planetGeo, planetMat);
  planet.position.set(11, 10, -68);
  scene.add(planet);

  /* atmosfer halesi */
  const atmoGeo = new THREE.SphereGeometry(5.9, 32, 32);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: 0x7c5cff,
    transparent: true,
    opacity: 0.12,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(atmoGeo, atmoMat);
  atmo.position.copy(planet.position);
  scene.add(atmo);

  /* player spaceship */
  const playerGroup = new THREE.Group();
  const playerMat = new THREE.MeshStandardMaterial({
    color: 0x00e0ff,
    emissive: 0x00e0ff,
    emissiveIntensity: 1.3,
    flatShading: true,
  });
  const bodyGeo = new THREE.ConeGeometry(0.32, 1.5, 6);
  const body = new THREE.Mesh(bodyGeo, playerMat);
  body.rotation.x = -Math.PI / 2; // burun -z yönüne bakar

  const wingGeo = new THREE.BoxGeometry(1.5, 0.08, 0.55);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f55,
    emissive: 0x7c5cff,
    emissiveIntensity: 0.5,
    metalness: 0.6,
    roughness: 0.3,
  });
  const wings = new THREE.Mesh(wingGeo, wingMat);
  wings.position.z = 0.35;

  const engineGeo = new THREE.SphereGeometry(0.16, 12, 12);
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0xff8a3d,
    emissive: 0xff8a3d,
    emissiveIntensity: 1.2,
  });
  const engine = new THREE.Mesh(engineGeo, engineMat);
  engine.position.z = 0.85;

  const shipVisual = new THREE.Group(); // fallback (model yüklenene kadar)
  shipVisual.add(body, wings, engine);
  playerGroup.add(shipVisual);

  const playerGlow = new THREE.PointLight(0x00e0ff, 3.5, 6);
  playerGroup.add(playerGlow);
  playerGroup.position.set(0, 0.6, 0);
  scene.add(playerGroup);

  /* gerçek gemi modeli (CC0 — Quaternius) */
  function mountModel(
    target: THREE.Group,
    url: string,
    sizeTarget: number,
    fallback: THREE.Object3D | null,
    orientation: "forward" | "east" | "west" = "forward",
  ) {
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat && !Array.isArray(mat)) mat.envMapIntensity = 1.2;
          }
        });
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        model.scale.setScalar(sizeTarget / Math.max(size.x, size.y, size.z));
        // burun: forward → -z, east → +x, west → -x
        model.rotation.y =
          orientation === "forward" ? Math.PI : orientation === "east" ? -Math.PI / 2 : Math.PI / 2;
        box.setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        target.add(model);
        if (fallback) fallback.visible = false;
      },
      undefined,
      () => {
        /* model yüklenemezse prosedürel fallback kalmaya devam eder */
      },
    );
  }
  mountModel(playerGroup, "/models/Spitfire.glb", 1.7, shipVisual);

  /* stars */
  const starCount = 220;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 60;
    starPos[i * 3 + 1] = Math.random() * 14 - 2;
    starPos[i * 3 + 2] = -Math.random() * 90;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0x9fd8ff,
    size: 0.12,
    transparent: true,
    opacity: 0.7,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* asteroids (pooled) — displaced icosahedron = gerçek kayalık görünüm */
  const obstacles: { mesh: THREE.Mesh; active: boolean; counted: boolean }[] = [];
  const asteroidGeo = new THREE.IcosahedronGeometry(0.85, 2);
  {
    const pos = asteroidGeo.attributes
      .position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const noise =
        0.78 +
        0.22 *
          Math.abs(
            Math.sin(v.x * 3.1) * Math.sin(v.y * 2.3) * Math.sin(v.z * 3.7),
          ) +
        0.08 * Math.sin(v.y * 7);
      v.multiplyScalar(0.85 * noise);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    asteroidGeo.computeVertexNormals();
  }
  const asteroidMat = new THREE.MeshStandardMaterial({
    color: 0xff2d95,
    emissive: 0xff2d95,
    emissiveIntensity: 0.4,
    roughness: 0.55,
    metalness: 0.3,
  });
  const asteroidEdgeGeo = new THREE.EdgesGeometry(asteroidGeo, 1);
  const asteroidEdgeMat = new THREE.LineBasicMaterial({ color: 0xff8ac6 });

  function makeObstacleMesh(): THREE.Mesh {
    const m = new THREE.Mesh(asteroidGeo, asteroidMat);
    m.add(
      new THREE.LineSegments(asteroidEdgeGeo, asteroidEdgeMat),
    );
    scene.add(m);
    return m;
  }

  function spawnObstacle() {
    let entry = obstacles.find((o) => !o.active);
    if (!entry) {
      entry = { mesh: makeObstacleMesh(), active: true, counted: false };
      obstacles.push(entry);
    }
    const mesh = entry.mesh;
    entry.counted = false;

    // difficulty: sometimes close 2 lanes (always leave 1 open)
    const closedLanes = speed > BASE_SPEED + 6 && Math.random() < 0.35 ? 2 : 1;
    const open = Math.floor(Math.random() * 3);
    const closed = [0, 1, 2].filter((l) => l !== open).slice(0, closedLanes);

    mesh.position.set(
      closed.length === 2 ? (LANE_X[closed[0]] + LANE_X[closed[1]]) / 2 : LANE_X[closed[0]],
      0.6,
      SPAWN_Z,
    );
    mesh.scale.setScalar(closed.length === 2 ? 1.6 : 1);
    entry.active = true;
    lastObstacleDist = distance;
    lastClosedLanes = closed;
  }

  /* coins (pooled) — klasik arcade altın halkası */
  const coins: { mesh: THREE.Mesh; active: boolean }[] = [];
  const coinGeo = new THREE.TorusGeometry(0.3, 0.11, 12, 28);
  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xffc94d,
    emissive: 0xffc94d,
    emissiveIntensity: 1.4,
    metalness: 0.9,
    roughness: 0.25,
  });

  function spawnCoinRun() {
    // keep coin runs away from the obstacle that just spawned
    const blocked = lastDistance - lastObstacleDist < 5 ? lastClosedLanes : [];
    const open = [0, 1, 2].filter((l) => !blocked.includes(l));
    if (open.length === 0) return;
    const lane = open[Math.floor(Math.random() * open.length)];
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      let entry = coins.find((c) => !c.active);
      if (!entry) {
        entry = { mesh: new THREE.Mesh(coinGeo, coinMat), active: false };
        scene.add(entry.mesh);
        coins.push(entry);
      }
      entry.mesh.position.set(LANE_X[lane], 0.6, SPAWN_Z - i * 2.2);
      entry.mesh.scale.setScalar(1);
      entry.active = true;
    }
  }

  /* side pillars (decorative, speed sensation) */
  const pillars: THREE.Mesh[] = [];
  const pillarGeo = new THREE.BoxGeometry(0.25, 3.4, 0.25);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x00e0ff,
    emissive: 0x00e0ff,
    emissiveIntensity: 0.7,
  });
  function spawnPillars() {
    for (const x of [-4.4, 4.4]) {
      let p = pillars.find((m) => !m.visible);
      if (!p) {
        p = new THREE.Mesh(pillarGeo, pillarMat);
        scene.add(p);
        pillars.push(p);
      }
      p.position.set(x, 0.7, SPAWN_Z);
      p.visible = true;
    }
  }

  /* ambient spaceships (decorative, no collision) */
  interface AmbientShip {
    group: THREE.Group;
    vx: number;
    baseY: number;
    phase: number;
  }
  const ambientShips: AmbientShip[] = [];
  const shipHullGeo = new THREE.ConeGeometry(0.5, 2.4, 5);
  const shipColors = [0x00e0ff, 0xff2d95, 0x7c5cff];
  const shipModels = ["Zenith", "Striker", "Imperial"];
  const shipMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: shipColors[i],
      emissive: shipColors[i],
      emissiveIntensity: 0.7,
      flatShading: true,
    });
    shipMats.push(mat);
    const g = new THREE.Group();
    const hull = new THREE.Mesh(shipHullGeo, mat);
    const dir = i % 2 === 0 ? 1 : -1;
    hull.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2; // burun yönü
    g.add(hull);
    const beacon = new THREE.PointLight(shipColors[i], 2.5, 6);
    g.add(beacon);
    const baseY = 4 + Math.random() * 7;
    g.position.set(
      dir > 0 ? -35 : 35,
      baseY,
      -22 - Math.random() * 40,
    );
    scene.add(g);
    ambientShips.push({
      group: g,
      vx: dir * (7 + Math.random() * 5),
      baseY,
      phase: Math.random() * 10,
    });
    // gerçek gemi modeli (fallback koni gizlenir)
    mountModel(
      g,
      `/models/${shipModels[i]}.glb`,
      2.6,
      hull,
      dir > 0 ? "east" : "west",
    );
  }

  /* engine trail havuzu */
  const trailPool: { mesh: THREE.Mesh; life: number; maxLife: number; size: number }[] = [];
  const trailGeo = new THREE.SphereGeometry(0.09, 8, 8);
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0x00e0ff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 36; i++) {
    const mesh = new THREE.Mesh(trailGeo, trailMat);
    mesh.visible = false;
    scene.add(mesh);
    trailPool.push({ mesh, life: 0, maxLife: 0.22, size: 1 });
  }
  let trailIdx = 0;
  let trailTimer = 0;
  const engineWorldPos = new THREE.Vector3();

  function emitTrail(active: boolean) {
    const t = trailPool[trailIdx % trailPool.length];
    trailIdx++;
    engine.getWorldPosition(engineWorldPos);
    t.mesh.position.copy(engineWorldPos);
    t.mesh.position.x += (Math.random() - 0.5) * 0.08;
    t.maxLife = active ? 0.32 : 0.22;
    t.life = t.maxLife;
    t.size = active ? 1.5 : 1;
    t.mesh.visible = true;
  }

  /* crash particles */
  const shardCount = 26;
  const shardGeo = new THREE.TetrahedronGeometry(0.16, 0);
  const shards: { mesh: THREE.Mesh; vel: THREE.Vector3 }[] = [];
  for (let i = 0; i < shardCount; i++) {
    const mesh = new THREE.Mesh(
      shardGeo,
      new THREE.MeshStandardMaterial({
        color: 0x00e0ff,
        emissive: 0x00e0ff,
        emissiveIntensity: 1.2,
      }),
    );
    mesh.visible = false;
    scene.add(mesh);
    shards.push({ mesh, vel: new THREE.Vector3() });
  }
  function explode(pos: THREE.Vector3) {
    for (const s of shards) {
      s.mesh.position.copy(pos);
      s.mesh.visible = true;
      s.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      s.vel.set(
        (Math.random() - 0.5) * 9,
        Math.random() * 6 + 2,
        (Math.random() - 0.5) * 9,
      );
    }
  }

  /* state */
  let targetLane = 1;
  let speed = BASE_SPEED;
  let distance = 0;
  let score = 0;
  let coinsCollected = 0;
  let nextObstacleAt = 12;
  let nextCoinAt = 8;
  let nextPillarAt = 0;
  let lastObstacleDist = -100;
  let lastClosedLanes: number[] = [];
  let lastDistance = 0;
  let crashed = false;
  let crashTimer = 0;
  let scoreTick = 0;
  let lastReported = -1;
  let disposed = false;
  let boosting = false;
  let boostMeter = 1; // 0..1
  let combo = 0;
  let comboTimer = 0;
  let nearMisses = 0;
  let slowmo = 0;
  let bestBeaten = false;

  /* input: swipe + keys (+ first interaction unlocks audio) */
  let pointerStartX: number | null = null;

  function moveLane(dir: -1 | 1) {
    if (crashed) return;
    const next = Math.max(0, Math.min(2, targetLane + dir));
    if (next !== targetLane) {
      targetLane = next;
      ensureAudio();
      sfx.move();
    }
  }

  const onPointerDown = (e: PointerEvent) => {
    pointerStartX = e.clientX;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (pointerStartX === null) return;
    const dx = e.clientX - pointerStartX;
    if (Math.abs(dx) > 28) moveLane(dx > 0 ? 1 : -1);
    pointerStartX = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "a") moveLane(-1);
    if (e.key === "ArrowRight" || e.key === "d") moveLane(1);
    if (e.key === "ArrowUp" || e.key === "w") {
      if (!boosting) {
        ensureAudio();
        tone(120, 0.5, "sawtooth", 0.14, 260); // afterburner başlangıç sesi
      }
      boosting = true;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "w") boosting = false;
  };

  /* mobil BOOST butonu — oyun kanvasının içinde, DOM seviyesinde */
  const boostBtn = document.createElement("button");
  boostBtn.textContent = "⚡ BOOST";
  boostBtn.setAttribute("aria-label", "Boost");
  boostBtn.style.cssText =
    "position:absolute;right:10px;bottom:10px;z-index:5;padding:12px 16px;" +
    "font:600 12px/1 system-ui,sans-serif;color:#00e0ff;" +
    "background:rgba(0,224,255,0.08);border:1px solid rgba(0,224,255,0.45);" +
    "border-radius:10px;cursor:pointer;touch-action:none;" +
    "-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent";
  container.appendChild(boostBtn);
  const boostStart = (e: Event) => {
    e.preventDefault();
    if (!boosting) {
      ensureAudio();
      tone(120, 0.5, "sawtooth", 0.14, 260);
    }
    boosting = true;
  };
  const boostEnd = () => {
    boosting = false;
  };
  boostBtn.addEventListener("pointerdown", boostStart);
  window.addEventListener("pointerup", boostEnd);
  window.addEventListener("pointercancel", boostEnd);

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);

  /* crash */
  function crash() {
    if (crashed) return;
    crashed = true;
    crashTimer = 0;
    ensureAudio();
    sfx.crash();
    explode(playerGroup.position);
    playerGroup.visible = false;
  }

  /* loop */
  const clock = new THREE.Clock();

  function tick() {
    if (disposed) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();

    if (!crashed) {
      // bullet-time: yakın kaçırışta dünya yavaşlar
      const ts = slowmo > 0 ? 0.3 : 1;
      slowmo = Math.max(0, slowmo - dt);
      const sdt = dt * ts;

      speed = Math.min(MAX_SPEED, speed + ACCEL * sdt);

      /* boost: afterburner — hız +14, skor x2, meter biterse söner */
      const wantBoost = boosting && boostMeter > 0;
      if (wantBoost) boostMeter = Math.max(0, boostMeter - sdt * 0.45);
      else boostMeter = Math.min(1, boostMeter + sdt * 0.15);
      const boostActive = wantBoost;
      const eff = boostActive ? speed + 14 : speed;

      distance += eff * sdt;
      lastDistance = distance;
      score += eff * sdt * 1.5 * (boostActive ? 2 : 1);

      /* combo süresi */
      comboTimer -= sdt;
      if (comboTimer <= 0 && combo > 0) combo = 0;

      /* player movement */
      const targetX = LANE_X[targetLane];
      const px = playerGroup.position.x;
      playerGroup.position.x = px + (targetX - px) * Math.min(1, sdt * 12);
      playerGroup.rotation.z = -(targetX - px) * 0.22; // bankala
      playerGroup.position.y = 0.6 + Math.abs(Math.sin(t * 6)) * 0.12;
      engineMat.emissiveIntensity = boostActive
        ? 2.6 + Math.sin(t * 30) * 0.6
        : 1.2 + Math.sin(t * 12) * 0.15;

      /* engine trail */
      trailTimer += sdt;
      if (trailTimer > (boostActive ? 0.016 : 0.028)) {
        trailTimer = 0;
        emitTrail(boostActive);
      }
      for (const tp of trailPool) {
        if (!tp.mesh.visible) continue;
        tp.life -= sdt;
        if (tp.life <= 0) {
          tp.mesh.visible = false;
          continue;
        }
        tp.mesh.position.z += eff * sdt;
        tp.mesh.scale.setScalar((tp.life / tp.maxLife) * tp.size);
      }

      /* speed FOV kick — boost'ta ekstra genişler, "uçuş" hissi */
      const fovTarget =
        70 +
        ((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)) * 14 +
        (boostActive ? 5 : 0);
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();

      /* track scroll */
      grid.position.z = -(distance % CELL);
      const arr = starGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < starCount; i++) {
        arr[i * 3 + 2] += eff * sdt * (boostActive ? 1.1 : 0.6);
        if (arr[i * 3 + 2] > DESPAWN_Z) arr[i * 3 + 2] = -90;
      }
      starGeo.attributes.position.needsUpdate = true;

      planet.rotation.y += dt * 0.08;
      planet.rotation.x += dt * 0.03;

      /* ambient spaceships cruising across the scene */
      for (const s of ambientShips) {
        s.group.position.x += s.vx * sdt;
        s.group.position.y = s.baseY + Math.sin(t * 0.8 + s.phase) * 0.6;
        s.group.rotation.z = Math.sin(t * 0.5 + s.phase) * 0.08;
        if (Math.abs(s.group.position.x) > 42) {
          const dir = s.vx > 0 ? 1 : -1;
          s.group.position.x = dir > 0 ? -42 : 42;
          s.group.position.z = -22 - Math.random() * 42;
          s.baseY = 4 + Math.random() * 7;
        }
      }

      /* spawns */
      if (distance >= nextObstacleAt) {
        nextObstacleAt = distance + Math.max(7, 13 - speed * 0.09);
        spawnObstacle();
      }
      if (distance >= nextCoinAt) {
        nextCoinAt = distance + 10 + Math.random() * 8;
        spawnCoinRun();
      }
      if (distance >= nextPillarAt) {
        nextPillarAt = distance + 11;
        spawnPillars();
      }

      /* asteroids */
      for (const o of obstacles) {
        if (!o.active) continue;
        o.mesh.position.z += eff * sdt;
        o.mesh.rotation.y += sdt * 1.5;
        if (o.mesh.position.z > DESPAWN_Z) {
          o.active = false;
          o.mesh.position.z = SPAWN_Z;
          o.mesh.scale.setScalar(1);
          continue;
        }
        const dz = Math.abs(o.mesh.position.z - playerGroup.position.z);
        const dx = Math.abs(o.mesh.position.x - playerGroup.position.x);
        const hitRadius = o.mesh.scale.x > 1.2 ? 1.5 : 0.95;
        if (dz < hitRadius && dx < hitRadius) {
          crash();
          continue;
        }
        /* near-miss: geminin hemen yanından geçmek bonus + bullet-time */
        if (!o.counted && o.mesh.position.z > playerGroup.position.z + 1.2) {
          o.counted = true;
          if (dx < 1.75) {
            nearMisses++;
            score += 50;
            slowmo = 0.3;
            sfx.nearMiss();
            hooks.onPopup?.("⚠ CLOSE +50");
          }
        }
      }

      /* coins */
      for (const c of coins) {
        if (!c.active) continue;
        const mesh = c.mesh;
        mesh.position.z += eff * sdt;
        mesh.rotation.y += dt * 4;
        mesh.position.y = 0.6 + Math.sin(t * 5 + mesh.position.z) * 0.1;
        if (mesh.position.z > DESPAWN_Z) {
          c.active = false;
          mesh.position.z = SPAWN_Z;
          continue;
        }
        const dz = Math.abs(mesh.position.z - playerGroup.position.z);
        const dx = Math.abs(mesh.position.x - playerGroup.position.x);
        if (dz < 0.9 && dx < 0.9) {
          c.active = false;
          mesh.position.z = SPAWN_Z;
          coinsCollected++;
          comboTimer = 2.5;
          combo = Math.min(8, combo + 1);
          score += COIN_VALUE * combo;
          sfx.coin(combo);
          hooks.onPopup?.(combo > 1 ? `COMBO x${combo}` : `+${COIN_VALUE}`);
        }
      }

      /* pillars */
      for (const p of pillars) {
        if (!p.visible) continue;
        p.position.z += eff * sdt;
        if (p.position.z > DESPAWN_Z) p.visible = false;
      }

      /* score + boost report ~10 Hz */
      scoreTick += dt;
      if (scoreTick > 0.1) {
        scoreTick = 0;
        hooks.onBoost?.(boostMeter, boostActive);
        const s = Math.floor(score);
        if (s !== lastReported) {
          lastReported = s;
          hooks.onScore?.(s);
        }
        /* rekor canlı geçilince tek seferlik kutlama */
        if (!bestBeaten && hooks.best && hooks.best > 0 && s > hooks.best) {
          bestBeaten = true;
          hooks.onPopup?.("🏆 NEW BEST!");
          sfx.best();
        }
      }
    } else {
      /* crash sequence: shake + shards fall, then finish */
      crashTimer += dt;
      camera.position.x = CAM_POS.x + (Math.random() - 0.5) * crashTimer * 2.2;
      for (const s of shards) {
        if (!s.mesh.visible) continue;
        s.vel.y -= 18 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += dt * 8;
        s.mesh.rotation.y += dt * 6;
        if (s.mesh.position.y < -1) s.mesh.visible = false;
      }
      if (crashTimer > 0.55) {
        hooks.onGameOver?.(Math.floor(score), {
          coins: coinsCollected,
          nearMisses,
          distance: Math.floor(distance),
        });
        return; // stops RAF; StageCanvas handles restart
      }
    }

    /* camera follows player softly */
    camera.position.x +=
      (playerGroup.position.x * 0.45 - camera.position.x) * Math.min(1, dt * 5);

    composer.render();
  }
  tick();

  /* resize & cleanup */
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
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", boostEnd);
      window.removeEventListener("pointercancel", boostEnd);
      boostBtn.removeEventListener("pointerdown", boostStart);
      boostBtn.remove();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      bodyGeo.dispose();
      playerMat.dispose();
      wingGeo.dispose();
      wingMat.dispose();
      engineGeo.dispose();
      engineMat.dispose();
      shipHullGeo.dispose();
      for (const m of shipMats) m.dispose();
      trailGeo.dispose();
      trailMat.dispose();
      asteroidGeo.dispose();
      asteroidMat.dispose();
      asteroidEdgeGeo.dispose();
      asteroidEdgeMat.dispose();
      coinGeo.dispose();
      coinMat.dispose();
      pillarGeo.dispose();
      pillarMat.dispose();
      shardGeo.dispose();
      starGeo.dispose();
      starMat.dispose();
      planetGeo.dispose();
      planetMat.dispose();
      for (const s of shards) {
        (s.mesh.material as THREE.Material).dispose();
      }
      groundGeo.dispose();
      groundMat.dispose();
      stripGeo.dispose();
      stripMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      grid.dispose();
      // yüklenen GLB dahil sahnede kalan tüm mesh kaynaklarını serbest bırak
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
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      audioCtx = null;
    },
  };
}

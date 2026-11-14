import * as THREE from "three";
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
  onGameOver?: (score: number) => void;
};

const LANE_X = [-2.2, 0, 2.2];
const PLAYER_RADIUS = 0.45;
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
  coin: () => tone(880, 0.12, "square", 0.12, 1320),
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
  renderer.toneMappingExposure = 1.15;
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
    0.85, // strength
    0.55, // radius
    0.15, // threshold — sadece parlak öğeler yayılır
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* lights */
  scene.add(new THREE.AmbientLight(0x334466, 1.4));
  const key = new THREE.PointLight(0x7c5cff, 60, 60);
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
    roughness: 0.35,
    metalness: 0.75,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.05;
  scene.add(ground);

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

  /* player */
  const playerGroup = new THREE.Group();
  const playerGeo = new THREE.IcosahedronGeometry(PLAYER_RADIUS, 1);
  const playerMat = new THREE.MeshStandardMaterial({
    color: 0x00e0ff,
    emissive: 0x00e0ff,
    emissiveIntensity: 1.3,
    flatShading: true,
  });
  const playerMesh = new THREE.Mesh(playerGeo, playerMat);
  playerGroup.add(playerMesh);
  const playerGlow = new THREE.PointLight(0x00e0ff, 12, 8);
  playerGroup.add(playerGlow);
  playerGroup.position.set(0, 0.6, 0);
  scene.add(playerGroup);

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

  /* asteroids (pooled) */
  const obstacles: { mesh: THREE.Mesh; active: boolean }[] = [];
  const asteroidGeo = new THREE.IcosahedronGeometry(0.85, 0);
  const asteroidMat = new THREE.MeshStandardMaterial({
    color: 0xff2d95,
    emissive: 0xff2d95,
    emissiveIntensity: 0.35,
    flatShading: true,
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
      entry = { mesh: makeObstacleMesh(), active: true };
      obstacles.push(entry);
    }
    const mesh = entry.mesh;

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

  /* coins (pooled) */
  const coins: { mesh: THREE.Mesh; active: boolean }[] = [];
  const coinGeo = new THREE.OctahedronGeometry(0.28, 0);
  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xffc94d,
    emissive: 0xffc94d,
    emissiveIntensity: 1.4,
    flatShading: true,
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
  };

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKey);

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
      speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
      distance += speed * dt;
      lastDistance = distance;
      score += speed * dt * 1.5;

      /* player movement */
      const targetX = LANE_X[targetLane];
      const px = playerGroup.position.x;
      playerGroup.position.x = px + (targetX - px) * Math.min(1, dt * 12);
      playerMesh.rotation.z += dt * 3;
      playerMesh.rotation.x += dt * 1.2;
      playerGroup.position.y = 0.6 + Math.abs(Math.sin(t * 6)) * 0.12;

      /* speed FOV kick — hız arttıkça görüş açısı genişler, "uçuş" hissi */
      const fovTarget =
        70 + ((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)) * 14;
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();

      /* track scroll */
      grid.position.z = -(distance % CELL);
      const arr = starGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < starCount; i++) {
        arr[i * 3 + 2] += speed * dt * 0.6;
        if (arr[i * 3 + 2] > DESPAWN_Z) arr[i * 3 + 2] = -90;
      }
      starGeo.attributes.position.needsUpdate = true;

      planet.rotation.y += dt * 0.08;
      planet.rotation.x += dt * 0.03;

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
        o.mesh.position.z += speed * dt;
        o.mesh.rotation.y += dt * 1.5;
        if (o.mesh.position.z > DESPAWN_Z) {
          o.active = false;
          o.mesh.position.z = SPAWN_Z;
          o.mesh.scale.setScalar(1);
          continue;
        }
        const dz = Math.abs(o.mesh.position.z - playerGroup.position.z);
        const dx = Math.abs(o.mesh.position.x - playerGroup.position.x);
        const hitRadius = o.mesh.scale.x > 1.2 ? 1.5 : 0.95;
        if (dz < hitRadius && dx < hitRadius) crash();
      }

      /* coins */
      for (const c of coins) {
        if (!c.active) continue;
        const mesh = c.mesh;
        mesh.position.z += speed * dt;
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
          score += COIN_VALUE;
          sfx.coin();
        }
      }

      /* pillars */
      for (const p of pillars) {
        if (!p.visible) continue;
        p.position.z += speed * dt;
        if (p.position.z > DESPAWN_Z) p.visible = false;
      }

      /* score report ~10 Hz */
      scoreTick += dt;
      if (scoreTick > 0.1) {
        scoreTick = 0;
        const s = Math.floor(score);
        if (s !== lastReported) {
          lastReported = s;
          hooks.onScore?.(s);
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
        hooks.onGameOver?.(Math.floor(score));
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
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      playerGeo.dispose();
      playerMat.dispose();
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
      grid.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      audioCtx = null;
    },
  };
}

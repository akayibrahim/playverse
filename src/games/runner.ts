import * as THREE from "three";

/**
 * Neon Runner — oynanabilir demo (v0.2).
 * 3 şerit, swipe/dokunma + ok tuşları, asteroidler, artan hız, skor.
 *
 * İmza korunacak:
 *   createGame(container, hooks) => { dispose() }
 * hooks: { onScore(s), onGameOver(s) } — StageCanvas HUD'a bağlar.
 */

export type RunnerHooks = {
  onScore?: (score: number) => void;
  onGameOver?: (score: number) => void;
};

const LANE_X = [-2.2, 0, 2.2];
const PLAYER_RADIUS = 0.45;
const SPAWN_Z = -70;
const DESPAWN_Z = 12;
const BASE_SPEED = 14; // birim/sn
const MAX_SPEED = 42;
const ACCEL = 0.4; // birim/sn²
const SCORE_RATE = 10; // skor / birim

export function createGame(
  container: HTMLElement,
  hooks: RunnerHooks = {},
): { dispose: () => void } {
  const width = container.clientWidth;
  const height = container.clientHeight;

  /* ---------- renderer / sahne / kamera ---------- */

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05060f, 14, 75);

  const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 120);
  const CAM_POS = new THREE.Vector3(0, 4.4, 8.5);
  camera.position.copy(CAM_POS);
  camera.lookAt(0, 0.8, -6);

  /* ---------- ışıklar ---------- */

  scene.add(new THREE.AmbientLight(0x334466, 1.4));
  const key = new THREE.PointLight(0x7c5cff, 60, 60);
  key.position.set(4, 8, 6);
  scene.add(key);

  /* ---------- sonsuz neon ızgara ---------- */

  const CELL = 2;
  const grid = new THREE.GridHelper(140, 70, 0x7c5cff, 0x2a2f55);
  grid.position.y = -1;
  scene.add(grid);

  /* ---------- oyuncu ---------- */

  const playerGroup = new THREE.Group();
  const playerGeo = new THREE.IcosahedronGeometry(PLAYER_RADIUS, 1);
  const playerMat = new THREE.MeshStandardMaterial({
    color: 0x00e0ff,
    emissive: 0x00e0ff,
    emissiveIntensity: 0.8,
    flatShading: true,
  });
  const playerMesh = new THREE.Mesh(playerGeo, playerMat);
  playerGroup.add(playerMesh);
  const playerGlow = new THREE.PointLight(0x00e0ff, 12, 8);
  playerGroup.add(playerGlow);
  playerGroup.position.set(0, 0.6, 0);
  scene.add(playerGroup);

  /* ---------- asteroid havuzu ---------- */

  const obstacles: {
    mesh: THREE.Mesh;
    lanes: Set<number>;
    active: boolean;
  }[] = [];

  const asteroidGeo = new THREE.IcosahedronGeometry(0.85, 0);
  const asteroidMat = new THREE.MeshStandardMaterial({
    color: 0xff2d95,
    emissive: 0xff2d95,
    emissiveIntensity: 0.35,
    flatShading: true,
  });
  const asteroidEdgeGeo = new THREE.EdgesGeometry(asteroidGeo, 1);

  function spawnObstacle() {
    const activeCount = obstacles.filter((o) => o.active).length;
    const mesh =
      obstacles.find((o) => !o.active)?.mesh ??
      (() => {
        const m = new THREE.Mesh(asteroidGeo, asteroidMat);
        const edges = new THREE.LineSegments(
          asteroidEdgeGeo,
          new THREE.LineBasicMaterial({ color: 0xff8ac6 }),
        );
        m.add(edges);
        scene.add(m);
        return m;
      })();

    // Zorluk arttıkça bazen 2 şerit kapanır (hep 1 açık kalır)
    const closedLanes =
      speed > BASE_SPEED + 6 && Math.random() < 0.35 ? 2 : 1;
    const open = Math.floor(Math.random() * 3);
    const lanes = new Set<number>(
      [0, 1, 2].filter((l) => l !== open).slice(0, closedLanes),
    );

    const x = [...lanes].map((l) => LANE_X[l]);
    mesh.position.set(
      x.length === 2 ? (x[0] + x[1]) / 2 : x[0],
      0.6,
      SPAWN_Z,
    );
    mesh.scale.setScalar(x.length === 2 ? 1.6 : 1);

    const entry = obstacles.find((o) => o.mesh === mesh);
    if (entry) {
      entry.active = true;
      entry.lanes = lanes;
    } else {
      obstacles.push({ mesh, lanes, active: true });
    }
  }

  /* ---------- yıldız tozu ---------- */

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

  /* ---------- durum ---------- */

  let targetLane = 1;
  let speed = BASE_SPEED;
  let distance = 0;
  let score = 0;
  let nextSpawnAt = 10;
  let crashed = false;
  let crashTimer = 0;
  let scoreTick = 0;
  let lastReported = -1;
  let disposed = false;

  /* ---------- girdi: swipe + klavye ---------- */

  let pointerStartX: number | null = null;

  function moveLane(dir: -1 | 1) {
    if (crashed) return;
    targetLane = Math.max(0, Math.min(2, targetLane + dir));
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

  /* ---------- çarpışma & oyun sonu ---------- */

  function crash() {
    crashed = true;
    crashTimer = 0;
    playerMat.color.set(0xff2244);
    playerMat.emissive.set(0xff2244);
  }

  /* ---------- döngü ---------- */

  const clock = new THREE.Clock();

  function tick() {
    if (disposed) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05); // sekme değişiminde sıçramayı engelle
    const t = clock.getElapsedTime();

    if (!crashed) {
      // hız & mesafe & skor
      speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
      distance += speed * dt;
      score += speed * dt * SCORE_RATE * 0.1;

      // şerit geçişi (yumuşak)
      const targetX = LANE_X[targetLane];
      const px = playerGroup.position.x;
      playerGroup.position.x = px + (targetX - px) * Math.min(1, dt * 12);
      playerMesh.rotation.z += dt * 3;
      playerMesh.rotation.x += dt * 1.2;
      // hafif zıplama
      playerGroup.position.y = 0.6 + Math.abs(Math.sin(t * 6)) * 0.12;

      // ızgara + yıldız akışı (sonsuz pist hissi)
      grid.position.z = -(distance % CELL);
      starGeo.attributes.position.needsUpdate = true;
      const arr = starGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < starCount; i++) {
        arr[i * 3 + 2] += speed * dt * 0.6;
        if (arr[i * 3 + 2] > DESPAWN_Z) arr[i * 3 + 2] = -90;
      }

      // asteroid spawn
      if (distance >= nextSpawnAt) {
        nextSpawnAt = distance + Math.max(7, 12 - speed * 0.08);
        spawnObstacle();
      }

      // asteroid hareketi + çarpışma
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

      // skor raporu (throttle ~10 Hz)
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
      // çarpışma sonrası: kısa sarsıntı, sonra bitir
      crashTimer += dt;
      camera.position.x = CAM_POS.x + (Math.random() - 0.5) * crashTimer * 2;
      if (crashTimer > 0.45) {
        hooks.onGameOver?.(Math.floor(score));
        return; // RAF durur; restart StageCanvas'ta
      }
    }

    // kamera oyuncuyu yumuşak takip etsin
    camera.position.x +=
      (playerGroup.position.x * 0.45 - camera.position.x) * Math.min(1, dt * 5);

    renderer.render(scene, camera);
  }
  tick();

  /* ---------- resize & temizlik ---------- */

  const onResize = () => {
    if (disposed || !container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
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
      starGeo.dispose();
      starMat.dispose();
      grid.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

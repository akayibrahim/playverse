import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Orbiter — v1.0 (full game).
 * One-tap survival: your ship circles a planet on a glowing ring;
 * tap anywhere (or Space) to instantly REVERSE orbital direction
 * and dodge incoming asteroids. +10 per asteroid that safely crosses
 * the ring, +25 close-call bonus, LEVEL popup every 100 points.
 * WebAudio SFX (no assets) · explosion particles · camera shake.
 *
 * Contract (keep):
 *   createGame(container, hooks) => { dispose() }
 *   hooks: { onScore(s), onGameOver(s, stats), onPopup(text), best }
 */

export type OrbiterHooks = {
  onScore?: (score: number) => void;
  onGameOver?: (
    score: number,
    stats: { label: string; value: string }[],
  ) => void;
  onPopup?: (text: string) => void;
  best?: number; // rekor — geçilince onPopup "NEW BEST" tetikler
};

const RING_R = 4; // orbit radius
const SHIP_Y = 0.35; // flight height above the ring plane
const BASE_OMEGA = 1.35; // starting angular speed (rad/s)
const MAX_OMEGA = 2.7;
const AST_BASE_SPEED = 5.5;
const AST_MAX_SPEED = 16;
const SPAWN_R = 16; // asteroids spawn on this circle
const DESPAWN_R = 21;
const BASE_SPAWN_INTERVAL = 1.15;
const MIN_SPAWN_INTERVAL = 0.42;
const NEAR_MISS_DIST = 1.2;
const LEVEL_STEP = 100;

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
  delay = 0,
) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime + delay;
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
  reverse: () => tone(480, 0.08, "square", 0.1, 190), // kısa blip
  nearMiss: () => tone(320, 0.2, "sine", 0.13, 1500), // whoosh
  level: () => {
    tone(520, 0.12, "triangle", 0.12);
    tone(780, 0.2, "triangle", 0.12, 900, 0.09);
  },
  best: () => {
    tone(660, 0.18, "triangle", 0.14);
    tone(880, 0.18, "triangle", 0.14, 1100, 0.12);
    tone(1320, 0.35, "triangle", 0.12, 1320, 0.24);
  },
  crash: () => {
    tone(220, 0.5, "sawtooth", 0.25, 40);
    tone(90, 0.6, "triangle", 0.2, 30);
  },
};

/* ---------- game ---------- */

export function createGame(
  container: HTMLElement,
  hooks: OrbiterHooks = {},
): { dispose: () => void } {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f); // oyun sahnesi her temada karanlık
  scene.fog = new THREE.Fog(0x05060f, 17, 46);

  // top-down-ish: high tilted camera looking at the planet
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 160);
  const CAM_POS = new THREE.Vector3(0, 12.8, 7.2);
  camera.position.copy(CAM_POS);
  camera.lookAt(0, 0, -1.2);

  /* post-processing: bloom = neon estetiğin kalbi */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.45, // strength
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
  scene.add(new THREE.AmbientLight(0x334466, 1.3));
  const key = new THREE.PointLight(0x7c5cff, 50, 70);
  key.position.set(5, 10, 5);
  scene.add(key);
  // planet kendisi hafifçe aydınlatır — halka ve gemi altı mavi parlar
  const planetGlow = new THREE.PointLight(0x00e0ff, 6, 12);
  planetGlow.position.set(0, 1, 0);
  scene.add(planetGlow);

  /* central planet + emissive atmosphere */
  const planetGeo = new THREE.IcosahedronGeometry(1.8, 3);
  const planetMat = new THREE.MeshStandardMaterial({
    color: 0x1a2f55,
    emissive: 0x3d2a8f,
    emissiveIntensity: 0.35,
    roughness: 0.6,
    metalness: 0.35,
    flatShading: true,
  });
  const planet = new THREE.Mesh(planetGeo, planetMat);
  scene.add(planet);

  // wireframe overlay: dönerek "yaşayan gezegen" hissi verir
  const wireGeo = new THREE.IcosahedronGeometry(1.83, 1);
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x7c5cff,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
  });
  const planetWire = new THREE.Mesh(wireGeo, wireMat);
  scene.add(planetWire);

  const atmoGeo = new THREE.SphereGeometry(2.6, 32, 32);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: 0x7c5cff,
    transparent: true,
    opacity: 0.14,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const atmo = new THREE.Mesh(atmoGeo, atmoMat);
  scene.add(atmo);

  /* orbit ring: ince neon çember + geniş yumuşak hale */
  const ringGeo = new THREE.TorusGeometry(RING_R, 0.03, 10, 140);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x00e0ff,
    emissive: 0x00e0ff,
    emissiveIntensity: 1.4,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = SHIP_Y;
  scene.add(ring);

  const haloGeo = new THREE.TorusGeometry(RING_R, 0.11, 10, 140);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x00e0ff,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = SHIP_Y;
  scene.add(halo);

  /* background stars */
  const starCount = 260;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // küre kabuğu üzerinde dağıt — top-down sahnede her yönden yıldız görünsün
    const r = 30 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi) * 0.5; // üst yarımküreye hafifçe bas
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0x9fd8ff,
    size: 0.16,
    transparent: true,
    opacity: 0.75,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* player ship: neon cone pointing tangentially */
  const shipGroup = new THREE.Group();
  const bodyGeo = new THREE.ConeGeometry(0.3, 1.3, 6);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x00e0ff,
    emissive: 0x00e0ff,
    emissiveIntensity: 1.3,
    flatShading: true,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = -Math.PI / 2; // burun -z yönüne bakar

  const wingGeo = new THREE.BoxGeometry(0.95, 0.06, 0.4);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f55,
    emissive: 0x7c5cff,
    emissiveIntensity: 0.5,
    metalness: 0.6,
    roughness: 0.3,
  });
  const wings = new THREE.Mesh(wingGeo, wingMat);
  wings.position.z = 0.3;

  const engineGeo = new THREE.SphereGeometry(0.14, 12, 12);
  const engineMat = new THREE.MeshBasicMaterial({
    color: 0xff8a3d,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const engine = new THREE.Mesh(engineGeo, engineMat);
  engine.position.z = 0.75;

  shipGroup.add(body, wings, engine);
  const shipLight = new THREE.PointLight(0x00e0ff, 3.5, 6);
  shipGroup.add(shipLight);
  shipGroup.position.set(RING_R, SHIP_Y, 0);
  scene.add(shipGroup);

  /* engine trail: yörünge boyunca sönen neon noktalar */
  const trailGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0x00e0ff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const trailPool: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];
  for (let i = 0; i < 28; i++) {
    const mesh = new THREE.Mesh(trailGeo, trailMat);
    mesh.visible = false;
    scene.add(mesh);
    trailPool.push({ mesh, life: 0, maxLife: 0.4 });
  }
  let trailIdx = 0;
  let trailTimer = 0;

  /* asteroids (pooled) — displaced icosahedron = gerçek kayalık görünüm */
  const asteroids: {
    mesh: THREE.Mesh;
    active: boolean;
    counted: boolean;
    prevR: number;
    radius: number;
    scale: number;
  }[] = [];
  const asteroidGeo = new THREE.IcosahedronGeometry(0.85, 2);
  {
    const pos = asteroidGeo.attributes.position as THREE.BufferAttribute;
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

  function makeAsteroid(): (typeof asteroids)[number] {
    const mesh = new THREE.Mesh(asteroidGeo, asteroidMat);
    mesh.add(new THREE.LineSegments(asteroidEdgeGeo, asteroidEdgeMat));
    mesh.visible = false;
    scene.add(mesh);
    const entry = {
      mesh,
      active: false,
      counted: false,
      prevR: 0,
      radius: 0.85,
      scale: 1,
    };
    asteroids.push(entry);
    return entry;
  }

  function spawnAsteroid(speed: number) {
    const entry = asteroids.find((a) => !a.active) ?? makeAsteroid();
    const mesh = entry.mesh;

    // spawn on a circle around the planet, aim at a random point inside
    // the ring — guarantees the asteroid crosses the orbit
    const ang = Math.random() * Math.PI * 2;
    mesh.position.set(
      Math.cos(ang) * SPAWN_R,
      SHIP_Y,
      Math.sin(ang) * SPAWN_R,
    );
    const aimAng = Math.random() * Math.PI * 2;
    const aimR = Math.random() * 2.5;
    const dir = new THREE.Vector3(
      Math.cos(aimAng) * aimR - mesh.position.x,
      0,
      Math.sin(aimAng) * aimR - mesh.position.z,
    ).normalize();

    entry.scale = 0.6 + Math.random() * 0.5;
    mesh.scale.setScalar(entry.scale);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    mesh.visible = true;
    entry.radius = 0.85 * entry.scale;
    entry.active = true;
    entry.counted = false;
    entry.prevR = mesh.position.length();
    mesh.userData.vel = dir.multiplyScalar(speed * (0.85 + Math.random() * 0.3));
  }

  /* explosion shards */
  const shardCount = 30;
  const shardGeo = new THREE.TetrahedronGeometry(0.16, 0);
  const shardMats = [
    new THREE.MeshStandardMaterial({
      color: 0x00e0ff,
      emissive: 0x00e0ff,
      emissiveIntensity: 1.2,
    }),
    new THREE.MeshStandardMaterial({
      color: 0xff2d95,
      emissive: 0xff2d95,
      emissiveIntensity: 1.2,
    }),
  ];
  const shards: { mesh: THREE.Mesh; vel: THREE.Vector3 }[] = [];
  for (let i = 0; i < shardCount; i++) {
    const mesh = new THREE.Mesh(shardGeo, shardMats[i % shardMats.length]);
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
        (Math.random() - 0.5) * 10,
        Math.random() * 7 + 2,
        (Math.random() - 0.5) * 10,
      );
    }
  }

  /* state */
  let theta = 0; // orbital angle
  let omega = BASE_OMEGA; // angular speed magnitude
  let dirSign = 1; // +1 or -1 — tap reverses this
  let asteroidSpeed = AST_BASE_SPEED;
  let spawnInterval = BASE_SPAWN_INTERVAL;
  let spawnTimer = 1.2; // first asteroid gets a grace delay
  let score = 0;
  let level = 0;
  let nextLevelAt = LEVEL_STEP;
  let elapsed = 0;
  let nearMisses = 0;
  let crashed = false;
  let finished = false;
  let crashTimer = 0;
  let lastReported = -1;
  let bestBeaten = false;
  let flare = 0; // engine flash after a reversal
  let disposed = false;

  /* input: ONE tap anywhere = reverse (first tap unlocks audio too) */
  function reverse() {
    if (crashed) return;
    dirSign *= -1;
    flare = 0.18;
    ensureAudio();
    sfx.reverse();
  }

  const onPointerDown = () => reverse();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) reverse();
    }
  };

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKey);

  /* game over */
  function crash() {
    if (crashed) return;
    crashed = true;
    crashTimer = 0;
    ensureAudio();
    sfx.crash();
    explode(shipGroup.position.clone());
    shipGroup.visible = false;
  }

  /* loop */
  const clock = new THREE.Clock();
  const tmpVel = new THREE.Vector3();

  function tick() {
    if (disposed || finished) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();

    if (!crashed) {
      elapsed += dt;

      /* difficulty ramps: everything slowly tightens */
      omega = Math.min(MAX_OMEGA, BASE_OMEGA + elapsed * 0.02 + level * 0.06);
      asteroidSpeed = Math.min(
        AST_MAX_SPEED,
        AST_BASE_SPEED + elapsed * 0.14 + level * 0.3,
      );
      spawnInterval = Math.max(
        MIN_SPAWN_INTERVAL,
        BASE_SPAWN_INTERVAL - elapsed * 0.012,
      );

      /* orbital motion */
      theta += dirSign * omega * dt;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      shipGroup.position.set(RING_R * cosT, SHIP_Y, RING_R * sinT);
      // tangent direction = motion direction; ship nose follows it
      const tdx = -sinT * dirSign;
      const tdz = cosT * dirSign;
      shipGroup.rotation.y = Math.atan2(-tdx, -tdz);
      shipGroup.rotation.z = -dirSign * 0.35; // hafif bankala

      /* engine flare + trail */
      flare = Math.max(0, flare - dt);
      engineMat.opacity = 0.9 + flare * 4 + Math.sin(t * 14) * 0.15;
      engine.scale.setScalar(1 + flare * 2.2);
      trailTimer += dt;
      if (trailTimer > 0.03) {
        trailTimer = 0;
        const tr = trailPool[trailIdx % trailPool.length];
        trailIdx++;
        tr.mesh.position.copy(engine.getWorldPosition(new THREE.Vector3()));
        tr.mesh.position.y += (Math.random() - 0.5) * 0.06;
        tr.maxLife = 0.4;
        tr.life = tr.maxLife;
        tr.mesh.visible = true;
      }
      for (const tp of trailPool) {
        if (!tp.mesh.visible) continue;
        tp.life -= dt;
        if (tp.life <= 0) {
          tp.mesh.visible = false;
          continue;
        }
        (tp.mesh.material as THREE.MeshBasicMaterial).opacity =
          (tp.life / tp.maxLife) * 0.55;
        tp.mesh.scale.setScalar(tp.life / tp.maxLife);
      }

      /* spawns */
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = spawnInterval * (0.8 + Math.random() * 0.4);
        spawnAsteroid(asteroidSpeed);
      }

      /* asteroids: straight lines through the scene */
      for (const a of asteroids) {
        if (!a.active) continue;
        const mesh = a.mesh;
        tmpVel.copy(mesh.userData.vel as THREE.Vector3);
        mesh.position.addScaledVector(tmpVel, dt);
        mesh.rotation.y += dt * 1.5;
        mesh.rotation.x += dt * 0.6;

        const r = mesh.position.length();
        if (r > DESPAWN_R) {
          a.active = false;
          mesh.visible = false;
          continue;
        }

        /* hit check — continuous, both ship and asteroid move */
        const hitR = a.radius * 0.75 + 0.32;
        if (mesh.position.distanceTo(shipGroup.position) < hitR) {
          crash();
          continue;
        }

        /* ring crossing: sign change of |pos| - R → +10 */
        const d = r - RING_R;
        if (!a.counted && Math.sign(d) !== Math.sign(a.prevR - RING_R)) {
          a.counted = true;
          score += 10;

          /* near-miss bonus: crossed within 1.2u of the ship, no hit */
          if (mesh.position.distanceTo(shipGroup.position) < NEAR_MISS_DIST) {
            nearMisses++;
            score += 25;
            sfx.nearMiss();
            hooks.onPopup?.("⚠ CLOSE +25");
          }
        }
        a.prevR = d;
      }

      /* levels: every 100 points → popup + small speed bump */
      if (score >= nextLevelAt) {
        nextLevelAt += LEVEL_STEP;
        level++;
        sfx.level();
        hooks.onPopup?.(`LEVEL ${level}`);
      }

      /* score report (~on change) */
      const s = Math.floor(score);
      if (s !== lastReported) {
        lastReported = s;
        hooks.onScore?.(s);
        /* rekor canlı geçilince tek seferlik kutlama */
        if (!bestBeaten && hooks.best && hooks.best > 0 && s > hooks.best) {
          bestBeaten = true;
          hooks.onPopup?.("🏆 NEW BEST!");
          sfx.best();
        }
      }
    } else {
      /* crash sequence: shake + shards fly, then finish */
      crashTimer += dt;
      const shake = Math.max(0, 0.9 - crashTimer) * 0.55;
      camera.position.x = CAM_POS.x + (Math.random() - 0.5) * shake;
      camera.position.y = CAM_POS.y + (Math.random() - 0.5) * shake;
      for (const s of shards) {
        if (!s.mesh.visible) continue;
        s.vel.y -= 14 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += dt * 8;
        s.mesh.rotation.y += dt * 6;
      }
      if (crashTimer > 0.65) {
        finished = true;
        hooks.onGameOver?.(Math.floor(score), [
          { label: "⚠", value: `${nearMisses} close` },
          { label: "⏱", value: `${Math.floor(elapsed)}s` },
        ]);
        return; // stops RAF; StageCanvas handles restart
      }
    }

    /* ambient motion: planet spins, camera breathes */
    planet.rotation.y += dt * 0.12;
    planetWire.rotation.y -= dt * 0.05;
    planetWire.rotation.x += dt * 0.02;
    atmo.scale.setScalar(1 + Math.sin(t * 1.6) * 0.015);
    camera.position.x = CAM_POS.x + Math.sin(t * 0.3) * 0.55;
    camera.lookAt(0, 0, -1.2);

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
      bodyGeo.dispose();
      bodyMat.dispose();
      wingGeo.dispose();
      wingMat.dispose();
      engineGeo.dispose();
      engineMat.dispose();
      trailGeo.dispose();
      trailMat.dispose();
      asteroidGeo.dispose();
      asteroidMat.dispose();
      asteroidEdgeGeo.dispose();
      asteroidEdgeMat.dispose();
      shardGeo.dispose();
      for (const m of shardMats) m.dispose();
      starGeo.dispose();
      starMat.dispose();
      planetGeo.dispose();
      planetMat.dispose();
      wireGeo.dispose();
      wireMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      // sahnede kalan tüm mesh kaynaklarını serbest bırak
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
      renderer.domElement.remove();
      audioCtx = null;
    },
  };
}

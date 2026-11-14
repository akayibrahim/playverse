import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Stack Tower — v1.0 (full game).
 * One-tap stacking: a neon slab slides back and forth, tap (or Space) to drop.
 * Overlap with the slab below is kept, the overhang falls off.
 * Perfect drops (>=97% overlap) keep the slab size and build a combo (+5).
 * Zero overlap = game over. Camera rises with the tower.
 * WebAudio SFX (no assets) · bloom · hue-cycling neon slabs
 *
 * Contract (keep):
 *   createGame(container, hooks) => { dispose() }
 *   hooks: { onScore(s), onGameOver(s, stats), onPopup(text), best }
 */

export type StackerHooks = {
  onScore?: (score: number) => void;
  onGameOver?: (
    score: number,
    stats: { label: string; value: string }[],
  ) => void;
  onPopup?: (text: string) => void;
  best?: number; // geçilince onPopup "NEW BEST" tetikler
};

/* ---------- tuning ---------- */

const SLAB_H = 0.55; // slab thickness
const BASE_SIZE = 3; // base slab is 3x3
const RANGE = 3.6; // slide amplitude around the lower slab center
const BASE_SPEED = 2.4; // slide speed, units/second
const SPEED_PER_LEVEL = 0.075; // speed gain per placed slab
const MAX_SPEED = 5.2;
const PERFECT_RATIO = 0.97; // overlap ratio that counts as perfect
const PERFECT_BONUS = 5;
const GRAVITY = 22;
const HUE_STEP = 0.038; // neon palette rotation per level

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
  drop: () => {
    tone(150, 0.12, "square", 0.18, 70); // thock
    tone(340, 0.05, "sine", 0.09, 180);
  },
  perfect: (combo = 1) => {
    // rising chime — pitch climbs with the combo
    const pitch = 620 * (1 + 0.11 * Math.min(8, combo - 1));
    tone(pitch, 0.16, "triangle", 0.14, pitch * 1.4);
    tone(pitch * 1.5, 0.22, "sine", 0.09, pitch * 2);
  },
  best: () => tone(660, 0.4, "triangle", 0.15, 990),
  over: () => {
    tone(300, 0.6, "sawtooth", 0.2, 60); // descending
    tone(150, 0.7, "triangle", 0.15, 40);
  },
};

/* ---------- game ---------- */

type Axis = "x" | "z";

type MovingSlab = {
  mesh: THREE.Mesh;
  axis: Axis;
  dir: 1 | -1;
  speed: number;
  pos: number; // current coordinate along the slide axis
};

type FallingPiece = {
  mesh: THREE.Mesh;
  vy: number;
  spin: THREE.Vector3;
};

export function createGame(
  container: HTMLElement,
  hooks: StackerHooks = {},
): { dispose: () => void } {
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.Fog(0x05060f, 16, 55);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 120);
  const CAM_OFFSET = new THREE.Vector3(7.4, 7.4, 7.4); // isometric-ish direction
  const focus = new THREE.Vector3(0, 0, 0); // camera look target, rises with tower
  camera.position.copy(CAM_OFFSET);
  camera.lookAt(focus);

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
  scene.add(new THREE.AmbientLight(0x334466, 1.2));
  const key = new THREE.DirectionalLight(0x9fb8ff, 1.4);
  key.position.set(5, 12, 4);
  scene.add(key);

  /* dark ground + neon grid — kills the "void" look */
  const groundGeo = new THREE.PlaneGeometry(120, 120);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d22,
    roughness: 0.3,
    metalness: 0.8,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const grid = new THREE.GridHelper(50, 25, 0x7c5cff, 0x2a2f55);
  grid.position.y = 0.001;
  scene.add(grid);

  /* dust particles in a tall column — visible as the camera rises */
  const dustCount = 160;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 16;
    dustPos[i * 3 + 1] = Math.random() * 70;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 16;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x9fd8ff,
    size: 0.09,
    transparent: true,
    opacity: 0.35,
  });
  scene.add(new THREE.Points(dustGeo, dustMat));

  /* ---------- slab helpers ---------- */

  const tower: THREE.Mesh[] = []; // placed slabs (bottom → top)
  const falling: FallingPiece[] = []; // trimmed overhangs, under gravity
  const bounces: { mesh: THREE.Mesh; t: number; strong: boolean }[] = []; // land squash

  function neonMaterial(level: number): THREE.MeshStandardMaterial {
    // hue-cycling neon gradient palette
    const color = new THREE.Color().setHSL(
      (0.52 + level * HUE_STEP) % 1,
      0.85,
      0.58,
    );
    return new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.35,
    });
  }

  function makeSlab(
    sx: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    level: number,
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(sx, SLAB_H, sz);
    const mesh = new THREE.Mesh(geo, neonMaterial(level));
    mesh.position.set(x, y, z);
    // bright edge wireframe — pops with bloom
    const edgeMat = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHSL(
        (0.52 + level * HUE_STEP) % 1,
        0.85,
        0.85,
      ),
    });
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
    scene.add(mesh);
    return mesh;
  }

  function resizeSlab(mesh: THREE.Mesh, sx: number, sz: number) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BoxGeometry(sx, SLAB_H, sz);
    const edge = mesh.children[0] as THREE.LineSegments | undefined;
    if (edge?.isLineSegments) {
      edge.geometry.dispose();
      edge.geometry = new THREE.EdgesGeometry(mesh.geometry);
    }
  }

  /* base slab (level 0) */
  const base = makeSlab(BASE_SIZE, BASE_SIZE, 0, SLAB_H / 2, 0, 0);
  tower.push(base);

  /* ---------- state ---------- */

  let topSize = BASE_SIZE; // top slab is always square (trim only ever cuts one axis)
  let topX = 0;
  let topZ = 0;
  let placed = 0; // slabs stacked on top of the base
  let score = 0;
  let perfects = 0;
  let combo = 0; // consecutive perfects
  let bestBeaten = false;
  let over = false;
  let overTimer = 0;
  let moving: MovingSlab | null = null;
  let disposed = false;

  function spawnMoving() {
    const level = placed + 1; // index of the slab being placed
    const axis: Axis = placed % 2 === 0 ? "x" : "z"; // alternate axis each level
    const dir: 1 | -1 = placed % 2 === 0 ? 1 : -1;
    const center = axis === "x" ? topX : topZ;
    const mesh = makeSlab(
      topSize,
      topSize,
      axis === "x" ? center - dir * RANGE : topX,
      level * SLAB_H + SLAB_H / 2,
      axis === "z" ? center - dir * RANGE : topZ,
      level,
    );
    moving = {
      mesh,
      axis,
      dir,
      speed: Math.min(MAX_SPEED, BASE_SPEED + placed * SPEED_PER_LEVEL),
      pos: center - dir * RANGE,
    };
  }
  spawnMoving();

  /* ---------- core mechanic: drop the moving slab ---------- */

  function drop() {
    ensureAudio();
    if (over || !moving) return;

    const { mesh, axis } = moving;
    const y = mesh.position.y;
    const mPos = moving.pos;
    const tPos = axis === "x" ? topX : topZ;
    const d = Math.abs(mPos - tPos);
    const overlap = topSize - d;

    /* zero overlap — the whole slab falls, run ends */
    if (overlap <= 0.001) {
      falling.push({
        mesh,
        vy: 0,
        spin: new THREE.Vector3(
          axis === "x" ? 1.2 : 0,
          0,
          axis === "z" ? 1.2 : 0,
        ),
      });
      moving = null;
      startGameOver();
      return;
    }

    const isPerfect = overlap >= topSize * PERFECT_RATIO;

    if (isPerfect) {
      /* perfect: slab keeps its full size, snaps onto the lower slab center */
      mesh.position.set(topX, (placed + 1) * SLAB_H + SLAB_H / 2, topZ);
      perfects++;
      combo++;
      score += 1 + PERFECT_BONUS;
      hooks.onPopup?.(combo > 1 ? `PERFECT x${combo}!` : "PERFECT +5");
      sfx.perfect(combo);
      bounces.push({ mesh, t: 0, strong: true });
    } else {
      /* trim: keep the overlap, the overhang piece falls off */
      combo = 0;
      const sign = Math.sign(mPos - tPos) as 1 | -1;
      const newCenter =
        (Math.max(mPos - topSize / 2, tPos - topSize / 2) +
          Math.min(mPos + topSize / 2, tPos + topSize / 2)) /
        2;
      const overhangSize = d;
      const overhangCenter = tPos + sign * (topSize / 2 + overhangSize / 2);

      // overhang piece (same slab, just the part hanging over the edge)
      const px = axis === "x" ? overhangCenter : topX;
      const pz = axis === "z" ? overhangCenter : topZ;
      mesh.position.set(px, y, pz);
      resizeSlab(mesh, axis === "x" ? overhangSize : topSize, axis === "z" ? overhangSize : topSize);
      falling.push({
        mesh,
        vy: 1.2 * sign,
        spin: new THREE.Vector3(
          axis === "x" ? sign * 1.6 : 0,
          0,
          axis === "z" ? -sign * 1.6 : 0,
        ),
      });

      // placed slab = a fresh mesh trimmed to the overlap
      const slab = makeSlab(
        axis === "x" ? overlap : topSize,
        axis === "z" ? overlap : topSize,
        axis === "x" ? newCenter : topX,
        (placed + 1) * SLAB_H + SLAB_H / 2,
        axis === "z" ? newCenter : topZ,
        placed + 1,
      );
      tower.push(slab);
      bounces.push({ mesh: slab, t: 0, strong: false });

      if (axis === "x") topX = newCenter;
      else topZ = newCenter;
      score += 1;
      sfx.drop();
    }

    if (!isPerfect) topSize = overlap;

    placed++;
    moving = null;
    hooks.onScore?.(score);

    /* rekor canlı geçilince tek seferlik kutlama */
    if (!bestBeaten && hooks.best && hooks.best > 0 && score > hooks.best) {
      bestBeaten = true;
      hooks.onPopup?.("🏆 NEW BEST!");
      sfx.best();
    }

    spawnMoving();
  }

  function startGameOver() {
    over = true;
    overTimer = 0;
    sfx.over();
  }

  /* ---------- input: tap anywhere / Space (audio unlocks on first input) ---------- */

  const onPointerDown = () => drop();
  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Space" || e.key === " ") {
      if (!over) e.preventDefault(); // leave Space free for restart when over
      drop();
    }
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKey);

  /* ---------- loop ---------- */

  const clock = new THREE.Clock();

  function tick() {
    if (disposed) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();

    /* slide the moving slab back and forth (ping-pong) */
    if (moving) {
      moving.pos += moving.dir * moving.speed * dt;
      if (moving.pos > RANGE) {
        moving.pos = RANGE;
        moving.dir = -1;
      } else if (moving.pos < -RANGE) {
        moving.pos = -RANGE;
        moving.dir = 1;
      }
      if (moving.axis === "x") moving.mesh.position.x = moving.pos;
      else moving.mesh.position.z = moving.pos;
      // subtle hover bob so the slab feels alive
      moving.mesh.position.y =
        (placed + 1) * SLAB_H + SLAB_H / 2 + Math.sin(t * 5) * 0.03;
    }

    /* falling overhang pieces: simple gravity, then removed */
    for (let i = falling.length - 1; i >= 0; i--) {
      const p = falling[i];
      p.vy -= GRAVITY * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (p.mesh.position.y < -12) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        falling.splice(i, 1);
      }
    }

    /* landing squash-and-stretch */
    for (let i = bounces.length - 1; i >= 0; i--) {
      const b = bounces[i];
      b.t += dt;
      const k = Math.min(1, b.t / (b.strong ? 0.3 : 0.2));
      b.mesh.scale.y = 1 + (1 - k) * (b.strong ? 0.3 : 0.18) * Math.cos(k * Math.PI);
      if (k >= 1) {
        b.mesh.scale.y = 1;
        bounces.splice(i, 1);
      }
    }

    /* camera smoothly rises to keep the top slab framed */
    const pull = over ? Math.min(1.9, 1 + overTimer * 0.8) : 1; // game-over pull-back
    const targetFocusY = Math.max(0.3, placed * SLAB_H - 1.1);
    focus.y += (targetFocusY - focus.y) * Math.min(1, dt * 3.5);
    const camTargetX = CAM_OFFSET.x * pull;
    const camTargetY = focus.y + CAM_OFFSET.y * pull;
    const camTargetZ = CAM_OFFSET.z * pull;
    camera.position.x += (camTargetX - camera.position.x) * Math.min(1, dt * 4);
    camera.position.y += (camTargetY - camera.position.y) * Math.min(1, dt * 4);
    camera.position.z += (camTargetZ - camera.position.z) * Math.min(1, dt * 4);
    camera.lookAt(focus);

    if (over) {
      overTimer += dt;
      if (overTimer > 1.0) {
        hooks.onGameOver?.(score, [
          { label: "🏗", value: `${placed} levels` },
          { label: "✨", value: `${perfects} perfect` },
        ]);
        return; // stops RAF; StageCanvas handles restart
      }
    }

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
      // sahnede kalan tüm mesh kaynaklarını serbest bırak (tower + falling + decor)
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
      dustGeo.dispose();
      dustMat.dispose();
      grid.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      audioCtx = null;
    },
  };
}

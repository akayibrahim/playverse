/** GRIDLOCK — pooled additive effects: camera-facing beam ribbons, soft point particles, expanding rings. */
import * as THREE from "three";

// ------------------------------------------------------------------ beams
export function createBeams(scene: THREE.Scene, cap = 1200) {
  const pos = new Float32Array(cap * 4 * 3);
  const col = new Float32Array(cap * 4 * 4);
  const idx = new Uint32Array(cap * 6);
  for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const ca = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pa);
  geo.setAttribute("color", ca);
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  scene.add(mesh);
  // segment state
  const S = new Float32Array(cap * 14); // ax ay az bx by bz w r g b life max wEnd boost
  let n = 0;
  const tmpD = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();

  function seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, color: number, life: number, wEnd = w, boost = 1.6) {
    if (n >= cap) return;
    const c = new THREE.Color(color);
    S.set([ax, ay, az, bx, by, bz, w, c.r, c.g, c.b, life, life, wEnd, boost], n * 14);
    n++;
  }
  /** jagged lightning from a to b. */
  function bolt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, color: number, life: number, jag = 1.2, parts = 7, branch = 0.35) {
    let px = ax;
    let py = ay;
    let pz = az;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    for (let i = 1; i <= parts; i++) {
      const t = i / parts;
      const j = i === parts ? 0 : jag * Math.min(1, len / 14);
      const qx = ax + dx * t + (Math.random() - 0.5) * 2 * j;
      const qy = ay + dy * t + (Math.random() - 0.5) * 2 * j;
      const qz = az + dz * t + (Math.random() - 0.5) * 2 * j;
      seg(px, py, pz, qx, qy, qz, w, color, life, w, 2.2);
      if (i < parts && Math.random() < branch) {
        seg(qx, qy, qz, qx + (Math.random() - 0.5) * len * 0.35, qy + (Math.random() - 0.5) * len * 0.2, qz + (Math.random() - 0.5) * len * 0.35, w * 0.55, color, life * 0.8, w * 0.1, 1.8);
      }
      px = qx;
      py = qy;
      pz = qz;
    }
  }
  function update(dt: number, cam: THREE.Camera) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 14;
      S[o + 10] -= dt;
      if (S[o + 10] <= 0) continue;
      if (w !== i) S.copyWithin(w * 14, o, o + 14);
      w++;
    }
    n = w;
    const cp = cam.position;
    for (let i = 0; i < n; i++) {
      const o = i * 14;
      const k = S[o + 10] / S[o + 11]; // 1 → 0
      const width = S[o + 12] + (S[o + 6] - S[o + 12]) * k;
      tmpD.set(S[o + 3] - S[o], S[o + 4] - S[o + 1], S[o + 5] - S[o + 2]);
      tmpV.set(cp.x - (S[o] + S[o + 3]) / 2, cp.y - (S[o + 1] + S[o + 4]) / 2, cp.z - (S[o + 2] + S[o + 5]) / 2);
      tmpS.crossVectors(tmpD, tmpV);
      const l = tmpS.length();
      if (l < 1e-6) tmpS.set(0, 1, 0);
      else tmpS.multiplyScalar(width / 2 / l);
      const p = i * 12;
      pos[p] = S[o] - tmpS.x;
      pos[p + 1] = S[o + 1] - tmpS.y;
      pos[p + 2] = S[o + 2] - tmpS.z;
      pos[p + 3] = S[o] + tmpS.x;
      pos[p + 4] = S[o + 1] + tmpS.y;
      pos[p + 5] = S[o + 2] + tmpS.z;
      pos[p + 6] = S[o + 3] - tmpS.x;
      pos[p + 7] = S[o + 4] - tmpS.y;
      pos[p + 8] = S[o + 5] - tmpS.z;
      pos[p + 9] = S[o + 3] + tmpS.x;
      pos[p + 10] = S[o + 4] + tmpS.y;
      pos[p + 11] = S[o + 5] + tmpS.z;
      const b = S[o + 13];
      const a = Math.min(1, k * 1.6);
      for (let v = 0; v < 4; v++) {
        const c = i * 16 + v * 4;
        col[c] = S[o + 7] * b;
        col[c + 1] = S[o + 8] * b;
        col[c + 2] = S[o + 9] * b;
        col[c + 3] = a;
      }
    }
    geo.setDrawRange(0, n * 6);
    pa.needsUpdate = true;
    ca.needsUpdate = true;
  }
  return {
    seg,
    bolt,
    update,
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ particles
export function createParticles(scene: THREE.Scene, cap = 2400) {
  const pos = new Float32Array(cap * 3);
  const colA = new Float32Array(cap * 4);
  const size = new Float32Array(cap);
  const vel = new Float32Array(cap * 3);
  const life = new Float32Array(cap);
  const maxLife = new Float32Array(cap);
  const drag = new Float32Array(cap);
  const grav = new Float32Array(cap);
  const grow = new Float32Array(cap);
  const base = new Float32Array(cap);
  const alive = new Uint8Array(cap);
  let head = 0;
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const ca = new THREE.BufferAttribute(colA, 4).setUsage(THREE.DynamicDrawUsage);
  const sa = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pa);
  geo.setAttribute("aColor", ca);
  geo.setAttribute("aSize", sa);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 800 } },
    vertexShader: `
      attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
      void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 0.0, 220.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      varying vec4 vC;
      void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a;
        if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb * (0.6 + a), vC.a * a); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  scene.add(pts);
  const c = new THREE.Color();
  function spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, lifeS: number, sz: number, color: number, o: { drag?: number; grav?: number; grow?: number; bright?: number } = {}) {
    const i = head;
    head = (head + 1) % cap;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    life[i] = maxLife[i] = lifeS;
    base[i] = sz;
    size[i] = sz;
    drag[i] = o.drag ?? 1.5;
    grav[i] = o.grav ?? 0;
    grow[i] = o.grow ?? 0;
    c.setHex(color);
    const b = o.bright ?? 1.4;
    colA[i * 4] = c.r * b;
    colA[i * 4 + 1] = c.g * b;
    colA[i * 4 + 2] = c.b * b;
    colA[i * 4 + 3] = 1;
    alive[i] = 1;
  }
  function burst(x: number, y: number, z: number, n: number, speed: number, lifeS: number, sz: number, color: number, o: { up?: number; grav?: number; grow?: number; drag?: number; bright?: number } = {}) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.35 + Math.random() * 0.65);
      spawn(x, y, z, Math.cos(a) * r * s, u * s * 0.8 + (o.up ?? 0), Math.sin(a) * r * s, lifeS * (0.6 + Math.random() * 0.5), sz * (0.6 + Math.random() * 0.7), color, o);
    }
  }
  function update(dt: number) {
    for (let i = 0; i < cap; i++) {
      if (!alive[i]) {
        colA[i * 4 + 3] = 0;
        continue;
      }
      life[i] -= dt;
      if (life[i] <= 0) {
        alive[i] = 0;
        colA[i * 4 + 3] = 0;
        size[i] = 0;
        continue;
      }
      const k = life[i] / maxLife[i];
      const dr = Math.max(0, 1 - drag[i] * dt);
      vel[i * 3] *= dr;
      vel[i * 3 + 1] = vel[i * 3 + 1] * dr - grav[i] * dt;
      vel[i * 3 + 2] *= dr;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      colA[i * 4 + 3] = Math.min(1, k * 1.8);
      size[i] = base[i] * (1 + grow[i] * (1 - k)) * (0.5 + 0.5 * Math.min(1, k * 3));
    }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    sa.needsUpdate = true;
  }
  return {
    spawn,
    burst,
    update,
    setScale(s: number) {
      mat.uniforms.uScale.value = s;
    },
    dispose() {
      scene.remove(pts);
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ rings
export function createRings(scene: THREE.Scene, cap = 24) {
  const geo = new THREE.RingGeometry(0.93, 1, 72).rotateX(-Math.PI / 2);
  type R = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; life: number; r0: number; r1: number; a: number };
  const pool: R[] = [];
  for (let i = 0; i < cap; i++) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 5;
    scene.add(mesh);
    pool.push({ mesh, mat, t: 0, life: 0, r0: 1, r1: 1, a: 1 });
  }
  let head = 0;
  return {
    spawn(x: number, y: number, z: number, r0: number, r1: number, life: number, color: number, alpha = 0.9) {
      const r = pool[head];
      head = (head + 1) % cap;
      r.mesh.position.set(x, y, z);
      r.mat.color.setHex(color).multiplyScalar(1.5);
      r.t = 0;
      r.life = life;
      r.r0 = r0;
      r.r1 = r1;
      r.a = alpha;
      r.mesh.visible = true;
    },
    update(dt: number) {
      for (const r of pool) {
        if (!r.mesh.visible) continue;
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) {
          r.mesh.visible = false;
          continue;
        }
        const e = 1 - Math.pow(1 - k, 2.2);
        const s = r.r0 + (r.r1 - r.r0) * e;
        r.mesh.scale.set(s, 1, s);
        r.mat.opacity = r.a * (1 - k);
      }
    },
    dispose() {
      for (const r of pool) {
        scene.remove(r.mesh);
        r.mat.dispose();
      }
      geo.dispose();
    },
  };
}

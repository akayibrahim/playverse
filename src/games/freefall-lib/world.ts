/**
 * FREEFALL: District 07 from above. Builds the sky, cloud layer, city (instanced towers with the
 * procedural lit-window shader), the Spire, rings, the landing pad and the per-chunk props, and answers
 * collision / proximity queries against the active chunks.
 */
import * as THREE from "three";
import { softDot, verticalFade } from "../nexus-lib/textures";
import { boxDist, boxOf, CHUNK_SAMPLES, genChunk, mulberry32, SPIRE_HALF, START_Y, type Box, type ChunkSpec, type Course } from "./course";

export class Res {
  geos = new Set<THREE.BufferGeometry>();
  mats = new Set<THREE.Material>();
  texs = new Set<THREE.Texture>();
  G = <X extends THREE.BufferGeometry>(g: X): X => (this.geos.add(g), g);
  M = <X extends THREE.Material>(m: X): X => (this.mats.add(m), m);
  T = <X extends THREE.Texture>(t: X): X => (this.texs.add(t), t);
  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.texs.forEach((t) => t.dispose());
    this.geos.clear();
    this.mats.clear();
    this.texs.clear();
  }
}

const NEON = [0xff3fc8, 0x35f0ff, 0xffb547, 0x9a5cff, 0x7dffb0, 0x38bdf8];
const UP = new THREE.Vector3(0, 1, 0);

export type RingState = "idle" | "next" | "done" | "miss";
export type Hazard = { x: number; y: number; z: number; r: number; kind: "car" | "drone" };

type Chunk = {
  index: number;
  group: THREE.Group;
  boxes: Box[]; // static solids (towers + props)
  trainBoxes: Box[];
  spec: ChunkSpec;
  update: (t: number, haz: Hazard[]) => void;
  geos: THREE.BufferGeometry[];
  meshes: THREE.InstancedMesh[];
};

export type World = ReturnType<typeof createWorld>;

export function createWorld(scene: THREE.Scene, course: Course, opts: { mobile: boolean }) {
  const res = new Res();
  const { G, M, T } = res;
  const root = new THREE.Group();
  scene.add(root);
  const dotTex = T(softDot());
  const fadeTex = T(verticalFade());
  const rng = mulberry32(course.seed ^ 0xabcdef);

  // ------------------------------------------------------------------ materials
  const towerMat = M(new THREE.MeshStandardMaterial({ color: 0x141720, roughness: 0.5, metalness: 0.55 }));
  towerMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vSeed; varying vec3 vLP; varying vec3 vScl;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4; wn = mat3(instanceMatrix) * wn;
          vSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.027;
          vScl = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #else
          vSeed = 0.0;
          vScl = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        #endif
        vLP = position;
        vWP = (modelMatrix * wp4).xyz; vWN = normalize(mat3(modelMatrix) * wn);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWP; varying vec3 vWN; varying float vSeed; varying vec3 vLP; varying vec3 vScl;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 n = normalize(vWN);
          if (abs(n.y) < 0.5) {
            float hx = abs(n.x) > 0.5 ? vWP.z : vWP.x;
            vec2 g = vec2(hx / 2.4, vWP.y / 3.2);
            vec2 cell = floor(g);
            vec2 f = fract(g);
            float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
            float hsh = h21(cell + vSeed * 17.0);
            float lit = step(0.80, hsh) * (0.55 + 0.45 * h21(cell.yx + 3.1));
            float band = h21(vec2(floor(vWP.y / 30.0), vSeed));
            vec3 col = hsh > 0.975 ? vec3(1.0, 0.25, 0.8) : hsh > 0.95 ? vec3(0.3, 0.9, 1.0) : mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.85, 1.0), band);
            float px = length(fwidth(g));
            float far = smoothstep(0.25, 0.75, px);
            vec3 near = col * win * lit;
            vec3 avg = mix(vec3(0.85, 0.62, 0.45), vec3(0.55, 0.65, 1.0), band) * 0.05;
            totalEmissiveRadiance += mix(near, avg * 0.8, far) * 0.85;
            diffuseColor.rgb *= mix(1.0, 0.75, win);
          } else if (n.y > 0.5) {
            // roof seen from above: dark deck, neon parapet trim, lit hatches / equipment
            vec2 e2 = (0.5 - abs(vLP.xz)) * vScl.xz;
            float edge = min(e2.x, e2.y);
            float sel = h21(vec2(vSeed * 3.7, 7.7));
            vec3 tc = sel > 0.86 ? vec3(1.0, 0.25, 0.78) : sel > 0.72 ? vec3(0.25, 0.92, 1.0) : sel > 0.58 ? vec3(1.0, 0.68, 0.3) : vec3(0.55, 0.75, 1.0);
            float fw = max(0.55, fwidth(edge) * 1.6);
            float trim = (1.0 - smoothstep(0.0, fw, edge - 0.15)) * (0.55 / fw) * step(0.3, sel);
            vec2 rc = floor(vWP.xz / 3.4);
            vec2 rf = fract(vWP.xz / 3.4);
            float eq = step(0.88, h21(rc + vSeed * 5.0)) * step(2.2, edge) * step(0.2, rf.x) * step(rf.x, 0.8) * step(0.2, rf.y) * step(rf.y, 0.8);
            float pxr = length(fwidth(vWP.xz / 3.4));
            eq = mix(eq, 0.05, smoothstep(0.3, 0.8, pxr));
            totalEmissiveRadiance += tc * trim * 1.5 + vec3(1.0, 0.78, 0.55) * eq * 0.35;
            diffuseColor.rgb *= 0.55;
          }
        }`,
      );
  };
  towerMat.customProgramCacheKey = () => "ff-tower2";
  towerMat.envMapIntensity = 0.25;
  const towerGeo = G(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const unitBox = G(new THREE.BoxGeometry(1, 1, 1));

  const signTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 256;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#000";
    c.fillRect(0, 0, 64, 256);
    c.fillStyle = "#fff";
    for (let y = 12; y < 244; y += 34) {
      const w = 14 + Math.floor(rng() * 30);
      c.fillRect(32 - w / 2, y, w, 6 + Math.floor(rng() * 14));
      if (rng() < 0.5) c.fillRect(32 - w / 2, y + 22, 4, 6);
    }
    c.strokeStyle = "#fff";
    c.lineWidth = 3;
    c.strokeRect(3, 3, 58, 250);
    return T(new THREE.CanvasTexture(cv));
  })();
  const signMat = M(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false, side: THREE.DoubleSide }));
  const darkMat = M(new THREE.MeshStandardMaterial({ color: 0x1a1e27, roughness: 0.4, metalness: 0.8 }));
  const neonMat = M(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const carMat = M(new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.4, metalness: 0.8 }));
  const droneMat = M(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const holoMat = M(
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute float aSeed; varying vec2 vUv; varying vec3 vCol; varying float vSeed;
        void main(){ vUv = uv; vSeed = aSeed;
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vCol; varying float vSeed;
        float h(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
        void main(){
          vec2 uv = vUv;
          float row = floor(uv.y * 7.0);
          float shift = (h(row + floor(uTime * 1.5 + vSeed)) - 0.5) * step(0.82, h(row * 3.7 + floor(uTime * 3.0)));
          uv.x += shift * 0.2;
          float bars = step(0.5, fract(uv.x * (4.0 + mod(vSeed, 5.0)) + row * 0.37 + vSeed * 0.13 + uTime * 0.05));
          float blk = step(0.35, h(floor(uv.x * 9.0) + row * 7.0 + vSeed));
          float scan = 0.72 + 0.28 * sin(vUv.y * 160.0 - uTime * 5.0);
          float edge = step(0.035, vUv.x) * step(vUv.x, 0.965) * step(0.06, vUv.y) * step(vUv.y, 0.94);
          float border = 1.0 - edge;
          float m = mix(0.16, 0.95, bars * blk) * scan;
          vec3 c = vCol * (m * 1.5 + border * 2.2) + vec3(0.4, 0.5, 0.6) * border;
          gl_FragColor = vec4(c, 0.88);
        }`,
    }),
  );

  // ------------------------------------------------------------------ sky
  const skyUniforms = { uAlt: { value: START_Y }, uTime: { value: 0 } };
  const sky = new THREE.Mesh(
    G(new THREE.SphereGeometry(9000, 32, 20)),
    M(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: skyUniforms,
        vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uAlt; uniform float uTime; varying vec3 vDir;
          float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          void main(){
            vec3 d = normalize(vDir);
            float h = d.y;
            float dusk = smoothstep(350.0, 1900.0, uAlt);
            vec3 zen = mix(vec3(0.012, 0.012, 0.045), vec3(0.03, 0.04, 0.16), dusk);
            vec3 hor = mix(vec3(0.20, 0.075, 0.34), vec3(0.95, 0.36, 0.30), dusk * 0.85);
            vec3 hor2 = mix(vec3(0.05, 0.18, 0.28), vec3(0.65, 0.20, 0.45), dusk);
            float up = smoothstep(0.0, 0.55, h);
            vec3 col = mix(hor, zen, pow(up, 0.55));
            col += hor2 * exp(-abs(h) * 14.0) * 0.55;
            // below the horizon: the city's glow haze
            float dn = smoothstep(0.0, -0.5, h);
            vec3 glow = mix(vec3(0.16, 0.07, 0.24), vec3(0.04, 0.03, 0.09), dn);
            col = h < 0.0 ? mix(hor * 0.75, glow, smoothstep(0.0, -0.12, h)) : col;
            // stars + moon
            if (h > 0.04) {
              vec3 sp = floor(d * 380.0);
              float st = step(0.9972, hash(sp));
              col += vec3(0.85, 0.9, 1.0) * st * smoothstep(0.04, 0.4, h) * (0.55 + 0.45 * sin(uTime * 2.0 + hash(sp) * 40.0));
            }
            vec3 md = normalize(vec3(-0.45, 0.42, -0.55));
            float m = dot(d, md);
            col += vec3(0.75, 0.82, 1.0) * smoothstep(0.9988, 0.9993, m) * 1.4 + vec3(0.35, 0.4, 0.7) * pow(max(m, 0.0), 80.0) * 0.4;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    ),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  root.add(sky);

  // ------------------------------------------------------------------ ground (city lights from above)
  const groundTex = (() => {
    const S = 512;
    const cv = document.createElement("canvas");
    cv.width = S;
    cv.height = S;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#07080f";
    c.fillRect(0, 0, S, S);
    // blocks of lit windows seen from above
    for (let i = 0; i < 260; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const w = 6 + rng() * 26;
      const h = 6 + rng() * 26;
      const k = rng();
      c.fillStyle = k < 0.55 ? "rgba(255,170,90,.22)" : k < 0.8 ? "rgba(120,200,255,.2)" : k < 0.92 ? "rgba(255,70,190,.24)" : "rgba(90,255,220,.2)";
      c.fillRect(x, y, w, h);
    }
    // streets
    c.strokeStyle = "rgba(255,190,110,.55)";
    c.lineWidth = 2;
    for (let i = 0; i <= S; i += 64) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i, S);
      c.stroke();
      c.beginPath();
      c.moveTo(0, i);
      c.lineTo(S, i);
      c.stroke();
    }
    c.fillStyle = "rgba(255,255,255,.95)";
    for (let i = 0; i < 700; i++) {
      c.globalAlpha = 0.25 + rng() * 0.6;
      c.fillRect(Math.floor(rng() * S), Math.floor(rng() * S), 1.5, 1.5);
    }
    const t = T(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(60, 60);
    t.anisotropy = 4;
    return t;
  })();
  const ground = new THREE.Mesh(G(new THREE.PlaneGeometry(14000, 14000)), M(new THREE.MeshBasicMaterial({ map: groundTex, color: 0xffffff })));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  root.add(ground);

  // wet street near the pad / canyon floor: dark reflective sheet
  const streetTex = (() => {
    const S = 512;
    const cv = document.createElement("canvas");
    cv.width = S;
    cv.height = S;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#07090f";
    c.fillRect(0, 0, S, S);
    // wet neon reflections: soft vertical smears
    for (let i = 0; i < 46; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const w = 6 + rng() * 26;
      const h = 40 + rng() * 160;
      const col = [[255, 63, 200], [53, 240, 255], [255, 181, 71], [154, 92, 255]][Math.floor(rng() * 4)];
      const g = c.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      g.addColorStop(0.5, `rgba(${col[0]},${col[1]},${col[2]},${0.16 + rng() * 0.2})`);
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      c.fillStyle = g;
      c.fillRect(x, y, w, h);
    }
    // lane markings
    c.fillStyle = "rgba(255,255,255,.35)";
    for (let y = 0; y < S; y += 64) c.fillRect(S / 2 - 2, y, 4, 30);
    c.fillStyle = "rgba(255,181,71,.5)";
    c.fillRect(0, 0, S, 3);
    c.fillRect(0, S - 3, S, 3);
    const t = T(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(60, 60);
    t.anisotropy = 8;
    return t;
  })();
  const street = new THREE.Mesh(G(new THREE.PlaneGeometry(2600, 2600)), M(new THREE.MeshStandardMaterial({ color: 0xffffff, map: streetTex, emissive: 0xffffff, emissiveMap: streetTex, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.5 })));
  street.rotation.x = -Math.PI / 2;
  street.position.set(course.pad.x, 0, course.pad.z);
  root.add(street);

  // ------------------------------------------------------------------ far skyline (one draw call)
  {
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < course.N; i++) {
      cx += course.px[i];
      cz += course.pz[i];
    }
    cx /= course.N;
    cz /= course.N;
    const n = opts.mobile ? 500 : 1100;
    const inst = new THREE.InstancedMesh(towerGeo, towerMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const rr = 1900 + Math.pow(rng(), 0.7) * 4800;
      const w = 50 + rng() * 110;
      const h = 90 + Math.pow(rng(), 2.2) * 700;
      m.compose(new THREE.Vector3(cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr), q, new THREE.Vector3(w, h, w * (0.6 + rng() * 0.8)));
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    root.add(inst);
  }

  // ------------------------------------------------------------------ clouds
  // Two procedural cloud decks: moonlit slate tops seen from above, city-glow undersides from below.
  // They thin out near the camera's altitude so diving through them is a soft punch-through.
  type Deck = { mesh: THREE.Mesh; u: { uCam: { value: THREE.Vector3 }; uTime: { value: number }; uY: { value: number }; uSeed: { value: number }; uDens: { value: number } } };
  const decks: Deck[] = [];
  {
    const deckGeo = G(new THREE.PlaneGeometry(12000, 12000, 1, 1).rotateX(-Math.PI / 2));
    const mk = (y: number, sd: number, dens: number) => {
      const u = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uY: { value: y }, uSeed: { value: sd }, uDens: { value: dens } };
      const mat = M(
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
          uniforms: u,
          vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
          fragmentShader: `uniform vec3 uCam; uniform float uTime; uniform float uY; uniform float uSeed; uniform float uDens; varying vec3 vW;
            float hs(vec2 p){ p = fract(p * vec2(233.34, 851.73) + uSeed); p += dot(p, p + 23.45); return fract(p.x * p.y); }
            float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), f.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), f.x), f.y); }
            float fbm(vec2 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++){ s += vn(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
            void main(){
              vec2 p = vW.xz / 900.0 + vec2(uTime * 0.004, uTime * 0.002);
              float n = fbm(p) * 0.75 + fbm(p * 3.1 + 4.0) * 0.25;
              float body = smoothstep(uDens, uDens + 0.24, n);
              float camAbove = step(uY, uCam.y);
              // lit top: cold moonlight; underside: warm city glow with neon tints
              float detail = fbm(p * 7.0 + 2.0);
              vec3 top = mix(vec3(0.07, 0.075, 0.15), vec3(0.24, 0.24, 0.40), smoothstep(0.4, 0.9, n) * detail * 1.3);
              vec3 tint = mix(vec3(0.55, 0.16, 0.42), vec3(0.65, 0.32, 0.16), vn(p * 0.7 + 3.0));
              vec3 under = mix(vec3(0.05, 0.03, 0.08), tint, (1.0 - body * 0.6) * 0.65);
              vec3 col = mix(under, top, camAbove);
              float d = length(vW.xz - uCam.xz);
              float a = body * 0.9;
              a *= smoothstep(5600.0, 2600.0, d);
              a *= smoothstep(6.0, 90.0, abs(uCam.y - uY) + d * 0.02);
              // aerial perspective toward the horizon
              col = mix(col, vec3(0.10, 0.06, 0.16), smoothstep(800.0, 4500.0, d) * 0.7);
              gl_FragColor = vec4(col, a);
            }`,
        }),
      );
      const mesh = new THREE.Mesh(deckGeo, mat);
      mesh.position.y = y;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      root.add(mesh);
      decks.push({ mesh, u });
    };
    mk(1420, (course.seed % 97) * 0.13, 0.5);
    mk(1290, (course.seed % 89) * 0.17 + 3.3, 0.56);
  }
  // Billboard cloud puffs scattered through the deck along the dive, so falling through it has parallax.
  const puffU = { uCam: { value: new THREE.Vector3() } };
  {
    const n = opts.mobile ? 90 : 170;
    const cand: number[] = [];
    for (let i = 0; i < course.N; i++) if (course.py[i] > 1180 && course.py[i] < 1520) cand.push(i);
    if (cand.length) {
      const inst = new THREE.InstancedMesh(
        G(new THREE.PlaneGeometry(1, 1)),
        M(
          new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            fog: false,
            uniforms: puffU,
            vertexShader: `uniform vec3 uCam; varying vec2 vUv; varying float vA; varying float vTop; varying float vK;
              void main(){
                vUv = uv;
                vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                float s = length(instanceMatrix[0].xyz);
                vK = fract(c.x * 0.0137 + c.z * 0.0291);
                float d = distance(c, uCam);
                vA = smoothstep(s * 0.15, s * 0.9, d) * (1.0 - smoothstep(2400.0, 4200.0, d));
                vTop = step(c.y, uCam.y);
                vec4 mv = viewMatrix * vec4(c, 1.0);
                mv.xy += position.xy * vec2(s, s * 0.62);
                gl_Position = projectionMatrix * mv;
              }`,
            fragmentShader: `varying vec2 vUv; varying float vA; varying float vTop; varying float vK;
              void main(){
                vec2 p = vUv * 2.0 - 1.0;
                vec2 q = p * 2.2 + vK * 17.0;
                vec2 i = floor(q); vec2 f = fract(q); f = f * f * (3.0 - 2.0 * f);
                #define HH(v) fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453)
                float nz = mix(mix(HH(i), HH(i + vec2(1.0, 0.0)), f.x), mix(HH(i + vec2(0.0, 1.0)), HH(i + vec2(1.0, 1.0)), f.x), f.y);
                float r = length(p) + (nz - 0.5) * 0.55;
                float a = pow(clamp(1.0 - r, 0.0, 1.0), 1.6);
                vec3 lit = mix(vec3(0.20, 0.17, 0.32), vec3(0.42, 0.36, 0.58), clamp(0.5 + p.y * 0.6, 0.0, 1.0));
                vec3 glow = mix(vec3(0.30, 0.10, 0.28), vec3(0.34, 0.18, 0.12), vK);
                vec3 col = mix(glow, lit, vTop);
                gl_FragColor = vec4(col, a * vA * 0.6);
              }`,
          }),
        ),
        n,
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      for (let k = 0; k < n; k++) {
        const i = cand[Math.floor(rng() * cand.length)];
        const a = rng() * Math.PI * 2;
        const rr = Math.pow(rng(), 0.6) * 420;
        const s = 70 + rng() * 170;
        v.set(course.px[i] + Math.cos(a) * rr, 1250 + rng() * 190, course.pz[i] + Math.sin(a) * rr);
        inst.setMatrixAt(k, m.compose(v, q, sc.set(s, s, s)));
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      inst.renderOrder = 3;
      root.add(inst);
    }
  }

  // ------------------------------------------------------------------ Spire
  const spireGroup = new THREE.Group();
  root.add(spireGroup);
  {
    const sp = new THREE.Mesh(towerGeo, towerMat);
    sp.scale.set(SPIRE_HALF * 2, START_Y - 2, SPIRE_HALF * 2);
    sp.position.set(course.spire.cx, 0, course.spire.cz);
    spireGroup.add(sp);
    const capTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      const c = cv.getContext("2d")!;
      c.fillStyle = "#0b0f18";
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = "rgba(56,189,248,.35)";
      c.lineWidth = 2;
      for (let i = 0; i <= 256; i += 32) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i, 256);
        c.stroke();
        c.beginPath();
        c.moveTo(0, i);
        c.lineTo(256, i);
        c.stroke();
      }
      c.strokeStyle = "rgba(255,181,71,.45)";
      c.lineWidth = 2;
      c.strokeRect(6, 6, 244, 244);
      c.fillStyle = "rgba(56,189,248,.5)";
      c.font = "700 22px sans-serif";
      c.textAlign = "center";
      c.fillText("SPIRE · DISTRICT 07", 128, 136);
      const t = T(new THREE.CanvasTexture(cv));
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const capMat = M(new THREE.MeshStandardMaterial({ color: 0xffffff, map: capTex, emissive: 0xffffff, emissiveMap: capTex, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.6 }));
    const cap = new THREE.Mesh(unitBox, [darkMat, darkMat, capMat, darkMat, darkMat, darkMat]);
    cap.scale.set(SPIRE_HALF * 2 + 6, 3, SPIRE_HALF * 2 + 6);
    cap.position.set(course.spire.cx, START_Y - 1.5, course.spire.cz);
    spireGroup.add(cap);
    const stripGeo = G(new THREE.BoxGeometry(1, 1, 1));
    const stripMat = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x38bdf8).multiplyScalar(2.2), toneMapped: false }));
    const strips = new THREE.InstancedMesh(stripGeo, stripMat, 4 + 4 * 16);
    const m = new THREE.Matrix4();
    let si = 0;
    const h2 = SPIRE_HALF + 0.35;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      m.compose(new THREE.Vector3(course.spire.cx + sx * h2, START_Y / 2, course.spire.cz + sz * h2), new THREE.Quaternion(), new THREE.Vector3(1.4, START_Y, 1.4));
      strips.setMatrixAt(si++, m);
    }
    for (let l = 0; l < 16; l++) {
      const y = START_Y - 40 - l * 120;
      if (y < 20) break;
      for (const [sx, sz, ax] of [[0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, 1]]) {
        m.compose(new THREE.Vector3(course.spire.cx + sx * h2, y, course.spire.cz + sz * h2), new THREE.Quaternion(), ax ? new THREE.Vector3(1.2, 1.2, SPIRE_HALF * 2 + 3) : new THREE.Vector3(SPIRE_HALF * 2 + 3, 1.2, 1.2));
        strips.setMatrixAt(si++, m);
      }
    }
    strips.count = si;
    strips.instanceMatrix.needsUpdate = true;
    strips.frustumCulled = false;
    spireGroup.add(strips);
    // crown rim + beacon
    const rim = new THREE.InstancedMesh(stripGeo, M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3fc8).multiplyScalar(1.6), toneMapped: false })), 4);
    let ri = 0;
    for (const [sx, sz, ax] of [[0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, 1]]) {
      if (sx * Math.sin(course.psi0) + sz * -Math.cos(course.psi0) > 0.5) continue; // not across the jump ledge
      m.compose(new THREE.Vector3(course.spire.cx + sx * (SPIRE_HALF + 3), START_Y + 0.3, course.spire.cz + sz * (SPIRE_HALF + 3)), new THREE.Quaternion(), ax ? new THREE.Vector3(0.8, 0.8, SPIRE_HALF * 2 + 6) : new THREE.Vector3(SPIRE_HALF * 2 + 6, 0.8, 0.8));
      rim.setMatrixAt(ri++, m);
    }
    rim.count = ri;
    rim.instanceMatrix.needsUpdate = true;
    rim.frustumCulled = false;
    spireGroup.add(rim);
    const mast = new THREE.Mesh(unitBox, darkMat);
    mast.scale.set(2, 70, 2);
    mast.position.set(course.spire.cx, START_Y + 35, course.spire.cz);
    spireGroup.add(mast);
    const beacon = new THREE.Sprite(M(new THREE.SpriteMaterial({ map: dotTex, color: 0xff2a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    beacon.position.set(course.spire.cx, START_Y + 72, course.spire.cz);
    beacon.scale.setScalar(36);
    spireGroup.add(beacon);
    // jump ledge
    const f0x = Math.sin(course.psi0);
    const f0z = -Math.cos(course.psi0);
    const yaw = Math.PI - course.psi0;
    // a narrow diving board sticking out over the drop
    const lg = new THREE.Mesh(unitBox, darkMat);
    lg.scale.set(4, 0.6, 6);
    lg.position.set(course.spire.cx + f0x * (SPIRE_HALF + 3), START_Y - 0.3, course.spire.cz + f0z * (SPIRE_HALF + 3));
    lg.rotation.y = yaw;
    spireGroup.add(lg);
    const amber = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb547).multiplyScalar(1.6), toneMapped: false }));
    const cyan = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x38bdf8).multiplyScalar(2), toneMapped: false }));
    const lgn = new THREE.Mesh(unitBox, amber);
    lgn.scale.set(4.1, 0.12, 0.3);
    lgn.position.set(course.spire.cx + f0x * (SPIRE_HALF + 5.9), START_Y + 0.04, course.spire.cz + f0z * (SPIRE_HALF + 5.9));
    lgn.rotation.y = yaw;
    spireGroup.add(lgn);
    const rx0 = Math.cos(course.psi0);
    const rz0 = Math.sin(course.psi0);
    for (const sd of [-1, 1]) {
      const st = new THREE.Mesh(unitBox, cyan);
      st.scale.set(0.12, 0.12, 6);
      st.position.set(course.spire.cx + f0x * (SPIRE_HALF + 3) + rx0 * sd * 2.0, START_Y + 0.04, course.spire.cz + f0z * (SPIRE_HALF + 3) + rz0 * sd * 2.0);
      st.rotation.y = yaw;
      spireGroup.add(st);
      // short hand rails along the board's root
      const post = new THREE.Mesh(unitBox, darkMat);
      post.scale.set(0.08, 1.1, 0.08);
      post.position.set(course.spire.cx + f0x * (SPIRE_HALF + 0.6) + rx0 * sd * 2.0, START_Y + 0.55, course.spire.cz + f0z * (SPIRE_HALF + 0.6) + rz0 * sd * 2.0);
      spireGroup.add(post);
      const lamp = new THREE.Mesh(unitBox, amber);
      lamp.scale.set(0.16, 0.16, 0.16);
      lamp.position.set(post.position.x, START_Y + 1.15, post.position.z);
      spireGroup.add(lamp);
    }
  }
  const spireBoxes: Box[] = [
    boxOf(course.spire.cx, (START_Y - 2) / 2, course.spire.cz, SPIRE_HALF, (START_Y - 2) / 2, SPIRE_HALF),
    boxOf(course.spire.cx, START_Y - 1.5, course.spire.cz, SPIRE_HALF + 3, 1.5, SPIRE_HALF + 3),
    boxOf(
      course.spire.cx + Math.sin(course.psi0) * (SPIRE_HALF + 3),
      START_Y - 0.3,
      course.spire.cz - Math.cos(course.psi0) * (SPIRE_HALF + 3),
      2,
      0.3,
      3,
      Math.PI - course.psi0,
    ),
  ];

  // ------------------------------------------------------------------ landing pad
  const padGroup = new THREE.Group();
  root.add(padGroup);
  const padMat0 = (() => {
    const S = 512;
    const cv = document.createElement("canvas");
    cv.width = S;
    cv.height = S;
    const c = cv.getContext("2d")!;
    c.clearRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.fillStyle = "rgba(6,12,20,.92)";
    c.beginPath();
    c.arc(0, 0, S / 2 - 2, 0, 7);
    c.fill();
    const ring = (r: number, w: number, col: string) => {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      c.arc(0, 0, r, 0, 7);
      c.stroke();
    };
    ring(S / 2 - 8, 8, "#ffb547");
    ring(S * 0.34, 4, "rgba(56,189,248,.9)");
    ring(S * 0.19, 4, "rgba(255,181,71,.9)");
    ring(S * 0.07, 6, "#ffffff");
    c.fillStyle = "rgba(255,181,71,.9)";
    for (let i = 0; i < 12; i++) {
      c.save();
      c.rotate((i / 12) * Math.PI * 2);
      c.beginPath();
      c.moveTo(-9, -S * 0.46);
      c.lineTo(9, -S * 0.46);
      c.lineTo(0, -S * 0.39);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.fillStyle = "#fff";
    c.font = "800 70px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("LZ", 0, 0);
    const t = T(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const padMat = M(new THREE.MeshBasicMaterial({ map: padMat0, transparent: true, toneMapped: false, color: new THREE.Color(1, 1, 1) }));
  const padDisc = new THREE.Mesh(G(new THREE.CircleGeometry(course.pad.r, 48)), padMat);
  padDisc.rotation.x = -Math.PI / 2;
  padDisc.position.set(course.pad.x, 0.12, course.pad.z);
  padGroup.add(padDisc);
  const beaconMat = M(new THREE.MeshBasicMaterial({ color: 0xffb547, alphaMap: fadeTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const beacon = new THREE.Mesh(G(new THREE.CylinderGeometry(4, 9, 1700, 20, 1, true)), beaconMat);
  beacon.rotation.x = Math.PI;
  beacon.position.set(course.pad.x, 850, course.pad.z);
  beacon.frustumCulled = false;
  padGroup.add(beacon);
  const coreMat = M(new THREE.MeshBasicMaterial({ color: 0xfff0d0, alphaMap: fadeTex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const core = new THREE.Mesh(G(new THREE.CylinderGeometry(0.8, 1.6, 1700, 8, 1, true)), coreMat);
  core.rotation.x = Math.PI;
  core.position.copy(beacon.position);
  core.frustumCulled = false;
  padGroup.add(core);
  const padLight = new THREE.PointLight(0xffb547, 260, 90, 1.7);
  padLight.position.set(course.pad.x, 14, course.pad.z);
  padGroup.add(padLight);
  // lamp posts around the pad
  {
    const posts = new THREE.InstancedMesh(unitBox, darkMat, 8);
    const lamps = new THREE.InstancedMesh(unitBox, M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x38bdf8).multiplyScalar(3), toneMapped: false })), 8);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = course.pad.x + Math.cos(a) * (course.pad.r + 4);
      const z = course.pad.z + Math.sin(a) * (course.pad.r + 4);
      m.compose(new THREE.Vector3(x, 5, z), new THREE.Quaternion(), new THREE.Vector3(0.5, 10, 0.5));
      posts.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 10.3, z), new THREE.Quaternion(), new THREE.Vector3(1.4, 0.5, 1.4));
      lamps.setMatrixAt(i, m);
    }
    posts.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    padGroup.add(posts, lamps);
  }

  // ------------------------------------------------------------------ rings (instanced)
  const RN = course.rings.length;
  const ringGeo = G(new THREE.TorusGeometry(1, 0.035, 8, 64));
  const ringMat = M(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const ringInst = new THREE.InstancedMesh(ringGeo, ringMat, RN);
  const haloGeo = G(new THREE.CircleGeometry(1, 40));
  const haloMat = M(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, alphaMap: dotTex }));
  const haloInst = new THREE.InstancedMesh(haloGeo, haloMat, RN);
  const rm = new THREE.Matrix4();
  const rq = new THREE.Quaternion();
  const rt = new THREE.Vector3();
  const ringMats: THREE.Matrix4[] = [];
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  course.rings.forEach((r, i) => {
    rq.setFromUnitVectors(new THREE.Vector3(0, 0, 1), rt.set(r.tx, r.ty, r.tz));
    rm.compose(new THREE.Vector3(r.x, r.y, r.z), rq, new THREE.Vector3(r.r, r.r, r.r));
    ringMats.push(rm.clone());
    ringInst.setMatrixAt(i, rm);
    haloInst.setMatrixAt(i, rm);
  });
  ringInst.instanceMatrix.needsUpdate = true;
  haloInst.instanceMatrix.needsUpdate = true;
  ringInst.frustumCulled = false;
  haloInst.frustumCulled = false;
  root.add(ringInst, haloInst);
  const ringCol = {
    idle: new THREE.Color(0x2a8fd8).multiplyScalar(0.8),
    next: new THREE.Color(0x58d2ff).multiplyScalar(1.05),
    done: new THREE.Color(0x35f08a).multiplyScalar(0.0),
    miss: new THREE.Color(0xff4d5c).multiplyScalar(0.0),
  };
  const ringStates: RingState[] = course.rings.map(() => "idle");
  const nextMarker = new THREE.Group();
  const nmRing = new THREE.Mesh(G(new THREE.TorusGeometry(1, 0.018, 6, 64)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb547).multiplyScalar(1.15), toneMapped: false })));
  nextMarker.add(nmRing);
  const nmGlow = new THREE.Sprite(M(new THREE.SpriteMaterial({ map: dotTex, color: 0x4aa8e0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.06, fog: false })));
  nextMarker.add(nmGlow);
  root.add(nextMarker);
  let nextIdx = 0;
  function applyRingColors() {
    course.rings.forEach((_, i) => {
      const st = ringStates[i];
      const c = st === "next" ? ringCol.next : st === "idle" ? ringCol.idle : st === "done" ? ringCol.done : ringCol.miss;
      ringInst.setColorAt(i, c);
      const hc = st === "idle" ? new THREE.Color(0x1d6fa5) : st === "next" ? new THREE.Color(0x3a8ed0) : new THREE.Color(0x000000);
      haloInst.setColorAt(i, hc);
      const gone = st === "done" || st === "miss";
      ringInst.setMatrixAt(i, gone ? zeroM : ringMats[i]);
      haloInst.setMatrixAt(i, gone ? zeroM : ringMats[i]);
    });
    ringInst.instanceMatrix.needsUpdate = true;
    haloInst.instanceMatrix.needsUpdate = true;
    if (ringInst.instanceColor) ringInst.instanceColor.needsUpdate = true;
    if (haloInst.instanceColor) haloInst.instanceColor.needsUpdate = true;
  }
  function setRing(i: number, st: RingState) {
    ringStates[i] = st;
    applyRingColors();
  }
  function setNext(i: number) {
    for (let k = 0; k < RN; k++) if (ringStates[k] === "next") ringStates[k] = "idle";
    nextIdx = i;
    if (i < RN) {
      ringStates[i] = "next";
      const r = course.rings[i];
      nextMarker.visible = true;
      nextMarker.position.set(r.x, r.y, r.z);
      nextMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), rt.set(r.tx, r.ty, r.tz));
    } else nextMarker.visible = false;
    applyRingColors();
  }
  function resetRings() {
    for (let k = 0; k < RN; k++) ringStates[k] = "idle";
    setNext(0);
  }
  resetRings();

  // ------------------------------------------------------------------ chunks
  const chunks = new Map<number, Chunk>();
  const towersByChunk: number[][] = Array.from({ length: course.chunkCount }, () => []);
  course.towers.forEach((t, i) => towersByChunk[t.chunk].push(i));
  const SIGN_C = NEON.map((c) => new THREE.Color(c).multiplyScalar(1.05));

  function buildChunk(index: number): Chunk {
    const spec = genChunk(course, index);
    const group = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const meshes: THREE.InstancedMesh[] = [];
    const boxes: Box[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const yq = (ry: number) => q.setFromAxisAngle(UP, ry);

    // towers
    const ts = towersByChunk[index];
    if (ts.length) {
      const inst = new THREE.InstancedMesh(towerGeo, towerMat, ts.length);
      const signs: Array<{ m: THREE.Matrix4; c: number }> = [];
      const crowns: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
      ts.forEach((ti, k) => {
        const t = course.towers[ti];
        if (t.h > 380) {
          // neon crown bands + a mast on the supertalls (readable from far above)
          const cc = new THREE.Color(NEON[(ti * 7) % NEON.length]).multiplyScalar(1.4);
          for (const yy of [t.h - 3, t.h - 14, t.h - 40]) {
            crowns.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(t.x, yy, t.z), new THREE.Quaternion(), new THREE.Vector3(t.w + 0.8, yy === t.h - 3 ? 1.4 : 0.6, t.d + 0.8)), c: cc });
          }
          crowns.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.h + 22, t.z), new THREE.Quaternion(), new THREE.Vector3(0.9, 44, 0.9)), c: new THREE.Color(0x30343c) });
          crowns.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.h + 44.5, t.z), new THREE.Quaternion(), new THREE.Vector3(2.4, 2.4, 2.4)), c: new THREE.Color(0xff2a3c).multiplyScalar(2.5) });
          boxes.push(boxOf(t.x, t.h + 22, t.z, 0.6, 22, 0.6));
        }
        m.compose(new THREE.Vector3(t.x, 0, t.z), new THREE.Quaternion(), new THREE.Vector3(t.w, t.h, t.d));
        inst.setMatrixAt(k, m);
        boxes.push(boxOf(t.x, t.h / 2, t.z, t.w / 2, t.h / 2, t.d / 2));
        if (t.sign) {
          const sh = 10 + (t.sign % 3) * 5;
          const y = Math.min(t.h - sh * 0.6, 20 + (t.sign * 37) % Math.max(10, t.h - 30));
          const nrm = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)][t.face];
          const off = nrm.x !== 0 ? t.w / 2 + 0.3 : t.d / 2 + 0.3;
          const pos = new THREE.Vector3(t.x + nrm.x * off, Math.max(sh / 2 + 2, y), t.z + nrm.z * off);
          const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
          signs.push({ m: new THREE.Matrix4().compose(pos, qq, new THREE.Vector3(sh * 0.3, sh, 1)), c: t.sign - 1 });
        }
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
      meshes.push(inst);
      if (crowns.length) {
        const ci = new THREE.InstancedMesh(unitBox, neonMat, crowns.length);
        crowns.forEach((c, k) => {
          ci.setMatrixAt(k, c.m);
          ci.setColorAt(k, c.c);
        });
        ci.instanceMatrix.needsUpdate = true;
        if (ci.instanceColor) ci.instanceColor.needsUpdate = true;
        ci.frustumCulled = false;
        group.add(ci);
        meshes.push(ci);
      }
      if (signs.length) {
        const sg = G(new THREE.PlaneGeometry(1, 1));
        geos.push(sg);
        const si = new THREE.InstancedMesh(sg, signMat, signs.length);
        signs.forEach((s, k) => {
          si.setMatrixAt(k, s.m);
          si.setColorAt(k, SIGN_C[s.c % SIGN_C.length]);
        });
        si.instanceMatrix.needsUpdate = true;
        if (si.instanceColor) si.instanceColor.needsUpdate = true;
        si.frustumCulled = false;
        group.add(si);
        meshes.push(si);
      }
    }
    // dark + neon props
    if (spec.dark.length) {
      const di = new THREE.InstancedMesh(unitBox, darkMat, spec.dark.length);
      spec.dark.forEach((d, k) => di.setMatrixAt(k, m.compose(new THREE.Vector3(d.x, d.y, d.z), yq(d.ry).clone(), new THREE.Vector3(d.sx, d.sy, d.sz))));
      di.instanceMatrix.needsUpdate = true;
      di.frustumCulled = false;
      group.add(di);
      meshes.push(di);
    }
    if (spec.neon.length) {
      const ni = new THREE.InstancedMesh(unitBox, neonMat, spec.neon.length);
      spec.neon.forEach((d, k) => {
        ni.setMatrixAt(k, m.compose(new THREE.Vector3(d.x, d.y, d.z), yq(d.ry).clone(), new THREE.Vector3(d.sx, d.sy, d.sz)));
        ni.setColorAt(k, new THREE.Color(d.color).multiplyScalar(1.3));
      });
      ni.instanceMatrix.needsUpdate = true;
      if (ni.instanceColor) ni.instanceColor.needsUpdate = true;
      ni.frustumCulled = false;
      group.add(ni);
      meshes.push(ni);
    }
    if (spec.holo.length) {
      const pg = G(new THREE.PlaneGeometry(1, 1));
      geos.push(pg);
      const seeds = new Float32Array(spec.holo.length);
      spec.holo.forEach((h, k) => (seeds[k] = h.seed));
      pg.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
      const hi = new THREE.InstancedMesh(pg, holoMat, spec.holo.length);
      spec.holo.forEach((h, k) => {
        hi.setMatrixAt(k, m.compose(new THREE.Vector3(h.x, h.y, h.z), yq(h.ry).clone(), new THREE.Vector3(h.w, h.h, 1)));
        hi.setColorAt(k, new THREE.Color(h.color));
      });
      hi.instanceMatrix.needsUpdate = true;
      if (hi.instanceColor) hi.instanceColor.needsUpdate = true;
      hi.frustumCulled = false;
      hi.renderOrder = 2;
      group.add(hi);
      meshes.push(hi);
    }
    boxes.push(...spec.colliders);

    // traffic
    const carN = spec.lanes.reduce((a, l) => a + l.n, 0);
    let carBody: THREE.InstancedMesh | null = null;
    let carLight: THREE.InstancedMesh | null = null;
    if (carN) {
      const bg = G(new THREE.BoxGeometry(2.2, 1.1, 5));
      const lg = G(new THREE.BoxGeometry(2.25, 0.2, 5.05));
      geos.push(bg, lg);
      carBody = new THREE.InstancedMesh(bg, carMat, carN);
      carLight = new THREE.InstancedMesh(lg, neonMat, carN);
      let k = 0;
      for (const l of spec.lanes) for (let j = 0; j < l.n; j++) carLight.setColorAt(k++, new THREE.Color(l.color).multiplyScalar(1.5));
      carBody.frustumCulled = carLight.frustumCulled = false;
      group.add(carBody, carLight);
      meshes.push(carBody, carLight);
    }
    // drones
    const droneN = spec.swarms.reduce((a, s) => a + s.n, 0);
    let droneInst: THREE.InstancedMesh | null = null;
    if (droneN) {
      const dg = G(new THREE.OctahedronGeometry(0.9, 0));
      geos.push(dg);
      droneInst = new THREE.InstancedMesh(dg, droneMat, droneN);
      let k = 0;
      for (const s of spec.swarms) for (let j = 0; j < s.n; j++) droneInst.setColorAt(k++, new THREE.Color(s.color).multiplyScalar(2.6));
      droneInst.frustumCulled = false;
      group.add(droneInst);
      meshes.push(droneInst);
    }
    // trains
    const trainN = spec.trains.reduce((a, t) => a + t.cars, 0);
    const trainBoxes: Box[] = [];
    let trainInst: THREE.InstancedMesh | null = null;
    let trainGlow: THREE.InstancedMesh | null = null;
    if (trainN) {
      const tg = G(new THREE.BoxGeometry(3.4, 3, 12));
      const tg2 = G(new THREE.BoxGeometry(3.5, 0.5, 12.1));
      geos.push(tg, tg2);
      trainInst = new THREE.InstancedMesh(tg, carMat, trainN);
      trainGlow = new THREE.InstancedMesh(tg2, neonMat, trainN);
      for (let k = 0; k < trainN; k++) {
        trainGlow.setColorAt(k, new THREE.Color(0x35f0ff).multiplyScalar(2.2));
        trainBoxes.push(boxOf(0, -9999, 0, 1.7, 1.5, 6));
      }
      trainInst.frustumCulled = trainGlow.frustumCulled = false;
      group.add(trainInst, trainGlow);
      meshes.push(trainInst, trainGlow);
    }

    const cm = new THREE.Matrix4();
    const cq = new THREE.Quaternion();
    const cp = new THREE.Vector3();
    const update = (t: number, haz: Hazard[]) => {
      if (carBody && carLight) {
        let k = 0;
        for (const l of spec.lanes) {
          const yaw = Math.atan2(l.dx, l.dz);
          cq.setFromAxisAngle(UP, yaw);
          for (let j = 0; j < l.n; j++) {
            const u = ((((l.phase + j / l.n) * l.len + t * l.speed) % l.len) + l.len) % l.len - l.len / 2;
            cp.set(l.x + l.dx * u, l.y, l.z + l.dz * u);
            cm.compose(cp, cq, one);
            carBody.setMatrixAt(k, cm);
            carLight.setMatrixAt(k, cm);
            haz.push({ x: cp.x, y: cp.y, z: cp.z, r: 2.7, kind: "car" });
            k++;
          }
        }
        carBody.instanceMatrix.needsUpdate = true;
        carLight.instanceMatrix.needsUpdate = true;
      }
      if (droneInst) {
        let k = 0;
        for (const s of spec.swarms) {
          for (let j = 0; j < s.n; j++) {
            const a = s.phase + t * s.speed + (j / s.n) * Math.PI * 2;
            const tilt = j * 0.7;
            cp.set(s.x + Math.cos(a) * s.rad, s.y + Math.sin(a * 2 + tilt) * s.rad * 0.45, s.z + Math.sin(a) * s.rad);
            cq.setFromAxisAngle(UP, a * 3);
            cm.compose(cp, cq, one);
            droneInst.setMatrixAt(k++, cm);
            haz.push({ x: cp.x, y: cp.y, z: cp.z, r: 1.8, kind: "drone" });
          }
        }
        droneInst.instanceMatrix.needsUpdate = true;
      }
      if (trainInst && trainGlow) {
        let k = 0;
        for (const tr of spec.trains) {
          const yaw = Math.atan2(tr.dx, tr.dz);
          cq.setFromAxisAngle(UP, yaw);
          const u0 = ((((tr.phase + (t * tr.speed) / tr.len) % 1) + 1) % 1) * tr.len - tr.len / 2;
          for (let j = 0; j < tr.cars; j++) {
            const u = u0 - j * 13.5;
            const uu = ((u + tr.len / 2) % tr.len + tr.len) % tr.len - tr.len / 2;
            cp.set(tr.x + tr.dx * uu, tr.y, tr.z + tr.dz * uu);
            cm.compose(cp, cq, one);
            trainInst.setMatrixAt(k, cm);
            trainGlow.setMatrixAt(k, cm.clone().setPosition(cp.x, cp.y - 1.3, cp.z));
            const b = trainBoxes[k];
            b.cx = cp.x;
            b.cy = cp.y;
            b.cz = cp.z;
            b.c = Math.cos(yaw);
            b.s = Math.sin(yaw);
            k++;
          }
        }
        trainInst.instanceMatrix.needsUpdate = true;
        trainGlow.instanceMatrix.needsUpdate = true;
      }
    };
    root.add(group);
    return { index, group, boxes, trainBoxes, spec, update, geos, meshes };
  }

  function disposeChunk(c: Chunk) {
    root.remove(c.group);
    for (const g of c.geos) g.dispose();
    for (const m of c.meshes) m.dispose();
    chunks.delete(c.index);
  }

  let activeCI = -1;
  function setActiveChunk(ci: number) {
    if (ci === activeCI) return;
    activeCI = ci;
    for (let i = Math.max(0, ci - 2); i <= Math.min(course.chunkCount - 1, ci + 4); i++) if (!chunks.has(i)) chunks.set(i, buildChunk(i));
    for (const [i, c] of chunks) if (i < ci - 3 || i > ci + 5) disposeChunk(c);
  }

  const hazards: Hazard[] = [];
  function query(x: number, y: number, z: number): { d: number; box: Box | null } {
    let best = 1e9;
    let bb: Box | null = null;
    for (const b of spireBoxes) {
      const d = boxDist(b, x, y, z);
      if (d < best) {
        best = d;
        bb = b;
      }
    }
    for (const c of chunks.values()) {
      for (const b of c.boxes) {
        if (Math.abs(x - b.cx) > b.hx + 40 && Math.abs(x - b.cx) > b.hz + 40) continue;
        const d = boxDist(b, x, y, z);
        if (d < best) {
          best = d;
          bb = b;
        }
      }
      for (const b of c.trainBoxes) {
        const d = boxDist(b, x, y, z);
        if (d < best) {
          best = d;
          bb = b;
        }
      }
    }
    return { d: best, box: bb };
  }

  function hazardHit(x: number, y: number, z: number, r: number): Hazard | null {
    for (const h of hazards) {
      const dx = h.x - x;
      const dy = h.y - y;
      const dz = h.z - z;
      if (dx * dx + dy * dy + dz * dz < (h.r + r) * (h.r + r)) return h;
    }
    return null;
  }

  function update(t: number, dt: number, cam: THREE.Vector3) {
    sky.position.copy(cam);
    skyUniforms.uAlt.value = cam.y;
    skyUniforms.uTime.value = t;
    holoMat.uniforms.uTime.value = t;
    ground.position.x = Math.round(cam.x / 120) * 120;
    ground.position.z = Math.round(cam.z / 120) * 120;
    for (const d of decks) {
      d.u.uCam.value.copy(cam);
      d.u.uTime.value = t;
      d.mesh.position.x = Math.round(cam.x / 100) * 100;
      d.mesh.position.z = Math.round(cam.z / 100) * 100;
    }
    puffU.uCam.value.copy(cam);
    hazards.length = 0;
    for (const c of chunks.values()) c.update(t, hazards);
    // ring pulse
    const pulse = 0.75 + 0.25 * Math.sin(t * 6);
    if (nextIdx < RN) {
      const r = course.rings[nextIdx];
      nmRing.scale.setScalar(r.r * (1.12 + 0.05 * Math.sin(t * 4)));
      nmGlow.scale.setScalar(r.r * 2.6 * pulse);
    }
    // the beacon guides you in from altitude, then fades so the touchdown stays readable
    const nearPad = THREE.MathUtils.smoothstep(cam.y, 12, 140);
    beaconMat.opacity = (0.45 + 0.15 * Math.sin(t * 2.2)) * (0.12 + 0.88 * nearPad);
    coreMat.opacity = 0.8 * (0.08 + 0.92 * nearPad);
    padMat.color.setScalar(0.95 + 0.25 * Math.sin(t * 3));
    void dt;
  }

  /** Nearest centre-line sample index to a point (search window around a hint). */
  function nearestIndex(x: number, y: number, z: number, hint: number): number {
    let best = 1e12;
    let bi = hint;
    const a = Math.max(0, hint - 25);
    const b = Math.min(course.N - 1, hint + 40);
    for (let i = a; i <= b; i++) {
      const d = (course.px[i] - x) ** 2 + (course.py[i] - y) ** 2 * 0.25 + (course.pz[i] - z) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return bi;
  }

  function fogFor(alt: number) {
    // base haze, thicker inside the cloud layer
    const cloud = THREE.MathUtils.smoothstep(alt, 1230, 1300) * (1 - THREE.MathUtils.smoothstep(alt, 1400, 1460));
    return { density: 0.00045 + cloud * 0.0021 + (1 - THREE.MathUtils.smoothstep(alt, 0, 300)) * 0.0011, cloud };
  }

  return {
    root,
    res,
    update,
    query,
    hazardHit,
    hazards,
    setActiveChunk,
    nearestIndex,
    setRing,
    setNext,
    resetRings,
    fogFor,
    get activeChunk() {
      return activeCI;
    },
    get chunkCount() {
      return chunks.size;
    },
    dispose() {
      for (const c of [...chunks.values()]) disposeChunk(c);
      scene.remove(root);
      res.dispose();
      ringInst.dispose();
      haloInst.dispose();
    },
  };
}

export { CHUNK_SAMPLES };

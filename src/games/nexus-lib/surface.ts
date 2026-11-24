/**
 * NEXUS 2100 — surface detail for the untextured kit models.
 *
 * The env GLBs ship flat colours and (mostly) no UVs, so a photo PBR set (Poly Haven, CC0) is
 * projected triplanar in world space and layered over each material's own colour:
 *   albedo  × normalised detail luminance (keeps the kit's palette)
 *   normal  ← whiteout-blended triplanar normal map
 *   rough   ← ARM green channel, metal ← ARM blue
 * plus street grime near the ground and faint rain streaks on vertical faces.
 */
import * as THREE from "three";

export type PbrSet = { diff: THREE.Texture; nor: THREE.Texture; arm: THREE.Texture; mean: number };

export async function loadPbr(loader: THREE.TextureLoader, base: string, mean: number, aniso: number): Promise<PbrSet> {
  const [diff, nor, arm] = await Promise.all(["diff", "nor", "arm"].map((k) => loader.loadAsync(`${base}-${k}.webp`)));
  diff.colorSpace = THREE.SRGBColorSpace;
  for (const t of [diff, nor, arm]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
  }
  return { diff, nor, arm, mean };
}

export type TriOpts = {
  /** world metres per tile */
  tile: number;
  /** 0..1 albedo detail strength */
  albedo: number;
  /** 0..1 how much of the texture's own hue survives (0 = luminance only) */
  chroma: number;
  /** 0..1 normal map strength */
  normal: number;
  /** roughness range driven by ARM.g */
  rough: [number, number];
  /** metalness multiplier range driven by ARM.b */
  metal: [number, number];
  /** 0..1 darkening near the ground */
  grime: number;
};

export function triplanar(mat: THREE.MeshStandardMaterial, set: PbrSet, o: TriOpts) {
  const uniforms = {
    nxD: { value: set.diff },
    nxN: { value: set.nor },
    nxA: { value: set.arm },
    nxScale: { value: 1 / o.tile },
    nxMean: { value: set.mean },
    nxAlb: { value: o.albedo },
    nxChroma: { value: o.chroma },
    nxNorm: { value: o.normal },
    nxRough: { value: new THREE.Vector2(...o.rough) },
    nxMetal: { value: new THREE.Vector2(...o.metal) },
    nxGrime: { value: o.grime },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 nxWP;\nvarying vec3 nxWN;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nnxWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nnxWN = normalize(mat3(modelMatrix) * objectNormal);",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 nxWP;
varying vec3 nxWN;
uniform sampler2D nxD; uniform sampler2D nxN; uniform sampler2D nxA;
uniform float nxScale; uniform float nxMean; uniform float nxAlb; uniform float nxChroma;
uniform float nxNorm; uniform vec2 nxRough; uniform vec2 nxMetal; uniform float nxGrime;
vec3 nxW; vec2 nxUX; vec2 nxUY; vec2 nxUZ; vec3 nxArm;
vec3 nxTri(sampler2D t) { return texture2D(t, nxUX).rgb * nxW.x + texture2D(t, nxUY).rgb * nxW.y + texture2D(t, nxUZ).rgb * nxW.z; }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  vec3 n = normalize(nxWN);
  nxW = pow(abs(n), vec3(4.0));
  nxW /= (nxW.x + nxW.y + nxW.z);
  // per-axis offsets so neighbouring faces don't line up seams
  nxUX = nxWP.zy * nxScale + vec2(0.37, 0.11);
  nxUY = nxWP.xz * nxScale + vec2(0.71, 0.53);
  nxUZ = nxWP.xy * nxScale;
  vec3 d = nxTri(nxD);
  float l = dot(d, vec3(0.2126, 0.7152, 0.0722));
  vec3 det = mix(vec3(l), d, nxChroma) / nxMean;
  det = clamp(det, 0.25, 2.2);
  diffuseColor.rgb *= mix(vec3(1.0), det, nxAlb);
  nxArm = nxTri(nxA);
  diffuseColor.rgb *= mix(1.0, nxArm.r, 0.55);
  // grime: darker, browner near street level
  float g = 1.0 - smoothstep(0.0, 2.4, nxWP.y);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.58, 0.54), g * nxGrime);
  // rain streaks on vertical faces
  float vert = 1.0 - nxW.y;
  float s = texture2D(nxD, vec2((nxWP.x + nxWP.z) * 0.85, nxWP.y * 0.035)).g / max(nxMean * 3.0, 0.05);
  diffuseColor.rgb *= mix(1.0, clamp(0.7 + 0.45 * s, 0.6, 1.15), vert * 0.6 * nxGrime);
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(nxRough.x, nxRough.y, nxArm.g), 0.04, 1.0);",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "#include <metalnessmap_fragment>\nmetalnessFactor = clamp(metalnessFactor * mix(nxMetal.x, nxMetal.y, nxArm.b), 0.0, 1.0);",
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  vec3 n = normalize(nxWN);
  vec3 tx = texture2D(nxN, nxUX).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(nxN, nxUY).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(nxN, nxUZ).xyz * 2.0 - 1.0;
  // whiteout blend (Golus)
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  vec3 wn = normalize(tx.zyx * nxW.x + ty.xzy * nxW.y + tz.xyz * nxW.z);
  wn = normalize(mix(n, wn, nxNorm));
  vec3 vn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  normal = faceDirection * vn;
}`,
      );
  };
  mat.customProgramCacheKey = () => "nx-tri";
  mat.needsUpdate = true;
}

/** Flat-colour kit materials → triplanar photo detail, tuned per palette name. */
export const KIT_SURF: Record<string, Partial<TriOpts>> = {
  LightGrey: {},
  Grey: {},
  MetalLight: { rough: [0.25, 0.6] },
  DarkGrey: { albedo: 0.6, rough: [0.35, 0.75] },
  Black: { albedo: 0.5, rough: [0.4, 0.8], grime: 0.4 },
  Orange: { albedo: 0.75, chroma: 0.15, rough: [0.4, 0.85] },
};

export function applyKitSurfaces(roots: Array<THREE.Object3D | null | undefined>, set: PbrSet) {
  const done = new Set<THREE.Material>();
  for (const r of roots) {
    r?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const sm = m as THREE.MeshStandardMaterial;
        const cfg = KIT_SURF[sm.name];
        if (!cfg || done.has(sm) || !sm.isMeshStandardMaterial || sm.map) continue;
        done.add(sm);
        triplanar(sm, set, { tile: 2.4, albedo: 0.85, chroma: 0.2, normal: 0.85, rough: [0.3, 0.85], metal: [0.5, 1.1], grime: 1, ...cfg });
      }
    });
  }
}

/** Saturated sign colours in the kit become emissive neon. */
export function glowNeon(root: THREE.Object3D) {
  const hsl = { h: 0, s: 0, l: 0 };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (!sm.color || !sm.emissive || sm.userData.nxGlow) continue;
      sm.userData.nxGlow = true;
      sm.color.getHSL(hsl);
      const neonHue = hsl.h > 0.72 || hsl.h < 0.02 || (hsl.h > 0.42 && hsl.h < 0.58) || (hsl.h > 0.12 && hsl.h < 0.2);
      if (hsl.s > 0.6 && hsl.l > 0.42 && neonHue) {
        sm.emissive.copy(sm.color);
        sm.emissiveIntensity = 0.85;
      }
    }
  });
}

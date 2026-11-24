/**
 * Final grade pass: vignette, subtle lens chromatic aberration, film grain,
 * damage tint and low-health desaturation. Runs after OutputPass, so it works
 * in display (sRGB) space.
 */
export const GradeShader = {
  name: "NexusGrade",
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uLowHp: { value: 0 },
    uAds: { value: 0 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDamage;
    uniform float uLowHp;
    uniform float uAds;
    uniform float uFade;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float ca = 0.0016 + r2 * 0.006 + uDamage * 0.004;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;

      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), uLowHp * 0.65);

      float vig = smoothstep(0.85, 0.18, r2 * (1.35 + uAds * 0.9));
      col *= mix(0.42, 1.0, vig);

      float edge = smoothstep(0.08, 0.42, r2);
      col = mix(col, vec3(0.55, 0.02, 0.03), edge * clamp(uDamage, 0.0, 1.0) * 0.75);
      col = mix(col, col * vec3(1.15, 0.55, 0.55), edge * uLowHp * (0.55 + 0.45 * sin(uTime * 6.0)));

      float g = hash(vUv * 1024.0 + fract(uTime * 13.0)) - 0.5;
      col += g * 0.035;

      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * NEXUS 2100 — procedural canvas textures (ground, sidewalk, sprites).
 */
import * as THREE from "three";

export function canvasTex(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) paint(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wet asphalt: albedo + roughness map with puddles (low roughness = mirror). */
export function asphalt(rng: () => number) {
  const S = 1024;
  const puddles: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 12; i++) puddles.push([rng() * S, rng() * S, 22 + rng() * 70, 10 + rng() * 32]);

  const map = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = "#2a2e34";
    ctx.fillRect(0, 0, S, S);
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() - 0.5) * 26 + (rng() < 0.02 ? 22 : 0);
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 1.05));
    }
    ctx.putImageData(img, 0, 0);
    // tar patches / repairs
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(14,16,20,${0.25 + rng() * 0.3})`;
      const w = 60 + rng() * 220;
      const h = 30 + rng() * 120;
      ctx.fillRect(rng() * S, rng() * S, w, h);
    }
    // cracks
    ctx.strokeStyle = "rgba(10,12,14,.75)";
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 26; i++) {
      let x = rng() * S;
      let y = rng() * S;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rng() - 0.5) * 50;
        y += (rng() - 0.5) * 50;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // darker wet puddles
    for (const [x, y, rx, ry] of puddles) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
      g.addColorStop(0, "rgba(8,10,14,.55)");
      g.addColorStop(1, "rgba(8,10,14,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const rough = canvasTex(
    S,
    S,
    (ctx) => {
      ctx.fillStyle = "rgb(200,200,200)";
      ctx.fillRect(0, 0, S, S);
      const img = ctx.getImageData(0, 0, S, S);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (rng() - 0.5) * 40;
        d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, d[i] + n));
      }
      ctx.putImageData(img, 0, 0);
      for (const [x, y, rx, ry] of puddles) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
        g.addColorStop(0, "rgb(70,70,70)");
        g.addColorStop(0.6, "rgba(95,95,95,.8)");
        g.addColorStop(1, "rgba(200,200,200,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    false,
  );
  for (const t of [map, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, rough };
}

export function sidewalk(rng: () => number) {
  const S = 256;
  const t = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = "#4a4f56";
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) {
        const v = 66 + Math.floor(rng() * 16);
        ctx.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
        ctx.fillRect(x * 128 + 2, y * 64 + 2, 124, 60);
      }
    }
    const img = ctx.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rng() - 0.5) * 18;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Vertical alpha gradient for light cones / beams (opaque top → clear bottom). */
export function verticalFade() {
  return canvasTex(
    4,
    128,
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, "#fff");
      g.addColorStop(0.35, "#888");
      g.addColorStop(1, "#000");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 128);
    },
    false,
  );
}

export function softDot() {
  return canvasTex(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

export function flashTex() {
  return canvasTex(128, 128, (ctx) => {
    ctx.translate(64, 64);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, "rgba(255,255,235,1)");
    g.addColorStop(0.25, "rgba(255,215,140,.9)");
    g.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = g;
    for (let i = 0; i < 5; i++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(62, 0);
      ctx.lineTo(0, 8);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function diamond(color: string) {
  return canvasTex(64, 64, (ctx) => {
    ctx.translate(32, 32);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.fillRect(-11, -11, 22, 22);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(-5, -5, 10, 10);
  });
}

export function nameTag(text: string, color: string) {
  return canvasTex(256, 64, (ctx) => {
    ctx.font = "600 26px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,.75)";
    ctx.strokeText(text, 128, 24);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 24);
    ctx.beginPath();
    ctx.moveTo(118, 44);
    ctx.lineTo(138, 44);
    ctx.lineTo(128, 56);
    ctx.closePath();
    ctx.fill();
  });
}

"use client";

import { useEffect, useRef } from "react";

/** Hero arkasında süzülen yıldız alanı — hafif, tek canvas */
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const DPR = Math.min(window.devicePixelRatio, 2);

    type Star = { x: number; y: number; r: number; v: number; ph: number };
    let stars: Star[] = [];

    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.parentElement?.getBoundingClientRect();
      w = rect?.width ?? window.innerWidth;
      h = rect?.height ?? 400;
      canvas.width = w * DPR;
      canvas.height = h * DPR;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      stars = Array.from({ length: 130 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.3 + 0.3,
        v: Math.random() * 0.25 + 0.08,
        ph: Math.random() * Math.PI * 2,
      }));
    }

    const t0 = performance.now();
    function draw(now: number) {
      if (!ctx) return;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.y += s.v;
        if (s.y > h + 2) {
          s.y = -2;
          s.x = Math.random() * w;
        }
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.5 + s.ph));
        ctx.globalAlpha = tw;
        ctx.fillStyle = s.r > 1 ? "#7cc7ff" : "#ffffff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { submitScore, getBestScore } from "@/lib/storage";

type GameInstance = { dispose: () => void };
type GameModule = {
  createGame: (container: HTMLElement) => GameInstance;
};

/**
 * Sahne kanvası: her oyun için ortak zemin.
 * src/games/<slug>.ts modülünü dynamic import eder ve dispose'u yönetir.
 * Kullanıcı sahneye dokunmadan çıkmadan cleanup garanti edilir.
 */
export default function StageCanvas({ slug }: { slug: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);

  useEffect(() => {
    let instance: GameInstance | null = null;
    let cancelled = false;
    let timer = 0;

    setBest(getBestScore(slug));

    import(`@/games/${slug}`)
      .then((mod: GameModule) => {
        if (cancelled || !containerRef.current) return;
        instance = mod.createGame(containerRef.current);
        // Demo: skor akan sahneden beslenmiyor, şimdilik tick'liyoruz.
        // Gerçek oyunda createGame bir onScore callback alacak.
        timer = window.setInterval(() => {
          setScore((s) => s + 1);
        }, 500);
      })
      .catch(() => {
        if (containerRef.current && !cancelled) {
          containerRef.current.innerHTML =
            '<p class="text-white/40 p-8">Bu oyun henüz hazır değil.</p>';
        }
      });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      instance?.dispose();
      if (slug === "runner") submitScore(slug, score); // demo: skoru yaz
    };
    // score'u dependency'ye koymam bilinçli; sadece çıkışta flush ediyoruz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="card touch-none select-none overflow-hidden
          h-[60vh] min-h-[380px] relative"
      />
      {/* HUD */}
      <div className="mt-3 flex items-center justify-between text-sm px-1">
        <span className="text-white/60">
          Skor: <strong className="text-white">{score}</strong>
        </span>
        <span className="text-cyan-300">🏆 En iyi: {best}</span>
      </div>
    </div>
  );
}

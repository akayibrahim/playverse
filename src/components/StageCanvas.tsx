"use client";

import { useEffect, useRef, useState } from "react";
import { submitScore, getBestScore } from "@/lib/storage";

type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number) => void;
  onBoost?: (meter: number) => void;
};
type GameInstance = { dispose: () => void };
type GameModule = {
  createGame: (container: HTMLElement, hooks: GameHooks) => GameInstance;
};

/**
 * Sahne kanvası: her oyun için ortak zemin.
 * src/games/<slug>.ts modülünü dynamic import eder, dispose'u yönetir,
 * oyunun onScore/onGameOver çağrılarını HUD'a ve skora bağlar.
 */
export default function StageCanvas({ slug }: { slug: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [boost, setBoost] = useState(1);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let instance: GameInstance | null = null;
    let cancelled = false;

    setGameOver(false);
    setScore(0);
    setBoost(1);
    setBest(getBestScore(slug));

    import(`@/games/${slug}`)
      .then((mod: GameModule) => {
        if (cancelled || !containerRef.current) return;
        instance = mod.createGame(containerRef.current, {
          onScore: (s) => setScore(s),
          onBoost: (m) => setBoost(m),
          onGameOver: (final) => {
            // submitScore yeni rekorsa onu döndürür
            const recorded = submitScore(slug, final);
            setBest(recorded);
            setGameOver(true);
          },
        });
      })
      .catch(() => {
        if (containerRef.current && !cancelled) {
          containerRef.current.innerHTML =
            '<p class="text-white/40 p-8">This game isn\'t ready yet.</p>';
        }
      });

    return () => {
      cancelled = true;
      instance?.dispose();
    };
  }, [slug, runId]);

  const restart = () => setRunId((r) => r + 1);

  // Desktop: Enter / Space restarts after game over
  useEffect(() => {
    if (!gameOver) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        restart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gameOver]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="card touch-none select-none overflow-hidden
          h-[60vh] min-h-[380px] relative"
      />

      {/* Game over ekranı */}
      {gameOver && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center
            gap-4 bg-[#05060f]/80 backdrop-blur-sm rounded-2xl"
        >
          <p className="text-white/60 text-sm">You crashed!</p>
          <p className="text-4xl font-bold neon-text">
            {score.toLocaleString("en-US")}
          </p>
          {score >= best && score > 0 && (
            <p className="text-cyan-300 text-sm">🏆 New best!</p>
          )}
          <button
            type="button"
            onClick={restart}
            className="card px-6 py-3 font-semibold text-lg
              hover:border-accent active:scale-95 transition"
          >
            ↻ Play again
          </button>
          <p className="text-white/40 text-xs">🏆 Best: {best}</p>
        </div>
      )}

      {/* Boost barı */}
      <div className="mt-2 mx-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-cyan-400 to-violet-500
            transition-[width] duration-150"
          style={{ width: `${Math.round(boost * 100)}%` }}
        />
      </div>

      {/* HUD */}
      <div className="mt-2 flex items-center justify-between text-sm px-1">
        <span className="text-white/60">
          Score: <strong className="text-white">{score}</strong>
        </span>
        <span className="hidden sm:block text-white/35">
          ← → steer · ↑/W boost · swipe on mobile
        </span>
        <span className="text-cyan-300">🏆 Best: {best}</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { submitScore, getBestScore } from "@/lib/storage";

type RunStat = { label: string; value: string };

type GameHooks = {
  onScore: (score: number) => void;
  onGameOver: (score: number, stats: RunStat[]) => void;
  onBoost?: (meter: number, active: boolean) => void;
  onPopup?: (text: string) => void;
  best?: number;
};
type GameInstance = { dispose: () => void };
type GameModule = {
  createGame: (container: HTMLElement, hooks: GameHooks) => GameInstance;
};

/**
 * Ortak oyun sahnesi: src/games/<slug>.ts modülünü dynamic import eder,
 * dispose'u yönetir; skor / popup / mission-over çağrılarını katmana bağlar.
 * Oyun kendi HUD'ını container içinde kurar — burası sadece ortak katman.
 */
export default function StageCanvas({ slug }: { slug: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [stats, setStats] = useState<RunStat[]>([]);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);
  const popupId = useRef(0);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let instance: GameInstance | null = null;
    let cancelled = false;

    setGameOver(false);
    setScore(0);
    setStats([]);
    setPopups([]);
    const startBest = getBestScore(slug);
    setBest(startBest);

    import(`@/games/${slug}`)
      .then((mod: GameModule) => {
        if (cancelled || !containerRef.current) return;
        instance = mod.createGame(containerRef.current, {
          best: startBest,
          onScore: (s) => setScore(s),
          onPopup: (text) => {
            const id = ++popupId.current;
            setPopups((p) => [...p.slice(-3), { id, text }]);
            window.setTimeout(() => {
              setPopups((p) => p.filter((x) => x.id !== id));
            }, 1100);
          },
          onGameOver: (final, runStats) => {
            const recorded = submitScore(slug, final);
            setBest(recorded);
            setStats(runStats);
            setGameOver(true);
          },
        });
      })
      .catch(() => {
        if (containerRef.current && !cancelled) {
          containerRef.current.innerHTML =
            '<p class="text-faint p-8">Simulation unavailable.</p>';
        }
      });

    return () => {
      cancelled = true;
      instance?.dispose();
    };
  }, [slug, runId]);

  const restart = () => setRunId((r) => r + 1);

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
    <div className="relative flex-1 flex flex-col">
      <div
        ref={containerRef}
        className="card touch-none select-none overflow-hidden flex-1 min-h-[420px] relative"
      />

      <div className="absolute inset-x-0 top-12 flex flex-col items-center gap-1 pointer-events-none z-10">
        {popups.map((p) => (
          <span key={p.id} className="popup-float text-sm font-bold uppercase tracking-[0.2em] text-cyan-200 [text-shadow:0_0_12px_rgba(0,224,255,0.8)]">
            {p.text}
          </span>
        ))}
      </div>

      {gameOver && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[#05060f]/85 backdrop-blur-sm rounded-sm gameover-flash">
          <div className={`text-[10px] uppercase tracking-[0.3em] font-semibold ${
            stats.find((s) => s.label === "RESULT")?.value === "SUCCESS"
              ? "text-cyan-400"
              : "text-rose-400"
          }`}>
            {stats.find((s) => s.label === "RESULT")?.value === "SUCCESS"
              ? "Mission accomplished"
              : "Mission failed"}
          </div>
          <p className="text-5xl font-black tracking-tight text-foreground">
            {score.toLocaleString("en-US")}
          </p>
          <p className="text-xs uppercase tracking-[0.14em] text-muted text-center px-4">
            {stats.map((s) => `${s.label} ${s.value}`).join(" · ")}
          </p>
          {score >= best && score > 0 && (
            <p className="text-cyan-400 text-xs uppercase tracking-[0.2em]">New best</p>
          )}
          <button
            type="button"
            onClick={restart}
            className="rounded-sm border border-surface-border px-7 py-3 text-xs font-bold uppercase tracking-[0.2em] text-foreground hover:border-cyan-400/60 hover:text-cyan-300 active:scale-[0.98] transition"
          >
            ↻ Redeploy
          </button>
          <p className="text-faint text-[10px] uppercase tracking-[0.2em]">Best: {best}</p>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between px-1 font-mono text-[11px] uppercase tracking-wider text-faint">
        <span>Score <strong className="text-foreground">{score}</strong></span>
        <span>Mouse / keyboard · touch supported</span>
        <span>Best <strong className="text-cyan-400">{best}</strong></span>
      </div>
    </div>
  );
}

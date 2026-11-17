import Link from "next/link";
import Image from "next/image";
import { GameGrid } from "@/components/GameGrid";
import Starfield from "@/components/Starfield";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main className="relative flex-1">
      {/* Nav */}
      <nav className="sticky top-0 z-20 backdrop-blur-md bg-background/70 border-b border-surface-border">
        <div className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="Playverse"
              width={26}
              height={26}
              className="drop-shadow-[0_0_8px_rgba(0,224,255,0.5)]"
            />
            <span className="font-extrabold tracking-tight text-lg">
              Play<span className="neon-text">verse</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-xs text-faint tracking-wide">
              real-time WebGL · no install · plays on mobile &amp; desktop
            </span>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-surface-border">
        <Starfield />
        {/* nebula glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-30%] left-1/2 -translate-x-1/2 w-[70rem] h-[36rem] rounded-full bg-[radial-gradient(ellipse_at_center,var(--glow-1),transparent_60%)] blur-3xl" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[40rem] h-[28rem] rounded-full bg-[radial-gradient(ellipse_at_center,var(--glow-2),transparent_60%)] blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-16 text-center">
          <Link
            href="/games/swarm"
            className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30
              bg-cyan-400/10 px-4 py-1.5 text-xs font-semibold text-cyan-300
              hover:bg-cyan-400/20 transition"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Flagship: SWARM MIND is live — 6,000 drones
          </Link>

          <h1 className="mt-6 text-5xl sm:text-7xl font-extrabold tracking-tight leading-[1.04]">
            Games from
            <br />
            <span className="neon-text [text-shadow:0_0_40px_rgba(124,92,255,0.45)]">
              tomorrow.
            </span>
          </h1>

          <p className="mt-5 text-base sm:text-lg text-muted max-w-xl mx-auto">
            Real-time worlds at a scale your browser has never seen — thousands
            of agents, living physics, zero installs. This is what play looks
            like next.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/games/swarm"
              className="rounded-full px-7 py-3.5 font-bold text-white text-sm
                bg-gradient-to-r from-cyan-500 to-violet-600
                shadow-[0_0_30px_rgba(0,224,255,0.4)]
                hover:brightness-115 hover:shadow-[0_0_44px_rgba(124,92,255,0.6)]
                active:scale-95 transition"
            >
              ▶ Enter the swarm
            </Link>
            <a
              href="#games"
              className="rounded-full px-7 py-3.5 font-semibold text-sm text-muted
                border border-surface-border bg-surface backdrop-blur-sm
                hover:border-accent hover:text-foreground active:scale-95 transition"
            >
              Browse games
            </a>
          </div>

          {/* stat satırı */}
          <div className="mt-14 mx-auto grid max-w-lg grid-cols-3 gap-px overflow-hidden rounded-2xl border border-surface-border bg-surface-border backdrop-blur-sm">
            {[
              ["6,000", "agents in real time"],
              ["60fps", "instanced WebGL"],
              ["0", "installs needed"],
            ].map(([v, l]) => (
              <div key={l} className="bg-background/80 px-4 py-4">
                <div className="text-xl font-extrabold neon-text">{v}</div>
                <div className="mt-0.5 text-[11px] text-faint">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Oyun listesi */}
      <section id="games" className="mx-auto max-w-6xl px-5 pt-14 pb-24">
        <div className="flex items-end justify-between mb-6">
          <h2 className="text-2xl font-extrabold tracking-tight">Games</h2>
          <span className="text-xs text-faint">new ones shipping soon</span>
        </div>
        <GameGrid />
      </section>

      <footer className="border-t border-surface-border py-8 text-center text-xs text-faint">
        Playverse · games from tomorrow · scores stay on your device · v0.3
      </footer>
    </main>
  );
}

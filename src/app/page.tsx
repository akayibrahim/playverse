import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main className="relative flex-1">
      {/* Nav */}
      <nav className="sticky top-0 z-20 backdrop-blur-md bg-background/70 border-b border-surface-border">
        <div className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.svg"
              alt="Playverse"
              width={26}
              height={26}
              className="drop-shadow-[0_0_8px_rgba(0,224,255,0.5)]"
            />
            <span className="font-extrabold tracking-[0.16em] text-sm uppercase">
              Play<span className="neon-text">verse</span>
            </span>
            <span className="hidden md:inline text-[10px] text-faint uppercase tracking-[0.2em] border-l border-surface-border pl-3 ml-1">
              interactive systems lab
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-[10px] text-faint tracking-[0.18em] uppercase">
              WebGL2 · real-time · no install
            </span>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-surface-border">
        {/* grid teknesi — sakin, teknik bir zemin */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.16]" aria-hidden>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
              maskImage:
                "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
              WebkitMaskImage:
                "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
            }}
          />
        </div>

        <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-20 grid gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.28em] text-cyan-400 font-semibold">
              <span className="h-px w-8 bg-cyan-400/60" />
              Project 01 · Tactical simulation
            </div>

            <h1 className="mt-6 text-6xl sm:text-8xl font-black tracking-[-0.05em] leading-[0.92]">
              NEXUS
              <br />
              <span className="text-muted font-extrabold">2100</span>
            </h1>

            <p className="mt-7 max-w-xl text-base sm:text-lg leading-relaxed text-muted">
              Command a four-operator strike team in a living megacity. Rigged,
              animated operatives. Real environments. Cover, suppression and
              extraction — every shot has weight.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/games/nexus"
                className="rounded-sm px-8 py-4 font-bold text-xs uppercase tracking-[0.18em]
                  bg-cyan-400 text-slate-950 hover:bg-cyan-300
                  shadow-[0_0_36px_rgba(34,211,238,0.25)]
                  active:scale-[0.98] transition"
              >
                ▶ Deploy now
              </Link>
              <a
                href="#briefing"
                className="rounded-sm px-8 py-4 font-semibold text-xs uppercase tracking-[0.18em]
                  text-muted border border-surface-border hover:border-cyan-400/50 hover:text-foreground
                  active:scale-[0.98] transition"
              >
                Read the briefing
              </a>
            </div>
          </div>

          {/* sistem paneli */}
          <div className="card rounded-sm p-6 font-mono text-[11px] leading-relaxed border-surface-border">
            <div className="flex items-center justify-between pb-4 border-b border-surface-border">
              <span className="uppercase tracking-[0.2em] text-faint">System status</span>
              <span className="flex items-center gap-2 text-cyan-400">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                ONLINE
              </span>
            </div>
            <dl className="mt-4 space-y-3">
              {[
                ["Simulation", "NEXUS / district 07"],
                ["Operators", "4 · rigged + animated"],
                ["Environment", "authored modular geometry"],
                ["Lighting", "HDRI · PBR · dynamic shadows"],
                ["Input", "mouse + keyboard / touch"],
                ["Build", "0.1.0 · browser native"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-6">
                  <dt className="text-faint uppercase tracking-wider">{k}</dt>
                  <dd className="text-right text-foreground/90">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 pt-4 border-t border-surface-border text-[10px] text-faint">
              Rendering starts on deployment. No account, no download.
            </div>
          </div>
        </div>
      </section>

      {/* Briefing */}
      <section id="briefing" className="mx-auto max-w-6xl px-5 pt-16 pb-20">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-cyan-400 font-semibold">
              Mission brief
            </div>
            <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight">
              Built like a simulation, not a toy.
            </h2>
          </div>
          <Link href="/games/nexus" className="hidden sm:block text-xs text-muted hover:text-cyan-400 transition">
            Enter the field →
          </Link>
        </div>

        <div className="grid gap-px bg-surface-border border border-surface-border sm:grid-cols-3">
          {[
            [
              "01",
              "Real operators",
              "Rigged, animated human characters with locomotion states. They move, take cover and fall — no floating capsules.",
            ],
            [
              "02",
              "Living district",
              "Authored modular city geometry, proper materials, HDRI light and real-time shadows. The city is a tactical space.",
            ],
            [
              "03",
              "Consequence",
              "Line of sight, cover, ammo and wounded operators. Extraction is the objective — not a high-score grind.",
            ],
          ].map(([n, title, body]) => (
            <div key={n} className="bg-background p-6 sm:p-7">
              <div className="font-mono text-[11px] text-cyan-400">{n}</div>
              <h3 className="mt-4 text-lg font-bold tracking-tight">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Deploy */}
      <section className="border-t border-surface-border">
        <div className="mx-auto max-w-6xl px-5 py-16 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-faint">District 07 awaits</div>
            <p className="mt-2 text-xl font-bold tracking-tight">Your squad is ready.</p>
          </div>
          <Link
            href="/games/nexus"
            className="rounded-sm px-8 py-4 font-bold text-xs uppercase tracking-[0.18em]
              bg-cyan-400 text-slate-950 hover:bg-cyan-300 active:scale-[0.98] transition"
          >
            ▶ Deploy now
          </Link>
        </div>
      </section>

      <footer className="border-t border-surface-border py-8 text-center text-[10px] uppercase tracking-[0.2em] text-faint">
        Playverse · games from tomorrow · v1.0
      </footer>
    </main>
  );
}

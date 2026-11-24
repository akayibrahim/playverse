import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GAMES } from "@/lib/games";

export default function Home() {
  const live = GAMES.filter((g) => g.status === "live");
  const latest = live[live.length - 1];

  return (
    <main className="relative flex-1">
      {/* Nav */}
      <nav className="sticky top-0 z-20 backdrop-blur-md bg-background/70 border-b border-surface-border">
        <div className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="Playverse" width={26} height={26} className="drop-shadow-[0_0_8px_rgba(0,224,255,0.5)]" />
            <span className="font-extrabold tracking-[0.16em] text-sm uppercase">
              Play<span className="neon-text">verse</span>
            </span>
          </Link>
          <div className="flex items-center gap-5">
            <a href="#games" className="hidden sm:block text-[11px] uppercase tracking-[0.18em] text-muted hover:text-foreground transition">
              Games
            </a>
            <a href="#studio" className="hidden sm:block text-[11px] uppercase tracking-[0.18em] text-muted hover:text-foreground transition">
              Studio
            </a>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      {/* Hero — the studio, not a single game */}
      <section className="relative overflow-hidden border-b border-surface-border">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {live.map((g, i) => (
            <div key={g.slug} className="pv-slide absolute inset-0" style={{ animationDelay: `${-i * 8}s` }}>
              <Image src={g.cover} alt="" fill priority={i === 0} sizes="100vw" className="object-cover object-[70%_50%] opacity-70" />
            </div>
          ))}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/50" />
        </div>
        <div className="relative mx-auto max-w-6xl px-5 pt-24 pb-24 sm:pt-32 sm:pb-28">
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.28em] text-cyan-400 font-semibold">
            <span className="h-px w-8 bg-cyan-400/60" />
            Browser game studio
          </div>
          <h1 className="mt-6 max-w-3xl text-5xl sm:text-7xl font-black tracking-[-0.045em] leading-[0.95]">
            Games from <span className="neon-text">2100</span>.
          </h1>
          <p className="mt-7 max-w-xl text-base sm:text-lg leading-relaxed text-muted">
            Cinematic real-time 3D games set in one rain-soaked megacity. They run right here in your browser — no install, no
            account, no waiting.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a
              href="#games"
              className="rounded-sm px-8 py-4 font-bold text-xs uppercase tracking-[0.18em] bg-cyan-400 text-slate-950 hover:bg-cyan-300 shadow-[0_0_36px_rgba(34,211,238,0.25)] active:scale-[0.98] transition"
            >
              Browse games ↓
            </a>
            <Link
              href={`/games/${latest.slug}`}
              className="rounded-sm px-8 py-4 font-semibold text-xs uppercase tracking-[0.18em] text-foreground border border-surface-border hover:border-cyan-400/50 active:scale-[0.98] transition"
            >
              New · Play {latest.title} ▸
            </Link>
          </div>
          <dl className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-px max-w-2xl border border-surface-border bg-surface-border font-mono">
            {[
              [String(live.length), "games live"],
              ["60 fps", "WebGL2 · PBR · HDRI"],
              ["0 MB", "to install"],
              ["Desktop", "+ mobile touch"],
            ].map(([v, k]) => (
              <div key={k} className="bg-background/80 px-4 py-3">
                <dt className="text-lg font-bold tracking-tight text-foreground">{v}</dt>
                <dd className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-faint">{k}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Games — equal billing, real in-game shots */}
      <section id="games" className="mx-auto max-w-6xl px-5 pt-20 scroll-mt-16">
        <div className="flex items-end justify-between gap-6 mb-8">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-cyan-400 font-semibold">Now playing</div>
            <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight">Two ways into District 07.</h2>
          </div>
          <span className="hidden sm:block text-[10px] uppercase tracking-[0.2em] text-faint">Captured in-engine</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {live.map((g) => (
            <Link
              key={g.slug}
              href={`/games/${g.slug}`}
              className="group relative overflow-hidden rounded-sm border border-surface-border bg-black aspect-[4/5] sm:aspect-[16/11] flex flex-col justify-end"
              style={{ ["--ac" as string]: g.accent }}
            >
              <Image
                src={g.cover}
                alt={`${g.title} in-game`}
                fill
                sizes="(min-width:1024px) 560px, 100vw"
                className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.06]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 via-45% to-black/0" />
              <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
              <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                <span className="rounded-full border border-white/20 bg-black/40 backdrop-blur px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/90">
                  {g.genre}
                </span>
                {g.slug === latest.slug && live.length > 1 && (
                  <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-black" style={{ background: g.accent }}>
                    New
                  </span>
                )}
              </div>
              <div className="relative p-6 sm:p-7">
                <h3 className="text-3xl sm:text-4xl font-black tracking-[-0.03em] text-white">{g.title}</h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75">{g.pitch}</p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {g.features.map((f) => (
                    <li key={f} className="border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/80">
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex items-center gap-4">
                  <span
                    className="inline-flex items-center gap-2 rounded-sm px-6 py-3 text-xs font-bold uppercase tracking-[0.18em] text-black transition group-hover:brightness-110"
                    style={{ background: g.accent, boxShadow: `0 0 30px ${g.accent}40` }}
                  >
                    ▶ Play now
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">Free · in browser</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Studio pillars */}
      <section id="studio" className="mx-auto max-w-6xl px-5 pt-20 pb-20 scroll-mt-16">
        <div className="text-[10px] uppercase tracking-[0.28em] text-cyan-400 font-semibold">The studio</div>
        <h2 className="mt-2 mb-8 text-2xl sm:text-3xl font-extrabold tracking-tight">Built like games, not demos.</h2>
        <div className="grid gap-px bg-surface-border border border-surface-border sm:grid-cols-3">
          {[
            ["01", "Real engines, in a tab", "Physically based materials, HDRI lighting, real-time shadows, ragdoll physics and motion-captured animation — streamed into the browser."],
            ["02", "One city, many stories", "Every game shares District 07: the same rain, the same neon, the same streets — seen from a fireteam or a sniper nest."],
            ["03", "Made to be replayed", "Stars, medals, ranks and daily operations. Short sessions with real decisions, on desktop or phone."],
          ].map(([n, title, body]) => (
            <div key={n} className="bg-background p-6 sm:p-7">
              <div className="font-mono text-[11px] text-cyan-400">{n}</div>
              <h3 className="mt-4 text-lg font-bold tracking-tight">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-surface-border py-8 text-center text-[10px] uppercase tracking-[0.2em] text-faint">
        Playverse · games from tomorrow
      </footer>
    </main>
  );
}

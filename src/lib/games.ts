export type GameMeta = {
  slug: string;
  title: string;
  tagline: string;
  emoji: string;
  gradient: string;
  status: "live" | "soon";
};

/**
 * Oyun kayıt defteri.
 * Yeni oyun eklemek için buraya bir giriş ekle + src/games/<slug>.ts
 * içinde initGame modülü yaz; GameStage otomatik yükler.
 */
export const GAMES: GameMeta[] = [
  {
    slug: "runner",
    title: "Neon Runner",
    tagline: "Run the endless neon track — swipe between lanes, dodge asteroids.",
    emoji: "🏃",
    gradient: "from-violet-500/60 to-cyan-400/60",
    status: "live",
  },
  {
    slug: "orbiter",
    title: "Orbiter",
    tagline: "Play with gravity, stay in orbit, go as far as you can.",
    emoji: "🪐",
    gradient: "from-cyan-400/60 to-emerald-400/60",
    status: "live",
  },
  {
    slug: "sniper",
    title: "Ghost Range",
    tagline: "Dusk sniper range — real ballistics, wind, breath control.",
    emoji: "🎯",
    gradient: "from-orange-500/60 to-rose-500/60",
    status: "live",
  },
  {
    slug: "stacker",
    title: "Stack Tower",
    tagline: "One tap to drop the block — stack the perfect tower.",
    emoji: "🧱",
    gradient: "from-fuchsia-500/60 to-violet-500/60",
    status: "live",
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}

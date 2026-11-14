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
    tagline: "Sonsuz pistte koş, şerit değiştir, asteroidlerden kaç.",
    emoji: "🏃",
    gradient: "from-violet-500/60 to-cyan-400/60",
    status: "soon",
  },
  {
    slug: "orbiter",
    title: "Orbiter",
    tagline: "Yerçekimini kullan, yörüngede kal, en uzağa git.",
    emoji: "🪐",
    gradient: "from-cyan-400/60 to-emerald-400/60",
    status: "soon",
  },
  {
    slug: "stacker",
    title: "Stack Tower",
    tagline: "Tek dokunuşla bloğu bırak, kuleyi dik.",
    emoji: "🧱",
    gradient: "from-fuchsia-500/60 to-violet-500/60",
    status: "soon",
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}

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
 * içinde createGame modülü yaz; GameStage otomatik yükler.
 */
export const GAMES: GameMeta[] = [
  {
    slug: "nexus",
    title: "NEXUS 2100",
    tagline: "Squad tactics in a living megacity. Every shot has weight.",
    emoji: "🎖",
    gradient: "from-slate-500/50 to-cyan-700/40",
    status: "live",
  },
  {
    slug: "longshot",
    title: "LONGSHOT",
    tagline: "One nest, one bolt-action, a hundred metres of rain. Read the wind.",
    emoji: "🎯",
    gradient: "from-amber-500/40 to-slate-700/50",
    status: "live",
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}

export type GameMeta = {
  slug: string;
  title: string;
  tagline: string;
  emoji: string;
  gradient: string;
  status: "live" | "soon";
  /** vitrin (ana sayfa) */
  genre: string;
  cover: string;
  pitch: string;
  features: string[];
  accent: string;
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
    genre: "Squad tactical shooter",
    cover: "/assets/promo/nexus.webp",
    pitch: "Lead a three-operator fireteam down a rain-soaked boulevard. Clear the street, hold the uplink, get out alive.",
    features: ["Mocap + ragdoll physics", "Two districts", "Daily ops · global board"],
    accent: "#67e8f9",
  },
  {
    slug: "longshot",
    title: "LONGSHOT",
    tagline: "One nest, one bolt-action, a hundred metres of rain. Read the wind.",
    emoji: "🎯",
    gradient: "from-amber-500/40 to-slate-700/50",
    status: "live",
    genre: "Marksman",
    cover: "/assets/promo/longshot.webp",
    pitch: "A nest twelve metres up, a bolt-action and a hundred metres of rain. Read the wind, lead the walkers, take the shot.",
    features: ["Real ballistics · drop + wind", "Bullet cam", "Three contracts"],
    accent: "#fbbf24",
  },
  {
    slug: "velocity",
    title: "VELOCITY",
    tagline: "Anti-grav racing on neon sky-lanes, 300 km/h above the megacity.",
    emoji: "🏍",
    gradient: "from-fuchsia-500/40 to-cyan-700/40",
    status: "live",
    genre: "Anti-grav racer",
    cover: "/assets/promo/velocity.webp",
    pitch: "Banked neon lanes two hundred metres above District 07. Drift the corners to charge boost, out-ride five rivals, then chase your own ghost.",
    features: ["400 km/h boost", "Rivals + ghost", "Two circuits"],
    accent: "#ff3fc8",
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}

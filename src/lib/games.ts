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
  {
    slug: "echo",
    title: "ECHO",
    tagline: "Ninety seconds, the same murder, every loop — until you see it coming.",
    emoji: "⏳",
    gradient: "from-violet-500/40 to-amber-600/30",
    status: "live",
    genre: "Time-loop mystery",
    cover: "/assets/promo/echo.webp",
    pitch: "At 1:25 the councillor dies and the street rewinds. Watch through the scope, follow the amber case, rewind what you missed — then take the one shot that breaks the loop.",
    features: ["Rewind any moment", "Clues persist", "One round per loop"],
    accent: "#c4a1ff",
  },
  {
    slug: "gridlock",
    title: "GRIDLOCK",
    tagline: "Hold District 07 from the rooftops when the swarm comes down the avenues.",
    emoji: "🛡",
    gradient: "from-emerald-500/40 to-slate-700/50",
    status: "live",
    genre: "Tower defense",
    cover: "/assets/promo/gridlock.webp",
    pitch: "Night falls and the drone swarms pour down the avenues toward the reactor. Build turrets on the rooftops, chain the arcs, upgrade between waves and hold the core.",
    features: ["Rooftop height bonus", "Five tower lines", "Boss waves"],
    accent: "#4ade80",
  },
  {
    slug: "freefall",
    title: "FREEFALL",
    tagline: "Two kilometres of megacity straight down. Fly close, fly fast, pull late.",
    emoji: "🪂",
    gradient: "from-sky-500/40 to-fuchsia-600/30",
    status: "soon",
    genre: "Wingsuit dive",
    cover: "/assets/promo/freefall.webp",
    pitch: "Step off the top of the Spire and fall through District 07: thread the rings, skim the towers for proximity points and pull the chute as late as you dare.",
    features: ["Daily course", "Proximity scoring", "Ghost of your best dive"],
    accent: "#38bdf8",
  },
  {
    slug: "override",
    title: "OVERRIDE",
    tagline: "A palm-sized drone, a corporate tower and every camera inside it.",
    emoji: "🛰",
    gradient: "from-rose-500/40 to-slate-700/50",
    status: "soon",
    genre: "Stealth hacking",
    cover: "/assets/promo/override.webp",
    pitch: "Slip a micro-drone into the Halden Tower. Jack the cameras, ride the security robots, loop the lasers and reach the core without ever being seen.",
    features: ["Hack cameras + robots", "Three handcrafted floors", "Ghost rating"],
    accent: "#fb7185",
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}

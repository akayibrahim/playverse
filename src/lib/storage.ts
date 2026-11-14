/**
 * Playverse localStorage modülü.
 * Faz 1: skorlar + favoriler tamamen cihazda (DB yok).
 * Faz 2 (leaderboard): aynı anahtar isimleriyle sunucuya taşınabilir.
 */

const PREFIX = "playverse:";
const KEYS = {
  nickname: `${PREFIX}nickname`,
  favorites: `${PREFIX}favorites`,
  best: (slug: string) => `${PREFIX}best:${slug}`,
  lastPlayed: (slug: string) => `${PREFIX}lastPlayed:${slug}`,
} as const;

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* depolama dolu veya engelli — sessizce yut */
  }
}

/* ---------- Nickname ---------- */

export function getNickname(): string {
  return safeGet(KEYS.nickname) ?? "";
}

export function setNickname(name: string) {
  safeSet(KEYS.nickname, name.trim().slice(0, 16));
}

/* ---------- Favoriler ---------- */

export function getFavorites(): string[] {
  try {
    const raw = safeGet(KEYS.favorites);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(slug: string): string[] {
  const favs = getFavorites();
  const next = favs.includes(slug)
    ? favs.filter((s) => s !== slug)
    : [...favs, slug];
  safeSet(KEYS.favorites, JSON.stringify(next));
  return next;
}

/* ---------- Skorlar ---------- */

export function getBestScore(slug: string): number {
  const raw = safeGet(KEYS.best(slug));
  return raw ? Number(raw) || 0 : 0;
}

export function submitScore(slug: string, score: number): number {
  const best = getBestScore(slug);
  if (score > best) {
    safeSet(KEYS.best(slug), String(Math.floor(score)));
    safeSet(KEYS.lastPlayed(slug), String(Date.now()));
    return Math.floor(score); // yeni rekor
  }
  return best;
}

export function getAllBestScores(): Record<string, number> {
  if (typeof window === "undefined") return {};
  const out: Record<string, number> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(`${PREFIX}best:`)) {
        const slug = key.replace(`${PREFIX}best:`, "");
        out[slug] = Number(window.localStorage.getItem(key)) || 0;
      }
    }
  } catch {
    /* yut */
  }
  return out;
}

/** Faz 2'de bu fonksiyonun içi /api/scores'a POST'a dönüşecek. */
export async function publishScore(slug: string, score: number): Promise<number> {
  return submitScore(slug, score);
}

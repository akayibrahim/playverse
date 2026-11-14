"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GAMES } from "@/lib/games";
import { getAllBestScores, getFavorites, toggleFavorite } from "@/lib/storage";

function FavoriteStar({ slug }: { slug: string }) {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    setFavorites(getFavorites());
  }, []);

  const isFavorite = favorites.includes(slug);

  return (
    <button
      type="button"
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.preventDefault();
        setFavorites(toggleFavorite(slug));
      }}
      className="absolute top-3 right-3 z-10 p-2 text-lg leading-none
        opacity-70 hover:opacity-100 active:scale-125 transition"
    >
      {isFavorite ? "⭐" : "☆"}
    </button>
  );
}

export function GameGrid() {
  const [bestScores, setBestScores] = useState<Record<string, number>>({});

  useEffect(() => {
    setBestScores(getAllBestScores());
  }, []);

  return (
    <section
      aria-label="Games"
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
    >
      {GAMES.map((game) => (
        <Link
          key={game.slug}
          href={game.status === "live" ? `/games/${game.slug}` : "#"}
          className={`card relative overflow-hidden p-5 group ${
            game.status === "soon" ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <FavoriteStar slug={game.slug} />
          <div
            className={`h-28 rounded-lg mb-4 bg-gradient-to-br ${game.gradient}
              flex items-center justify-center text-5xl
              group-hover:scale-[1.02] transition`}
          >
            {game.emoji}
          </div>
          <h2 className="font-semibold text-lg">{game.title}</h2>
          <p className="mt-1 text-sm text-white/55">{game.tagline}</p>
          <p className="mt-3 text-xs">
            {game.status === "live" ? (
              bestScores[game.slug] ? (
                <span className="text-cyan-300">
                  🏆 Best: {bestScores[game.slug].toLocaleString("en-US")}
                </span>
              ) : (
                <span className="text-white/40">Play →</span>
              )
            ) : (
              <span className="text-white/40">Coming soon…</span>
            )}
          </p>
        </Link>
      ))}
    </section>
  );
}

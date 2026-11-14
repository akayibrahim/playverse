"use client";

import Link from "next/link";
import { GAMES } from "@/lib/games";
import { GameIcon } from "@/components/GameIcon";
import { getAllBestScores, getFavorites, toggleFavorite } from "@/lib/storage";
import { useEffect, useState } from "react";

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
      className="absolute top-3 right-3 z-10 p-2 text-base leading-none
        opacity-60 hover:opacity-100 active:scale-125 transition"
    >
      {isFavorite ? "⭐" : "☆"}
    </button>
  );
}

function StatusPill({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1
        text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm
        ${
          live
            ? "bg-emerald-400/15 text-emerald-300 border border-emerald-400/30"
            : "bg-white/10 text-white/50 border border-white/10"
        }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          live ? "bg-emerald-400 animate-pulse" : "bg-white/40"
        }`}
      />
      {live ? "Live" : "Soon"}
    </span>
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
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
    >
      {GAMES.map((game) => {
        const live = game.status === "live";
        return (
          <Link
            key={game.slug}
            href={live ? `/games/${game.slug}` : "#"}
            className={`group card relative overflow-hidden ${
              live ? "" : "pointer-events-none opacity-50"
            }`}
          >
            {/* Kart görseli */}
            <div
              className={`relative h-36 overflow-hidden bg-gradient-to-br ${game.gradient}`}
            >
              {/* karartma + glow */}
              <div className="absolute inset-0 bg-[#05060f]/55" />
              <div
                className="absolute -inset-8 opacity-40 blur-3xl
                  bg-[radial-gradient(circle_at_50%_60%,rgba(255,255,255,0.25),transparent_60%)]
                  group-hover:opacity-60 transition-opacity duration-500"
              />
              {/* ikon */}
              <div
                className="absolute inset-0 flex items-center justify-center
                  group-hover:scale-110 transition-transform duration-500"
              >
                <GameIcon slug={game.slug} className="h-16 w-16 drop-shadow-[0_0_18px_rgba(0,224,255,0.55)]" />
              </div>
              {/* shine sweep */}
              <div
                className="absolute inset-y-0 w-1/2 -translate-x-[150%]
                  group-hover:translate-x-[250%] transition-transform duration-700
                  bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12"
              />
              {/* badge'ler */}
              <div className="absolute top-3 left-3">
                <StatusPill live={live} />
              </div>
              <FavoriteStar slug={game.slug} />
            </div>

            {/* Bilgi alanı */}
            <div className="p-5">
              <h3 className="font-bold text-lg tracking-tight">
                {game.title}
              </h3>
              <p className="mt-1 text-sm text-white/50 leading-snug">
                {game.tagline}
              </p>
              <div className="mt-4 flex items-center justify-between">
                {live ? (
                  <>
                    {bestScores[game.slug] ? (
                      <span className="text-xs font-semibold text-cyan-300">
                        🏆 {bestScores[game.slug].toLocaleString("en-US")}
                      </span>
                    ) : (
                      <span className="text-xs text-white/35">
                        No score yet
                      </span>
                    )}
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5
                        text-xs font-bold text-white
                        bg-gradient-to-r from-violet-500 to-cyan-400
                        group-hover:brightness-125 active:scale-95 transition"
                    >
                      ▶ Play
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-white/30">In the workshop…</span>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

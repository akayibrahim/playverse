import Link from "next/link";
import { notFound } from "next/navigation";
import { GAMES, getGame } from "@/lib/games";
import { GameStage } from "@/components/GameStage";

export function generateStaticParams() {
  return GAMES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/games/[slug]">) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) return {};
  return { title: game.title, description: game.tagline };
}

export default async function GamePage({
  params,
}: PageProps<"/games/[slug]">) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) notFound();

  return (
    <main className="flex-1 flex flex-col">
      {/* Üst bar */}
      <header className="flex items-center gap-3 px-4 py-3">
        <Link
          href="/"
          className="card px-3 py-1.5 text-sm text-white/70 hover:text-white"
        >
          ← Oyunlar
        </Link>
        <h1 className="font-semibold">
          {game.emoji} {game.title}
        </h1>
      </header>

      {/* Oyun sahnesi */}
      <div className="flex-1 px-4 pb-6">
        <GameStage slug={game.slug} />
      </div>
    </main>
  );
}

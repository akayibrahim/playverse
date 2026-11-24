import Link from "next/link";
import { notFound } from "next/navigation";
import { GAMES, getGame } from "@/lib/games";
import { GameStage } from "@/components/GameStage";

// Game routes are fully client-rendered canvases; skip instant-navigation validation.
export const instant = false;

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
    <main className="flex-1 flex flex-col h-[100dvh] min-h-0">
      {/* Üst bar — kısa (yatay telefon) ekranlarda gizlenir, oyun tüm ekranı alır */}
      <header className="flex items-center gap-3 px-4 py-3 [@media(max-height:560px)]:hidden">
        <Link
          href="/"
          className="card px-3 py-1.5 text-sm text-muted hover:text-foreground"
        >
          ← Games
        </Link>
        <h1 className="font-semibold">
          {game.emoji} {game.title}
        </h1>
      </header>

      {/* Oyun sahnesi — kalan tüm yüksekliği kaplar */}
      <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 [@media(max-height:560px)]:p-0">
        <GameStage slug={game.slug} />
      </div>
    </main>
  );
}

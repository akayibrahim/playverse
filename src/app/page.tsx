import Image from "next/image";
import { GameGrid } from "@/components/GameGrid";

export default function Home() {
  return (
    <main className="flex-1 mx-auto w-full max-w-5xl px-5 pb-16">
      {/* Hero */}
      <header className="pt-14 pb-10 text-center">
        <Image
          src="/logo.svg"
          alt="Playverse logosu"
          width={72}
          height={72}
          className="mx-auto mb-4"
          priority
        />
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Play<span className="neon-text">verse</span>
        </h1>
        <p className="mt-3 text-sm sm:text-base text-white/60 max-w-md mx-auto">
          Tarayıcıda çalışan, mobil dostu 3D mini oyunlar. Kurulum yok,
          indirme yok — dokun ve oyna.
        </p>
      </header>

      {/* Oyun listesi */}
      <GameGrid />

      <footer className="mt-16 text-center text-xs text-white/30">
        Playverse · skorların cihazında saklanır · v0.1
      </footer>
    </main>
  );
}

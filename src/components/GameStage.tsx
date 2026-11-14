"use client";

import dynamic from "next/dynamic";

const Stage = dynamic(() => import("./StageCanvas"), {
  ssr: false,
  loading: () => (
    <div className="card h-[60vh] flex items-center justify-center text-white/40">
      Sahne yükleniyor…
    </div>
  ),
});

export function GameStage({ slug }: { slug: string }) {
  return <Stage slug={slug} />;
}

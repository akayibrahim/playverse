import type { MetadataRoute } from "next";
import { GAMES } from "@/lib/games";

// PWA: installable from the browser ("Install app" / "Add to Home Screen"); each game is a launcher shortcut.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Playverse — games from 2100",
    short_name: "Playverse",
    description: "Cinematic real-time 3D games set in one rain-soaked megacity. No install, no account.",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any",
    background_color: "#05060f",
    theme_color: "#05060f",
    categories: ["games", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: GAMES.filter((g) => g.status === "live").map((g) => ({
      name: g.title,
      short_name: g.title,
      description: g.tagline,
      url: `/games/${g.slug}`,
      icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    })),
  };
}

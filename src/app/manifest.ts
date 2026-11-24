import type { MetadataRoute } from "next";

// PWA: "Add to Home Screen" opens the game full-screen, landscape, without browser chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEXUS 2100 · Playverse",
    short_name: "NEXUS 2100",
    description: "Squad tactics in a rain-soaked megacity. Real-time 3D in your browser.",
    start_url: "/games/nexus",
    scope: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#05060f",
    theme_color: "#05060f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

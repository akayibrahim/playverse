"use client";

import { useEffect } from "react";

/** Registers the PWA service worker in production builds only (dev HMR stays uncached). */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const reg = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") reg();
    else window.addEventListener("load", reg, { once: true });
  }, []);
  return null;
}

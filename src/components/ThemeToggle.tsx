"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "playverse:theme";

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dispatchEvent(new CustomEvent("pv-theme"));
}

/** 3'lü tema seçici — System / Light / Dark. Varsayılan: system. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Theme | null) ?? "system";
    setTheme(saved);
    apply(saved);
    // system modundayken OS değişimini takip et
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      const current =
        (localStorage.getItem(KEY) as Theme | null) ?? "system";
      if (current === "system") apply("system");
    };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, []);

  const options: { key: Theme; icon: string; label: string }[] = [
    { key: "system", icon: "🖥", label: "System theme" },
    { key: "light", icon: "☀️", label: "Light theme" },
    { key: "dark", icon: "🌙", label: "Dark theme" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-full border border-surface-border bg-surface p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={theme === o.key}
          aria-label={o.label}
          title={o.label}
          onClick={() => {
            setTheme(o.key);
            localStorage.setItem(KEY, o.key);
            apply(o.key);
          }}
          className={`rounded-full px-2.5 py-1 text-xs leading-none transition
            ${
              theme === o.key
                ? "bg-accent text-white shadow-sm"
                : "opacity-55 hover:opacity-100"
            }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

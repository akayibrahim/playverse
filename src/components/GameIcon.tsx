/** Her oyun için özel çizilmiş neon SVG ikon — emoji yok */
export function GameIcon({ slug, className }: { slug: string; className?: string }) {
  if (slug === "runner") {
    return (
      <svg viewBox="0 0 64 64" fill="none" className={className}>
        {/* gemi */}
        <path d="M40 32 L14 22 L20 32 L14 42 Z" fill="#00e0ff" />
        <path d="M40 32 L14 22 L20 32 Z" fill="#00e0ff" opacity="0.85" />
        <circle cx="40" cy="32" r="3.4" fill="#bff6ff" />
        {/* iz */}
        <path d="M12 32 H2" stroke="#7c5cff" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
        <path d="M8 26 H-1" stroke="#7c5cff" strokeWidth="2" strokeLinecap="round" opacity="0.5" transform="translate(6 0)" />
        <path d="M8 38 H1" stroke="#7c5cff" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        {/* hız çizgileri */}
        <path d="M56 24 H46" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
        <path d="M58 32 H48" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <path d="M56 40 H46" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
      </svg>
    );
  }
  if (slug === "orbiter") {
    return (
      <svg viewBox="0 0 64 64" fill="none" className={className}>
        <circle cx="32" cy="32" r="13" fill="url(#og)" />
        <defs>
          <radialGradient id="og" cx="0.35" cy="0.3">
            <stop offset="0" stopColor="#00e0ff" />
            <stop offset="1" stopColor="#7c5cff" />
          </radialGradient>
        </defs>
        <ellipse cx="32" cy="32" rx="24" ry="9" stroke="#00e0ff" strokeWidth="2.4" strokeLinecap="round" transform="rotate(-16 32 32)" />
        <circle cx="52" cy="26" r="3" fill="#00e0ff" />
      </svg>
    );
  }
  /* stacker */
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <rect x="20" y="40" width="26" height="9" rx="2.5" fill="#e879f9" />
      <rect x="17" y="28" width="30" height="9" rx="2.5" fill="#c026d3" />
      <rect x="22" y="16" width="20" height="9" rx="2.5" fill="#f0abfc" />
      <rect x="26" y="6" width="12" height="7" rx="2" fill="#f5d0fe" />
    </svg>
  );
}

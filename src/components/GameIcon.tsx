/** Oyun kartları için çizilmiş ikonlar — emoji yok */
export function GameIcon({ slug, className }: { slug: string; className?: string }) {
  if (slug === "nexus") {
    return (
      <svg viewBox="0 0 64 64" fill="none" className={className}>
        {/* dört operatörden oluşan squad + nişan halkası */}
        <circle cx="32" cy="32" r="22" stroke="#67e8f9" strokeWidth="1.6" opacity="0.55" />
        <circle cx="32" cy="32" r="13" stroke="#22d3ee" strokeWidth="1" opacity="0.35" strokeDasharray="3 4" />
        <path d="M32 4 V14 M32 50 V60 M4 32 H14 M50 32 H60" stroke="#67e8f9" strokeWidth="1.8" opacity="0.7" />
        {[
          [23, 23],
          [41, 23],
          [23, 41],
          [41, 41],
        ].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="3.4" fill={i === 0 ? "#e2f9ff" : "#22d3ee"} />
            <path d={`M${x} ${y + 5} v7`} stroke="#22d3ee" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
          </g>
        ))}
        <circle cx="32" cy="32" r="1.8" fill="#f8fafc" />
      </svg>
    );
  }
  if (slug === "longshot") {
    return (
      <svg viewBox="0 0 64 64" fill="none" className={className}>
        {/* dürbün: mil çizgileri + düşüş işaretleri, ortada hedef silüeti */}
        <circle cx="32" cy="32" r="24" stroke="#fbbf24" strokeWidth="1.8" opacity="0.7" />
        <path d="M8 32 H25 M39 32 H56 M32 8 V25 M32 39 V56" stroke="#fde68a" strokeWidth="1.6" opacity="0.85" />
        <path d="M32 25 V39 M25 32 H39" stroke="#fef3c7" strokeWidth="0.8" />
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M${29 - i} ${36 + i * 3} H${35 + i}`} stroke="#fde68a" strokeWidth="0.9" opacity="0.8" />
        ))}
        <circle cx="40.5" cy="21" r="2.3" fill="#f87171" />
        <path d="M40.5 24 v6" stroke="#f87171" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="32" cy="32" r="1.3" fill="#ef4444" />
      </svg>
    );
  }
  if (slug === "velocity") {
    return (
      <svg viewBox="0 0 64 64" fill="none" className={className}>
        {/* perspektif şerit + hız çizgileri */}
        <path d="M8 54 L28 18 M56 54 L36 18" stroke="#22d3ee" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M32 22 V28 M32 34 V42 M32 48 V56" stroke="#f0abfc" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 30 H18 M4 38 H14 M50 26 H60 M52 34 H62" stroke="#f0abfc" strokeWidth="1.2" opacity="0.6" strokeLinecap="round" />
        <circle cx="27" cy="46" r="3" fill="#22d3ee" />
        <circle cx="37" cy="46" r="3" fill="#22d3ee" />
        <path d="M26 41 h12 l-2 -4 h-8 z" fill="#e2e8f0" />
      </svg>
    );
  }
  if (slug === "echo") {
    return (
      <svg viewBox="0 0 64 64" fill="none" className={className}>
        {/* geri saran saat: yarım halka + ok, ortada hedef */}
        <path d="M14 32 A18 18 0 1 0 22 17" stroke="#c4a1ff" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M22 9 L22 17 L14 17" stroke="#c4a1ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 21 V32 L40 37" stroke="#fde68a" strokeWidth="2" strokeLinecap="round" />
        <circle cx="32" cy="32" r="2" fill="#fbbf24" />
        <path d="M47 47 l6 6" stroke="#ff6b74" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      </svg>
    );
  }
  return null;
}

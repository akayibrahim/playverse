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
  return null;
}

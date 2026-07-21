// The AI feature's mark — a faceted diamond/gem, not a sparkle-in-a-circle.
// Replaces the old pulsing-glow orb per direct user request ("a diamond
// logo for our AI and no glow"): a static, tasteful mark instead of an
// animated hotspot. Purple gradient fill (--ai-accent/--ai-accent-2, the
// app's one consistent AI hue) with a few translucent facet lines for
// dimension — reads as a small logo, not a button shape.
export default function AiDiamondMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="aiDiamondGrad" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ai-accent-2)" />
          <stop offset="0.55" stopColor="var(--ai-accent)" />
          <stop offset="1" stopColor="#5B1FC9" />
        </linearGradient>
      </defs>
      <path d="M9 3H15L20 8L12 21L4 8Z" fill="url(#aiDiamondGrad)" />
      <path
        d="M4 8H20M9 3L12 21M15 3L12 21"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="0.6"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

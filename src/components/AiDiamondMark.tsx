// The AI feature's mark — a plain, symmetric diamond (a rotated square),
// not a sparkle-in-a-circle. Replaces the old pulsing-glow orb per direct
// user request ("a diamond logo for our AI and no glow"). Kept deliberately
// simple after the first pass (a faceted gem silhouette with internal facet
// lines) read as busy at icon size — one clean shape, one soft gradient, no
// detail lines, no animation.
export default function AiDiamondMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="aiDiamondGrad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--ai-accent-2)" />
          <stop offset="1" stopColor="var(--ai-accent)" />
        </linearGradient>
      </defs>
      <path d="M12 3L21 12L12 21L3 12Z" fill="url(#aiDiamondGrad)" />
    </svg>
  );
}

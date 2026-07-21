// Simple, solid-filled SVG icons for the bottom nav's Discover/Favourites
// slots — Ikonate has no filled compass/heart variant, so these fill the
// gap. Deliberately plain single-shape silhouettes (no internal facet/detail
// lines) so they read cleanly at 20px and match the weight of Ikonate's own
// -fill glyphs (used for Reserve/Tickets, see App.tsx).
export function IconHomeFill({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 3.2 3 11h2.5v8.3a1 1 0 0 0 1 1H9.8v-6.1h4.4v6.1H18.5a1 1 0 0 0 1-1V11H22z" fill="currentColor" />
    </svg>
  );
}

export function IconHeartFill({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 20.6 10.5 19.2C5.4 14.6 2 11.5 2 7.7 2 4.6 4.4 2.2 7.5 2.2c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1 3.1 0 5.5 2.4 5.5 5.5 0 3.8-3.4 6.9-8.5 11.5z" fill="currentColor" />
    </svg>
  );
}

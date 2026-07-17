// The EventDetail route is code-split (see main.tsx). This factory is the
// single import used both to lazy-load it there and to warm the chunk from
// event cards (Stub/Explore) on pointerdown/hover — so the card→hero
// layoutId morph has its target mounted the instant the route swaps. Kept in
// its own leaf module (not exported from main.tsx) so a card component never
// has to import the app entry, which would re-run createRoot() under HMR.
export const preloadEventDetail = () => import("./pages/EventDetail");

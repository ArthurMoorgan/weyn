import { useLocation } from "react-router-dom";
import { usePrefersReducedMotion } from "./index";

// A thin progress bar sweeping across the top of the screen on every route
// change — the "something is happening" cue for navigation, replacing a
// content cross-fade (see pageVariants in motion/index.ts, which no longer
// touches opacity at all). Keying the div on the pathname forces a fresh
// mount on every navigation, which restarts the CSS animation from scratch
// — simpler and more reliable than hand-rolling a JS progress state machine
// for what's ultimately a fixed, fake-progress sweep (most routes are
// already-loaded chunks with nothing real to report progress on).
export default function PageLoadBar() {
  const location = useLocation();
  const reduced = usePrefersReducedMotion();
  if (reduced) return null;
  return <div className="page-load-bar" key={location.pathname} aria-hidden="true" />;
}

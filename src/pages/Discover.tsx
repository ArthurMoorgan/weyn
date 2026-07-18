import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Explore from "./Explore";
import Skeleton from "../components/Skeleton";
import UserAvatar from "../components/UserAvatar";
import { useAccount } from "../store";

// Reservations (venue browsing) is now folded into Discover as a second
// mode rather than living on its own bottom-tab slot — events and venues
// are the same "what's on near me" intent, so switching between them is a
// segmented toggle at the top, not a separate destination. Reservations
// stays lazy: a visitor who never flips to Venues never downloads it.
const Reservations = lazy(() => import("./Reservations"));

// How long the toggle-switch skeleton stays up before crossfading to real
// content. The reference video holds its skeleton for ~2.3-2.9s per switch,
// but that's real network latency (District is fetching over the wire);
// Weyn's Events/Venues toggle has no such wait once Venues' chunk is
// downloaded, so a literally-as-long synthetic delay would read as a fake
// spinner rather than matching the video's *feel*. This is a deliberate,
// shorter middle ground — long enough to register as an intentional
// loading beat (and be reliably screenshot-able) without feeling sluggish
// on an already-fast switch. For Venues' first-ever visit, the lazy chunk
// can still take longer than this to download: Suspense's own fallback
// (the same "discover" skeleton) keeps covering that case once this timer
// ends.
const SWITCH_SKELETON_MS = 900;

export default function Discover() {
  const [mode, setMode] = useState<"events" | "venues">("events");
  const [switching, setSwitching] = useState(false);
  const account = useAccount();
  const location = useLocation();

  // Re-hue .shell's ambient glow (see .shell::before, components.css) to
  // match whichever mode is active — Discover stays mounted once visited
  // (see App.tsx's MAIN_TABS), so this only touches the shared glow while
  // Discover's own route is on screen, and hands it back to the default
  // purple the moment the visitor navigates to another bottom tab.
  useEffect(() => {
    if (location.pathname !== "/") return;
    const shell = document.querySelector(".shell");
    shell?.setAttribute("data-ambient", mode);
    return () => shell?.removeAttribute("data-ambient");
  }, [mode, location.pathname]);

  // Re-trigger the bloom keyframes (see .shell.ambient-pulse, components.css)
  // on every mode switch — a plain CSS custom-property transition alone is
  // a flat fade, not the spike-then-settle "bloom" the reference video
  // shows. Toggling the class off/on (via a rAF so the browser sees the
  // removal before the re-add) restarts the animation even when switching
  // back to a mode it's already mid-fade toward.
  useEffect(() => {
    if (location.pathname !== "/") return;
    const shell = document.querySelector(".shell");
    if (!shell) return;
    shell.classList.remove("ambient-pulse");
    const raf = requestAnimationFrame(() => shell.classList.add("ambient-pulse"));
    const t = setTimeout(() => shell.classList.remove("ambient-pulse"), 900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [mode, location.pathname]);

  // Every Events⇄Venues switch briefly shows a skeleton before crossfading
  // to real content, matching the reference video's every-switch behavior
  // (not just Venues' first, chunk-download visit).
  useEffect(() => {
    if (!switching) return;
    const t = setTimeout(() => setSwitching(false), SWITCH_SKELETON_MS);
    return () => clearTimeout(t);
  }, [switching]);

  function selectMode(next: "events" | "venues") {
    if (next === mode) return;
    setMode(next);
    setSwitching(true);
  }

  return (
    <>
      <div className="discover-head">
        <div className="seg-toggle" role="tablist" aria-label="Browse">
          {/* Sliding thumb — a single element that transforms between the
              two slot positions, rather than each button re-painting its
              own background on click, is what actually reads as "sliding"
              instead of an instant color swap. */}
          <div className={"seg-toggle-thumb" + (mode === "venues" ? " slot-2" : "")} aria-hidden="true" />
          <button
            role="tab"
            aria-selected={mode === "events"}
            className={"seg-btn seg-btn-events" + (mode === "events" ? " on" : "")}
            onClick={() => selectMode("events")}
          >
            Events
          </button>
          <button
            role="tab"
            aria-selected={mode === "venues"}
            className={"seg-btn seg-btn-venues" + (mode === "venues" ? " on" : "")}
            onClick={() => selectMode("venues")}
          >
            Venues
          </button>
        </div>
        <div className="discover-head-actions">
          <Link to="/concierge" className="ex-hero-link">Ask our AI</Link>
          <Link to="/host/events" className="ex-hero-host">Host <i className="icon-arrow-right" /></Link>
          <UserAvatar account={account} />
        </div>
      </div>

      {/* key={mode} + .discover-mode's rise-in animation (same entrance
          motion as feed cards elsewhere) gives the Events/Venues content
          swap a real transition instead of an instant hard cut, matching
          the thumb slide above it. The inner key (loading vs. ready)
          remounts separately from that, so the skeleton-to-content swap
          gets its own crossfade instead of jumping straight to real
          content mid rise-in. */}
      <div key={mode} className="discover-mode">
        <div key={switching ? "loading" : "ready"} className="discover-mode-frame">
          {switching ? (
            <Skeleton variant="discover" />
          ) : mode === "events" ? (
            <Explore embedded />
          ) : (
            <Suspense fallback={<Skeleton variant="discover" />}>
              <Reservations embedded />
            </Suspense>
          )}
        </div>
      </div>
    </>
  );
}

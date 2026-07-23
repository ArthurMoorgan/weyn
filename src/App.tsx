import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import Discover from "./pages/Discover";
import { IconHomeFill, IconHeartFill, IconStoreFill, IconTicketFill } from "./components/NavIcons";
import Skeleton from "./components/Skeleton";
import ThemeToggle from "./components/ThemeToggle";
import CityPill from "./components/CityPill";
import { useAccount } from "./store";
import { MotionButton, MotionNavLink, MotionLink, usePrefersReducedMotion, shellEntrance, settleSpring } from "./motion";
import { splashActive, onSplashExit } from "./splash";

// Lazy, same as every other non-critical-path route (see main.tsx) — these
// just aren't *routed* through main.tsx anymore, App renders them directly.
const Tickets = lazy(() => import("./pages/Tickets"));
const You = lazy(() => import("./pages/You"));
const Concierge = lazy(() => import("./pages/Concierge"));

// Profile deliberately isn't a bottom-tab slot — it's reached from the
// top-right avatar (see PageTopBar / Discover's header) so the persistent
// nav stays down to the two "what's on / what I've got" browse intents plus
// Host, and the profile entry point lives once, at the top, instead of
// competing in two places.
// Events and Venues are now two top-level destinations (was one "Discover"
// tab with an in-header Events/Venues toggle). The AI helper (was a top-bar
// icon) is a tab here too. `filled` marks tabs that have an -icon-fill
// variant for the selected state; the rest read selection through the
// dim->bright color + scale cue in .tab/.tab.on (components.css).
const TABS = [
  { to: "/", icon: "calendar", label: "Events", filled: true },
  { to: "/venues", icon: "store", label: "Venues", filled: true },
  { to: "/tickets", icon: "ticket", label: "Tickets", filled: true },
  { to: "/concierge", icon: "sparkles", label: "AI", filled: true },
];

// Mobile bottom nav (<900px) — a floating pill again, per a specific later
// design reference (not a repeat of the earlier floating-pill+separate-
// AI-circle experiment that read as "weird"/too novel — this is one
// consistent pill this time, matching the reference exactly). AI moved out
// of here per direct instruction — it now lives at the top next to the
// profile avatar (see Discover.tsx/Reservations.tsx headers), same reasoning
// this file already applied to Profile above: "the entry point lives once,
// at the top, instead of competing in two places." 4 tabs, not 5. Every icon
// is a solid/filled glyph, theme-aware ink color (see .bottom-bar-item in
// components.css) — Ikonate's -fill variants for store/ticket, custom
// simple SVGs (NavIcons.tsx) for compass/heart (no filled Ikonate variant
// exists).
const BOTTOM_TABS = [
  { to: "/", end: true, label: "Discover", Glyph: IconHomeFill },
  { to: "/venues", end: false, label: "Reserve", Glyph: IconStoreFill },
  { to: "/saved", end: false, label: "Favourites", Glyph: IconHeartFill },
  { to: "/tickets", end: false, label: "Tickets", Glyph: IconTicketFill },
];

// Hosting an event and listing a venue are different setup flows with
// different forms behind them — collapsing them into one tab meant either
// picking one (burying the other) or landing on a chooser page. A short
// popover lets Host stay a single tab-bar slot while still sending each
// intent straight to its own flow.
const HOST_OPTIONS = [
  { to: "/host/events", icon: "calendar-plus", label: "Host an event", hint: "Gigs, nights out, workshops — anything ticketed" },
  { to: "/host/venue", icon: "store", label: "List a venue", hint: "Tables and reservations for a cafe, restaurant or lounge" },
];

// The bottom-tab pages, kept mounted once visited instead of unmounting on
// every switch — a plain <Outlet/> would tear down and rebuild Discover's
// feed, You's tab state, etc. every time, losing scroll position and
// re-fetching data each visit. Each one mounts on first visit, then just
// toggles display on further switches — "stays loaded until you close the
// app," matching how native tab-bar apps behave. Nested subpages
// (/saved, /host/events, /admin, …) are NOT part of this — those mount
// fresh via the normal <Outlet/> below.
// Venues is no longer a kept-mounted tab — it's a normal pushed route
// (like /host/events) reached by tapping the home hub's Venues tile, so it
// gets a real page transition + icon morph instead of an instant tab-swap.
const MAIN_TABS: { path: string; Component: React.ComponentType }[] = [
  { path: "/", Component: Discover },
  { path: "/tickets", Component: Tickets },
  { path: "/you", Component: You },
  { path: "/concierge", Component: Concierge },
];

// Hold the shell hidden while the splash still covers it, then surface it up in
// the same window the splash lifts off (see splash.ts / index.html) so the
// handoff reads as one motion. A load with no splash — already dismissed, or
// reduced motion — goes straight to rest with no entrance.
function useShellEntrance() {
  const reduced = usePrefersReducedMotion();
  // Snapshot at mount: only play the entrance if the splash is actually still
  // over us. Recomputing per render could flip mid-exit.
  const [holds] = useState(() => !reduced && splashActive());
  const [entered, setEntered] = useState(!holds);
  useEffect(() => {
    if (!holds) { setEntered(true); return; }
    return onSplashExit(() => setEntered(true));
  }, [holds]);
  return { holds, entered };
}

export default function App() {
  const { holds, entered } = useShellEntrance();
  const location = useLocation();
  const account = useAccount();
  const activeMainTab = MAIN_TABS.find((t) => t.path === location.pathname);
  const [visited, setVisited] = useState<Set<string>>(() => new Set(activeMainTab ? [activeMainTab.path] : []));
  const [hostOpen, setHostOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const onHostRoute = location.pathname.startsWith("/host");

  useEffect(() => {
    if (activeMainTab && !visited.has(activeMainTab.path)) {
      setVisited((prev) => new Set(prev).add(activeMainTab.path));
    }
  }, [activeMainTab, visited]);

  useEffect(() => {
    if (!hostOpen) return;
    const close = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setHostOpen(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setHostOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [hostOpen]);

  useEffect(() => { setHostOpen(false); }, [location.pathname]);

  return (
    <motion.div
      className="shell"
      variants={shellEntrance}
      initial={holds ? "hidden" : false}
      animate={entered ? "shown" : "hidden"}
      transition={settleSpring}
    >
      {MAIN_TABS.map(({ path, Component }) =>
        visited.has(path) ? (
          <div key={path} className="tab-page" data-active={location.pathname === path}>
            {/* Skeleton fallback (not the Weyn logo) while a first-visited
                tab's lazy chunk downloads — a layout-matched skeleton reads
                as the page arriving, and the logo no longer flashes on every
                first tab switch. Per-tab variant so the skeleton mirrors that
                tab's real chrome. */}
            <Suspense
              fallback={
                <Skeleton
                  variant={
                    path === "/tickets" ? "tickets" : path === "/you" ? "profile" : path === "/concierge" ? "generic" : "discover"
                  }
                />
              }
            >
              <Component />
            </Suspense>
          </div>
        ) : null
      )}
      {/* Drilled-in routes (/saved, /host/*, /admin, …) render here. Their
          own Suspense boundary — with a skeleton, not the logo — so the
          floating nav stays put while a drilled route's chunk loads, instead
          of the whole shell being replaced by a full-page fallback. */}
      {!activeMainTab && (
        <Suspense fallback={<Skeleton variant="generic" />}>
          <Outlet />
        </Suspense>
      )}
      {/* Mobile (<900px): Instagram-style bottom bar — full-width, fixed to
          the screen edge, always visible, icon-only (selection reads through
          outline->fill). Desktop (>=900px): a normal top bar — logo left,
          labeled inline links, city/theme/avatar utility cluster right (see
          the >=900px block in components.css). Stretching the mobile bottom
          bar full-width across a desktop viewport (the previous pass) left
          4 icons rattling around in a huge empty bar — not a real desktop
          nav pattern; top bars are. Same <nav>, same links, CSS repositions
          it per breakpoint — .tab span (the label) is always in the DOM,
          just hidden below 900px, so there's one source of truth per tab. */}
      <nav className="tabs">
        <div className="sidebar-brand brand">
          <i className="icon-sparkles" />
          <span className="en">Weyn</span>
          <span className="ar">وين؟</span>
        </div>
        <div className="tabs-pill">
          {TABS.map((t) => (
            <MotionNavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) => "tab" + (isActive ? " on" : "")}
              aria-label={t.label}
            >
              {({ isActive }) => (
                <>
                  {/* Outline glyph when inactive, solid fill when selected
                      (iOS/Instagram tab-bar convention) — but only for tabs
                      that actually have a *-fill variant in ikonate.css.
                      Fill-less tabs (Events/Venues) show selection through the
                      dim->bright color + scale cue in .tab.on instead, so the
                      glyph never blanks out to a missing icon-*-fill class. */}
                  <i className={"icon-" + t.icon + (isActive && t.filled ? "-fill" : "")} />
                  <span>{t.label}</span>
                </>
              )}
            </MotionNavLink>
          ))}
          <div className="tab-host" ref={hostRef}>
            <MotionButton
              type="button"
              className={"tab" + (onHostRoute ? " on" : "")}
              aria-haspopup="menu"
              aria-expanded={hostOpen}
              aria-label="Host"
              onClick={() => setHostOpen((v) => !v)}
            >
              <i className={"icon-circle-plus" + (onHostRoute ? "-fill" : "")} />
              <span>Host</span>
            </MotionButton>
            {hostOpen && (
              <>
                {/* Dimmed backdrop so it's visually obvious the popover is a
                    dismissable overlay, not stray floating content — the
                    outside-tap-to-close behavior already existed (the
                    pointerdown listener above), but with nothing behind it
                    darkened there was no visual cue that tapping away would
                    close it, and no explicit close control either. Matches
                    the same backdrop+close convention as the filter sheet
                    and the city/notifications popovers elsewhere. */}
                <div className="tab-host-backdrop" onClick={() => setHostOpen(false)} aria-hidden="true" />
                <div className="tab-host-menu" role="menu">
                  <div className="tab-host-menu-head">
                    <span>Get started</span>
                    <MotionButton type="button" className="icon-btn sm" onClick={() => setHostOpen(false)} aria-label="Close">
                      <i className="icon-x" />
                    </MotionButton>
                  </div>
                  {HOST_OPTIONS.map((o) => (
                    <MotionLink key={o.to} to={o.to} className="tab-host-item" role="menuitem" onClick={() => setHostOpen(false)}>
                      <i className={"icon-" + o.icon} />
                      <div>
                        <strong>{o.label}</strong>
                        <span>{o.hint}</span>
                      </div>
                    </MotionLink>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {/* Desktop-only (see .tabs-right in components.css, hidden below
            900px) — city, theme, and account. Host lives in .tab-host above
            (rendered on both mobile and desktop), so no separate host link
            needed here. */}
        <div className="tabs-right">
          <CityPill />
          <ThemeToggle />
          <Link to="/you" className="tb-avatar" aria-label="Profile">
            {account?.picture ? <img src={account.picture} alt="" /> : <i className="icon-circle-user" />}
          </Link>
        </div>
      </nav>

      {/* Mobile bottom nav (hidden >=900px, where .tabs above is the top bar
          instead) — a normal, full-width, edge-docked bar. Same 5 icons as
          the earlier floating-pill version, just back in a standard bar
          shape per direct feedback. */}
      <nav className="bottom-bar" aria-label="Primary">
        {BOTTOM_TABS.map((t) => (
          <MotionNavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => "bottom-bar-item" + (isActive ? " on" : "")}
            aria-label={t.label}
            onPointerDown={t.to === "/concierge" ? () => { import("./pages/Concierge"); } : undefined}
            onMouseEnter={t.to === "/concierge" ? () => { import("./pages/Concierge"); } : undefined}
          >
            <span className="bottom-bar-icwrap">
              <t.Glyph className="bottom-bar-svg" />
            </span>
            <span className="bottom-bar-label">{t.label}</span>
          </MotionNavLink>
        ))}
      </nav>
    </motion.div>
  );
}

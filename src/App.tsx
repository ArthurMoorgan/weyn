import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import Discover from "./pages/Discover";
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

// Profile deliberately isn't a bottom-tab slot — it's reached from the
// top-right avatar (see PageTopBar / Discover's header) so the persistent
// nav stays down to the two "what's on / what I've got" browse intents plus
// Host, and the profile entry point lives once, at the top, instead of
// competing in two places.
const TABS = [
  { to: "/", icon: "sparkles", label: "Discover" },
  { to: "/tickets", icon: "ticket", label: "Tickets" },
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
const MAIN_TABS: { path: string; Component: React.ComponentType }[] = [
  { path: "/", Component: Discover },
  { path: "/tickets", Component: Tickets },
  { path: "/you", Component: You },
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
            <Suspense fallback={<Skeleton variant={path === "/tickets" ? "tickets" : path === "/you" ? "profile" : "discover"} />}>
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
                      (iOS/Instagram tab-bar convention) — the *-fill
                      variants live in ikonate.css. */}
                  <i className={"icon-" + t.icon + (isActive ? "-fill" : "")} />
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
    </motion.div>
  );
}

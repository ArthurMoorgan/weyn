import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import Discover from "./pages/Discover";
import Skeleton from "./components/Skeleton";
import ThemeToggle from "./components/ThemeToggle";
import CityPill from "./components/CityPill";
import { useAccount } from "./store";

// Lazy, same as every other non-critical-path route (see main.tsx) — these
// just aren't *routed* through main.tsx anymore, App renders them directly.
const Tickets = lazy(() => import("./pages/Tickets"));
const You = lazy(() => import("./pages/You"));

const TABS = [
  { to: "/", icon: "sparkles", label: "Discover" },
  { to: "/tickets", icon: "ticket", label: "Tickets" },
  { to: "/you", icon: "user", label: "Profile" },
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

export default function App() {
  const location = useLocation();
  const account = useAccount();
  const activeMainTab = MAIN_TABS.find((t) => t.path === location.pathname);
  const [visited, setVisited] = useState<Set<string>>(() => new Set(activeMainTab ? [activeMainTab.path] : []));
  const [hostOpen, setHostOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const onHostRoute = location.pathname.startsWith("/host");
  // Which slot the sliding highlight pill (.tab-indicator) sits behind —
  // TABS' own order (Discover/Tickets/Profile), with Host as the 4th slot
  // since it renders after them in the same row. -1 means nothing in the
  // row is active (e.g. a route inside neither, like /saved) — the
  // indicator just hides itself rather than resting on a wrong tab.
  const activeTabIndex = onHostRoute
    ? TABS.length
    : TABS.findIndex((t) => (t.to === "/" ? location.pathname === "/" : location.pathname.startsWith(t.to)));

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
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [hostOpen]);

  useEffect(() => { setHostOpen(false); }, [location.pathname]);

  // Auto-hiding nav (Uber/Apple convention): slides away while scrolling
  // down (content gets the full screen), returns the instant the user
  // scrolls up, reaches the top, or changes route. Capture-phase listener so
  // scrolling inside any nested container counts, not just window. A 6px
  // dead-zone filters out sub-pixel jitter and iOS rubber-banding; the
  // 64px top guard keeps the bar pinned while the page has barely moved.
  const [navHidden, setNavHidden] = useState(false);
  const lastYRef = useRef(0);
  useEffect(() => {
    function scrollTopOf(e: Event): number {
      const t = e.target;
      if (t instanceof Element) return t.scrollTop;
      return window.scrollY;
    }
    function onScroll(e: Event) {
      const y = scrollTopOf(e);
      const dy = y - lastYRef.current;
      lastYRef.current = y;
      if (y < 64 || dy < -6) setNavHidden(false);
      else if (dy > 6) setNavHidden(true);
    }
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, []);
  useEffect(() => { setNavHidden(false); lastYRef.current = 0; }, [location.pathname]);

  return (
    <div className="shell">
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
      <nav className="tabs" data-hidden={navHidden}>
        <div className="sidebar-brand brand">
          <i className="icon-sparkles" />
          <span className="en">Weyn</span>
          <span className="ar">وين؟</span>
        </div>
        {/* One joined floating pill — Discover/Tickets/Profile + Host all
            live in the same bar now (previously Host floated as its own
            separate circle next to it). Icon-only on mobile (see
            .tabs-pill/.tab span in components.css). NavLink sets
            aria-current="page" on the active link automatically. */}
        <div className="tabs-pill">
          {/* Sliding highlight capsule — the liquid-glass blur/refraction
              behind the icons (see .tabs-pill's backdrop-filter) means a
              bare icon can lose contrast against whatever's scrolling
              underneath. This sits just above the glass and below the icon,
              giving the active tab a solid-ish backing to read against —
              and, like Uber/Platinumlist's tab bars, slides to track
              whichever tab is active instead of just appearing/disappearing. */}
          <span
            className="tab-indicator"
            /* 70px = tab width (64) + inter-tab gap (6); keep in sync with
               .tab / .tabs-pill in components.css. */
            style={{ transform: `translateX(${activeTabIndex * 70}px)`, opacity: activeTabIndex < 0 ? 0 : 1 }}
            aria-hidden="true"
          />
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) => "tab" + (isActive ? " on" : "")}
            >
              {({ isActive }) => (
                <>
                  {/* Outline glyph when inactive, solid fill when selected
                      (iOS tab-bar convention) — the *-fill variants live in
                      ikonate.css. */}
                  <i className={"icon-" + t.icon + (isActive ? "-fill" : "")} />
                  <span>{t.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <div className="tab-host" ref={hostRef}>
            <button
              type="button"
              className={"tab" + (onHostRoute ? " on" : "")}
              aria-haspopup="menu"
              aria-expanded={hostOpen}
              aria-label="Host"
              onClick={() => setHostOpen((v) => !v)}
            >
              <i className={"icon-circle-plus" + (onHostRoute ? "-fill" : "")} />
              <span>Host</span>
            </button>
            {hostOpen && (
              <div className="tab-host-menu" role="menu">
                {HOST_OPTIONS.map((o) => (
                  <Link key={o.to} to={o.to} className="tab-host-item" role="menuitem" onClick={() => setHostOpen(false)}>
                    <i className={"icon-" + o.icon} />
                    <div>
                      <strong>{o.label}</strong>
                      <span>{o.hint}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Desktop-only (see .tabs-right in index.css, hidden below 900px) —
            once the bar moves to the top on wide layouts, these are the
            chrome that top bar earns: city, theme, and account. Host lives
            in .tab-host above (rendered on both mobile and desktop), so no
            separate host link needed here. */}
        <div className="tabs-right">
          <CityPill />
          <ThemeToggle />
          <Link to="/you" className="tb-avatar" aria-label="Profile">
            {account?.picture ? <img src={account.picture} alt="" /> : <i className="icon-circle-user" />}
          </Link>
        </div>
      </nav>
    </div>
  );
}

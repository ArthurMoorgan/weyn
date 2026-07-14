import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import Discover from "./pages/Discover";
import LoadingMark from "./components/LoadingMark";
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

  // Edge refraction reacts to movement: real glass bends light more as
  // whatever's behind it moves, not a fixed amount at rest. Tracks scroll
  // velocity (capture-phase listener so it catches scrolling inside any
  // nested container, not just window) and drives the SVG filter's
  // feDisplacementMap `scale` up on fast movement, decaying back to the
  // calm resting value the instant scrolling stops. rAF-driven, not a scroll
  // handler doing the writing directly, so the decay stays smooth between
  // scroll events instead of snapping.
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  useEffect(() => {
    const REST_SCALE = 16;
    const MAX_EXTRA = 34;
    let lastY = window.scrollY;
    let lastT = performance.now();
    let velocity = 0;
    let raf = 0;

    function onScroll() {
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      const y = window.scrollY;
      velocity = Math.max(velocity, Math.min(1, Math.abs(y - lastY) / dt / 3));
      lastY = y;
      lastT = now;
    }
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });

    function tick() {
      velocity *= 0.88; // decays to ~0 in a few frames once movement stops
      const el = displacementRef.current;
      if (el) el.setAttribute("scale", String(REST_SCALE + velocity * MAX_EXTRA));
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="shell">
      {/* SVG filter def for the nav's liquid-glass refraction (see .tabs-pill
          in components.css) — backdrop-filter: url(#liquid-glass-distortion)
          needs a live filter element in the DOM to reference; a plain CSS
          file can't define one. Real Apple Liquid Glass concentrates its
          refraction at the *rim* of the shape and stays calm/undistorted in
          the middle — a uniform noise field (the previous version here)
          warps evenly everywhere instead, which reads as static/foggy, not
          glass. feImage draws a stadium matching the pill's own shape with a
          blurred red/green ring traced right along its border (color
          neutral-gray in the center, intense at the edge); feDisplacementMap
          reads that ring as "how far to push each pixel," so only content
          near the rim visibly bends — exactly the edge-lensing look, while
          the center stays sharp. Hidden and zero-sized: renders nothing
          itself, just holds the filter for backdrop-filter to reference. */}
      <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <filter id="liquid-glass-distortion" x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feImage
            x="0" y="0" width="100%" height="100%" preserveAspectRatio="none"
            href={
              "data:image/svg+xml," +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">' +
                '<rect width="200" height="60" rx="30" fill="#808080"/>' +
                '<rect x="1.5" y="1.5" width="197" height="57" rx="28.5" fill="none" stroke="#ff2a1a" stroke-width="14" filter="blur(5px)"/>' +
                '<rect x="1.5" y="1.5" width="197" height="57" rx="28.5" fill="none" stroke="#1aff5a" stroke-width="8" filter="blur(2.5px)"/>' +
                "</svg>"
              )
            }
            result="edgeMap"
          />
          <feGaussianBlur in="edgeMap" stdDeviation="3" result="edgeMapSmooth" />
          {/* scale starts at 16 (rest) and is driven up to ~50 on fast
              scroll by the rAF loop above (ref, not React state — this
              repaints every frame while moving, which would be far too
              expensive as a re-render). 16 alone is the "reference
              screenshot's soft, even frosting" resting look; the extra
              kicks in only while something's actually moving past the bar. */}
          <feDisplacementMap ref={displacementRef} in="SourceGraphic" in2="edgeMapSmooth" scale="16" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      {MAIN_TABS.map(({ path, Component }) =>
        visited.has(path) ? (
          <div key={path} className="tab-page" data-active={location.pathname === path}>
            <Suspense fallback={<div className="route-loading" aria-busy="true"><LoadingMark /></div>}>
              <Component />
            </Suspense>
          </div>
        ) : null
      )}
      {!activeMainTab && <Outlet />}
      <nav className="tabs">
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
            /* 80px = tab width (74) + inter-tab gap (6); keep in sync with
               .tab / .tabs-pill in components.css. */
            style={{ transform: `translateX(${activeTabIndex * 80}px)`, opacity: activeTabIndex < 0 ? 0 : 1 }}
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

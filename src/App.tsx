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

  return (
    <div className="shell">
      {/* SVG filter def for the nav's liquid-glass refraction (see .tabs-pill
          in components.css) — backdrop-filter: url(#liquid-glass-distortion)
          needs a live filter element in the DOM to reference; a plain CSS
          file can't define one. feTurbulence generates an irregular noise
          field, feDisplacementMap uses it to warp what's behind the pill
          per-pixel — the actual lensing/refraction real glass produces,
          which blur+saturate alone (flat "glassmorphism") can't fake. Hidden
          and zero-sized: it renders nothing itself, just holds the filter. */}
      <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <filter id="liquid-glass-distortion" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="smoothNoise" />
          <feDisplacementMap in="SourceGraphic" in2="smoothNoise" scale="22" xChannelSelector="R" yChannelSelector="G" />
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
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) => "tab" + (isActive ? " on" : "")}
            >
              <i className={"icon-" + t.icon} />
              <span>{t.label}</span>
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
              <i className="icon-circle-plus" />
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

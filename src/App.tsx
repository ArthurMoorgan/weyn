import { useEffect, useState, lazy, Suspense } from "react";
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
  { to: "/host/events", icon: "circle-plus", label: "Host" },
  { to: "/you", icon: "user", label: "Profile" },
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

  useEffect(() => {
    if (activeMainTab && !visited.has(activeMainTab.path)) {
      setVisited((prev) => new Set(prev).add(activeMainTab.path));
    }
  }, [activeMainTab, visited]);

  return (
    <div className="shell">
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
        <div className="sidebar-brand"><i className="icon-sparkles" /> Weyn</div>
        {/* NavLink sets aria-current="page" on the active link automatically */}
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
        {/* Desktop-only (see .tabs-right in index.css, hidden below 900px) —
            once the bar moves to the top on wide layouts, these are the
            chrome that top bar earns: city, theme, and account. Host is
            already a real tab in TABS above (rendered on both mobile and
            desktop), so no separate host link needed here. */}
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

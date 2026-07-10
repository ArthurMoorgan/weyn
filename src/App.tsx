import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import Explore from "./pages/Explore";
import LoadingMark from "./components/LoadingMark";
import ThemeToggle from "./components/ThemeToggle";
import CityPill from "./components/CityPill";
import { useAccount } from "./store";

// Lazy, same as every other non-critical-path route (see main.tsx) — these
// just aren't *routed* through main.tsx anymore, App renders them directly.
const Reservations = lazy(() => import("./pages/Reservations"));
const HostHub = lazy(() => import("./pages/HostHub"));
const You = lazy(() => import("./pages/You"));

const TABS = [
  { to: "/", icon: "sparkles", label: "Discover" },
  { to: "/reservations", icon: "utensils", label: "Reservations" },
  { to: "/host", icon: "circle-plus", label: "Host" },
  { to: "/you", icon: "user", label: "Profile" },
];

// The 4 bottom-tab pages, kept mounted once visited instead of unmounting
// on every switch — a plain <Outlet/> would tear down and rebuild Explore's
// feed, You's tab state, etc. every time, losing scroll position and
// re-fetching data each visit. Each one mounts on first visit, then just
// toggles display:none/contents on further switches — "stays loaded until
// you close the app," matching how native tab-bar apps behave. Nested
// subpages (/saved, /host/events, /host/venue, /admin) are NOT part of this
// — those still mount fresh via the normal <Outlet/> below, which is the
// right behavior for a page you navigate into and back out of rather than
// switch to repeatedly.
const MAIN_TABS: { path: string; Component: React.ComponentType }[] = [
  { path: "/", Component: Explore },
  { path: "/reservations", Component: Reservations },
  { path: "/host", Component: HostHub },
  { path: "/you", Component: You },
];

const SPARK_COLORS = ["var(--spark-color-1)", "var(--spark-color-2)", "var(--spark-color-3)"];
const SPARK_COUNT = 6;

type Burst = { id: number; x: number; y: number; sparks: { dx: number; dy: number; color: string; delay: number }[] };

let burstId = 0;

// A quick literal "spark" burst fired from the tab a switch lands on —
// replaces the earlier gooey/particle nav experiments with something much
// smaller in scope: a handful of flecks fly outward from the icon and fade,
// nothing persists in the DOM between switches. Respects
// prefers-reduced-motion via the CSS (.tab-spark { display: none }).
export default function App() {
  const navRef = useRef<HTMLElement>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const location = useLocation();
  const account = useAccount();
  const activeMainTab = MAIN_TABS.find((t) => t.path === location.pathname);
  const [visited, setVisited] = useState<Set<string>>(() => new Set(activeMainTab ? [activeMainTab.path] : []));

  useEffect(() => {
    if (activeMainTab && !visited.has(activeMainTab.path)) {
      setVisited((prev) => new Set(prev).add(activeMainTab.path));
    }
  }, [activeMainTab, visited]);

  function fireSpark(e: React.MouseEvent<HTMLAnchorElement>, alreadyActive: boolean) {
    if (alreadyActive || !navRef.current) return;
    const navRect = navRef.current.getBoundingClientRect();
    const iconEl = e.currentTarget.querySelector("[class^='icon-']") || e.currentTarget;
    const iconRect = iconEl.getBoundingClientRect();
    const x = iconRect.left + iconRect.width / 2 - navRect.left;
    const y = iconRect.top + iconRect.height / 2 - navRect.top;
    const id = ++burstId;
    const sparks = Array.from({ length: SPARK_COUNT }, (_, i) => {
      const angle = (Math.PI * 2 * i) / SPARK_COUNT + (Math.random() - 0.5) * 0.6;
      const dist = 16 + Math.random() * 12;
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 6, // slight upward bias
        color: SPARK_COLORS[i % SPARK_COLORS.length],
        delay: Math.random() * 40,
      };
    });
    setBursts((b) => [...b, { id, x, y, sparks }]);
    setTimeout(() => setBursts((b) => b.filter((burst) => burst.id !== id)), 600);
  }

  return (
    <div className="shell">
      {MAIN_TABS.map(({ path, Component }) =>
        visited.has(path) ? (
          <div key={path} style={location.pathname === path ? undefined : { display: "none" }}>
            <Suspense fallback={<div className="route-loading" aria-busy="true"><LoadingMark /></div>}>
              <Component />
            </Suspense>
          </div>
        ) : null
      )}
      {!activeMainTab && <Outlet />}
      <nav className="tabs" ref={navRef as React.RefObject<HTMLElement>}>
        <div className="sidebar-brand"><i className="icon-sparkles" /> Weyn</div>
        {/* NavLink sets aria-current="page" on the active link automatically */}
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === "/"}
            className={({ isActive }) => "tab" + (isActive ? " on" : "")}
            onClick={(e) => fireSpark(e, e.currentTarget.classList.contains("on"))}
          >
            <i className={"icon-" + t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
        {/* Desktop-only (see .tabs-right in index.css, hidden below 900px) —
            the bottom tab bar has no room for this and doesn't need it;
            once the bar moves to the top of the screen on wide layouts,
            these are the chrome that top bar earns: city + theme + account,
            each already a real working component elsewhere in the app. */}
        <div className="tabs-right">
          <CityPill />
          <ThemeToggle />
          <Link to="/you" className="tb-avatar" aria-label="Profile">
            {account?.picture ? <img src={account.picture} alt="" /> : <i className="icon-circle-user" />}
          </Link>
        </div>
        {bursts.map((burst) => (
          <span key={burst.id} className="tab-sparks" style={{ left: burst.x, top: burst.y }}>
            {burst.sparks.map((s, i) => (
              <span
                key={i}
                className="tab-spark"
                style={{
                  "--spark-x": `${s.dx}px`,
                  "--spark-y": `${s.dy}px`,
                  "--spark-color": s.color,
                  animationDelay: `${s.delay}ms`,
                } as React.CSSProperties}
              />
            ))}
          </span>
        ))}
      </nav>
    </div>
  );
}

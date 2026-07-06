import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

const TABS = [
  { to: "/", icon: "sparkles", label: "Discover" },
  { to: "/reservations", icon: "utensils", label: "Reservations" },
  { to: "/host", icon: "circle-plus", label: "Host" },
  { to: "/you", icon: "user", label: "Profile" },
];

// ReactBits' GooeyNav, adapted: a single soft blob slides + squashes between
// the active tab instead of the library's multi-blob/particle-burst version
// — kept intentionally understated per product direction (no flashy
// gimmicks). One flag reverts to the plain static nav with no code removal:
// flip GOOEY_NAV_ENABLED to false. Respects prefers-reduced-motion by
// skipping the transform transition entirely (indicator still snaps to the
// right tab, just without the animated slide).
const GOOEY_NAV_ENABLED = true;

function GooeyIndicator({ navRef }: { navRef: React.RefObject<HTMLElement> }) {
  const location = useLocation();
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>(".tab.on");
    if (!active) { setRect(null); return; }
    setRect({ left: active.offsetLeft, width: active.offsetWidth });
  }, [location.pathname, navRef]);

  // Re-measure on resize (sidebar vs bottom-bar layouts differ by breakpoint)
  useEffect(() => {
    const onResize = () => {
      const nav = navRef.current;
      const active = nav?.querySelector<HTMLElement>(".tab.on");
      if (active) setRect({ left: active.offsetLeft, width: active.offsetWidth });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [navRef]);

  if (!rect) return null;
  return <span className="gooey-blob" style={{ transform: `translateX(${rect.left}px)`, width: rect.width }} aria-hidden="true" />;
}

export default function App() {
  const navRef = useRef<HTMLElement>(null);
  return (
    <div className="shell">
      <Outlet />
      <nav className={"tabs" + (GOOEY_NAV_ENABLED ? " gooey" : "")} ref={navRef as React.RefObject<HTMLElement>}>
        <div className="sidebar-brand"><i className="icon-sparkles" /> Weyn</div>
        {GOOEY_NAV_ENABLED && (
          <svg width="0" height="0" style={{ position: "absolute" }}>
            <filter id="gooey-filter">
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
              <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -11" result="goo" />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </svg>
        )}
        {GOOEY_NAV_ENABLED && (
          <div className="gooey-layer" style={{ filter: "url(#gooey-filter)" }}>
            <GooeyIndicator navRef={navRef} />
          </div>
        )}
        {/* NavLink sets aria-current="page" on the active link automatically */}
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => "tab" + (isActive ? " on" : "")}>
            <i className={"icon-" + t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

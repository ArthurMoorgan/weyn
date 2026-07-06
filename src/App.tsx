import { useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "/", icon: "sparkles", label: "Discover" },
  { to: "/reservations", icon: "utensils", label: "Reservations" },
  { to: "/host", icon: "circle-plus", label: "Host" },
  { to: "/you", icon: "user", label: "Profile" },
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
      <Outlet />
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

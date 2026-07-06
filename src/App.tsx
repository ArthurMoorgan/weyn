import { NavLink, Outlet } from "react-router-dom";
import GooeyNav from "./components/GooeyNav";

const TABS = [
  { to: "/", icon: "sparkles", label: "Discover" },
  { to: "/reservations", icon: "utensils", label: "Reservations" },
  { to: "/host", icon: "circle-plus", label: "Host" },
  { to: "/you", icon: "user", label: "Profile" },
];

export default function App() {
  return (
    <div className="shell">
      <Outlet />
      <nav className="tabs">
        <div className="sidebar-brand"><i className="icon-sparkles" /> Weyn</div>

        {/* Mobile bottom bar: ReactBits' GooeyNav (particle-burst transition
            between tabs) — hidden on desktop via .tabs-gooey's media query,
            see index.css. */}
        <div className="tabs-gooey">
          <GooeyNav items={TABS.map((t) => ({ ...t, end: t.to === "/" }))} />
        </div>

        {/* Desktop sidebar: plain link list — a horizontal pill nav doesn't
            translate to a vertical sidebar, so this keeps the existing flat
            .tab.on highlight instead. Hidden on mobile, see .tabs-plain. */}
        <div className="tabs-plain">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => "tab" + (isActive ? " on" : "")}>
              <i className={"icon-" + t.icon} />
              <span>{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

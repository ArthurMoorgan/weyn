import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "/", icon: "sparkles", label: "Explore" },
  { to: "/host", icon: "circle-plus", label: "Host" },
  { to: "/saved", icon: "heart", label: "Saved" },
  { to: "/you", icon: "user", label: "You" },
];

export default function App() {
  return (
    <div className="shell">
      <Outlet />
      <nav className="tabs">
        <div className="sidebar-brand"><i className="icon-sparkles" /> Weyn</div>
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

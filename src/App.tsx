import { NavLink, Outlet } from "react-router-dom";

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

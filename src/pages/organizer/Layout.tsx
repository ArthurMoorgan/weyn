import { NavLink, Outlet, Link } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { useAccount } from "../../store";

// Promoted out of You.tsx's "Organizer" tab into its own top-level section —
// per HANDOFF.md §17, organizer tools are meant to be a real product
// surface (deep-linkable URLs, a proper workspace per event) rather than a
// corner of the profile screen. Mirrors how /admin is wired: a normal lazy
// route rendered through App's shared <Outlet/>, NOT one of App.tsx's
// MAIN_TABS — an organizer dashboard doesn't need to stay mounted across
// every tab switch the way Explore/Reservations/HostHub/You do.
export type OrganizerCtx = { isHost: boolean; reloadEvents: () => void; eventsLoading: boolean };

// Kept deliberately short — Finance's numbers live on Overview (a small
// "Revenue by event" list, alongside the trend chart that was already
// there) and the old Marketing hub's one genuinely unique feature (the
// organizer-profile QR poster) moved into Settings; per-event marketing
// copy is still reachable from each event's own workspace. AI Studio is the
// one new top-level addition — a real distinct destination, not something
// that folds naturally into an existing tab.
const NAV = [
  { to: "/organizer", end: true, icon: "layout-dashboard", label: "Overview" },
  { to: "/organizer/events", icon: "calendar", label: "Events" },
  { to: "/organizer/attendees", icon: "users", label: "Attendees" },
  { to: "/organizer/ai-studio", icon: "sparkles", label: "AI Studio" },
  { to: "/organizer/settings", icon: "settings", label: "Settings" },
];

export default function OrganizerLayout() {
  const account = useAccount();
  const dashEvents = useAsync(() => (account ? api.dashboardEvents() : Promise.resolve([])), [account]);
  const isHost = (dashEvents.data?.length || 0) > 0;

  if (dashEvents.loading) {
    return <div className="feed" style={{ paddingTop: 8 }}>
      <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
      <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
    </div>;
  }

  if (!isHost) {
    return (
      <section>
        <div className="page-head"><h1>Organizer</h1><p className="sub">Publish an event free and everything here lights up automatically.</p></div>
        <div className="host-cta" style={{ margin: "0 16px" }}>
          <div>
            <b>Running an event?</b>
            <span>Publish it free and track sales, attendees, promo codes, and more here.</span>
          </div>
          <Link to="/host/events" className="btn glass" style={{ width: "auto", padding: "11px 16px" }}><i className="icon-plus" /> Host</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="organizer-page">
      <header className="topbar">
        <h1>Organizer</h1>
        <Link to="/host/events" className="btn glass" style={{ width: "auto", padding: "9px 14px" }}><i className="icon-plus" /> New event</Link>
      </header>
      <div className="organizer-shell">
        <nav className="profile-tabs organizer-nav" aria-label="Organizer sections">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => "profile-tab" + (isActive ? " on" : "")}>
              <i className={`icon-${n.icon}`} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="organizer-content">
          <Outlet context={{ isHost, reloadEvents: dashEvents.reload, eventsLoading: dashEvents.loading } satisfies OrganizerCtx} />
        </div>
      </div>
    </section>
  );
}

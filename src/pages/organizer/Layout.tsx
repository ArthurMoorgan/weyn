import { useState } from "react";
import { Outlet, Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { useAccount } from "../../store";
import DashboardShell from "../../components/dashboard/DashboardShell";

// Promoted out of You.tsx's "Organizer" tab into its own top-level section —
// per HANDOFF.md §17, organizer tools are meant to be a real product
// surface (deep-linkable URLs, a proper workspace per event) rather than a
// corner of the profile screen. Mirrors how /admin is wired: a normal lazy
// route rendered through App's shared <Outlet/>, NOT one of App.tsx's
// MAIN_TABS — an organizer dashboard doesn't need to stay mounted across
// every tab switch the way Explore/Reservations/Tickets/You do.
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
  { to: "/organizer/marketing", icon: "megaphone", label: "Marketing" },
  { to: "/organizer/workflows", icon: "zap", label: "Workflows" },
  { to: "/organizer/ai-studio", icon: "sparkles", label: "AI Studio" },
  { to: "/organizer/settings", icon: "settings", label: "Settings" },
];

export default function OrganizerLayout() {
  const account = useAccount();
  const nav = useNavigate();
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
        <header className="topbar">
          <div className="brand">
            <button className="icon-btn" onClick={() => nav("/you")} aria-label="Back"><i className="icon-arrow-left" /></button>
            <span className="en">Organizer</span>
          </div>
        </header>
        <p className="sub" style={{ padding: "10px 16px 0" }}>Publish an event free and everything here lights up automatically.</p>
        <div className="host-cta" style={{ margin: "12px 16px 0" }}>
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
        <div className="brand">
          <button className="icon-btn" onClick={() => nav("/you")} aria-label="Back"><i className="icon-arrow-left" /></button>
          <h1 style={{ font: "var(--t-section)", fontSize: 20 }}>Organizer</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <NotificationBell />
          <Link to="/host/events" className="btn glass" style={{ width: "auto", padding: "9px 14px" }}><i className="icon-plus" /> New event</Link>
        </div>
      </header>
      <DashboardShell navItems={NAV} ariaLabel="Organizer sections" primary>
        <Outlet context={{ isHost, reloadEvents: dashEvents.reload, eventsLoading: dashEvents.loading } satisfies OrganizerCtx} />
      </DashboardShell>
    </section>
  );
}

// A persistent bell across every organizer page, surfacing the same
// needsAttention feed Overview already computes (org-wide zero-sales/
// manual-review/waitlist/selling-fast/pending-invite items) — previously
// only visible if you happened to be on Overview itself.
function NotificationBell() {
  const overview = useAsync(() => api.organizerOverview(), []);
  const [open, setOpen] = useState(false);
  const items = overview.data?.needsAttention || [];

  return (
    <>
      <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label={`Notifications${items.length ? ` (${items.length})` : ""}`} style={{ position: "relative" }}>
        <i className="icon-bell" />
        {items.length > 0 && <span className="search-filter-count">{items.length > 9 ? "9+" : items.length}</span>}
      </button>
      {open && (
        <div className="city-popover-backdrop" onClick={() => setOpen(false)}>
          <div className="city-popover" style={{ width: "min(340px, 90vw)" }} onClick={(e) => e.stopPropagation()}>
            <div className="city-popover-head">
              <i className="icon-bell" /> <b>Notifications</b>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><i className="icon-x" /></button>
            </div>
            {items.length === 0 ? (
              <p>Nothing needs your attention right now.</p>
            ) : (
              <ul className="steps" style={{ margin: 0 }}>
                {items.map((item, i) => (
                  <li key={i}>
                    <i className="icon-alert-circle" />
                    <span>
                      <Link to={`/organizer/events/${item.eventId}`} onClick={() => setOpen(false)}>{item.eventTitle}</Link>
                      <br /><small style={{ color: "var(--text-3)" }}>{item.message}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

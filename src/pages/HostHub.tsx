import { useNavigate } from "react-router-dom";

// Landing point for the "Host" tab — splits event hosting (self-serve,
// existing Organizer.tsx flow) from venue/reservation hosting (application +
// manual approval, per product decision: subscriptions are sold by the
// Weyn team before a venue goes live, not self-serve yet). One card, one
// CTA each — no stacked contact buttons competing for attention.
export default function HostHub() {
  const nav = useNavigate();

  return (
    <div className="page host-hub">
      <header className="host-hub-head">
        <h1>Host on Weyn</h1>
        <p className="t-body">Bring your events or your venue to Weyn.</p>
      </header>

      <div className="host-hub-grid">
        <button className="host-hub-card" onClick={() => nav("/host/events")}>
          <i className="icon-circle-plus" />
          <h3>Host Events</h3>
          <p>Create and manage events — concerts, workshops, nights out, and more.</p>
          <span className="host-hub-cta">Create an event <i className="icon-arrow-right" /></span>
        </button>

        <button className="host-hub-card" onClick={() => nav("/host/venue")}>
          <i className="icon-utensils" />
          <h3>Host Reservations</h3>
          <p>List your restaurant, café, lounge, rooftop, beach club, or experience for table reservations.</p>
          <div className="host-hub-notice">
            <strong>Reservation hosting requires approval.</strong>
            <span>Apply below — most venues hear back within a day or two.</span>
          </div>
          <span className="host-hub-cta">Apply to list your venue <i className="icon-arrow-right" /></span>
        </button>
      </div>
    </div>
  );
}

import { useNavigate } from "react-router-dom";

// Landing point for the "Host" tab — splits event hosting (self-serve,
// existing Organizer.tsx flow) from venue/reservation hosting (currently
// direct-onboarding only, per product decision: subscriptions are sold
// by the Weyn team before a venue goes live, not self-serve yet).
export default function HostHub() {
  const nav = useNavigate();
  const whatsapp = "https://wa.me/96890000000";
  const email = "mailto:partners@weynevents.com";

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
          <span className="host-hub-cta">Create an event →</span>
        </button>

        <div className="host-hub-card host-hub-card--reservations">
          <i className="icon-utensils" />
          <h3>Host Reservations</h3>
          <p>List your restaurant, café, lounge, rooftop, beach club, or experience for table reservations.</p>

          <div className="host-hub-notice">
            <strong>Reservation hosting is currently available through direct onboarding.</strong>
            <span>Contact the Weyn team to get your venue onboarded.</span>
          </div>

          <div className="host-hub-contacts">
            <a className="btn" href={whatsapp} target="_blank" rel="noreferrer">
              <i className="icon-message-circle" /> WhatsApp us
            </a>
            <a className="btn btn-ghost" href={email}>
              <i className="icon-mail" /> Email partners@weynevents.com
            </a>
          </div>

          <button className="host-hub-cta host-hub-cta--link" onClick={() => nav("/host/venue")}>
            Or start the venue application →
          </button>
        </div>
      </div>
    </div>
  );
}

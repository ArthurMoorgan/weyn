import { Link } from "react-router-dom";
import { api, type Weyn } from "../api";
import { useAsync } from "../hooks";
import { useAccount, useTickets } from "../store";
import Stub from "../components/Stub";
import AccountWidget from "../components/AccountWidget";

// Promoted from a drilled-in Profile section to its own top-level tab —
// "my bookings" is core, frequently-checked attendee functionality that was
// previously two taps deep under Profile with no top-level home (the old
// "Host" tab, by contrast, was just two launcher buttons and didn't earn a
// permanent slot in the bar). Mirrors Reservations.tsx's bare `ex-hero`
// header convention for a top-level tab (no back button — nothing to go
// back to, this IS a home screen).
export default function Tickets() {
  const account = useAccount();
  const tickets = useTickets();
  // Same shared cache key Explore/You use for the public catalog — landing
  // here from Discover (the common path) hits an already-warm cache instead
  // of re-fetching everything from scratch.
  const allEvents = useAsync(() => api.listEvents(), [], { cacheKey: "events:all" });
  const myTickets = (allEvents.data || []).filter((e) => tickets.some((t) => t.eventId === e.id));

  if (!account) {
    return (
      <>
        <section className="ex-hero">
          <h1>Tickets</h1>
        </section>
        <div className="signin-card" style={{ margin: "0 16px 12px" }}>
          <AccountWidget />
        </div>
      </>
    );
  }

  return (
    <>
      <section className="ex-hero">
        <h1>Tickets</h1>
      </section>

      {allEvents.loading || allEvents.error ? (
        <div className="feed" style={{ paddingTop: 8 }}>
          <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
          <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
          <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
        </div>
      ) : myTickets.length > 0 ? (
        <div className="feed" style={{ paddingBottom: 4 }}>{myTickets.map((e: Weyn) => <Stub key={e.id} e={e} ticket />)}</div>
      ) : (
        <div className="empty" style={{ padding: "24px 36px 32px" }}>
          <div className="ic"><i className="icon-ticket" /></div>
          <p>No tickets yet. RSVP or grab a ticket and it'll show up here.</p>
          <Link to="/" className="btn" style={{ maxWidth: 220, margin: "0 auto" }}><i className="icon-compass" /> Find something to do</Link>
        </div>
      )}
    </>
  );
}

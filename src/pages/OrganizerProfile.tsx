import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { useAccount } from "../store";
import Stub from "../components/Stub";
import FollowButton from "../components/FollowButton";

// Public destination for the Follow feature — previously a follow button
// existed on event pages with nowhere for it to actually send people. Shows
// only APPROVED, non-cancelled events (same rule as the main discovery
// feed) and never revenue/booking data (see getOrganizerProfile's comment
// on the privacy bug in the route this replaces).
export default function OrganizerProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const account = useAccount();
  const { data: p, loading, error } = useAsync(() => api.getOrganizerProfile(id!), [id]);

  if (loading) return <div className="detail"><div className="spin" /></div>;
  if (error || !p) return (
    <div className="detail">
      <div className="empty" style={{ paddingTop: 120 }}>
        <div className="ic"><i className="icon-user-x" /></div>
        <p>{error || "Organizer not found."}</p>
        <button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={() => nav("/")}>Back to Explore</button>
      </div>
    </div>
  );

  return (
    <div className="detail">
      <div className="page-head" style={{ paddingTop: 24, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--surface-2)", display: "grid", placeItems: "center", flex: "0 0 auto", overflow: "hidden" }}>
          {p.avatarUrl ? <img src={p.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="icon-circle-user" style={{ fontSize: 32, color: "var(--text-3)" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 22 }}>{p.name}</h1>
          <p className="sub">{p.followerCount} {p.followerCount === 1 ? "follower" : "followers"} · {p.events.length} live {p.events.length === 1 ? "event" : "events"}</p>
        </div>
        {/* FollowButton hides itself while signed out; self-follow attempts
            are rejected server-side (db.followOrganizer) — not worth adding
            a client-side "is this my own profile" check just to suppress a
            button that simply no-ops if clicked on your own page. */}
        {account && <FollowButton organizerId={p.id} />}
      </div>

      {p.events.length > 0 ? (
        <div className="feed" style={{ paddingTop: 8 }}>{p.events.map((e) => <Stub key={e.id} e={e} />)}</div>
      ) : (
        <div className="empty">
          <div className="ic"><i className="icon-calendar-off" /></div>
          <p>No live events right now.</p>
        </div>
      )}
    </div>
  );
}

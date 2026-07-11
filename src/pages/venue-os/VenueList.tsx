import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { useAccount } from "../../store";

// The /venue-os index — mirrors organizer/Events.tsx's role as the entry
// point into per-venue workspaces (Workspace.tsx), just simpler: venue
// owners today typically manage a small handful of venues, not a long
// list that needs filters/search.
export default function VenueList() {
  const nav = useNavigate();
  const account = useAccount();
  // Gated + keyed on `account` (same pattern as You.tsx's myVenues call) —
  // Clerk's getToken() can return null/stale on the very first call of a
  // fresh session, and with an unconditional `deps: []` that failed fetch
  // never retried, so the dashboard only ever "showed up" after a hard
  // refresh landed on an already-warm session. Keying on `account` makes
  // the fetch re-fire automatically once auth actually settles.
  const venues = useAsync(() => (account ? api.myVenues() : Promise.resolve([])), [account]);
  const list = venues.data || [];

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <button className="icon-btn" onClick={() => nav("/you")} aria-label="Back"><i className="icon-arrow-left" /></button>
          <span className="en">Your venues</span>
        </div>
      </header>

      {venues.loading && <p className="hint" style={{ padding: "8px 16px" }}>Loading…</p>}
      {venues.error && <p className="errline" style={{ padding: "0 16px" }}>{venues.error}</p>}

      {!venues.loading && !venues.error && list.length === 0 && (
        <div className="empty">
          <div className="ic"><i className="icon-store" /></div>
          <p>No venues yet.</p>
          <Link to="/host/venue" className="btn glass" style={{ maxWidth: 220, margin: "8px auto 0" }}>Host a venue</Link>
        </div>
      )}

      <div style={{ padding: "6px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {list.map((v) => (
          <Link key={v.id} to={`/venue-os/${v.id}`} className="dash-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}>
            <div className="thumb" style={v.coverImage ? { backgroundImage: `url(${v.coverImage})`, width: 46, height: 46, borderRadius: 12, backgroundSize: "cover", backgroundPosition: "center", flex: "0 0 auto" } : { width: 46, height: 46, borderRadius: 12, background: "var(--surface-2)", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
              {!v.coverImage && <i className="icon-store" />}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <b style={{ display: "block", fontSize: 15 }}>{v.name}{v.verified && <span className="ec-badge confirmed" style={{ marginLeft: 8 }}><i className="icon-badge-check" /> Verified</span>}</b>
              <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{v.area} · {v._count?.reservations ?? 0} reservation{(v._count?.reservations ?? 0) === 1 ? "" : "s"}</span>
            </div>
            <i className="icon-chevron-right" style={{ color: "var(--text-3)" }} />
          </Link>
        ))}
      </div>
    </>
  );
}

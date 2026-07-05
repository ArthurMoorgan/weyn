import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import Stub from "../components/Stub";

// Standalone shareable view — not inside the tab-bar shell — so a collection
// link (e.g. sent in a group chat) opens straight to the events, matching
// how /e/:id works for a single event.
export default function CollectionPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: c, loading, error } = useAsync(() => api.getCollection(id!), [id]);

  if (loading) return (
    <div className="detail">
      <div className="detail-skel-cover" />
      <div className="detail-skel-sheet">
        <div className="detail-skel-title" />
        <div className="detail-skel-line" />
        <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
        <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
        <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
      </div>
    </div>
  );
  if (error || !c) return (
    <div className="detail">
      <div className="empty" style={{ paddingTop: 120 }}>
        <div className="ic"><i className="icon-lock" /></div>
        <p>{error || "This list is private or doesn't exist."}</p>
        <button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={() => nav("/")}>Back to Explore</button>
      </div>
    </div>
  );

  return (
    <div className="detail">
      <div className="page-head" style={{ paddingTop: 24 }}>
        <h1>{c.name}</h1>
        <p className="sub">{c.ownerName ? `By ${c.ownerName} · ` : ""}{c.events.length} {c.events.length === 1 ? "event" : "events"}</p>
      </div>

      {c.events.length > 0 ? (
        <div className="feed">{c.events.map((e) => <Stub key={e.id} e={e} />)}</div>
      ) : (
        <div className="empty">
          <div className="ic"><i className="icon-list" /></div>
          <p>This list is empty.</p>
          <Link to="/" className="btn" style={{ maxWidth: 220, margin: "0 auto" }}><i className="icon-compass" /> Explore events</Link>
        </div>
      )}
    </div>
  );
}

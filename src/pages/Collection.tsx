import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import Stub from "../components/Stub";
import ThemeToggle from "../components/ThemeToggle";
import Tooltip from "../components/Tooltip";

// Standalone shareable view — not inside the tab-bar shell — so a collection
// link (e.g. sent in a group chat) opens straight to the events, matching
// how /e/:id works for a single event.
export default function CollectionPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: c, loading, error } = useAsync(() => api.getCollection(id!), [id]);

  // Header follows the same topbar convention as every other sub-page you
  // navigate into (Account.tsx, Support.tsx) — this page previously had no
  // back affordance at all, unlike its siblings.
  const header = (
    <header className="topbar">
      <Tooltip text="Back"><button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><i className="icon-arrow-left" /></button></Tooltip>
      <div className="brand"><span className="en">List</span></div>
      <div className="tb-right"><ThemeToggle /></div>
    </header>
  );

  if (loading) return (
    <>
      {header}
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
    </>
  );
  if (error || !c) return (
    <>
      {header}
      <div className="detail">
        <div className="empty" style={{ paddingTop: 40 }}>
          <div className="ic"><i className="icon-lock" /></div>
          <p>{error || "This list is private or doesn't exist."}</p>
          <button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={() => nav("/")}>Back to Explore</button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {header}
      <div className="detail">
        <div className="page-head compact">
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
    </>
  );
}

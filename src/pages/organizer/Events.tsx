import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ticketsLeft, isSoldOut, isPast, dayLabel, timeLabel, type Weyn } from "../../api";
import { useAsync } from "../../hooks";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

type Filter = "upcoming" | "past" | "drafts" | "templates" | "cancelled" | "all";

function DiscoveryBadge({ status }: { status?: Weyn["discoveryStatus"] }) {
  const copy: Record<string, { label: string; cls: string }> = {
    MANUAL_REVIEW: { label: "In review", cls: "warn" },
    DISCOVERY_BLOCKED: { label: "Flagged — contact support", cls: "danger" },
  };
  const c = status ? copy[status] : undefined;
  if (!c) return null;
  return <span className={`discovery-tag ${c.cls}`}>{c.label}</span>;
}

// Real per-event workspace + filters, replacing You.tsx's old flat
// dash-card list with a 9-button row per card — see HANDOFF.md §17 phase 1.
export default function OrganizerEvents() {
  const events = useAsync(() => api.dashboardEvents(), []);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = events.data || [];
  const filtered = useMemo(() => {
    if (filter === "all") return list;
    if (filter === "cancelled") return list.filter((e) => e.cancelled);
    if (filter === "drafts") return list.filter((e) => e.isDraft && !e.isTemplate && !e.cancelled);
    if (filter === "templates") return list.filter((e) => e.isTemplate && !e.cancelled);
    const live = list.filter((e) => !e.cancelled && !e.isDraft && !e.isTemplate);
    if (filter === "past") return live.filter((e) => isPast(e));
    return live.filter((e) => !isPast(e));
  }, [list, filter]);

  const draftCount = list.filter((e) => e.isDraft && !e.isTemplate && !e.cancelled).length;

  async function duplicate(e: Weyn) {
    setBusyId(e.id);
    try { await api.duplicateEvent(e.id); events.reload(); } finally { setBusyId(null); }
  }
  async function cancel(e: Weyn) {
    if (!confirm(`Cancel "${e.title}"? It'll disappear from Explore immediately.`)) return;
    setBusyId(e.id);
    try { await api.cancelEvent(e.id); events.reload(); } finally { setBusyId(null); }
  }
  async function publish(e: Weyn) {
    setBusyId(e.id);
    try { await api.publishEvent(e.id); events.reload(); } finally { setBusyId(null); }
  }
  async function useTemplate(e: Weyn) {
    setBusyId(e.id);
    try { await api.duplicateEvent(e.id); events.reload(); } finally { setBusyId(null); }
  }
  async function saveAsTemplate(e: Weyn) {
    setBusyId(e.id);
    try { await api.saveAsTemplate(e.id); events.reload(); } finally { setBusyId(null); }
  }
  async function discardDraft(e: Weyn) {
    if (!confirm(`Discard the draft "${e.title || "Untitled draft"}"? This can't be undone.`)) return;
    setBusyId(e.id);
    try { await api.cancelEvent(e.id); events.reload(); } finally { setBusyId(null); }
  }

  return (
    <>
      <div className="chips" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 6px 4px" }}>
        {(["upcoming", "past", "drafts", "templates", "cancelled", "all"] as Filter[]).map((f) => (
          <button key={f} className={"chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>
            {f === "upcoming" ? "Upcoming" : f === "past" ? "Past" : f === "drafts" ? `Drafts${draftCount ? ` (${draftCount})` : ""}` : f === "templates" ? "Templates" : f === "cancelled" ? "Cancelled" : "All"}
          </button>
        ))}
      </div>

      {events.loading && (
        <div className="feed" style={{ paddingTop: 8 }}>
          <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
          <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
        </div>
      )}
      {events.error && <p className="errline">{events.error}</p>}
      {!events.loading && filtered.length === 0 && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "8px 6px" }}>No {filter === "all" ? "" : filter} events.</p>
      )}

      <div className="organizer-events-grid">
        {filtered.map((e) => {
          const left = ticketsLeft(e);
          const out = isSoldOut(e);
          const pct = e.capacity >= 9000 ? 0 : Math.min(100, Math.round((e.sold / e.capacity) * 100));
          const gross = e.sold * e.price;
          const isDraftRow = e.isDraft && !e.isTemplate;
          return (
            <div key={e.id} className="dash-card">
              <Link to={isDraftRow || e.isTemplate ? "#" : `/organizer/events/${e.id}`} onClick={(ev) => { if (isDraftRow || e.isTemplate) ev.preventDefault(); }} className="dash-row" style={{ marginBottom: 0 }}>
                <div className="thumb" style={e.image ? { backgroundImage: `url(${e.image})`, backgroundPosition: e.imageFocalPoint || "center" } : { background: e.color }}>
                  {!e.image && e.glyph}
                </div>
                <div className="info">
                  <b>{e.title || "Untitled draft"}{isDraftRow && <span className="discovery-tag warn">Draft</span>}{e.isTemplate && <span className="discovery-tag">Template</span>}{e.cancelled && <span className="cancelled-tag">Cancelled</span>}{!e.cancelled && !isDraftRow && !e.isTemplate && <DiscoveryBadge status={e.discoveryStatus} />}{e.featured && <span className="ec-badge confirmed" style={{ marginLeft: 6 }}><i className="icon-star" /> Featured</span>}</b>
                  <span>{isDraftRow || e.isTemplate ? (e.venue || "TBD") : `${dayLabel(e)} · ${timeLabel(e)} · ${e.area}`}</span>
                  {e.capacity < 9000 && !e.cancelled && !isDraftRow && !e.isTemplate && <div className="bar"><i className={pct >= 100 ? "full" : ""} style={{ width: `${pct}%` }} /></div>}
                </div>
                <div className="amt">
                  <b>{isDraftRow || e.isTemplate ? "" : e.price === 0 ? "Free" : `${omr(+gross.toFixed(2))} OMR`}</b>
                  <span>{e.cancelled ? "—" : isDraftRow || e.isTemplate ? "" : out ? "Sold out" : e.capacity >= 9000 ? `${e.sold} in` : `${left} left`}</span>
                </div>
              </Link>
              {isDraftRow && (
                <div className="dash-actions">
                  <Link to="/host/events" state={{ resumeDraftId: e.id }} className="btn glass sm"><i className="icon-edit" /> Resume editing</Link>
                  <button onClick={() => publish(e)} disabled={busyId === e.id}><i className="icon-rocket" /> Publish</button>
                  <button onClick={() => discardDraft(e)} disabled={busyId === e.id} className="danger"><i className="icon-trash" /> Discard</button>
                </div>
              )}
              {e.isTemplate && (
                <div className="dash-actions">
                  <button onClick={() => useTemplate(e)} disabled={busyId === e.id}><i className="icon-copy" /> Use this template</button>
                </div>
              )}
              {!e.cancelled && !isDraftRow && !e.isTemplate && (
                <div className="dash-actions">
                  <Link to={`/organizer/events/${e.id}`} className="btn glass sm"><i className="icon-layout-dashboard" /> Open workspace</Link>
                  <button onClick={() => duplicate(e)} disabled={busyId === e.id}><i className="icon-copy" /> Duplicate</button>
                  <button onClick={() => saveAsTemplate(e)} disabled={busyId === e.id}><i className="icon-bookmark" /> Save as template</button>
                  <button onClick={() => cancel(e)} disabled={busyId === e.id} className="danger"><i className="icon-ban" /> Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Link to="/host/events" className="btn glass" style={{ marginTop: 8 }}><i className="icon-plus" /> Host another event</Link>
    </>
  );
}

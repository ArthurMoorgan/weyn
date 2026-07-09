import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, API_BASE, ticketsLeft, isSoldOut, isPast, dayLabel, timeLabel, type Weyn } from "../../api";
import { useAsync } from "../../hooks";
import { getAuthToken } from "../../store";

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
  const [view, setView] = useState<"list" | "calendar">("list");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkCancel() {
    if (!confirm(`Cancel ${selected.size} event${selected.size === 1 ? "" : "s"}? They'll disappear from Explore immediately.`)) return;
    setBulkBusy(true);
    try {
      await Promise.all([...selected].map((id) => api.cancelEvent(id)));
      setSelected(new Set());
      events.reload();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkExportCsv() {
    setBulkBusy(true);
    try {
      const token = await getAuthToken();
      const rows: string[] = ["Event,Name,Email,Booked At,Qty,Ticket Code,Checked In"];
      for (const id of selected) {
        const ev = list.find((e) => e.id === id);
        const res = await fetch(`${API_BASE}/api/events/${id}/attendees.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) continue;
        const text = await res.text();
        const [, ...dataLines] = text.split("\n");
        for (const line of dataLines) {
          if (line.trim()) rows.push(`"${(ev?.title || id).replace(/"/g, '""')}",${line}`);
        }
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "weyn-attendees-selected-events.csv"; link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <div className="chips" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 6px 4px", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(["upcoming", "past", "drafts", "templates", "cancelled", "all"] as Filter[]).map((f) => (
            <button key={f} className={"chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>
              {f === "upcoming" ? "Upcoming" : f === "past" ? "Past" : f === "drafts" ? `Drafts${draftCount ? ` (${draftCount})` : ""}` : f === "templates" ? "Templates" : f === "cancelled" ? "Cancelled" : "All"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={"chip" + (view === "list" ? " on" : "")} onClick={() => setView("list")}><i className="icon-list" /></button>
          <button className={"chip" + (view === "calendar" ? " on" : "")} onClick={() => setView("calendar")}><i className="icon-calendar" /></button>
        </div>
      </div>

      {view === "list" && selected.size > 0 && (
        <div className="dash-card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", margin: "0 6px 10px" }}>
          <b style={{ fontSize: 13.5 }}>{selected.size} selected</b>
          <button className="btn glass sm" onClick={bulkExportCsv} disabled={bulkBusy}><i className="icon-download" /> Export attendees CSV</button>
          <button className="btn glass sm" onClick={bulkCancel} disabled={bulkBusy} style={{ color: "var(--danger)" }}><i className="icon-ban" /> Cancel selected</button>
          <button className="copy-btn" style={{ marginLeft: "auto" }} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {view === "calendar" && !events.loading && <CalendarView events={filtered} />}

      {view === "list" && events.loading && (
        <div className="feed" style={{ paddingTop: 8 }}>
          <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
          <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
        </div>
      )}
      {events.error && <p className="errline">{events.error}</p>}
      {view === "list" && !events.loading && filtered.length === 0 && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "8px 6px" }}>No {filter === "all" ? "" : filter} events.</p>
      )}

      {view === "list" && <div className="organizer-events-grid">
        {filtered.map((e) => {
          const left = ticketsLeft(e);
          const out = isSoldOut(e);
          const pct = e.capacity >= 9000 ? 0 : Math.min(100, Math.round((e.sold / e.capacity) * 100));
          const gross = e.sold * e.price;
          const isDraftRow = e.isDraft && !e.isTemplate;
          const selectable = !isDraftRow && !e.isTemplate;
          return (
            <div key={e.id} className="dash-card">
              {selectable && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 0 8px", fontSize: 12.5, color: "var(--text-3)", cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} />
                  Select
                </label>
              )}
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
      </div>}

      <Link to="/host/events" className="btn glass" style={{ marginTop: 8 }}><i className="icon-plus" /> Host another event</Link>
    </>
  );
}

function CalendarView({ events }: { events: Weyn[] }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date();
  const month = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const firstWeekday = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const byDay = useMemo(() => {
    const map = new Map<string, Weyn[]>();
    for (const e of events) {
      const d = new Date(e.startsAt);
      if (d.getFullYear() !== month.getFullYear() || d.getMonth() !== month.getMonth()) continue;
      const key = d.getDate();
      map.set(String(key), [...(map.get(String(key)) || []), e]);
    }
    return map;
  }, [events, month]);

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="dash-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button className="copy-btn" onClick={() => setMonthOffset((m) => m - 1)}>‹</button>
        <b>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
        <button className="copy-btn" onClick={() => setMonthOffset((m) => m + 1)}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} style={{ textAlign: "center" }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => (
          <div key={i} style={{ minHeight: 56, borderRadius: 8, padding: 4, background: d ? "var(--card-alt, rgba(0,0,0,0.03))" : "transparent" }}>
            {d && <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>{d}</div>}
            {d && (byDay.get(String(d)) || []).slice(0, 2).map((e) => (
              <Link key={e.id} to={`/organizer/events/${e.id}`} title={e.title} style={{ display: "block", fontSize: 10, padding: "1px 3px", borderRadius: 4, background: e.color, color: "#fff", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.title}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// Cross-event CRM — HANDOFF.md §17's "Attendees" section, phase 2. Nothing
// like this existed before (Booking has no userId FK, so identity here is
// keyed by email server-side — see db.js's organizerAttendees comment).
export default function OrganizerAttendees() {
  const { data, loading, error } = useAsync(() => api.organizerAttendees(), []);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"spend" | "tickets" | "recent">("spend");

  const rows = useMemo(() => {
    let list = data || [];
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((a) => (a.name || "").toLowerCase().includes(needle) || (a.email || "").toLowerCase().includes(needle));
    }
    return [...list].sort((a, b) => {
      if (sort === "tickets") return b.ticketsBought - a.ticketsBought;
      if (sort === "recent") return new Date(b.lastBookedAt).getTime() - new Date(a.lastBookedAt).getTime();
      return b.totalSpend - a.totalSpend;
    });
  }, [data, q, sort]);

  const totals = useMemo(() => {
    const list = data || [];
    return {
      count: list.length,
      repeat: list.filter((a) => a.eventsAttended > 1).length,
      totalSpend: list.reduce((s, a) => s + a.totalSpend, 0),
    };
  }, [data]);

  return (
    <>
      <div className="stat-grid">
        <div className="stat"><div className="k">Unique attendees</div><div className="v">{totals.count.toLocaleString()}</div></div>
        <div className="stat"><div className="k">Repeat attendees</div><div className="v">{totals.repeat.toLocaleString()}</div></div>
        <div className="stat"><div className="k">Total spend</div><div className="v">{omr(totals.totalSpend)} <small>OMR</small></div></div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 6px 10px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" style={{ flex: "1 1 200px" }} />
        <select value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ flex: "0 0 auto" }}>
          <option value="spend">Sort: Top spenders</option>
          <option value="tickets">Sort: Most tickets</option>
          <option value="recent">Sort: Most recent</option>
        </select>
      </div>

      {loading && (
        <div style={{ padding: "0 4px" }}>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
        </div>
      )}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 6px" }}>No paid attendees across your events yet.</p>
      )}
      {!loading && !error && rows.length > 0 && (
        <ul className="steps">
          {rows.map((a) => (
            <li key={a.key}>
              <i className="icon-user" />
              <span>
                {a.name || a.email || "Anonymous"}
                {a.name && a.email && <><br /><small style={{ color: "var(--text-3)" }}>{a.email}</small></>}
                <br /><small style={{ color: "var(--text-3)" }}>{a.eventsAttended} event{a.eventsAttended === 1 ? "" : "s"} · {a.ticketsBought} ticket{a.ticketsBought === 1 ? "" : "s"}{a.eventsAttended > 1 ? " · repeat" : ""}</small>
              </span>
              <b style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{omr(a.totalSpend)} OMR</b>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

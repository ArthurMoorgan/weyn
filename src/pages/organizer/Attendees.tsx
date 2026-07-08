import { useMemo, useState } from "react";
import { api, type OrganizerAttendee } from "../../api";
import { useAsync } from "../../hooks";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// Cross-event CRM — HANDOFF.md §17's "Attendees" section, phase 2. Nothing
// like this existed before (Booking has no userId FK, so identity here is
// keyed by email server-side — see db.js's organizerAttendees comment).
// Tags/notes/loyalty points (Phase D) are a separate AttendeeProfile row per
// organizer+email, upserted on demand from the editor panel below — plain
// tag-click filtering stands in for a full natural-language "AI segment
// builder", which is a bigger feature better scoped on its own later.
export default function OrganizerAttendees() {
  const { data, loading, error, reload } = useAsync(() => api.organizerAttendees(), []);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"spend" | "tickets" | "recent">("spend");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrganizerAttendee | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    (data || []).forEach((a) => a.tags.forEach((t) => s.add(t)));
    return [...s].sort();
  }, [data]);

  const rows = useMemo(() => {
    let list = data || [];
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((a) => (a.name || "").toLowerCase().includes(needle) || (a.email || "").toLowerCase().includes(needle));
    }
    if (tagFilter) list = list.filter((a) => a.tags.includes(tagFilter));
    return [...list].sort((a, b) => {
      if (sort === "tickets") return b.ticketsBought - a.ticketsBought;
      if (sort === "recent") return new Date(b.lastBookedAt).getTime() - new Date(a.lastBookedAt).getTime();
      return b.totalSpend - a.totalSpend;
    });
  }, [data, q, sort, tagFilter]);

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

      {allTags.length > 0 && (
        <div className="chips" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 6px 10px" }}>
          <button className={"chip" + (!tagFilter ? " on" : "")} onClick={() => setTagFilter(null)}>All</button>
          {allTags.map((t) => (
            <button key={t} className={"chip" + (tagFilter === t ? " on" : "")} onClick={() => setTagFilter(t)}>{t}</button>
          ))}
        </div>
      )}

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
                <br /><small style={{ color: "var(--text-3)" }}>{a.eventsAttended} event{a.eventsAttended === 1 ? "" : "s"} · {a.ticketsBought} ticket{a.ticketsBought === 1 ? "" : "s"}{a.eventsAttended > 1 ? " · repeat" : ""}{a.loyaltyPoints > 0 ? ` · ${a.loyaltyPoints} pts` : ""}</small>
                {a.tags.length > 0 && (
                  <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {a.tags.map((t) => <span key={t} className="discovery-tag">{t}</span>)}
                  </div>
                )}
              </span>
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <b style={{ whiteSpace: "nowrap", display: "block" }}>{omr(a.totalSpend)} OMR</b>
                {a.email && <button className="copy-btn" style={{ marginTop: 4 }} onClick={() => setEditing(a)}>Edit</button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AttendeeEditor
          attendee={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function AttendeeEditor({ attendee, onClose, onSaved }: { attendee: OrganizerAttendee; onClose: () => void; onSaved: () => void }) {
  const [tags, setTags] = useState(attendee.tags.join(", "));
  const [notes, setNotes] = useState(attendee.notes);
  const [loyaltyPoints, setLoyaltyPoints] = useState(String(attendee.loyaltyPoints));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateAttendeeProfile(attendee.email!, {
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes,
        loyaltyPoints: Number(loyaltyPoints) || 0,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dash-card" style={{ padding: 16, maxWidth: 420, margin: "10vh auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="date-head" style={{ padding: 0, marginBottom: 12 }}><h2>{attendee.name || attendee.email}</h2></div>
        <div className="field"><label>Tags <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· comma separated</span></label><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, regular, influencer" /></div>
        <div className="field"><label>Loyalty points</label><input inputMode="numeric" value={loyaltyPoints} onChange={(e) => setLoyaltyPoints(e.target.value)} /></div>
        <div className="field"><label>Notes</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this person…" /></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="btn glass" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

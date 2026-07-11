import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { api, type Venue, type Reservation, type VenueAvailabilitySlot, type FloorTable, type FloorTableInput, type Campaign, type VenueSegment } from "../../api";
import { useAsync } from "../../hooks";
import FloorPlanCanvas from "../../components/FloorPlanCanvas";

type OwnedVenue = Venue & { _count?: { reservations: number; slots: number } };

// Promoted out of You.tsx's "Your venues" tab into its own top-level
// dashboard — same move Organizer went through (see organizer/Layout.tsx's
// comment): a venue owner's tools deserve deep-linkable URLs and a real
// workspace per venue, not a corner of the profile screen. Mirrors
// EventWorkspace.tsx's shape (route param tab, NavLink sidebar, flat
// conditional render chain) rather than the old internal chip-switcher.
const VENUE_TABS = [
  { key: "reservations", label: "Reservations", icon: "calendar-check" },
  { key: "calendar", label: "Calendar", icon: "calendar" },
  { key: "tables", label: "Tables", icon: "grid-2x2" },
  { key: "guests", label: "Guests", icon: "user" },
  { key: "marketing", label: "Marketing", icon: "megaphone" },
  { key: "analytics", label: "Analytics", icon: "bar-chart" },
  { key: "hours", label: "Hours", icon: "clock" },
] as const;
type VenueTabKey = typeof VENUE_TABS[number]["key"];

export default function VenueWorkspace() {
  const { venueId, tab = "reservations" } = useParams<{ venueId: string; tab?: VenueTabKey }>();
  const nav = useNavigate();
  const venues = useAsync(() => api.myVenues(), []);
  const venue = (venues.data || []).find((v) => v.id === venueId);

  if (venues.loading) return <p className="hint" style={{ padding: "8px 6px" }}>Loading…</p>;
  if (venues.error) return <p className="errline">{venues.error}</p>;
  if (!venue) return (
    <div className="empty">
      <div className="ic"><i className="icon-search-x" /></div>
      <p>Couldn't find that venue, or you don't manage it.</p>
      <Link to="/venue-os" className="btn glass" style={{ maxWidth: 220, margin: "8px auto 0" }}>Back to venues</Link>
    </div>
  );

  return (
    <>
      <div className="date-head" style={{ paddingLeft: 0, alignItems: "center", paddingBottom: 4 }}>
        <button className="copy-btn" style={{ marginRight: 4 }} onClick={() => nav("/venue-os")}><i className="icon-arrow-left" /></button>
        <h2 className="page-title" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {venue.name}{venue.verified && <span className="ec-badge confirmed" style={{ marginLeft: 8 }}><i className="icon-badge-check" /> Verified</span>}
        </h2>
      </div>
      <p className="hint" style={{ padding: "0 6px 10px" }}>{venue.area} · {venue._count?.reservations ?? 0} reservation{(venue._count?.reservations ?? 0) === 1 ? "" : "s"}</p>

      <nav className="profile-tabs organizer-nav" aria-label="Venue sections" style={{ padding: "0 6px 10px" }}>
        {VENUE_TABS.map((t) => (
          <NavLink key={t.key} to={`/venue-os/${venue.id}/${t.key}`} className={({ isActive }) => "profile-tab" + (isActive ? " on" : "")}>
            <i className={`icon-${t.icon}`} /> {t.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: "0 6px" }}>
        <VenueBody tab={tab} venue={venue} />
      </div>
    </>
  );
}

function VenueBody({ tab, venue }: { tab: VenueTabKey; venue: OwnedVenue }) {
  // Reservations are shared across the Reservations/Calendar/Guests tabs —
  // fetched once here rather than three times — Analytics has its own
  // server-aggregated endpoint since it needs a full-history scan.
  const { data, loading, error, reload } = useAsync(() => api.venueReservations(venue.id), [venue.id]);
  const [rows, setRows] = useState<(Reservation & { slot?: VenueAvailabilitySlot | null })[]>([]);
  useEffect(() => { if (data) setRows(data); }, [data]);

  async function setStatus(id: string, status: "confirmed" | "cancelled" | "seated" | "no_show") {
    const updated = await api.setReservationStatus(id, status);
    setRows((list) => list.map((r) => (r.id === id ? { ...r, status: updated.status ?? status } : r)));
  }

  if (tab === "reservations") return <VenueReservationsTab venueId={venue.id} rows={rows} loading={loading} error={error} setStatus={setStatus} onCreated={reload} />;
  if (tab === "calendar") return <VenueCalendar rows={rows} loading={loading} />;
  if (tab === "tables") return <VenueTables venueId={venue.id} />;
  if (tab === "guests") return <VenueGuests venueId={venue.id} rows={rows} />;
  if (tab === "marketing") return <VenueMarketing venueId={venue.id} />;
  if (tab === "analytics") return <VenueAnalyticsPanel venueId={venue.id} />;
  return <VenueAvailabilityEditor venue={venue} />;
}

function statusClass(status?: string) {
  const s = (status || "pending").toLowerCase();
  if (s === "confirmed") return "confirmed";
  if (s === "cancelled") return "out";
  return "";
}

type VenueReservationRow = Reservation & { slot?: VenueAvailabilitySlot | null };

function VenueReservationsTab({ venueId, rows, loading, error, setStatus, onCreated }: {
  venueId: string;
  rows: VenueReservationRow[];
  loading: boolean;
  error: string | null;
  setStatus: (id: string, status: "confirmed" | "cancelled" | "seated" | "no_show") => Promise<void>;
  onCreated: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  async function act(id: string, status: "confirmed" | "cancelled" | "seated" | "no_show") {
    setBusyId(id);
    try { await setStatus(id, status); } finally { setBusyId(null); }
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span><i className="icon-calendar-check" /> Incoming reservations</span>
        <button type="button" className="btn glass sm" style={{ width: "auto" }} onClick={() => setShowForm((v) => !v)}>
          <i className="icon-plus" /> {showForm ? "Cancel" : "Add reservation"}
        </button>
      </p>

      {showForm && (
        <ManualReservationForm venueId={venueId} onDone={() => { setShowForm(false); onCreated(); }} />
      )}

      {loading && (
        <div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
        </div>
      )}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        rows.length > 0 ? (
          <ul className="steps">
            {rows.map((r) => {
              const status = (r.status || "pending").toLowerCase();
              const pending = status === "pending";
              const arrivable = status === "confirmed";
              const canAssign = ["pending", "confirmed", "seated"].includes(status);
              return (
                <li key={r.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 10 }}>
                    <i className="icon-user" />
                    <span style={{ flex: 1 }}>
                      {r.guestName} <small style={{ color: "var(--text-3)" }}>· party of {r.partySize}</small>
                      {r.source === "manual" && <small style={{ color: "var(--text-3)" }}> · walk-in</small>}
                      <br />
                      <small style={{ color: "var(--text-3)" }}>{r.date.slice(0, 10)} · {r.time}</small>
                      {" "}
                      <span className={"ec-badge " + statusClass(r.status)}>{status.replace("_", "-")}</span>
                    </span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {pending && (
                        <>
                          <button className="btn glass sm" onClick={() => act(r.id, "confirmed")} disabled={busyId === r.id}>Confirm</button>
                          <button className="btn glass sm" onClick={() => act(r.id, "cancelled")} disabled={busyId === r.id}>Cancel</button>
                        </>
                      )}
                      {arrivable && (
                        <>
                          <button className="btn glass sm" onClick={() => act(r.id, "seated")} disabled={busyId === r.id}>Seated</button>
                          <button className="btn glass sm" onClick={() => act(r.id, "no_show")} disabled={busyId === r.id}>No-show</button>
                          <button className="btn glass sm" onClick={() => act(r.id, "cancelled")} disabled={busyId === r.id}>Cancel</button>
                        </>
                      )}
                      {canAssign && (
                        <button className="btn glass sm" onClick={() => setAssigningId(assigningId === r.id ? null : r.id)}>
                          <i className="icon-grid-2x2" /> Table
                        </button>
                      )}
                    </div>
                  </div>
                  {assigningId === r.id && (
                    <TableAssignPanel venueId={venueId} reservationId={r.id} onDone={() => setAssigningId(null)} />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p style={{ color: "var(--text-2)", fontSize: 13.5, marginBottom: 18 }}>No reservations yet.</p>
        )
      )}
    </>
  );
}

function ManualReservationForm({ venueId, onDone }: { venueId: string; onDone: () => void }) {
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("19:00");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"confirmed" | "seated">("confirmed");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!guestName.trim() || !guestEmail.trim()) { setErr("Name and email are required."); return; }
    setSaving(true); setErr("");
    try {
      await api.createManualReservation(venueId, {
        guestName: guestName.trim(), guestEmail: guestEmail.trim(), guestPhone: guestPhone.trim() || undefined,
        partySize: Number(partySize) || 1, date, time, notes: notes.trim() || undefined, status,
      });
      onDone();
    } catch (e: any) {
      setErr(e.message || "Couldn't add that reservation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dash-card" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="hint" style={{ margin: 0 }}><i className="icon-phone" /> Phone booking / walk-in</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input placeholder="Guest name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
        <input placeholder="Email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
        <input placeholder="Phone (optional)" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
        <input inputMode="numeric" placeholder="Party size" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={status === "seated"} onChange={(e) => setStatus(e.target.checked ? "seated" : "confirmed")} />
          Already seated (walk-in happening now)
        </label>
      </div>
      {err && <p className="errline">{err}</p>}
      <button className="btn glass" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Add reservation"}</button>
    </div>
  );
}

// ---- Calendar: next 14 days as a horizontally-scrolling week/timeline
// view — each column is one day, reservations sorted by time within it, so
// an owner can see occupancy at a glance instead of hunting through a flat
// list. Cancelled reservations are omitted (nothing to plan around).
function VenueCalendar({ rows, loading }: { rows: VenueReservationRow[]; loading: boolean }) {
  if (loading) {
    return <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>;
  }
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
    return d;
  });
  const byDay = days.map((d) => {
    const key = d.toISOString().slice(0, 10);
    const list = rows
      .filter((r) => r.status !== "cancelled" && r.date.slice(0, 10) === key)
      .sort((a, b) => a.time.localeCompare(b.time));
    return { date: d, key, list };
  });

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-calendar" /> Next 14 days</p>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
        {byDay.map(({ date, key, list }) => (
          <div key={key} className="dash-card" style={{ padding: 10, minWidth: 150, flex: "0 0 auto" }}>
            <b style={{ fontSize: 12.5 }}>{date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              {list.length === 0 && <span style={{ fontSize: 12, color: "var(--text-3)" }}>—</span>}
              {list.map((r) => (
                <div key={r.id} style={{ fontSize: 12, lineHeight: 1.4 }}>
                  <b>{r.time}</b> {r.guestName.split(" ")[0]} <span style={{ color: "var(--text-3)" }}>· {r.partySize}</span>
                  {" "}<span className={"ec-badge " + statusClass(r.status)} style={{ fontSize: 10 }}>{(r.status || "pending").replace("_", "-")}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- Guests: reservations grouped by guestEmail — visit count, no-show
// count, last visit — plus a persisted per-guest note (VenueGuestNote),
// independent of any single reservation's own `notes` field.
function VenueGuests({ venueId, rows }: { venueId: string; rows: VenueReservationRow[] }) {
  const { data: notesData, reload } = useAsync(() => api.venueGuestNotes(venueId), [venueId]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const guests = Object.values(
    rows.reduce((acc, r) => {
      const key = r.guestEmail.toLowerCase();
      if (!acc[key]) acc[key] = { email: r.guestEmail, name: r.guestName, visits: 0, noShows: 0, lastVisit: r.date, reservations: [] as VenueReservationRow[] };
      const g = acc[key];
      g.reservations.push(r);
      if (r.status !== "cancelled") g.visits += 1;
      if (r.status === "no_show") g.noShows += 1;
      if (new Date(r.date) > new Date(g.lastVisit)) g.lastVisit = r.date;
      return acc;
    }, {} as Record<string, { email: string; name: string; visits: number; noShows: number; lastVisit: string; reservations: VenueReservationRow[] }>)
  ).sort((a, b) => new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime());

  const noteFor = (email: string) => notesData?.find((n) => n.guestEmail.toLowerCase() === email.toLowerCase())?.note || "";
  const tagsFor = (email: string) => notesData?.find((n) => n.guestEmail.toLowerCase() === email.toLowerCase())?.tags || [];

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-user" /> Guests ({guests.length})</p>
      {guests.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No guests yet.</p>
      ) : (
        <ul className="steps">
          {guests.map((g) => (
            <li key={g.email} style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 10 }}>
                <i className="icon-user" />
                <span style={{ flex: 1 }}>
                  {g.name} <small style={{ color: "var(--text-3)" }}>· {g.email}</small>
                  {tagsFor(g.email).map((t) => <span key={t} className="chip" style={{ marginLeft: 6, padding: "1px 8px", fontSize: 11 }}>{t}</span>)}
                  <br />
                  <small style={{ color: "var(--text-3)" }}>
                    {g.visits} visit{g.visits === 1 ? "" : "s"}{g.noShows > 0 ? ` · ${g.noShows} no-show${g.noShows === 1 ? "" : "s"}` : ""} · last {g.lastVisit.slice(0, 10)}
                  </small>
                </span>
                <button className="btn glass sm" style={{ width: "auto" }} onClick={() => setExpanded(expanded === g.email ? null : g.email)}>
                  {expanded === g.email ? "Close" : "Details"}
                </button>
              </div>
              {expanded === g.email && (
                <GuestDetail venueId={venueId} email={g.email} reservations={g.reservations} note={noteFor(g.email)} tags={tagsFor(g.email)} onNoteSaved={reload} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function GuestDetail({ venueId, email, reservations, note, tags, onNoteSaved }: {
  venueId: string; email: string; reservations: VenueReservationRow[]; note: string; tags: string[]; onNoteSaved: () => void;
}) {
  const [text, setText] = useState(note);
  const [tagsText, setTagsText] = useState(tags.join(", "));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(note); }, [note]);
  useEffect(() => { setTagsText(tags.join(", ")); }, [tags]);

  async function save() {
    setSaving(true);
    const parsedTags = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
    try { await api.setVenueGuestNote(venueId, email, text, parsedTags); onNoteSaved(); } finally { setSaving(false); }
  }

  return (
    <div style={{ marginTop: 10, paddingLeft: 30, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {[...reservations].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((r) => (
          <small key={r.id} style={{ color: "var(--text-3)" }}>
            {r.date.slice(0, 10)} · {r.time} · party of {r.partySize} · <span className={"ec-badge " + statusClass(r.status)} style={{ fontSize: 10 }}>{(r.status || "pending").replace("_", "-")}</span>
          </small>
        ))}
      </div>
      <input placeholder="Tags, comma-separated (VIP, regular, allergy: nuts…)" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
      <textarea rows={2} placeholder="Notes on this guest (allergies, preferences, VIP…)" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn glass sm" style={{ width: "auto" }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
    </div>
  );
}

const SEGMENT_OPTIONS: { key: VenueSegment["type"]; label: string }[] = [
  { key: "all", label: "All guests" },
  { key: "new", label: "First-time guests" },
  { key: "inactive", label: "Haven't visited recently" },
  { key: "tag", label: "By tag" },
];

// ---- Marketing: send a campaign to a real segment of a venue's guests
// (reusing reservation history + VenueGuestNote tags — no fabricated
// audience), with a live recipient-count preview before sending, and a
// history list of what's gone out. Scheduling reuses the same Campaign
// row + runCampaignScan flow the event side already has.
function VenueMarketing({ venueId }: { venueId: string }) {
  const { data: campaigns, loading, reload } = useAsync(() => api.venueCampaigns(venueId), [venueId]);
  const [segmentType, setSegmentType] = useState<VenueSegment["type"]>("all");
  const [tag, setTag] = useState("");
  const [days, setDays] = useState("60");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [scheduleFor, setScheduleFor] = useState("");
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");

  const segment: VenueSegment = { type: segmentType, tag: segmentType === "tag" ? tag : undefined, days: segmentType === "inactive" ? Number(days) || 60 : undefined };

  async function loadPreview() {
    if (segmentType === "tag" && !tag.trim()) { setPreview(null); return; }
    setPreviewing(true);
    try { setPreview(await api.venueSegmentPreview(venueId, segment)); } finally { setPreviewing(false); }
  }
  useEffect(() => { loadPreview(); }, [segmentType, tag, days]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!subject.trim() || !message.trim()) { setErr("Subject and message are required."); return; }
    setSending(true); setErr(""); setResult("");
    try {
      const res = await api.createVenueCampaign(venueId, {
        subject: subject.trim(), message: message.trim(), segment,
        scheduledFor: scheduleFor ? new Date(scheduleFor).toISOString() : undefined,
      });
      setResult(res.scheduled ? "Scheduled." : `Sent to ${res.emailed ?? 0} of ${res.recipients ?? 0} guests.`);
      setSubject(""); setMessage(""); setScheduleFor("");
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't send that campaign.");
    } finally {
      setSending(false);
    }
  }

  async function cancel(campaignId: string) {
    await api.cancelVenueCampaign(venueId, campaignId);
    reload();
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-megaphone" /> New campaign</p>
      <div className="dash-card" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12.5, color: "var(--text-2)", display: "block", marginBottom: 6 }}>Audience</label>
          <div className="chips" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SEGMENT_OPTIONS.map((o) => (
              <button key={o.key} className={"chip" + (segmentType === o.key ? " on" : "")} onClick={() => setSegmentType(o.key)}>{o.label}</button>
            ))}
          </div>
          {segmentType === "tag" && (
            <input style={{ marginTop: 8 }} placeholder="Tag (e.g. VIP)" value={tag} onChange={(e) => setTag(e.target.value)} />
          )}
          {segmentType === "inactive" && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13 }}>Haven't visited in</span>
              <input type="number" style={{ width: 70 }} value={days} onChange={(e) => setDays(e.target.value)} />
              <span style={{ fontSize: 13 }}>days</span>
            </div>
          )}
          <p style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8 }}>
            {previewing ? "Checking…" : preview ? `${preview.count} guest${preview.count === 1 ? "" : "s"}${preview.sample.length ? ` — e.g. ${preview.sample.join(", ")}` : ""}` : "—"}
          </p>
        </div>

        <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea rows={4} placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div>
          <label style={{ fontSize: 12.5, color: "var(--text-2)", display: "block", marginBottom: 6 }}>Send now, or schedule for later</label>
          <input type="datetime-local" value={scheduleFor} onChange={(e) => setScheduleFor(e.target.value)} />
        </div>

        {err && <p className="errline">{err}</p>}
        {result && <p className="hint">{result}</p>}
        <button className="btn glass" onClick={send} disabled={sending || !preview?.count}>
          {sending ? "Sending…" : scheduleFor ? "Schedule campaign" : `Send to ${preview?.count ?? 0} guest${preview?.count === 1 ? "" : "s"}`}
        </button>
      </div>

      <p className="hint" style={{ margin: "4px 0 8px" }}>History</p>
      {loading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !campaigns?.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No campaigns sent yet.</p>
      ) : (
        <ul className="steps">
          {campaigns.map((c) => (
            <li key={c.id}>
              <i className="icon-megaphone" />
              <span>
                {c.subject || "(no subject)"} <span className={"ec-badge " + (c.status === "sent" ? "confirmed" : c.status === "cancelled" ? "out" : "")}>{c.status}</span>
                <br />
                <small style={{ color: "var(--text-3)" }}>
                  {c.status === "sent" ? `Sent ${new Date(c.sentAt!).toLocaleDateString()} · ${c.recipientCount ?? "?"} recipients` : c.status === "scheduled" ? `Scheduled for ${new Date(c.scheduledFor!).toLocaleString()}` : "Cancelled"}
                </small>
              </span>
              {c.status === "scheduled" && (
                <button className="btn glass sm" style={{ marginLeft: "auto" }} onClick={() => cancel(c.id)}>Cancel</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function VenueAnalyticsPanel({ venueId }: { venueId: string }) {
  const { data, loading, error } = useAsync(() => api.venueAnalytics(venueId), [venueId]);
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (loading) return <div className="stat-skel"><div className="s-tile" /><div className="s-tile" /><div className="s-tile" /></div>;
  if (error) return <p className="errline">{error}</p>;
  if (!data) return null;

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-bar-chart" /> Analytics</p>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat"><span className="k">Total reservations</span><div className="v">{data.totalReservations}</div></div>
        <div className="stat"><span className="k">Covers seated</span><div className="v">{data.coversSeated}</div></div>
        <div className="stat"><span className="k">No-show rate</span><div className="v">{data.noShowRate === null ? "—" : `${Math.round(data.noShowRate * 100)}%`}</div></div>
      </div>

      <p className="hint" style={{ margin: "4px 0 8px" }}>Peak hours</p>
      {data.peakHours.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>Not enough data yet.</p>
      ) : (
        <ul className="steps" style={{ marginBottom: 14 }}>
          {data.peakHours.map((p) => (
            <li key={p.hour}><i className="icon-clock" /><span>{p.hour} <small style={{ color: "var(--text-3)" }}>· {p.count} reservation{p.count === 1 ? "" : "s"}</small></span></li>
          ))}
        </ul>
      )}

      <p className="hint" style={{ margin: "4px 0 8px" }}>Busiest days</p>
      <div style={{ display: "flex", gap: 8 }}>
        {data.byDayOfWeek.map((count, i) => {
          const max = Math.max(1, ...data.byDayOfWeek);
          return (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 60, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div style={{ width: "60%", height: `${Math.max(4, (count / max) * 100)}%`, background: "var(--accent)", borderRadius: 4 }} />
              </div>
              <small style={{ color: "var(--text-3)" }}>{DOW[i]}</small>
            </div>
          );
        })}
      </div>
    </>
  );
}

const VENUE_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type VenueDayRow = { enabled: boolean; start: string; end: string; capacity: string };

function VenueAvailabilityEditor({ venue }: { venue: OwnedVenue }) {
  const { data } = useAsync(() => api.getVenue(venue.id), [venue.id]);
  const [days, setDays] = useState<VenueDayRow[]>(() =>
    VENUE_DAYS.map(() => ({ enabled: false, start: "10:00", end: "22:00", capacity: "20" }))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  // Prefill from the venue's existing slots once loaded.
  useEffect(() => {
    const slots = data?.slots;
    if (!slots || slots.length === 0) return;
    setDays((prev) => {
      const next = prev.map((d) => ({ ...d, enabled: false }));
      for (const s of slots) {
        if (s.dayOfWeek < 0 || s.dayOfWeek > 6) continue;
        next[s.dayOfWeek] = { enabled: true, start: s.startTime, end: s.endTime, capacity: String(s.capacity) };
      }
      return next;
    });
  }, [data]);

  function update(i: number, patch: Partial<VenueDayRow>) {
    setDays((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setSaved(false);
  }

  async function save() {
    setSaving(true); setErr(""); setSaved(false);
    try {
      const slots = days
        .map((d, i) => ({ dayOfWeek: i, startTime: d.start, endTime: d.end, capacity: Number(d.capacity) || 0, enabled: d.enabled }))
        .filter((s) => s.enabled)
        .map(({ enabled, ...s }) => { void enabled; return s; });
      await api.setVenueSlots(venue.id, slots);
      setSaved(true);
    } catch (e: any) {
      setErr(e.message || "Couldn't save availability.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-clock" /> Weekly availability</p>
      <div className="hv-avail-list">
        {VENUE_DAYS.map((day, i) => {
          const d = days[i];
          return (
            <div key={day} className={"hv-avail-day" + (d.enabled ? " on" : "")}>
              <label className="hv-avail-day-head">
                <input type="checkbox" checked={d.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                <span>{day}</span>
                {!d.enabled && <span className="hv-avail-closed">Closed</span>}
              </label>
              {d.enabled && (
                <div className="hv-avail-ranges">
                  <div className="hv-avail-range">
                    <input type="time" value={d.start} onChange={(e) => update(i, { start: e.target.value })} aria-label={`${day} opening time`} />
                    <span>–</span>
                    <input type="time" value={d.end} onChange={(e) => update(i, { end: e.target.value })} aria-label={`${day} closing time`} />
                    <input inputMode="numeric" value={d.capacity} onChange={(e) => update(i, { capacity: e.target.value })} placeholder="Cap." className="hv-avail-capacity" aria-label={`${day} capacity`} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {err && <p className="errline">{err}</p>}
      <button className="btn glass" style={{ marginTop: 10 }} onClick={save} disabled={saving}>
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save availability"}
      </button>
    </div>
  );
}

// ---- Tables: the floor-plan layout editor. Mode ("table" vs "seat") is
// chosen once per venue at setup — table mode assigns whole tables (most
// restaurants/lounges), seat mode assigns individual seats (e.g. a
// numbered-barstool bar or a screening-room venue). Layout edits are local
// until "Save layout" — dragging every pixel to the server would be both
// slow and noisy.
function VenueTables({ venueId }: { venueId: string }) {
  const { data: plan, loading, reload } = useAsync(() => api.getVenueFloorPlan(venueId), [venueId]);
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (plan) { setTables(plan.tables); setDirty(false); } }, [plan]);

  async function init(mode: "table" | "seat") {
    await api.initVenueFloorPlan(venueId, mode);
    reload();
  }

  function addTable() {
    const n = tables.length + 1;
    setTables((list) => [...list, {
      id: `new-${Date.now()}-${n}`, floorPlanId: plan!.id, sectionId: null,
      label: `Table ${n}`, shape: "rect", x: 20 + (n % 6) * 100, y: 20 + Math.floor(n / 6) * 100,
      width: 80, height: 80, rotation: 0, minCapacity: 1, maxCapacity: 4, status: "available", seats: [],
    }]);
    setDirty(true);
  }

  function updateTable(id: string, patch: Partial<FloorTable>) {
    setTables((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setDirty(true);
  }

  function removeTable(id: string) {
    setTables((list) => list.filter((t) => t.id !== id));
    setDirty(true);
  }

  async function save() {
    setSaving(true); setErr("");
    try {
      const input: FloorTableInput[] = tables.map((t) => ({
        id: t.id.startsWith("new-") ? undefined : t.id,
        label: t.label, shape: t.shape, x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation,
        minCapacity: t.minCapacity, maxCapacity: t.maxCapacity, sectionId: t.sectionId,
        seatCount: plan?.mode === "seat" ? (t.seats.length || t.maxCapacity) : undefined,
      }));
      await api.setVenueFloorTables(venueId, input);
      setDirty(false);
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't save the layout.");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(tableId: string, status: FloorTable["status"]) {
    const updated = await api.setFloorTableStatus(tableId, status);
    setTables((list) => list.map((t) => (t.id === tableId ? { ...t, status: updated.status } : t)));
  }

  if (loading) return <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>;

  if (!plan) {
    return (
      <div className="dash-card" style={{ padding: 16 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}><i className="icon-grid-2x2" /> Set up your floor plan</p>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 12 }}>
          Choose how tables get assigned here — you can change this later.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn glass" onClick={() => init("table")}>Whole tables</button>
          <button className="btn glass" onClick={() => init("seat")}>Individual seats</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span><i className="icon-grid-2x2" /> Floor plan · {plan.mode === "seat" ? "individual seats" : "whole tables"}</span>
        <button type="button" className="btn glass sm" style={{ width: "auto" }} onClick={addTable}><i className="icon-plus" /> Add table</button>
      </p>

      <FloorPlanCanvas tables={tables} mode="edit" seatMode={plan.mode === "seat"}
        onTableDrag={(id, x, y) => updateTable(id, { x, y })}
        onTableResize={(id, width, height) => updateTable(id, { width, height })}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {tables.map((t) => (
          <div key={t.id} className="dash-card" style={{ padding: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input style={{ width: 100 }} value={t.label} onChange={(e) => updateTable(t.id, { label: e.target.value })} />
            <select value={t.shape} onChange={(e) => updateTable(t.id, { shape: e.target.value as "rect" | "circle" })}>
              <option value="rect">Rect</option>
              <option value="circle">Circle</option>
            </select>
            <input type="number" style={{ width: 55 }} value={t.minCapacity} onChange={(e) => updateTable(t.id, { minCapacity: Number(e.target.value) || 1 })} title="Min capacity" />
            <span style={{ color: "var(--text-3)" }}>–</span>
            <input type="number" style={{ width: 55 }} value={t.maxCapacity} onChange={(e) => updateTable(t.id, { maxCapacity: Number(e.target.value) || 1 })} title="Max capacity" />
            {plan.mode === "seat" && (
              <input type="number" style={{ width: 60 }} value={t.seats.length || t.maxCapacity}
                onChange={(e) => updateTable(t.id, { seats: Array.from({ length: Number(e.target.value) || 0 }, (_, i) => t.seats[i] || { id: `pending-${i}`, tableId: t.id, index: i + 1, label: null, status: "available" }) })}
                title="Seat count" />
            )}
            <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value as FloorTable["status"])} style={{ marginLeft: "auto" }}>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="occupied">Occupied</option>
              <option value="needs_cleaning">Needs cleaning</option>
              <option value="maintenance">Maintenance</option>
            </select>
            <button className="btn glass sm" onClick={() => removeTable(t.id)}><i className="icon-x" /></button>
          </div>
        ))}
        {tables.length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No tables yet — add one above.</p>}
      </div>

      {err && <p className="errline">{err}</p>}
      <button className="btn glass" style={{ marginTop: 10 }} onClick={save} disabled={saving || !dirty}>
        {saving ? "Saving…" : dirty ? "Save layout" : "Saved ✓"}
      </button>
    </>
  );
}

// ---- Table assignment panel — inline under a reservation row. Click
// tables to toggle them into the selection (multiple = merge), then
// confirm. Only tables currently "available" are clickable.
function TableAssignPanel({ venueId, reservationId, onDone }: { venueId: string; reservationId: string; onDone: () => void }) {
  const { data: plan, loading } = useAsync(() => api.getVenueFloorPlan(venueId), [venueId]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function toggle(t: FloorTable) {
    setSelected((list) => (list.includes(t.id) ? list.filter((id) => id !== t.id) : [...list, t.id]));
  }

  async function confirm() {
    if (!selected.length) return;
    setSaving(true); setErr("");
    try {
      await api.assignTables(reservationId, selected);
      onDone();
    } catch (e: any) {
      setErr(e.message || "Couldn't assign that table.");
    } finally {
      setSaving(false);
    }
  }

  async function unassign() {
    setSaving(true);
    try { await api.unassignTables(reservationId); onDone(); } finally { setSaving(false); }
  }

  if (loading) return <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>;
  if (!plan) {
    return <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 8 }}>No floor plan set up yet — add tables in the Tables tab first.</p>;
  }

  return (
    <div style={{ marginTop: 10 }}>
      <FloorPlanCanvas tables={plan.tables} mode="assign" seatMode={plan.mode === "seat"} selectedTableIds={selected} onTableClick={toggle} />
      {err && <p className="errline">{err}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn glass sm" style={{ width: "auto" }} onClick={confirm} disabled={saving || !selected.length}>
          {saving ? "Saving…" : `Assign ${selected.length || ""} table${selected.length === 1 ? "" : "s"}`.trim()}
        </button>
        <button className="btn glass sm" style={{ width: "auto" }} onClick={unassign} disabled={saving}>Clear assignment</button>
      </div>
    </div>
  );
}

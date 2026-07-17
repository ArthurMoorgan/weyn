import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, VENUE_CATS, type Venue, type VenueCategory, type PriceRange, type Reservation, type VenueAvailabilitySlot, type FloorTable, type FloorTableInput, type Campaign, type VenueSegment, type VenueWorkflow, type VenueWorkflowTrigger, type VenueConditionField, type VenueWorkflowAction, type WFNode, type WFEdge, type WFNodeType, type WinBackStats, type VenueLoyaltyGuest, type VenueMarketingLink, type VenueMarketingCalendarItem, type VenueBrandKit, type SocialAccountConnection, type VenueSocialPost, type VenueMarketingContact, type AdVariant, type PersuasionAngle, type VenueWaitlistEntry } from "../../api";
import { useAsync } from "../../hooks";
import { useAccount } from "../../store";
import FloorPlanCanvas from "../../components/FloorPlanCanvas";
import WorkflowCanvas from "../../components/WorkflowCanvas";
import DashboardShell from "../../components/dashboard/DashboardShell";
import DesktopOnlyBanner from "../../components/DesktopOnlyBanner";
import { layoutGraph, unreachableNodeIds } from "../../lib/workflowLayout";
import { MotionButton, MotionLink } from "../../motion";

type OwnedVenue = Venue & { _count?: { reservations: number; slots: number } };

// Promoted out of You.tsx's "Your venues" tab into its own top-level
// dashboard — same move Organizer went through (see organizer/Layout.tsx's
// comment): a venue owner's tools deserve deep-linkable URLs and a real
// workspace per venue, not a corner of the profile screen. Mirrors
// EventWorkspace.tsx's shape (route param tab, NavLink sidebar, flat
// conditional render chain) rather than the old internal chip-switcher.
const VENUE_TABS = [
  { key: "reservations", label: "Reservations", icon: "calendar-check" },
  { key: "waitlist", label: "Waitlist", icon: "clock" },
  { key: "calendar", label: "Calendar", icon: "calendar" },
  { key: "tables", label: "Tables", icon: "grid-2x2" },
  { key: "venue", label: "Venue", icon: "store" },
  { key: "guests", label: "Guests", icon: "user" },
  { key: "marketing", label: "Marketing", icon: "megaphone" },
  { key: "marketing-hub", label: "Marketing Hub", icon: "sparkles" },
  { key: "workflows", label: "Workflows", icon: "zap" },
  { key: "analytics", label: "Analytics", icon: "bar-chart" },
  { key: "hours", label: "Hours", icon: "clock" },
] as const;
type VenueTabKey = typeof VENUE_TABS[number]["key"];

export default function VenueWorkspace() {
  const { venueId, tab } = useParams<{ venueId: string; tab?: VenueTabKey }>();
  const nav = useNavigate();
  const account = useAccount();
  // Gated + keyed on `account` (mirrors You.tsx's myVenues call) — an
  // unconditional `deps: []` here meant a failed first token fetch (Clerk's
  // getToken() can return null/stale on a fresh session's very first call)
  // never retried, so this workspace only "showed up" after a hard refresh
  // landed on an already-warm session. Keying on `account` re-fires the
  // fetch automatically once auth actually settles.
  const venues = useAsync(() => (account ? api.myVenues() : Promise.resolve([])), [account]);
  const venue = (venues.data || []).find((v) => v.id === venueId);

  if (venues.loading) return <p className="hint" style={{ padding: "8px 6px" }}>Loading…</p>;
  if (venues.error) return <p className="errline">{venues.error}</p>;
  if (!venue) return (
    <div className="empty">
      <div className="ic"><i className="icon-search-x" /></div>
      <p>Couldn't find that venue, or you don't manage it.</p>
      <MotionLink to="/venue-os" className="btn glass" style={{ maxWidth: 220, margin: "8px auto 0" }}>Back to venues</MotionLink>
    </div>
  );
  // The bare /venue-os/:id route (no :tab segment) rendered the reservations
  // body via a JS default, but that left the URL itself without "/reservations"
  // — so no NavLink below ever matched it and the active section never
  // highlighted. Redirect once so the URL and the rendered tab always agree.
  if (!tab) return <Navigate to={`/venue-os/${venue.id}/reservations`} replace />;

  return (
    <>
      <div className="date-head" style={{ paddingLeft: 0, alignItems: "center", paddingBottom: 4 }}>
        <button className="copy-btn" style={{ marginRight: 4 }} onClick={() => nav("/venue-os")}><i className="icon-arrow-left" /></button>
        <h2 className="page-title" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {venue.name}{venue.verified && <span className="ec-badge confirmed" style={{ marginLeft: 8 }}><i className="icon-badge-check" /> Verified</span>}
        </h2>
      </div>
      <p className="hint" style={{ padding: "0 6px 10px" }}>{venue.area} · {venue._count?.reservations ?? 0} reservation{(venue._count?.reservations ?? 0) === 1 ? "" : "s"}</p>

      <div style={{ padding: "0 6px" }}><DesktopOnlyBanner /></div>

      <DashboardShell
        ariaLabel="Venue sections"
        navItems={VENUE_TABS.map((t) => ({ to: `/venue-os/${venue.id}/${t.key}`, icon: t.icon, label: t.label }))}
      >
        <VenueBody tab={tab} venue={venue} />
      </DashboardShell>
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
  if (tab === "waitlist") return <VenueWaitlistTab venueId={venue.id} />;
  if (tab === "calendar") return <VenueCalendar rows={rows} loading={loading} />;
  if (tab === "tables") return <VenueTables venueId={venue.id} />;
  if (tab === "venue") return <VenueProfileEditor venue={venue} />;
  if (tab === "guests") return <VenueGuests venueId={venue.id} rows={rows} />;
  if (tab === "marketing") return <VenueMarketing venueId={venue.id} />;
  if (tab === "marketing-hub") return <VenueMarketingHub venueId={venue.id} />;
  if (tab === "workflows") return <VenueWorkflows venueId={venue.id} />;
  if (tab === "analytics") return <VenueAnalyticsPanel venueId={venue.id} />;
  return <VenueAvailabilityEditor venue={venue} />;
}

function statusClass(status?: string) {
  const s = (status || "pending").toLowerCase();
  if (s === "confirmed") return "confirmed";
  if (s === "cancelled") return "out";
  return "";
}

type VenueReservationRow = Reservation & { slot?: VenueAvailabilitySlot | null; tableAssignment?: { tables: { table: FloorTable }[] } | null };

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
        <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={() => setShowForm((v) => !v)}>
          <i className="icon-plus" /> {showForm ? "Cancel" : "Add reservation"}
        </MotionButton>
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
                      {r.tableAssignment?.tables.length ? (
                        <span className="ec-badge confirmed" style={{ marginLeft: 4 }}>
                          <i className="icon-grid-2x2" /> {r.tableAssignment.tables.map((t) => t.table.label).join(" + ")}
                        </span>
                      ) : canAssign ? (
                        <span className="ec-badge" style={{ marginLeft: 4, color: "var(--text-3)" }}>Unassigned</span>
                      ) : null}
                    </span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {pending && (
                        <>
                          <MotionButton className="btn glass sm success" onClick={() => act(r.id, "confirmed")} disabled={busyId === r.id}>Confirm</MotionButton>
                          <MotionButton className="btn glass sm danger" onClick={() => act(r.id, "cancelled")} disabled={busyId === r.id}>Cancel</MotionButton>
                        </>
                      )}
                      {arrivable && (
                        <>
                          <MotionButton className="btn glass sm success" onClick={() => act(r.id, "seated")} disabled={busyId === r.id}>Seated</MotionButton>
                          <MotionButton className="btn glass sm" onClick={() => act(r.id, "no_show")} disabled={busyId === r.id}>No-show</MotionButton>
                          <MotionButton className="btn glass sm danger" onClick={() => act(r.id, "cancelled")} disabled={busyId === r.id}>Cancel</MotionButton>
                        </>
                      )}
                      {canAssign && (
                        <MotionButton className="btn glass sm" onClick={() => setAssigningId(assigningId === r.id ? null : r.id)}>
                          <i className="icon-grid-2x2" /> {r.tableAssignment?.tables.length ? "Reassign" : "Assign"}
                        </MotionButton>
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
        <input className="toolbar-field" placeholder="Guest name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
        <input className="toolbar-field" placeholder="Email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
        <input className="toolbar-field" placeholder="Phone (optional)" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
        <input className="toolbar-field" inputMode="numeric" placeholder="Party size" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
        <input className="toolbar-field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="toolbar-field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <input className="toolbar-field" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={status === "seated"} onChange={(e) => setStatus(e.target.checked ? "seated" : "confirmed")} />
          Already seated (walk-in happening now)
        </label>
      </div>
      {err && <p className="errline">{err}</p>}
      <MotionButton className="btn glass" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Add reservation"}</MotionButton>
    </div>
  );
}

// ---- Waitlist: guests waiting on a fully-booked slot. Own owner-entered
// join form (mirrors ManualReservationForm's shape) plus per-entry actions
// — notify, promote to a real reservation, remove — rather than a
// read-only list, since the whole point of a waitlist is acting on it.
function VenueWaitlistTab({ venueId }: { venueId: string }) {
  const { data, loading, error, reload } = useAsync(() => api.venueWaitlist(venueId), [venueId]);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const entries = data || [];
  const pending = entries.filter((e) => e.status === "WAITING" || e.status === "NOTIFIED");
  const resolved = entries.filter((e) => e.status === "CONVERTED" || e.status === "EXPIRED" || e.status === "CANCELLED");

  async function notify(id: string) {
    setBusyId(id); setErr("");
    try { await api.notifyVenueWaitlistEntry(venueId, id); await reload(); }
    catch (e: any) { setErr(e.message || "Couldn't notify that guest."); }
    finally { setBusyId(null); }
  }
  async function promote(id: string) {
    setBusyId(id); setErr("");
    try { await api.promoteVenueWaitlistEntry(venueId, id); await reload(); }
    catch (e: any) { setErr(e.message || "Couldn't seat that guest."); }
    finally { setBusyId(null); }
  }
  async function remove(id: string) {
    setBusyId(id); setErr("");
    try { await api.removeVenueWaitlistEntry(venueId, id); await reload(); }
    catch (e: any) { setErr(e.message || "Couldn't remove that entry."); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span><i className="icon-clock" /> Waitlist</span>
        <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={() => setShowForm((v) => !v)}>
          <i className="icon-plus" /> {showForm ? "Cancel" : "Add to waitlist"}
        </MotionButton>
      </p>

      {showForm && <VenueWaitlistJoinForm venueId={venueId} onDone={() => { setShowForm(false); reload(); }} />}
      {err && <p className="errline">{err}</p>}

      {loading && (
        <div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
        </div>
      )}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        pending.length > 0 ? (
          <ul className="steps">
            {pending.map((e) => (
              <li key={e.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 10 }}>
                  <i className="icon-user" />
                  <span style={{ flex: 1 }}>
                    {e.guestName} <small style={{ color: "var(--text-3)" }}>· party of {e.partySize}</small>
                    <br />
                    <small style={{ color: "var(--text-3)" }}>{e.requestedDate.slice(0, 10)} · {e.requestedTimeWindow}</small>
                    {" "}
                    <span className={"ec-badge " + (e.status === "NOTIFIED" ? "confirmed" : "")}>{e.status === "NOTIFIED" ? "notified" : "waiting"}</span>
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {e.status === "WAITING" && (
                      <MotionButton className="btn glass sm" onClick={() => notify(e.id)} disabled={busyId === e.id}>Notify</MotionButton>
                    )}
                    <MotionButton className="btn glass sm success" onClick={() => promote(e.id)} disabled={busyId === e.id}>Seat now</MotionButton>
                    <MotionButton className="btn glass sm danger" onClick={() => remove(e.id)} disabled={busyId === e.id}>Remove</MotionButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "var(--text-2)", fontSize: 13.5, marginBottom: 18 }}>No one's waiting right now.</p>
        )
      )}

      {resolved.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>Past entries ({resolved.length})</summary>
          <ul className="steps" style={{ marginTop: 8 }}>
            {resolved.map((e) => (
              <li key={e.id}>
                <i className="icon-user" />
                <span style={{ flex: 1 }}>
                  {e.guestName} <small style={{ color: "var(--text-3)" }}>· party of {e.partySize} · {e.requestedDate.slice(0, 10)}</small>
                </span>
                <span className={"ec-badge " + (e.status === "CONVERTED" ? "confirmed" : "out")}>{e.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function VenueWaitlistJoinForm({ venueId, onDone }: { venueId: string; onDone: () => void }) {
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [requestedDate, setRequestedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [requestedTimeWindow, setRequestedTimeWindow] = useState("19:00");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!guestName.trim() || !guestEmail.trim()) { setErr("Name and email are required."); return; }
    setSaving(true); setErr("");
    try {
      await api.joinVenueWaitlist(venueId, {
        guestName: guestName.trim(), guestEmail: guestEmail.trim(), guestPhone: guestPhone.trim() || undefined,
        partySize: Number(partySize) || 1, requestedDate, requestedTimeWindow, notes: notes.trim() || undefined,
      });
      onDone();
    } catch (e: any) {
      setErr(e.message || "Couldn't add that guest to the waitlist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dash-card" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="hint" style={{ margin: 0 }}><i className="icon-clock" /> Add a guest to the waitlist</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input className="toolbar-field" placeholder="Guest name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
        <input className="toolbar-field" placeholder="Email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
        <input className="toolbar-field" placeholder="Phone (optional)" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
        <input className="toolbar-field" inputMode="numeric" placeholder="Party size" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
        <input className="toolbar-field" type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
        <input className="toolbar-field" placeholder="Requested time, e.g. 19:00" value={requestedTimeWindow} onChange={(e) => setRequestedTimeWindow(e.target.value)} />
      </div>
      <input className="toolbar-field" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {err && <p className="errline">{err}</p>}
      <MotionButton className="btn glass" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Add to waitlist"}</MotionButton>
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
                <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={() => setExpanded(expanded === g.email ? null : g.email)}>
                  {expanded === g.email ? "Close" : "Details"}
                </MotionButton>
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
      <input className="toolbar-field" placeholder="Tags, comma-separated (VIP, regular, allergy: nuts…)" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
      <textarea className="toolbar-field" rows={2} placeholder="Notes on this guest (allergies, preferences, VIP…)" value={text} onChange={(e) => setText(e.target.value)} />
      <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</MotionButton>
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
  const [goal, setGoal] = useState("");
  const [drafting, setDrafting] = useState(false);

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

  async function aiDraft() {
    if (!goal.trim()) { setErr("Describe what this campaign should achieve first."); return; }
    setDrafting(true); setErr("");
    try {
      const segmentLabel = SEGMENT_OPTIONS.find((o) => o.key === segmentType)?.label || "your guests";
      const draft = await api.aiDraftVenueCampaign(venueId, goal.trim(), segmentLabel);
      setSubject(draft.subject); setMessage(draft.message);
    } catch (e: any) {
      setErr(e.message || "Couldn't draft that right now.");
    } finally {
      setDrafting(false);
    }
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
            <input className="toolbar-field" style={{ marginTop: 8 }} placeholder="Tag (e.g. VIP)" value={tag} onChange={(e) => setTag(e.target.value)} />
          )}
          {segmentType === "inactive" && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13 }}>Haven't visited in</span>
              <input className="toolbar-field" type="number" style={{ width: 70 }} value={days} onChange={(e) => setDays(e.target.value)} />
              <span style={{ fontSize: 13 }}>days</span>
            </div>
          )}
          <p style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8 }}>
            {previewing ? "Checking…" : preview ? `${preview.count} guest${preview.count === 1 ? "" : "s"}${preview.sample.length ? ` — e.g. ${preview.sample.join(", ")}` : ""}` : "—"}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input className="toolbar-field" style={{ flex: 1 }} placeholder="What's this campaign for? e.g. win back guests who haven't visited in a while" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={aiDraft} disabled={drafting}>
            <i className="icon-sparkles" /> {drafting ? "Drafting…" : "AI draft"}
          </MotionButton>
        </div>
        <input className="toolbar-field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="toolbar-field" rows={4} placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div>
          <label style={{ fontSize: 12.5, color: "var(--text-2)", display: "block", marginBottom: 6 }}>Send now, or schedule for later</label>
          <input className="toolbar-field" type="datetime-local" value={scheduleFor} onChange={(e) => setScheduleFor(e.target.value)} />
        </div>

        {err && <p className="errline">{err}</p>}
        {result && <p className="hint">{result}</p>}
        <MotionButton className="btn glass" onClick={send} disabled={sending || !preview?.count}>
          {sending ? "Sending…" : scheduleFor ? "Schedule campaign" : `Send to ${preview?.count ?? 0} guest${preview?.count === 1 ? "" : "s"}`}
        </MotionButton>
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
                <MotionButton className="btn glass sm" style={{ marginLeft: "auto" }} onClick={() => cancel(c.id)}>Cancel</MotionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Marketing Hub: win-back tracking, loyalty/referral, UTM link
// builder, cross-campaign calendar, brand kit. A sub-tabbed section
// (separate top-level nav entry from the plain "Marketing" send-a-campaign
// tab above) since these are five distinct standalone tools, not one form.
const HUB_SECTIONS = [
  { key: "winback", label: "Win-back" },
  { key: "loyalty", label: "Loyalty" },
  { key: "accounts", label: "Connected accounts" },
  { key: "email", label: "Email list" },
  { key: "growth", label: "Growth ideas" },
  { key: "links", label: "UTM Links" },
  { key: "calendar", label: "Calendar" },
  { key: "brand", label: "Brand Kit" },
] as const;
type HubSectionKey = typeof HUB_SECTIONS[number]["key"];

function VenueMarketingHub({ venueId }: { venueId: string }) {
  const [section, setSection] = useState<HubSectionKey>("winback");
  return (
    <>
      <div className="chips" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {HUB_SECTIONS.map((s) => (
          <button key={s.key} className={"chip" + (section === s.key ? " on" : "")} onClick={() => setSection(s.key)}>{s.label}</button>
        ))}
      </div>
      {section === "winback" && <VenueWinBack venueId={venueId} />}
      {section === "loyalty" && <VenueLoyalty venueId={venueId} />}
      {section === "accounts" && <VenueConnectedAccounts venueId={venueId} />}
      {section === "email" && <VenueEmailList venueId={venueId} />}
      {section === "growth" && <VenueGrowthIdeas venueId={venueId} />}
      {section === "links" && <VenueMarketingLinks venueId={venueId} />}
      {section === "calendar" && <VenueMarketingCalendar venueId={venueId} />}
      {section === "brand" && <VenueBrandKitEditor venueId={venueId} />}
    </>
  );
}

// ---- Win-back: identify lapsed guests (reuses the existing "inactive"
// segment + AI-draft), send from here, and see how many of the guests that
// specific past campaign was sent to actually booked again since.
function VenueWinBack({ venueId }: { venueId: string }) {
  const { data: campaigns, loading } = useAsync(() => api.venueCampaigns(venueId), [venueId]);
  const [days, setDays] = useState("60");
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [goal, setGoal] = useState("Bring back guests who haven't visited in a while");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");
  const [stats, setStats] = useState<Record<string, WinBackStats>>({});
  const [statsWindow, setStatsWindow] = useState("30");

  // Psychology-informed copy variants — a toggle next to the campaign
  // draft, mirroring the organizer Marketing Hub's ad-copy angle picker.
  const [angle, setAngle] = useState<PersuasionAngle>("scarcity");
  const [angling, setAngling] = useState(false);
  const [angledResult, setAngledResult] = useState<{ instagram?: string; whatsapp?: string } | null>(null);

  // Bulk ad-variant generation for A/B testing at scale.
  const [bulkPlatform, setBulkPlatform] = useState<"google" | "meta">("meta");
  const [bulkCount, setBulkCount] = useState(6);
  const [bulkVariants, setBulkVariants] = useState<AdVariant[] | null>(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);

  async function applyAngle() {
    setAngling(true);
    try { setAngledResult(await api.venueAngledCopy(venueId, angle)); } finally { setAngling(false); }
  }
  async function generateMoreVariants() {
    setBulkGenerating(true);
    try {
      const res = await api.venueBulkAdVariants(venueId, { platform: bulkPlatform, count: bulkCount });
      setBulkVariants(res.variants);
    } finally {
      setBulkGenerating(false);
    }
  }

  const segment: VenueSegment = { type: "inactive", days: Number(days) || 60 };

  async function loadPreview() {
    setPreviewing(true);
    try { setPreview(await api.venueSegmentPreview(venueId, segment)); } finally { setPreviewing(false); }
  }
  useEffect(() => { loadPreview(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  async function aiDraft() {
    if (!goal.trim()) { setErr("Describe the goal first."); return; }
    setDrafting(true); setErr("");
    try {
      const draft = await api.aiDraftVenueCampaign(venueId, goal.trim(), `guests who haven't visited in ${days} days`);
      setSubject(draft.subject); setMessage(draft.message);
    } catch (e: any) {
      setErr(e.message || "Couldn't draft that right now.");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!subject.trim() || !message.trim()) { setErr("Subject and message are required."); return; }
    setSending(true); setErr(""); setResult("");
    try {
      const res = await api.createVenueCampaign(venueId, { subject: subject.trim(), message: message.trim(), segment });
      setResult(`Sent to ${res.emailed ?? 0} of ${res.recipients ?? 0} lapsed guests.`);
      setSubject(""); setMessage("");
    } catch (e: any) {
      setErr(e.message || "Couldn't send that campaign.");
    } finally {
      setSending(false);
    }
  }

  const winBackCampaigns = (campaigns || []).filter((c) => c.segment?.type === "inactive" && c.status === "sent");

  async function loadStats(campaignId: string) {
    const s = await api.venueWinBackStats(venueId, campaignId, Number(statsWindow) || 30);
    setStats((prev) => ({ ...prev, [campaignId]: s }));
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-megaphone" /> Win back lapsed guests</p>
      <div className="dash-card" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13 }}>Haven't visited in</span>
          <input className="toolbar-field" type="number" style={{ width: 70 }} value={days} onChange={(e) => setDays(e.target.value)} />
          <span style={{ fontSize: 13 }}>days</span>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-2)" }}>
          {previewing ? "Checking…" : preview ? `${preview.count} lapsed guest${preview.count === 1 ? "" : "s"}${preview.sample.length ? ` — e.g. ${preview.sample.join(", ")}` : ""}` : "—"}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="toolbar-field" style={{ flex: 1 }} value={goal} onChange={(e) => setGoal(e.target.value)} />
          <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={aiDraft} disabled={drafting}>
            <i className="icon-sparkles" /> {drafting ? "Drafting…" : "AI draft"}
          </MotionButton>
        </div>
        <input className="toolbar-field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="toolbar-field" rows={4} placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} />
        {err && <p className="errline">{err}</p>}
        {result && <p className="hint">{result}</p>}
        <MotionButton className="btn glass" onClick={send} disabled={sending || !preview?.count}>
          {sending ? "Sending…" : `Send win-back to ${preview?.count ?? 0} guest${preview?.count === 1 ? "" : "s"}`}
        </MotionButton>
      </div>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>Psychology-informed copy variants</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select className="toolbar-field" value={angle} onChange={(e) => setAngle(e.target.value as PersuasionAngle)}>
            <option value="scarcity">Scarcity</option>
            <option value="social_proof">Social proof</option>
            <option value="urgency">Urgency / FOMO</option>
            <option value="exclusivity">Exclusivity</option>
          </select>
          <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={applyAngle} disabled={angling}>
            <i className="icon-zap" /> {angling ? "Re-angling…" : "Re-angle copy"}
          </MotionButton>
        </div>
        {angledResult && (
          <div className="marketing-card" style={{ marginTop: 10 }}>
            {angledResult.instagram && <><b>Instagram ({angle.replace("_", " ")})</b><pre className="marketing-text">{angledResult.instagram}</pre></>}
            {angledResult.whatsapp && <><b>WhatsApp</b><pre className="marketing-text">{angledResult.whatsapp}</pre></>}
          </div>
        )}
      </div>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>Bulk ad variants (A/B testing)</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select className="toolbar-field" value={bulkPlatform} onChange={(e) => setBulkPlatform(e.target.value as "google" | "meta")}>
            <option value="meta">Meta (Facebook/Instagram)</option>
            <option value="google">Google Search</option>
          </select>
          <input type="number" min={1} max={10} className="toolbar-field" style={{ width: 70 }} value={bulkCount} onChange={(e) => setBulkCount(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
          <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={generateMoreVariants} disabled={bulkGenerating}>
            <i className="icon-refresh-cw" /> {bulkGenerating ? "Generating…" : "Generate variants"}
          </MotionButton>
        </div>
        {bulkVariants && bulkVariants.map((v, i) => (
          <div className="marketing-card" key={i} style={{ marginTop: 10 }}>
            <b>{v.headline}</b>
            <pre className="marketing-text">{v.description}</pre>
          </div>
        ))}
      </div>

      <p className="hint" style={{ margin: "4px 0 8px" }}>Past win-back campaigns · conversion within</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <input className="toolbar-field" type="number" style={{ width: 70 }} value={statsWindow} onChange={(e) => setStatsWindow(e.target.value)} />
        <span style={{ fontSize: 13 }}>days of send</span>
      </div>
      {loading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !winBackCampaigns.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No win-back campaigns sent yet.</p>
      ) : (
        <ul className="steps">
          {winBackCampaigns.map((c) => (
            <li key={c.id}>
              <i className="icon-megaphone" />
              <span style={{ flex: 1 }}>
                {c.subject || "(no subject)"}
                <br />
                <small style={{ color: "var(--text-3)" }}>
                  Sent {new Date(c.sentAt!).toLocaleDateString()} · {c.recipientCount ?? "?"} recipients
                  {stats[c.id] && ` · ${stats[c.id].converted} of ${stats[c.id].targeted} booked again (${stats[c.id].rate != null ? Math.round(stats[c.id].rate! * 100) : "—"}%)`}
                </small>
              </span>
              <MotionButton className="btn glass sm" style={{ marginLeft: "auto" }} onClick={() => loadStats(c.id)}>Check conversion</MotionButton>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Loyalty: punch-card visit tiers (bronze/silver/gold), computed live
// from reservation history, plus a per-guest referral code the owner can
// issue and share. No payment/discount processing.
const TIER_BADGE_CLASS: Record<string, string> = { gold: "confirmed", silver: "", bronze: "" };
function VenueLoyalty({ venueId }: { venueId: string }) {
  const { data, loading, reload } = useAsync(() => api.venueLoyalty(venueId), [venueId]);
  const [issuing, setIssuing] = useState<string | null>(null);

  async function issue(email: string) {
    setIssuing(email);
    try { await api.issueVenueReferralCode(venueId, email); reload(); } finally { setIssuing(null); }
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-user" /> Loyalty & referrals</p>
      {data?.tiers && (
        <p style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 10 }}>
          {data.tiers.map((t) => `${t.label} at ${t.minVisits}+ visits`).join(" · ")}
        </p>
      )}
      {loading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !data?.guests.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No guests yet.</p>
      ) : (
        <ul className="steps">
          {data.guests.map((g: VenueLoyaltyGuest) => (
            <li key={g.email}>
              <i className="icon-user" />
              <span style={{ flex: 1 }}>
                {g.name} <small style={{ color: "var(--text-3)" }}>· {g.email}</small>
                {g.tier && <span className={"ec-badge " + TIER_BADGE_CLASS[g.tier]} style={{ marginLeft: 6, textTransform: "capitalize" }}>{g.tier}</span>}
                <br />
                <small style={{ color: "var(--text-3)" }}>
                  {g.visits} visit{g.visits === 1 ? "" : "s"}
                  {g.referralCode ? ` · referral code ${g.referralCode} (${g.referralCount} referral${g.referralCount === 1 ? "" : "s"})` : ""}
                </small>
              </span>
              {!g.referralCode && (
                <MotionButton className="btn glass sm" style={{ marginLeft: "auto" }} onClick={() => issue(g.email)} disabled={issuing === g.email}>
                  {issuing === g.email ? "Issuing…" : "Issue referral code"}
                </MotionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- UTM link builder: trackable links per venue/campaign source ----
function VenueMarketingLinks({ venueId }: { venueId: string }) {
  const { data: links, loading, reload } = useAsync(() => api.venueMarketingLinks(venueId), [venueId]);
  const [label, setLabel] = useState("");
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("instagram");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    if (!label.trim() || !utmSource.trim() || !utmMedium.trim() || !utmCampaign.trim()) {
      setErr("Label, source, medium, and campaign are all required.");
      return;
    }
    setSaving(true); setErr("");
    try {
      await api.createVenueMarketingLink(venueId, { label: label.trim(), utmSource: utmSource.trim(), utmMedium: utmMedium.trim(), utmCampaign: utmCampaign.trim() });
      setLabel(""); setUtmSource(""); setUtmCampaign("");
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't create that link.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await api.deleteVenueMarketingLink(venueId, id);
    reload();
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-link" /> New trackable link</p>
      <div className="dash-card" style={{ padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="toolbar-field" placeholder="Label (e.g. Instagram bio link)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="toolbar-field" style={{ flex: 1, minWidth: 120 }} placeholder="utm_source (e.g. instagram)" value={utmSource} onChange={(e) => setUtmSource(e.target.value)} />
          <input className="toolbar-field" style={{ flex: 1, minWidth: 120 }} placeholder="utm_medium (e.g. social)" value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} />
          <input className="toolbar-field" style={{ flex: 1, minWidth: 120 }} placeholder="utm_campaign (e.g. summer-launch)" value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} />
        </div>
        {err && <p className="errline">{err}</p>}
        <MotionButton className="btn glass" onClick={create} disabled={saving}>{saving ? "Creating…" : "Create link"}</MotionButton>
      </div>

      {loading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !links?.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No links yet.</p>
      ) : (
        <ul className="steps">
          {links.map((l: VenueMarketingLink) => (
            <li key={l.id} style={{ alignItems: "flex-start" }}>
              <i className="icon-link" />
              <span style={{ flex: 1 }}>
                {l.label} <small style={{ color: "var(--text-3)" }}>· {l.utmSource}/{l.utmMedium}/{l.utmCampaign}</small>
                <br />
                <small style={{ color: "var(--text-3)", wordBreak: "break-all" }}>{l.url}</small>
              </span>
              <MotionButton className="btn glass sm" style={{ marginLeft: "auto" }} onClick={() => remove(l.id)}>Delete</MotionButton>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Connected accounts: Meta OAuth connect + real Instagram posting for
// this venue, the venue-dashboard mirror of the organizer Marketing Hub's
// ConnectedAccountsSection. ----
function VenueConnectedAccounts({ venueId }: { venueId: string }) {
  const { data: accounts, loading, reload } = useAsync(() => api.listVenueSocialAccounts(venueId), [venueId]);
  const meta = (accounts as SocialAccountConnection[] | undefined)?.find((a) => a.provider === "meta");
  const { data: posts, reload: reloadPosts } = useAsync(() => api.listVenueSocialPosts(venueId), [venueId]);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [postErr, setPostErr] = useState("");

  async function disconnect(id: string) {
    if (!confirm("Disconnect this account? You'll need to reconnect to post again.")) return;
    await api.disconnectVenueSocialAccount(venueId, id);
    reload();
  }
  async function post(confirmRepost?: boolean) {
    if (!caption.trim()) return;
    setPosting(true); setPostErr("");
    try {
      await api.postVenueToInstagram(venueId, { caption: caption.trim(), confirmRepost });
      reloadPosts();
    } catch (e: any) {
      if (e?.error?.code === "ALREADY_POSTED" || e?.code === "ALREADY_POSTED") {
        if (confirm("This venue was already posted to Instagram. Post again anyway?")) return post(true);
      } else {
        setPostErr(e.message || "Couldn't post");
      }
    } finally {
      setPosting(false);
    }
  }

  if (loading) return <p className="hint">Loading…</p>;

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-2)" }}>
        Connect your Instagram/Facebook so Weyn can actually publish your venue's campaign copy — not just hand you text to paste.
      </p>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        {meta ? (
          <>
            <p className="hint" style={{ margin: "0 0 8px" }}>
              <i className="icon-instagram" /> Connected — posting via <b>{meta.pageName || "your Facebook Page"}</b>
            </p>
            <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={() => disconnect(meta.id)}>
              <i className="icon-x" /> Disconnect
            </MotionButton>
          </>
        ) : (
          <>
            <p className="hint" style={{ margin: "0 0 10px" }}>Not connected yet.</p>
            <a className="btn glass sm" style={{ width: "auto" }} href={api.connectVenueMetaUrl(venueId)}>
              <i className="icon-instagram" /> Connect Instagram / Facebook
            </a>
            <p className="hint" style={{ marginTop: 10, color: "var(--text-3)" }}>
              Requires this Weyn deployment to have Meta app credentials configured — if the button leads to an error, this isn't turned on here yet.
            </p>
          </>
        )}
      </div>

      {meta && (
        <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
          <p className="hint" style={{ margin: "0 0 10px" }}>Post to Instagram</p>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} style={{ width: "100%", marginBottom: 10 }} placeholder="Caption…" />
          {postErr && <p className="errline">{postErr}</p>}
          <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={() => post()} disabled={posting || !caption.trim()}>
            <i className="icon-send" /> {posting ? "Posting…" : "Post now"}
          </MotionButton>
        </div>
      )}

      {!!(posts as VenueSocialPost[] | undefined)?.length && (
        <>
          <p className="section-label">Post history</p>
          <ul className="steps">
            {(posts as VenueSocialPost[]).map((p) => (
              <li key={p.id}>
                <i className={p.status === "posted" ? "icon-check" : "icon-x"} />
                <span>
                  <b>{p.provider}</b> — {p.status} <span className="hint">{new Date(p.postedAt).toLocaleString()}</span>
                  {p.error && <><br /><small style={{ color: "var(--text-3)" }}>{p.error}</small></>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ---- Email list: real subscriber list + campaign send for this venue,
// the venue-dashboard mirror of the organizer Marketing Hub's
// EmailListSection. ----
function VenueEmailList({ venueId }: { venueId: string }) {
  const { data: contacts, loading, reload } = useAsync(() => api.listVenueMarketingContacts(venueId), [venueId]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [saving, setSaving] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ recipients: number; sent: number } | null>(null);

  const subscribedCount = (contacts as VenueMarketingContact[] | undefined)?.filter((c) => c.subscribed).length ?? 0;

  async function addContact() {
    if (!email.trim()) return;
    setSaving(true);
    try { await api.addVenueMarketingContact(venueId, { email: email.trim(), name: name.trim() || undefined }); setEmail(""); setName(""); reload(); } finally { setSaving(false); }
  }
  async function importCsv() {
    if (!csv.trim()) return;
    setSaving(true); setImportMsg("");
    try {
      const res = await api.importVenueMarketingContacts(venueId, csv);
      setImportMsg(`Imported ${res.imported} of ${res.total} (${res.skipped} skipped)`);
      setCsv("");
      reload();
    } finally {
      setSaving(false);
    }
  }
  async function removeContact(id: string) {
    await api.deleteVenueMarketingContact(venueId, id);
    reload();
  }
  async function send() {
    if (!subject.trim() || !body.trim()) return;
    setSending(true); setSendResult(null);
    try {
      const res = await api.sendVenueEmailCampaign(venueId, { subject: subject.trim(), body: body.trim() });
      setSendResult({ recipients: res.recipients, sent: res.sent });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-2)" }}>
        A real, separately-consented subscriber list — distinct from guests who've just booked a table — with a genuine one-click unsubscribe on every send.
      </p>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>Add a subscriber</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div className="field" style={{ margin: 0 }}><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></div>
          <div className="field" style={{ margin: 0 }}><label>Name (optional)</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={addContact} disabled={saving || !email.trim()}>
          <i className="icon-plus" /> Add
        </MotionButton>
      </div>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>Import CSV (email,name per line)</p>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} style={{ width: "100%", marginBottom: 10 }} placeholder={"email,name\njane@example.com,Jane"} />
        {importMsg && <p className="hint">{importMsg}</p>}
        <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={importCsv} disabled={saving || !csv.trim()}>
          <i className="icon-upload" /> Import
        </MotionButton>
      </div>

      {loading ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          <p className="hint" style={{ margin: "0 0 8px" }}>{subscribedCount} subscribed contact{subscribedCount === 1 ? "" : "s"}</p>
          <ul className="steps">
            {((contacts as VenueMarketingContact[] | undefined) || []).map((c) => (
              <li key={c.id} style={{ opacity: c.subscribed ? 1 : 0.5 }}>
                <i className="icon-mail" />
                <span><b>{c.email}</b> {c.name && <span className="hint">{c.name}</span>} {!c.subscribed && <span className="hint">(unsubscribed)</span>}</span>
                <MotionButton className="btn glass sm" style={{ marginLeft: "auto", width: "auto" }} onClick={() => removeContact(c.id)}><i className="icon-x" /></MotionButton>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="section-label">Send a campaign</p>
      <div className="dash-card" style={{ padding: 14 }}>
        <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label>Body</label><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} style={{ width: "100%" }} /></div>
        {sendResult && <p className="hint">Sent to {sendResult.sent} of {sendResult.recipients} recipients.</p>}
        <MotionButton className="btn glass" onClick={send} disabled={sending || !subject.trim() || !body.trim()} style={{ marginTop: 4 }}>
          <i className="icon-send" /> {sending ? "Sending…" : `Send to ${subscribedCount} subscriber${subscribedCount === 1 ? "" : "s"}`}
        </MotionButton>
      </div>
    </>
  );
}

// ---- Growth ideas: tactical suggestions + free-tool/lead-magnet concepts
// for this venue, the venue-dashboard mirror of the organizer Marketing
// Hub's GrowthIdeasSection. ----
function VenueGrowthIdeas({ venueId }: { venueId: string }) {
  const { data: growth, loading: growthLoading, reload: reloadGrowth } = useAsync(() => api.venueGrowthIdeas(venueId), [venueId]);
  const { data: freeTool, loading: freeToolLoading, reload: reloadFreeTool } = useAsync(() => api.venueFreeToolIdeas(venueId), [venueId]);

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-2)" }}>
        Concrete, tactical ideas for this specific venue — not generic "post on social media" advice.
      </p>

      <p className="section-label">Growth ideas <button className="copy-btn" onClick={reloadGrowth}><i className="icon-refresh-cw" /> Regenerate</button></p>
      {growthLoading ? <p className="hint">Loading…</p> : (
        <ul className="steps">
          {(growth?.ideas || []).map((idea, i) => (
            <li key={i}>
              <i className="icon-trending-up" />
              <span><b>{idea.title}</b><br /><small style={{ color: "var(--text-3)" }}>{idea.description}</small></span>
            </li>
          ))}
        </ul>
      )}

      <p className="section-label">Free tool / lead magnet ideas <button className="copy-btn" onClick={reloadFreeTool}><i className="icon-refresh-cw" /> Regenerate</button></p>
      {freeToolLoading ? <p className="hint">Loading…</p> : (
        <ul className="steps">
          {(freeTool?.ideas || []).map((idea, i) => (
            <li key={i}>
              <i className="icon-gift" />
              <span><b>{idea.name}</b><br /><small style={{ color: "var(--text-3)" }}>{idea.description}</small><br /><small style={{ color: "var(--text-3)" }}>Why: {idea.why}</small></span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Marketing calendar: every scheduled/sent campaign for this venue in
// one timeline. ----
function VenueMarketingCalendar({ venueId }: { venueId: string }) {
  const { data: items, loading } = useAsync(() => api.venueMarketingCalendar(venueId), [venueId]);
  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-calendar" /> Marketing calendar</p>
      {loading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !items?.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>Nothing scheduled or sent yet — campaigns you create in Win-back or Marketing show up here.</p>
      ) : (
        <ul className="steps">
          {items.map((it: VenueMarketingCalendarItem) => (
            <li key={it.id}>
              <i className="icon-calendar" />
              <span>
                {it.subject || "(no subject)"} <span className={"ec-badge " + (it.status === "sent" ? "confirmed" : "")}>{it.status}</span>
                <br />
                <small style={{ color: "var(--text-3)" }}>{it.date ? new Date(it.date).toLocaleString() : "—"}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Brand kit: feeds the AI campaign-copy prompt so drafts stay on-brand ----
function VenueBrandKitEditor({ venueId }: { venueId: string }) {
  const { data, loading, reload } = useAsync(() => api.venueBrandKit(venueId), [venueId]);
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) { setLogoUrl(data.logoUrl || ""); setPrimaryColor(data.primaryColor || ""); setToneOfVoice(data.toneOfVoice || ""); }
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      await api.setVenueBrandKit(venueId, { logoUrl: logoUrl.trim() || null, primaryColor: primaryColor.trim() || null, toneOfVoice: toneOfVoice.trim() || null });
      reload();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>;

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-sparkles" /> Brand kit</p>
      <p style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 10 }}>Feeds every AI-drafted campaign for this venue — the AI will follow this tone and mention your color where relevant.</p>
      <div className="dash-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="toolbar-field" placeholder="Logo URL" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
        <input className="toolbar-field" placeholder="Primary brand color (e.g. #E63946)" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
        <input className="toolbar-field" placeholder="Tone of voice (e.g. playful and casual)" value={toneOfVoice} onChange={(e) => setToneOfVoice(e.target.value)} />
        <MotionButton className="btn glass" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save brand kit"}</MotionButton>
      </div>
    </>
  );
}

const TRIGGER_LABELS: Record<VenueWorkflowTrigger, string> = {
  reservation_created: "Reservation created",
  reservation_cancelled: "Reservation cancelled",
  guest_no_show: "Guest no-shows",
};
const CONDITION_FIELD_LABELS: Record<VenueConditionField, string> = {
  partySize: "Party size",
  guestTag: "Guest tag",
  reservationSource: "Booking source",
  reservationNotes: "Reservation notes",
};
const ACTION_LABELS: Record<VenueWorkflowAction, string> = {
  notify_owner: "Notify me (email)",
  tag_guest: "Tag the guest",
  send_guest_email: "Email the guest",
  send_guest_sms: "Text the guest (coming soon)",
};

const TRIGGER_DESCRIPTIONS: Record<VenueWorkflowTrigger, string> = {
  reservation_created: "Fires the instant a guest books a reservation at this venue.",
  reservation_cancelled: "Fires the instant a reservation is cancelled — by the guest or by you.",
  guest_no_show: "Fires when you mark a reservation as a no-show.",
};
const CONDITION_FIELD_DESCRIPTIONS: Record<VenueConditionField, string> = {
  partySize: "Only continue down this branch if the reservation's party size matches.",
  guestTag: "Only continue down this branch based on a tag already on the guest's profile (set by a previous \"Tag the guest\" action, for example).",
  reservationSource: "Only continue down this branch based on how the reservation was made — a guest self-booking, or one you entered manually (phone/walk-in).",
  reservationNotes: "Only continue down this branch if the reservation's notes contain a specific word or phrase.",
};
const ACTION_DESCRIPTIONS: Record<VenueWorkflowAction, string> = {
  notify_owner: "Sends you (the venue owner) an email — use it for anything you want a heads-up on.",
  tag_guest: "Adds a tag to the guest's profile, so later workflows/conditions can key off it.",
  send_guest_email: "Sends an email straight to the guest who made the reservation.",
  send_guest_sms: "Not available yet — there's no SMS provider set up for this venue, so this action will report an error until that's added.",
};

let wfNodeCounter = 0;
function newNodeId() { wfNodeCounter += 1; return `node-${Date.now()}-${wfNodeCounter}`; }

function defaultDataFor(type: WFNodeType): Record<string, any> {
  if (type === "trigger") return { trigger: "reservation_created" };
  if (type === "condition") return { field: "partySize", op: ">=", value: "" };
  return { action: "notify_owner", config: {} };
}

function defaultOpForField(field: string): string {
  if (field === "guestTag") return "has";
  if (field === "reservationSource") return "==";
  if (field === "reservationNotes") return "contains";
  return ">=";
}

function nodeLabel(n: WFNode): { title: string; subtitle: string } {
  if (n.type === "trigger") return { title: TRIGGER_LABELS[n.data.trigger as VenueWorkflowTrigger] || n.data.trigger, subtitle: "Trigger" };
  if (n.type === "condition") {
    const field = CONDITION_FIELD_LABELS[n.data.field as VenueConditionField] || n.data.field;
    return { title: `${field} ${n.data.op} ${n.data.value}`, subtitle: "Condition" };
  }
  const cfg = n.data.config || {};
  const subtitle = n.data.action === "tag_guest" ? (cfg.tag || "no tag set") : n.data.action === "send_guest_sms" ? "not set up yet" : (cfg.subject || "no subject set");
  return { title: ACTION_LABELS[n.data.action as VenueWorkflowAction] || n.data.action, subtitle };
}

// ---- Workflow templates: hardcoded, curated starting points built only
// from the real trigger/condition/action catalog in
// server/venue-workflows.js — small enough that a per-venue DB-backed
// catalog isn't worth it. Node ids here are placeholders re-generated via
// newNodeId() at insertion time (see instantiateTemplate) so multiple
// insertions of the same template never collide.
type WFTemplate = { id: string; name: string; description: string; nodes: WFNode[]; edges: WFEdge[] };

const WORKFLOW_TEMPLATES: WFTemplate[] = [
  {
    id: "notify-every-reservation",
    name: "Notify me on every reservation",
    description: "Get an email the moment any reservation is booked.",
    nodes: [
      { id: "trigger", type: "trigger", x: 30, y: 30, data: { trigger: "reservation_created" } },
      { id: "notify", type: "action", x: 280, y: 30, data: { action: "notify_owner", config: { subject: "New reservation" } } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "notify" }],
  },
  {
    id: "notify-large-parties",
    name: "Notify me on large parties",
    description: "Get an email only when a booking is for a big group (6+).",
    nodes: [
      { id: "trigger", type: "trigger", x: 30, y: 30, data: { trigger: "reservation_created" } },
      { id: "cond", type: "condition", x: 280, y: 30, data: { field: "partySize", op: ">=", value: "6" } },
      { id: "notify", type: "action", x: 530, y: 30, data: { action: "notify_owner", config: { subject: "Large party booked" } } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "cond" }, { id: "e2", source: "cond", target: "notify" }],
  },
  {
    id: "auto-tag-vip-no-shows",
    name: "Auto-tag VIP no-shows",
    description: "Tag a guest \"Frequent no-show\" whenever they no-show.",
    nodes: [
      { id: "trigger", type: "trigger", x: 30, y: 30, data: { trigger: "guest_no_show" } },
      { id: "tag", type: "action", x: 280, y: 30, data: { action: "tag_guest", config: { tag: "Frequent no-show" } } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "tag" }],
  },
  {
    id: "thank-returning-guests",
    name: "Thank returning guests",
    description: "Email a thank-you to guests already tagged \"Repeat guest\" when they book again.",
    nodes: [
      { id: "trigger", type: "trigger", x: 30, y: 30, data: { trigger: "reservation_created" } },
      { id: "cond", type: "condition", x: 280, y: 30, data: { field: "guestTag", op: "has", value: "Repeat guest" } },
      { id: "email", type: "action", x: 530, y: 30, data: { action: "send_guest_email", config: { subject: "Thanks for coming back!", message: "We noticed you booked with us again — thank you for being a regular! See you soon." } } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "cond" }, { id: "e2", source: "cond", target: "email" }],
  },
  {
    id: "cancellation-follow-up",
    name: "Cancellation follow-up",
    description: "Email a guest when they cancel, then tag them so you can follow up later.",
    nodes: [
      { id: "trigger", type: "trigger", x: 30, y: 30, data: { trigger: "reservation_cancelled" } },
      { id: "email", type: "action", x: 280, y: 30, data: { action: "send_guest_email", config: { subject: "Sorry to see you cancel", message: "We're sorry your plans changed — hope to host you another time soon." } } },
      { id: "tag", type: "action", x: 530, y: 30, data: { action: "tag_guest", config: { tag: "Cancelled recently" } } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "email" }, { id: "e2", source: "email", target: "tag" }],
  },
  {
    id: "vip-no-show-alert",
    name: "VIP no-show alert",
    description: "Get an email whenever a guest already tagged \"VIP\" no-shows.",
    nodes: [
      { id: "trigger", type: "trigger", x: 30, y: 30, data: { trigger: "guest_no_show" } },
      { id: "cond", type: "condition", x: 280, y: 30, data: { field: "guestTag", op: "has", value: "VIP" } },
      { id: "notify", type: "action", x: 530, y: 30, data: { action: "notify_owner", config: { subject: "VIP no-show" } } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "cond" }, { id: "e2", source: "cond", target: "notify" }],
  },
];

function instantiateTemplate(tpl: WFTemplate): { name: string; nodes: WFNode[]; edges: WFEdge[] } {
  const idMap = new Map<string, string>();
  const nodes = tpl.nodes.map((n) => {
    const id = newNodeId();
    idMap.set(n.id, id);
    return { ...n, id };
  });
  const edges = tpl.edges.map((e) => ({ ...e, id: newNodeId(), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
  return { name: tpl.name, nodes: layoutGraph(nodes, edges), edges };
}

// ---- Workflows: the visual node-graph automation builder — trigger ->
// condition(s) -> action(s), executed the instant the trigger actually
// happens (see server/venue-workflows.js). Deliberately not modeling true
// if/else branching, loops, or scheduled/retry execution yet — this is
// the real, working core of a graph editor (draggable nodes, click-to-
// connect edges, persisted + executed server-side), which the rest of
// the master automation-builder vision would extend.
function VenueWorkflows({ venueId }: { venueId: string }) {
  const { data: workflows, loading, reload } = useAsync(() => api.venueWorkflows(venueId), [venueId]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [starting, setStarting] = useState<{ name: string; nodes: WFNode[]; edges: WFEdge[] } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [creating, setCreating] = useState(false);

  function startNew() {
    const trigger: WFNode = { id: newNodeId(), type: "trigger", x: 30, y: 180, data: defaultDataFor("trigger") };
    setStarting({ name: "New workflow", nodes: [trigger], edges: [] });
  }

  function startFromTemplate(tpl: WFTemplate) {
    setStarting(instantiateTemplate(tpl));
    setShowTemplates(false);
  }

  async function toggle(wf: VenueWorkflow) {
    await api.setVenueWorkflowEnabled(venueId, wf.id, !wf.enabled);
    reload();
  }

  async function remove(wf: VenueWorkflow) {
    await api.deleteVenueWorkflow(venueId, wf.id);
    reload();
  }

  const editing = workflows?.find((w) => w.id === editingId);
  if (editing) {
    return <WorkflowEditor venueId={venueId} workflow={editing} onDone={() => { setEditingId(null); reload(); }} />;
  }
  if (starting) {
    return (
      <WorkflowEditor
        venueId={venueId}
        initial={starting}
        onDone={() => { setStarting(null); reload(); }}
      />
    );
  }

  if (showTemplates) {
    return (
      <>
        <p className="hint" style={{ margin: "4px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span><i className="icon-layout" /> Start from template</span>
          <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={() => setShowTemplates(false)}>Cancel</MotionButton>
        </p>
        <ul className="steps">
          {WORKFLOW_TEMPLATES.map((tpl) => (
            <li key={tpl.id}>
              <i className="icon-zap" />
              <span>
                {tpl.name}<br />
                <small style={{ color: "var(--text-3)" }}>{tpl.description}</small>
              </span>
              <MotionButton className="btn glass sm" style={{ marginLeft: "auto", width: "auto" }} onClick={() => startFromTemplate(tpl)}>Use this</MotionButton>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span><i className="icon-zap" /> Workflows</span>
        <span style={{ display: "flex", gap: 8 }}>
          <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={() => setShowTemplates(true)}>
            <i className="icon-layout" /> Start from template
          </MotionButton>
          <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={startNew} disabled={creating}>
            <i className="icon-plus" /> New workflow
          </MotionButton>
        </span>
      </p>

      {loading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !workflows?.length ? (
        <div className="dash-card" style={{ padding: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>No workflows yet</p>
          <p style={{ color: "var(--text-2)", fontSize: 13.5, margin: "0 0 12px" }}>
            A workflow is a simple <strong>trigger → condition → action</strong> chain: something happens at your venue
            (a reservation is booked, cancelled, or no-shows), you can optionally narrow it down (party size, guest tag),
            and then something happens automatically (notify you, tag the guest, or email them).
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={() => setShowTemplates(true)}>
              <i className="icon-layout" /> Start from template
            </MotionButton>
            <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={startNew} disabled={creating}>
              <i className="icon-plus" /> New workflow
            </MotionButton>
          </div>
        </div>
      ) : (
        <ul className="steps">
          {workflows.map((w) => {
            const trigger = w.nodes.find((n) => n.type === "trigger");
            const actionCount = w.nodes.filter((n) => n.type === "action").length;
            return (
              <li key={w.id}>
                <i className="icon-zap" />
                <span>
                  {w.name} <span className={"ec-badge " + (w.enabled ? "confirmed" : "")}>{w.enabled ? "on" : "off"}</span>
                  <br />
                  <small style={{ color: "var(--text-3)" }}>
                    {trigger ? TRIGGER_LABELS[trigger.data.trigger as VenueWorkflowTrigger] || trigger.data.trigger : "no trigger"} · {actionCount} action{actionCount === 1 ? "" : "s"}
                  </small>
                </span>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  <MotionButton className="btn glass sm" onClick={() => setEditingId(w.id)}>Edit</MotionButton>
                  <MotionButton className="btn glass sm" onClick={() => toggle(w)}>{w.enabled ? "Disable" : "Enable"}</MotionButton>
                  <MotionButton className="btn glass sm" onClick={() => remove(w)}><i className="icon-x" /></MotionButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function WorkflowEditor({ venueId, workflow, initial, onDone }: { venueId: string; workflow?: VenueWorkflow; initial?: { name: string; nodes: WFNode[]; edges: WFEdge[] }; onDone: () => void }) {
  const seed = workflow || initial!;
  const [workflowId, setWorkflowId] = useState<string | null>(workflow?.id || null);
  const [name, setName] = useState(seed.name);
  const [nodes, setNodes] = useState<WFNode[]>(seed.nodes);
  const [edges, setEdges] = useState<WFEdge[]>(seed.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(!workflowId);

  const selected = nodes.find((n) => n.id === selectedNodeId) || null;
  const unreachable = unreachableNodeIds(nodes, edges);
  let nextY = 40 + nodes.length * 90;

  // Auto-arrange once when a workflow is first created (brand-new blank
  // trigger, or freshly instantiated from a template) — nothing manual to
  // preserve yet at that point, so this doesn't fight in-progress edits.
  useEffect(() => {
    if (!workflowId) setNodes((ns) => layoutGraph(ns, edges));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addNode(type: WFNodeType) {
    const n: WFNode = { id: newNodeId(), type, x: 280 + (nodes.length % 3) * 200, y: nextY % (CANVAS_H_APPROX - 80), data: defaultDataFor(type) };
    setNodes([...nodes, n]);
    setSelectedNodeId(n.id);
    setDirty(true);
  }

  function autoArrange() {
    setNodes(layoutGraph(nodes, edges));
    setDirty(true);
  }

  function updateSelectedData(patch: Record<string, any>) {
    if (!selected) return;
    setNodes(nodes.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  }

  function deleteSelected() {
    if (!selected) return;
    if (selected.type === "trigger") { setErr("A workflow needs its trigger node — delete the whole workflow instead if you don't need this rule."); return; }
    setNodes(nodes.filter((n) => n.id !== selected.id));
    setEdges(edges.filter((e) => e.source !== selected.id && e.target !== selected.id));
    setSelectedNodeId(null);
    setDirty(true);
  }

  async function save() {
    setSaving(true); setErr("");
    try {
      if (workflowId) {
        await api.saveVenueWorkflow(venueId, workflowId, { name, nodes, edges });
      } else {
        const wf = await api.createVenueWorkflow(venueId, { name, nodes, edges });
        setWorkflowId(wf.id);
      }
      setDirty(false);
    } catch (e: any) {
      setErr(e.message || "Couldn't save — check every condition/action node is filled in.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={onDone}><i className="icon-arrow-left" /> Back</MotionButton>
        <input className="toolbar-field" style={{ flex: 1 }} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        {workflowId && <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={() => setShowRuns((v) => !v)}>{showRuns ? "Canvas" : "Run history"}</MotionButton>}
      </div>

      {showRuns && workflowId ? (
        <WorkflowRunsPanel venueId={venueId} workflowId={workflowId} />
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={() => addNode("condition")}><i className="icon-plus" /> Condition</MotionButton>
            <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={() => addNode("action")}><i className="icon-plus" /> Action</MotionButton>
            <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={autoArrange}><i className="icon-layout" /> Auto-arrange</MotionButton>
          </div>

          <WorkflowCanvas
            nodes={nodes} edges={edges}
            onNodesChange={(n) => { setNodes(n); setDirty(true); }}
            onEdgesChange={(e) => { setEdges(e); setDirty(true); }}
            onSelectNode={setSelectedNodeId} selectedNodeId={selectedNodeId}
            renderLabel={nodeLabel}
          />

          {selected && (
            <div className="dash-card" style={{ padding: 14, marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <p className="hint" style={{ margin: 0 }}>{selected.type === "trigger" ? "Trigger" : selected.type === "condition" ? "Condition" : "Action"}</p>
                {selected.type !== "trigger" && <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={deleteSelected}><i className="icon-x" /> Remove node</MotionButton>}
              </div>
              <p style={{ color: "var(--text-3)", fontSize: 12.5, margin: "0 0 10px" }}>
                {selected.type === "trigger" && (TRIGGER_DESCRIPTIONS[selected.data.trigger as VenueWorkflowTrigger] || "")}
                {selected.type === "condition" && (CONDITION_FIELD_DESCRIPTIONS[selected.data.field as VenueConditionField] || "")}
                {selected.type === "action" && (ACTION_DESCRIPTIONS[selected.data.action as VenueWorkflowAction] || "")}
              </p>
              {unreachable.includes(selected.id) && (
                <p className="hint" style={{ margin: "0 0 10px", color: "var(--warning)" }}>
                  <i className="icon-alert-triangle" /> This node isn't connected to the trigger yet, so it won't run — connect it (or a node upstream of it) to the flow.
                </p>
              )}

              {selected.type === "trigger" && (
                <div className="field" style={{ margin: 0 }}>
                  <label>When</label>
                  <select value={selected.data.trigger} onChange={(e) => updateSelectedData({ trigger: e.target.value })}>
                    {Object.entries(TRIGGER_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
              )}

              {selected.type === "condition" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Field</label>
                    <select value={selected.data.field} onChange={(e) => updateSelectedData({ field: e.target.value, op: defaultOpForField(e.target.value), value: "" })}>
                      {Object.entries(CONDITION_FIELD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Comparison</label>
                    {selected.data.field === "guestTag" ? (
                      <select value={selected.data.op} onChange={(e) => updateSelectedData({ op: e.target.value })}>
                        <option value="has">has tag</option>
                        <option value="not_has">doesn't have tag</option>
                      </select>
                    ) : selected.data.field === "reservationNotes" ? (
                      <select value={selected.data.op} onChange={(e) => updateSelectedData({ op: e.target.value })}>
                        <option value="contains">contains</option>
                        <option value="not_contains">doesn't contain</option>
                      </select>
                    ) : selected.data.field === "reservationSource" ? (
                      <select value={selected.data.op} disabled><option value="==">is</option></select>
                    ) : (
                      <select value={selected.data.op} onChange={(e) => updateSelectedData({ op: e.target.value })}>
                        <option value=">=">≥</option>
                        <option value="<=">≤</option>
                        <option value="==">=</option>
                      </select>
                    )}
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Value</label>
                    {selected.data.field === "reservationSource" ? (
                      <select value={selected.data.value} onChange={(e) => updateSelectedData({ value: e.target.value })}>
                        <option value="">Select…</option>
                        <option value="guest">Guest booking</option>
                        <option value="manual">Manual (phone/walk-in)</option>
                      </select>
                    ) : (
                      <input value={selected.data.value} onChange={(e) => updateSelectedData({ value: e.target.value })} placeholder={selected.data.field === "reservationNotes" ? "e.g. anniversary" : ""} />
                    )}
                  </div>
                </div>
              )}

              {selected.type === "action" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Do</label>
                    <select value={selected.data.action} onChange={(e) => updateSelectedData({ action: e.target.value, config: {} })}>
                      {Object.entries(ACTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  {selected.data.action === "tag_guest" ? (
                    <div className="field" style={{ margin: 0 }}>
                      <label>Tag to apply</label>
                      <input value={selected.data.config?.tag || ""} onChange={(e) => updateSelectedData({ config: { ...selected.data.config, tag: e.target.value } })} placeholder="e.g. Repeat guest" />
                    </div>
                  ) : selected.data.action === "send_guest_sms" ? (
                    <p className="hint" style={{ margin: 0, color: "var(--warning)" }}>
                      <i className="icon-alert-triangle" /> SMS isn't set up for this venue yet — this node will save fine, but it'll report an error each time it runs until a text provider is connected.
                    </p>
                  ) : (
                    <>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Subject</label>
                        <input value={selected.data.config?.subject || ""} onChange={(e) => updateSelectedData({ config: { ...selected.data.config, subject: e.target.value } })} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Message</label>
                        <textarea rows={3} value={selected.data.config?.message || ""} onChange={(e) => updateSelectedData({ config: { ...selected.data.config, message: e.target.value } })} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {err && <p className="errline" style={{ marginTop: 10 }}>{err}</p>}
          <MotionButton className="btn glass" style={{ marginTop: 10 }} onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save workflow" : "Saved ✓"}
          </MotionButton>
        </>
      )}
    </>
  );
}
const CANVAS_H_APPROX = 480;

function WorkflowRunsPanel({ venueId, workflowId }: { venueId: string; workflowId: string }) {
  const { data: runs, loading } = useAsync(() => api.venueWorkflowRuns(venueId, workflowId), [venueId, workflowId]);
  if (loading) return <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>;
  if (!runs?.length) return <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>This workflow hasn't run yet.</p>;
  return (
    <ul className="steps">
      {runs.map((r) => (
        <li key={r.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <i className="icon-zap" />
            <span style={{ flex: 1 }}>
              {TRIGGER_LABELS[r.trigger as VenueWorkflowTrigger] || r.trigger}
              {" "}<span className={"ec-badge " + (r.status === "success" ? "confirmed" : r.status === "failed" ? "out" : "")}>{r.status}</span>
              <br />
              <small style={{ color: "var(--text-3)" }}>{new Date(r.createdAt).toLocaleString()}</small>
            </span>
          </div>
          {r.matchedActions.length > 0 && (
            <div style={{ paddingLeft: 30, marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
              {r.matchedActions.map((m, i) => (
                <small key={i} style={{ color: m.ok ? "var(--text-3)" : "var(--danger)" }}>
                  {ACTION_LABELS[m.action as VenueWorkflowAction] || m.action} — {m.ok ? "ok" : m.error || "failed"}
                </small>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
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

// ---- Venue: the business-profile editor. Every field here already exists
// on the Venue model — this is the first UI that can ever change it after
// the venue-application was approved (previously permanently frozen at
// whatever the application captured).
function VenueProfileEditor({ venue }: { venue: OwnedVenue }) {
  const [name, setName] = useState(venue.name);
  const [description, setDescription] = useState(venue.description);
  const [category, setCategory] = useState<VenueCategory>(venue.category);
  const [address, setAddress] = useState(venue.venue);
  const [area, setArea] = useState(venue.area);
  const [priceRange, setPriceRange] = useState<PriceRange | "">(venue.priceRange || "");
  const [tagsText, setTagsText] = useState(venue.tags.join(", "));
  const [photos, setPhotos] = useState(venue.photos);
  const [removePhotos, setRemovePhotos] = useState<string[]>([]);
  const [newCover, setNewCover] = useState<File | null>(null);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const coverPreview = newCover ? URL.createObjectURL(newCover) : venue.coverImage;
  const visiblePhotos = photos.filter((p) => !removePhotos.includes(p));

  function toggleRemovePhoto(url: string) {
    setRemovePhotos((prev) => (prev.includes(url) ? prev.filter((p) => p !== url) : [...prev, url]));
    setSaved(false);
  }

  async function save() {
    setSaving(true); setErr(""); setSaved(false);
    try {
      const updated = await api.updateVenueProfile(venue.id, {
        name, description, category, venue: address, area,
        priceRange, tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        coverImage: newCover || undefined, photos: newPhotos, removePhotos,
      });
      setPhotos(updated.photos);
      setRemovePhotos([]); setNewPhotos([]); setNewCover(null);
      setSaved(true);
    } catch (e: any) {
      setErr(e.message || "Couldn't save your changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-store" /> Business profile</p>

      <div className="dash-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12.5, color: "var(--text-2)", display: "block", marginBottom: 6 }}>Cover photo</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={coverPreview ? { backgroundImage: `url(${coverPreview})`, width: 72, height: 72, borderRadius: 12, backgroundSize: "cover", backgroundPosition: "center" } : { width: 72, height: 72, borderRadius: 12, background: "var(--surface-2)", display: "grid", placeItems: "center" }}>
              {!coverPreview && <i className="icon-store" />}
            </div>
            <input type="file" accept="image/*" onChange={(e) => { setNewCover(e.target.files?.[0] || null); setSaved(false); }} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12.5, color: "var(--text-2)", display: "block", marginBottom: 6 }}>Gallery photos</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {visiblePhotos.map((p) => (
              <div key={p} style={{ position: "relative" }}>
                <div style={{ backgroundImage: `url(${p})`, width: 60, height: 60, borderRadius: 8, backgroundSize: "cover", backgroundPosition: "center", opacity: removePhotos.includes(p) ? 0.35 : 1 }} />
                <button type="button" onClick={() => toggleRemovePhoto(p)} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "var(--surface-1)", border: "1px solid var(--glass-line)" }}>
                  <i className="icon-x" style={{ fontSize: 11 }} />
                </button>
              </div>
            ))}
          </div>
          <input type="file" accept="image/*" multiple onChange={(e) => { setNewPhotos(Array.from(e.target.files || [])); setSaved(false); }} />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label>Name</label>
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Description</label>
          <textarea rows={3} value={description} onChange={(e) => { setDescription(e.target.value); setSaved(false); }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Category</label>
            <select value={category} onChange={(e) => { setCategory(e.target.value as VenueCategory); setSaved(false); }}>
              {VENUE_CATS.filter((c) => c.key !== "all").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Price range</label>
            <select value={priceRange} onChange={(e) => { setPriceRange(e.target.value as PriceRange | ""); setSaved(false); }}>
              <option value="">—</option>
              <option value="$">$</option>
              <option value="$$">$$</option>
              <option value="$$$">$$$</option>
            </select>
          </div>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label>Address</label>
          <input value={address} onChange={(e) => { setAddress(e.target.value); setSaved(false); }} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Area</label>
          <input value={area} onChange={(e) => { setArea(e.target.value); setSaved(false); }} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Tags (comma-separated)</label>
          <input value={tagsText} onChange={(e) => { setTagsText(e.target.value); setSaved(false); }} placeholder="outdoor, family-friendly, live-music" />
        </div>

        {err && <p className="errline">{err}</p>}
        <MotionButton className="btn glass" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}</MotionButton>
      </div>
    </div>
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
      <MotionButton className="btn glass" style={{ marginTop: 10 }} onClick={save} disabled={saving}>
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save availability"}
      </MotionButton>
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
          <MotionButton className="btn glass" onClick={() => init("table")}>Whole tables</MotionButton>
          <MotionButton className="btn glass" onClick={() => init("seat")}>Individual seats</MotionButton>
        </div>
      </div>
    );
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span><i className="icon-grid-2x2" /> Floor plan · {plan.mode === "seat" ? "individual seats" : "whole tables"}</span>
        <MotionButton type="button" className="btn glass sm" style={{ width: "auto" }} onClick={addTable}><i className="icon-plus" /> Add table</MotionButton>
      </p>

      <FloorPlanCanvas tables={tables} mode="edit" seatMode={plan.mode === "seat"}
        onTableDrag={(id, x, y) => updateTable(id, { x, y })}
        onTableResize={(id, width, height) => updateTable(id, { width, height })}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {tables.map((t) => (
          <div key={t.id} className="dash-card" style={{ padding: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input className="toolbar-field" style={{ width: 100 }} value={t.label} onChange={(e) => updateTable(t.id, { label: e.target.value })} />
            <select className="toolbar-field" value={t.shape} onChange={(e) => updateTable(t.id, { shape: e.target.value as "rect" | "circle" })}>
              <option value="rect">Rect</option>
              <option value="circle">Circle</option>
            </select>
            <input className="toolbar-field" type="number" style={{ width: 55 }} value={t.minCapacity} onChange={(e) => updateTable(t.id, { minCapacity: Number(e.target.value) || 1 })} title="Min capacity" />
            <span style={{ color: "var(--text-3)" }}>–</span>
            <input className="toolbar-field" type="number" style={{ width: 55 }} value={t.maxCapacity} onChange={(e) => updateTable(t.id, { maxCapacity: Number(e.target.value) || 1 })} title="Max capacity" />
            {plan.mode === "seat" && (
              <input className="toolbar-field" type="number" style={{ width: 60 }} value={t.seats.length || t.maxCapacity}
                onChange={(e) => updateTable(t.id, { seats: Array.from({ length: Number(e.target.value) || 0 }, (_, i) => t.seats[i] || { id: `pending-${i}`, tableId: t.id, index: i + 1, label: null, status: "available" }) })}
                title="Seat count" />
            )}
            <select className="toolbar-field" value={t.status} onChange={(e) => setStatus(t.id, e.target.value as FloorTable["status"])} style={{ marginLeft: "auto" }}>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="occupied">Occupied</option>
              <option value="needs_cleaning">Needs cleaning</option>
              <option value="maintenance">Maintenance</option>
            </select>
            <MotionButton className="btn glass sm" onClick={() => removeTable(t.id)}><i className="icon-x" /></MotionButton>
          </div>
        ))}
        {tables.length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No tables yet — add one above.</p>}
      </div>

      {err && <p className="errline">{err}</p>}
      <MotionButton className="btn glass" style={{ marginTop: 10 }} onClick={save} disabled={saving || !dirty}>
        {saving ? "Saving…" : dirty ? "Save layout" : "Saved ✓"}
      </MotionButton>
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
        <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={confirm} disabled={saving || !selected.length}>
          {saving ? "Saving…" : `Assign ${selected.length || ""} table${selected.length === 1 ? "" : "s"}`.trim()}
        </MotionButton>
        <MotionButton className="btn glass sm" style={{ width: "auto" }} onClick={unassign} disabled={saving}>Clear assignment</MotionButton>
      </div>
    </div>
  );
}

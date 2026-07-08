import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Weyn, type Venue, type Reservation, type VenueAvailabilitySlot } from "../api";
import { useAsync } from "../hooks";
import { useAccount, useTickets, useSaved } from "../store";
import Stub from "../components/Stub";
import ThemeToggle from "../components/ThemeToggle";
import InstallPrompt from "../components/InstallPrompt";
import AccountWidget from "../components/AccountWidget";
import { webPushStatus, webPushSupported, subscribeWebPush, unsubscribeWebPush } from "../webpush";

// Profile architecture: dedicated views instead of one long stacked page.
// Settings only appears once relevant (signed in) so a first-time visitor
// isn't shown empty tabs for features they haven't touched yet. Organizer
// used to be a tab here — it's now the full /organizer dashboard (see
// HANDOFF.md §17 and src/pages/organizer/*), promoted out for the same
// reason Admin isn't a You.tsx tab either: it's a real product surface, not
// a corner of the profile screen.
type ProfileTab = "overview" | "tickets" | "saved" | "lists" | "venues" | "settings";

type OwnedVenue = Venue & { _count?: { reservations: number; slots: number } };

export default function You() {
  const tickets = useTickets();
  const saved = useSaved();
  const [tab, setTab] = useState<ProfileTab>("overview");
  // hooks must all run before the loading/error early-returns below —
  // calling one conditionally crashes the whole tree on the render where
  // the condition flips (React counts hooks per render)
  const account = useAccount();
  // dashboardEvents/dashboardSummary (not organizerSummary(name)) — they
  // include events a team member was invited to, not just ones matching
  // the signed-in user's own organizer display name. Both require auth, so
  // signed-out visitors just get an empty dashboard (nothing to show yet).
  const dashEvents = useAsync(() => (account ? api.dashboardEvents() : Promise.resolve([])), [account]);
  const dashSummary = useAsync(() => (account ? api.dashboardSummary() : Promise.resolve(null)), [account]);
  // cacheKey matches Explore.tsx's own listEvents() call — public, shared-
  // across-users data (see hooks.ts's cacheKey doc comment), so navigating
  // here from Discover (the overwhelmingly common path, since Explore is the
  // home tab) hits Explore's already-warm 30s cache instead of re-fetching
  // the entire public catalog from scratch every time.
  const allEvents = useAsync(() => api.listEvents(), [], { cacheKey: "events:all" });
  const myVenues = useAsync<OwnedVenue[]>(() => (account ? api.myVenues() : Promise.resolve([])), [account]);

  const summary = {
    loading: dashEvents.loading || dashSummary.loading,
    error: dashEvents.error || dashSummary.error,
    reload: () => { dashEvents.reload(); dashSummary.reload(); },
    data: dashSummary.data && dashEvents.data ? {
      events: dashEvents.data,
      stats: {
        eventCount: dashSummary.data.totalEvents,
        ticketsSold: dashSummary.data.totalAttendees,
        grossRevenue: dashSummary.data.totalRevenue,
        netRevenue: +(dashSummary.data.totalRevenue * 0.92).toFixed(2),
        feePaid: +(dashSummary.data.totalRevenue * 0.08).toFixed(2),
      },
    } : null,
  };

  const myTickets = (allEvents.data || []).filter((e) => tickets.some((t) => t.eventId === e.id));
  const savedEvents = (allEvents.data || []).filter((e) => saved.includes(e.id));
  const isHost = (summary.data?.events.length || 0) > 0;
  const venues = myVenues.data || [];
  const hasVenues = venues.length > 0;
  const summaryData = summary.data || { events: [], stats: { eventCount: 0, ticketsSold: 0, grossRevenue: 0, netRevenue: 0, feePaid: 0 } };

  // Each tab below carries its own loading/error state instead of the whole
  // page blocking on every fetch before rendering anything — Settings (no
  // network dependency at all) or Venues (only needs myVenues) used to sit
  // behind a full-page skeleton just because allEvents/dashSummary hadn't
  // resolved yet, which is exactly why this page felt slow to open.
  const eventsPending = allEvents.loading || allEvents.error;

  return (
    <>
      <Header tab={tab} setTab={setTab} isHost={isHost} hasVenues={hasVenues} account={!!account} />

      {!account && (
        <div className="signin-card" style={{ margin: "16px 16px 0" }}>
          <AccountWidget />
        </div>
      )}

      {tab === "overview" && (
        eventsPending ? (
          <TabSkeletonOrError error={allEvents.error} onRetry={allEvents.reload} />
        ) : (
          <OverviewTab
            account={!!account}
            tickets={myTickets}
            saved={savedEvents}
            isHost={isHost}
            summary={summaryData}
            onNavigate={setTab}
          />
        )
      )}
      {tab === "tickets" && (
        eventsPending ? <TabSkeletonOrError error={allEvents.error} onRetry={allEvents.reload} /> : <TicketsSection tickets={myTickets} />
      )}
      {tab === "saved" && (
        eventsPending ? <TabSkeletonOrError error={allEvents.error} onRetry={allEvents.reload} /> : <SavedTab events={savedEvents} />
      )}
      {tab === "lists" && account && <CollectionsSection />}
      {tab === "venues" && (
        myVenues.loading || myVenues.error
          ? <TabSkeletonOrError error={myVenues.error} onRetry={myVenues.reload} />
          : <VenuesSection venues={venues} />
      )}
      {tab === "settings" && <SettingsTab account={!!account} />}
    </>
  );
}

// Shared per-tab loading/error placeholder — NEVER silently falls through on
// a failed fetch (still shows it, with a retry), it just no longer blocks
// the header/other tabs from rendering while doing so.
function TabSkeletonOrError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <div className="empty">
        <div className="ic"><i className="icon-cloud-off" /></div>
        <p>Couldn't reach the server. {error}</p>
        <button className="btn glass" style={{ maxWidth: 220, margin: "0 auto" }} onClick={onRetry}>Try again</button>
      </div>
    );
  }
  return (
    <div className="feed" style={{ paddingTop: 8 }}>
      <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
      <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
      <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
    </div>
  );
}

/* ---------- Overview — quick summary + shortcuts into the other tabs ---------- */
function OverviewTab({ account, tickets, saved, isHost, summary, onNavigate }: {
  account: boolean; tickets: Weyn[]; saved: Weyn[]; isHost: boolean; summary: any; onNavigate: (t: ProfileTab) => void;
}) {
  return (
    <>
      <div className="page-head">
        <h1>You</h1>
        <p className="sub">{tickets.length > 0 ? `${tickets.length} upcoming ${tickets.length === 1 ? "ticket" : "tickets"}` : "Your tickets and events"}</p>
      </div>

      <div className="ov-grid">
        <button className="ov-card" onClick={() => onNavigate("tickets")}>
          <i className="icon-ticket" /><div className="ov-v">{tickets.length}</div><div className="ov-k">Tickets</div>
        </button>
        <button className="ov-card" onClick={() => onNavigate("saved")}>
          <i className="icon-heart" /><div className="ov-v">{saved.length}</div><div className="ov-k">Saved</div>
        </button>
        {isHost && (
          <Link to="/organizer" className="ov-card">
            <i className="icon-chart-bar" /><div className="ov-v">{summary.stats.eventCount}</div><div className="ov-k">Live events</div>
          </Link>
        )}
        {account && (
          <button className="ov-card" onClick={() => onNavigate("lists")}>
            <i className="icon-list" /><div className="ov-v">—</div><div className="ov-k">Lists</div>
          </button>
        )}
      </div>

      {tickets.length > 0 && (
        <section>
          <div className="date-head"><h2>Up next</h2><span>{tickets.length}</span></div>
          <div className="feed" style={{ paddingBottom: 4 }}>{tickets.slice(0, 3).map((e) => <Stub key={e.id} e={e} ticket />)}</div>
        </section>
      )}

      {!isHost && (
        <section>
          <div className="host-cta" style={{ margin: "18px 16px 0" }}>
            <div><b>Running an event?</b><span>Publish it free and track sales here.</span></div>
            <Link to="/host/events" className="btn glass" style={{ width: "auto", padding: "11px 16px" }}><i className="icon-plus" /> Host</Link>
          </div>
        </section>
      )}

      <div style={{ padding: "16px 16px 0" }}><InstallPrompt /></div>
    </>
  );
}

/* ---------- Saved tab (same data the standalone /saved route shows) ---------- */
function SavedTab({ events }: { events: Weyn[] }) {
  return (
    <section>
      <div className="date-head"><h2>Saved</h2><span>{events.length}</span></div>
      {events.length > 0 ? (
        <div className="feed" style={{ paddingTop: 4 }}>{events.map((e) => <Stub key={e.id} e={e} />)}</div>
      ) : (
        <div className="empty" style={{ padding: "24px 36px 32px" }}>
          <div className="ic"><i className="icon-heart" /></div>
          <p>Nothing saved yet. Tap the heart on any event to keep it here.</p>
          <Link to="/" className="btn" style={{ maxWidth: 220, margin: "0 auto" }}><i className="icon-compass" /> Explore events</Link>
        </div>
      )}
    </section>
  );
}

/* ---------- Settings — account, theme, notifications, support, admin ---------- */
function SettingsTab({ account }: { account: boolean }) {
  const acc = useAccount();
  const [pushState, setPushState] = useState<"unsupported" | "denied" | "subscribed" | "available" | "loading">("loading");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErr, setPushErr] = useState("");

  useEffect(() => {
    if (!webPushSupported()) { setPushState("unsupported"); return; }
    webPushStatus().then(setPushState);
  }, []);

  async function togglePush() {
    setPushErr(""); setPushBusy(true);
    try {
      if (pushState === "subscribed") {
        await unsubscribeWebPush(api);
        setPushState("available");
      } else {
        await subscribeWebPush(api);
        setPushState("subscribed");
      }
    } catch (e: any) {
      setPushErr(e.message || "Couldn't update notification settings.");
      setPushState(await webPushStatus());
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <section>
      <div className="date-head"><h2>Settings</h2></div>
      <div style={{ padding: "0 16px" }}>
        <div className="settings-row">
          <span>Appearance</span>
          <ThemeToggle />
        </div>

        {account && pushState !== "unsupported" && (
          <div className="settings-row">
            <span>Notifications</span>
            {pushState === "denied" ? (
              <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Blocked in browser settings</span>
            ) : pushState === "loading" ? (
              <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>…</span>
            ) : (
              <button className={"switch" + (pushState === "subscribed" ? " on" : "")} disabled={pushBusy} onClick={togglePush} aria-pressed={pushState === "subscribed"} aria-label="Toggle push notifications">
                <span className="switch-thumb" />
              </button>
            )}
          </div>
        )}
        {pushErr && <p className="errline">{pushErr}</p>}

        {account && (
          <div className="account-row" style={{ marginTop: 12 }}>
            <AccountWidget />
          </div>
        )}

        {account && (
          <Link to="/account" className="copy-btn" style={{ marginTop: 12 }}>
            <i className="icon-user-cog" /> Manage account
          </Link>
        )}
        {acc?.role === "ADMIN" && (
          <Link to="/admin" className="copy-btn" style={{ marginTop: 12 }}>
            <i className="icon-shield-check" /> Admin dashboard
          </Link>
        )}

        <Link to="/support" className="copy-btn" style={{ marginTop: 12 }}>
          <i className="icon-life-buoy" /> Help &amp; support
        </Link>
      </div>
    </section>
  );
}

/* ---------- Collections (Pinterest-style saved lists) ---------- */
function CollectionsSection() {
  const { data, loading, reload } = useAsync(() => api.listMyCollections(), []);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.createCollection(name.trim());
      setName("");
      reload();
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this list? This can't be undone.")) return;
    await api.deleteCollection(id);
    reload();
  }

  return (
    <section>
      <div className="date-head"><h2>My lists</h2><span>{data?.length || 0}</span></div>
      <div style={{ display: "flex", gap: 8, padding: "0 16px 10px" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New list name…"
          onKeyDown={(e) => e.key === "Enter" && create()}
          style={{ flex: 1 }}
        />
        <button className="btn glass sm" onClick={create} disabled={creating || !name.trim()}>Create</button>
      </div>
      {loading ? (
        <>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
        </>
      ) : (data || []).length > 0 ? (
        <ul className="steps" style={{ padding: "0 16px" }}>
          {data!.map((c) => (
            <li key={c.id}>
              <i className="icon-list" />
              <Link to={`/collections/${c.id}`} style={{ color: "var(--text)" }}>
                {c.name} <small style={{ color: "var(--text-3)" }}>· {c._count?.items || 0} events{c.isPublic ? "" : " · private"}</small>
              </Link>
              <button className="copy-btn" onClick={() => remove(c.id)} style={{ marginLeft: "auto" }}>Delete</button>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 16px 10px" }}>No lists yet — group events you want to remember or share.</p>
      )}
    </section>
  );
}

const TAB_DEFS: { key: ProfileTab; label: string; icon: string; needsAuth?: boolean; needsHost?: boolean; needsVenues?: boolean }[] = [
  { key: "overview", label: "Overview", icon: "layout-grid" },
  { key: "venues", label: "Venues", icon: "store", needsVenues: true },
  { key: "tickets", label: "Tickets", icon: "ticket" },
  { key: "saved", label: "Saved", icon: "heart" },
  { key: "lists", label: "Lists", icon: "list", needsAuth: true },
  { key: "settings", label: "Settings", icon: "settings" },
];

function Header({ tab, setTab, isHost, hasVenues, account }: { tab: ProfileTab; setTab: (t: ProfileTab) => void; isHost: boolean; hasVenues: boolean; account: boolean }) {
  const visible = TAB_DEFS.filter((t) => (!t.needsAuth || account) && (!t.needsHost || isHost) && (!t.needsVenues || hasVenues));
  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="en">You</span></div>
      </header>
      <nav className="profile-tabs">
        {visible.map((t) => (
          <button
            key={t.key}
            className={"profile-tab" + (tab === t.key ? " on" : "")}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "true" : undefined}
          >
            <i className={"icon-" + t.icon} />{t.label}
          </button>
        ))}
      </nav>
    </>
  );
}

/* ---------- My tickets (always shown) ---------- */
function TicketsSection({ tickets }: { tickets: Weyn[] }) {
  return (
    <section>
      <div className="date-head"><h2>My tickets</h2><span>{tickets.length}</span></div>
      {tickets.length > 0 ? (
        <div className="feed" style={{ paddingBottom: 4 }}>{tickets.map((e) => <Stub key={e.id} e={e} ticket />)}</div>
      ) : (
        <div className="empty" style={{ padding: "24px 36px 32px" }}>
          <div className="ic"><i className="icon-ticket" /></div>
          <p>No tickets yet. RSVP or grab a ticket and it'll show up here.</p>
          <Link to="/" className="btn" style={{ maxWidth: 220, margin: "0 auto" }}>Find something to do</Link>
        </div>
      )}
    </section>
  );
}

/* ---------- Venues (venue owner dashboard) ---------- */
const VENUE_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type VenueDayRow = { enabled: boolean; start: string; end: string; capacity: string };

function VenuesSection({ venues }: { venues: OwnedVenue[] }) {
  const [selectedId, setSelectedId] = useState<string>(venues[0]?.id || "");
  const selected = venues.find((v) => v.id === selectedId) || venues[0];

  return (
    <section>
      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Your venues</h2><span>{venues.length}</span></div>

      {venues.length > 1 && (
        <div className="chips" style={{ padding: "0 16px 4px", display: "flex", flexWrap: "wrap", gap: 8 }}>
          {venues.map((v) => (
            <button
              key={v.id}
              className={"chip" + (v.id === selected?.id ? " on" : "")}
              onClick={() => setSelectedId(v.id)}
            >
              {v.name} <small style={{ opacity: 0.7 }}>· {v._count?.reservations ?? 0}</small>
            </button>
          ))}
        </div>
      )}

      {selected && <VenueManager key={selected.id} venue={selected} />}
    </section>
  );
}

function VenueManager({ venue }: { venue: OwnedVenue }) {
  return (
    <div style={{ padding: "6px 16px 0" }}>
      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="thumb" style={venue.coverImage ? { backgroundImage: `url(${venue.coverImage})`, width: 46, height: 46, borderRadius: 12, backgroundSize: "cover", backgroundPosition: "center", flex: "0 0 auto" } : { width: 46, height: 46, borderRadius: 12, background: "var(--surface-2)", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
            {!venue.coverImage && <i className="icon-store" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <b style={{ display: "block", fontSize: 15 }}>{venue.name}{venue.verified && <span className="ec-badge confirmed" style={{ marginLeft: 8 }}><i className="icon-badge-check" /> Verified</span>}</b>
            <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{venue.area} · {venue._count?.reservations ?? 0} reservation{(venue._count?.reservations ?? 0) === 1 ? "" : "s"}</span>
          </div>
        </div>
      </div>

      <VenueReservations venueId={venue.id} />
      <VenueAvailabilityEditor venue={venue} />
    </div>
  );
}

function statusClass(status?: string) {
  const s = (status || "pending").toLowerCase();
  if (s === "confirmed") return "confirmed";
  if (s === "cancelled") return "out";
  return "";
}

function VenueReservations({ venueId }: { venueId: string }) {
  const { data, loading, error } = useAsync(() => api.venueReservations(venueId), [venueId]);
  const [rows, setRows] = useState<(Reservation & { slot?: VenueAvailabilitySlot | null })[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { if (data) setRows(data); }, [data]);

  async function setStatus(id: string, status: "confirmed" | "cancelled") {
    setBusyId(id);
    try {
      const updated = await api.setReservationStatus(id, status);
      setRows((list) => list.map((r) => (r.id === id ? { ...r, status: updated.status ?? status } : r)));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-calendar-check" /> Incoming reservations</p>
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
              const pending = (r.status || "pending").toLowerCase() === "pending";
              return (
                <li key={r.id}>
                  <i className="icon-user" />
                  <span>
                    {r.guestName} <small style={{ color: "var(--text-3)" }}>· party of {r.partySize}</small>
                    <br />
                    <small style={{ color: "var(--text-3)" }}>{r.date} · {r.time}</small>
                    {" "}
                    <span className={"ec-badge " + statusClass(r.status)}>{(r.status || "pending")}</span>
                  </span>
                  {pending && (
                    <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                      <button className="btn glass sm" onClick={() => setStatus(r.id, "confirmed")} disabled={busyId === r.id}>Confirm</button>
                      <button className="btn glass sm" onClick={() => setStatus(r.id, "cancelled")} disabled={busyId === r.id}>Cancel</button>
                    </div>
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


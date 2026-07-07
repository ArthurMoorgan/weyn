import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useClerk } from "@clerk/react";
import { Html5Qrcode } from "html5-qrcode";
import { api, ticketsLeft, isSoldOut, dayLabel, timeLabel, type Weyn, type TeamRole, type Venue, type Reservation, type VenueAvailabilitySlot } from "../api";
import { useAsync, useClosing } from "../hooks";
import { getOrganizer, useAccount, useTickets, useSaved } from "../store";
import Stub from "../components/Stub";
import ThemeToggle from "../components/ThemeToggle";
import InstallPrompt from "../components/InstallPrompt";
import AccountWidget from "../components/AccountWidget";
import { webPushStatus, webPushSupported, subscribeWebPush, unsubscribeWebPush } from "../webpush";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// Profile architecture: dedicated views instead of one long stacked page.
// Organizer/Settings only appear once relevant (signed in) so a first-time
// visitor isn't shown empty tabs for features they haven't touched yet.
type ProfileTab = "overview" | "tickets" | "saved" | "lists" | "organizer" | "venues" | "settings";

type OwnedVenue = Venue & { _count?: { reservations: number; slots: number } };

export default function You() {
  const name = getOrganizer();
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
  const allEvents = useAsync(() => api.listEvents(), []);
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

  if (summary.loading || allEvents.loading) {
    return (<><Header tab={tab} setTab={setTab} isHost={false} hasVenues={false} account={!!account} /><div className="feed" style={{ paddingTop: 8 }}>
      <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
      <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
      <div className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>
    </div></>);
  }

  // NEVER silently fall through on a failed fetch — show it, don't hide it as an empty state
  if (summary.error || allEvents.error) {
    return (
      <>
        <Header tab={tab} setTab={setTab} isHost={false} hasVenues={false} account={!!account} />
        <div className="empty">
          <div className="ic"><i className="icon-cloud-off" /></div>
          <p>Couldn't reach the server. {summary.error || allEvents.error}</p>
          <p style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: -8 }}>
            If you're testing a deployed build, make sure it was built with <code>VITE_API_BASE</code> pointing at your live backend URL.
          </p>
          <button className="btn glass" style={{ maxWidth: 220, margin: "0 auto" }} onClick={() => { summary.reload(); allEvents.reload(); }}>
            Try again
          </button>
        </div>
      </>
    );
  }

  const myTickets = (allEvents.data || []).filter((e) => tickets.some((t) => t.eventId === e.id));
  const savedEvents = (allEvents.data || []).filter((e) => saved.includes(e.id));
  const isHost = (summary.data?.events.length || 0) > 0;
  const venues = myVenues.data || [];
  const hasVenues = venues.length > 0;
  const summaryData = summary.data || { events: [], stats: { eventCount: 0, ticketsSold: 0, grossRevenue: 0, netRevenue: 0, feePaid: 0 } };

  return (
    <>
      <Header tab={tab} setTab={setTab} isHost={isHost} hasVenues={hasVenues} account={!!account} />

      {!account && (
        <div className="signin-card" style={{ margin: "16px 16px 0" }}>
          <AccountWidget />
        </div>
      )}

      {tab === "overview" && (
        <OverviewTab
          account={!!account}
          tickets={myTickets}
          saved={savedEvents}
          isHost={isHost}
          summary={summaryData}
          onNavigate={setTab}
        />
      )}
      {tab === "tickets" && <TicketsSection tickets={myTickets} />}
      {tab === "saved" && <SavedTab events={savedEvents} />}
      {tab === "lists" && account && <CollectionsSection />}
      {tab === "organizer" && (
        <OrganizerSection name={name} summary={summaryData} reload={summary.reload} />
      )}
      {tab === "venues" && <VenuesSection venues={venues} />}
      {tab === "settings" && <SettingsTab account={!!account} />}
    </>
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
          <button className="ov-card" onClick={() => onNavigate("organizer")}>
            <i className="icon-chart-bar" /><div className="ov-v">{summary.stats.eventCount}</div><div className="ov-k">Live events</div>
          </button>
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
  const { signOut } = useClerk();
  const nav = useNavigate();
  const [pushState, setPushState] = useState<"unsupported" | "denied" | "subscribed" | "available" | "loading">("loading");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErr, setPushErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

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

  async function deleteAccount() {
    if (!confirm("Delete your account? This cancels any events you're hosting and can't be undone.")) return;
    setDeleting(true); setDeleteErr("");
    try {
      await api.deleteAccount();
      await signOut();
      nav("/", { replace: true });
    } catch (e: any) {
      setDeleteErr(e.message || "Couldn't delete your account. Please try again, or contact support.");
      setDeleting(false);
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
        {acc?.role === "ADMIN" && (
          <Link to="/admin" className="copy-btn" style={{ marginTop: 12 }}>
            <i className="icon-shield-check" /> Admin dashboard
          </Link>
        )}

        <Link to="/support" className="copy-btn" style={{ marginTop: 12 }}>
          <i className="icon-life-buoy" /> Help &amp; support
        </Link>

        {account && (
          <div className="danger-zone">
            <b>Delete account</b>
            <p>Permanently deletes your account. Any events you're hosting are cancelled. This can't be undone.</p>
            {deleteErr && <p className="errline">{deleteErr}</p>}
            <button className="btn" style={{ borderColor: "var(--error)", color: "var(--error)" }} disabled={deleting} onClick={deleteAccount}>
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        )}
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

// Base order for non-hosts. When the user IS a host, Organizer is spliced in
// right after Overview (see below) instead of sitting buried at the end —
// it's the primary tool for hosts and shouldn't require scrolling the strip
// to discover.
const TAB_DEFS: { key: ProfileTab; label: string; icon: string; needsAuth?: boolean; needsHost?: boolean; needsVenues?: boolean }[] = [
  { key: "overview", label: "Overview", icon: "layout-grid" },
  { key: "organizer", label: "Organizer", icon: "chart-bar", needsHost: true },
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

/* ---------- Organizer (always shown — CTA or full dashboard) ---------- */
// Surfaces the trust & safety pipeline's decision — see server/moderation.js.
// Growth-priority tuning (2026-07-04): DISCOVERY_LIMITED is no longer shown
// here (and no longer auto-assigned server-side) — quality/trust scores
// don't restrict reach right now. Only genuinely fraud/spam-flagged events
// still surface a badge; everything else (including PENDING_REVIEW/APPROVED)
// shows nothing, since that's the common, unremarkable case.
function DiscoveryBadge({ status }: { status?: Weyn["discoveryStatus"] }) {
  const copy: Record<string, { label: string; cls: string }> = {
    MANUAL_REVIEW: { label: "In review", cls: "warn" },
    DISCOVERY_BLOCKED: { label: "Flagged — contact support", cls: "danger" },
  };
  const c = status ? copy[status] : undefined;
  if (!c) return null;
  return <span className={`discovery-tag ${c.cls}`}>{c.label}</span>;
}

function OrganizerSection({ name, summary, reload }: { name: string; summary: any; reload: () => void }) {
  const isHost = summary.events.length > 0;
  const [editing, setEditing] = useState<Weyn | null>(null);
  const [attendeesFor, setAttendeesFor] = useState<Weyn | null>(null);
  const [marketingFor, setMarketingFor] = useState<Weyn | null>(null);
  const [analyticsFor, setAnalyticsFor] = useState<Weyn | null>(null);
  const [teamFor, setTeamFor] = useState<Weyn | null>(null);
  const [checkinFor, setCheckinFor] = useState<Weyn | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!isHost) {
    return (
      <section>
        <div className="date-head"><h2>Organizer</h2></div>
        <div className="host-cta" style={{ margin: "0 16px" }}>
          <div>
            <b>Running an event?</b>
            <span>Publish it free and track sales here.</span>
          </div>
          <Link to="/host/events" className="btn glass" style={{ width: "auto", padding: "11px 16px" }}><i className="icon-plus" /> Host</Link>
        </div>
      </section>
    );
  }

  const s = summary.stats;

  async function cancel(e: Weyn) {
    if (!confirm(`Cancel "${e.title}"? It'll disappear from Explore immediately.`)) return;
    setBusyId(e.id);
    try { await api.cancelEvent(e.id); reload(); } finally { setBusyId(null); }
  }
  async function duplicate(e: Weyn) {
    setBusyId(e.id);
    try { await api.duplicateEvent(e.id); reload(); } finally { setBusyId(null); }
  }

  return (
    <section className="dash">
      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Organizer</h2><span>Performance for {name}</span></div>

      <div className="stat-grid">
        <div className="stat"><div className="k">Net revenue</div><div className="v">{omr(s.netRevenue)} <small>OMR</small></div></div>
        <div className="stat"><div className="k">Tickets sold</div><div className="v">{s.ticketsSold.toLocaleString()}</div></div>
        <div className="stat"><div className="k">Live events</div><div className="v">{s.eventCount}</div></div>
        <div className="stat"><div className="k">Weyn fees paid</div><div className="v">{omr(s.feePaid)} <small>OMR</small></div></div>
      </div>

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Your events</h2><span>{summary.events.length}</span></div>

      {summary.events.map((e: Weyn) => {
        const left = ticketsLeft(e);
        const out = isSoldOut(e);
        const pct = e.capacity >= 9000 ? 0 : Math.min(100, Math.round((e.sold / e.capacity) * 100));
        const gross = e.sold * e.price;
        return (
          <div key={e.id} className="dash-card">
            <Link to={`/e/${e.id}`} className="dash-row" style={{ marginBottom: 0 }}>
              <div className="thumb" style={e.image ? { backgroundImage: `url(${e.image})`, backgroundPosition: e.imageFocalPoint || "center" } : { background: e.color }}>
                {!e.image && e.glyph}
              </div>
              <div className="info">
                <b>{e.title}{e.cancelled && <span className="cancelled-tag">Cancelled</span>}{!e.cancelled && <DiscoveryBadge status={e.discoveryStatus} />}</b>
                <span>{dayLabel(e)} · {timeLabel(e)} · {e.area}</span>
                {e.capacity < 9000 && !e.cancelled && <div className="bar"><i className={pct >= 100 ? "full" : ""} style={{ width: `${pct}%` }} /></div>}
              </div>
              <div className="amt">
                <b>{e.price === 0 ? "Free" : `${omr(+gross.toFixed(2))} OMR`}</b>
                <span>{e.cancelled ? "—" : out ? "Sold out" : e.capacity >= 9000 ? `${e.sold} in` : `${left} left`}</span>
              </div>
            </Link>
            {!e.cancelled && (
              <div className="dash-actions">
                <button onClick={() => setEditing(e)}><i className="icon-pencil" /> Edit</button>
                <button onClick={() => setAnalyticsFor(e)}><i className="icon-chart-bar" /> Analytics</button>
                <button onClick={() => setAttendeesFor(e)}><i className="icon-users" /> Attendees</button>
                <button onClick={() => setCheckinFor(e)}><i className="icon-qr-code" /> Check-in</button>
                <button onClick={() => setTeamFor(e)}><i className="icon-users-round" /> Team</button>
                <button onClick={() => setMarketingFor(e)}><i className="icon-megaphone" /> Marketing</button>
                <button onClick={() => duplicate(e)} disabled={busyId === e.id}><i className="icon-copy" /> Duplicate</button>
                <button onClick={() => cancel(e)} disabled={busyId === e.id} className="danger"><i className="icon-ban" /> Cancel</button>
              </div>
            )}
          </div>
        );
      })}

      <Link to="/host/events" className="btn glass" style={{ marginTop: 8 }}><i className="icon-plus" /> Host another event</Link>

      {editing && <EditSheet event={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {attendeesFor && <AttendeesSheet event={attendeesFor} onClose={() => setAttendeesFor(null)} />}
      {marketingFor && <MarketingSheet event={marketingFor} onClose={() => setMarketingFor(null)} />}
      {analyticsFor && <AnalyticsSheet event={analyticsFor} onClose={() => setAnalyticsFor(null)} />}
      {teamFor && <TeamSheet event={teamFor} onClose={() => setTeamFor(null)} />}
      {checkinFor && <CheckInSheet event={checkinFor} onClose={() => setCheckinFor(null)} />}
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

/* ---------- Edit sheet ---------- */
function EditSheet({ event, onClose, onSaved }: { event: Weyn; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState(String(event.price));
  const [capacity, setCapacity] = useState(String(event.capacity));
  const [blurb, setBlurb] = useState(event.blurb);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { closing, close } = useClosing(onClose);

  async function save() {
    setBusy(true); setErr("");
    try {
      await api.updateEvent(event.id, { price: Number(price) || 0, capacity: Number(capacity) || event.capacity, blurb });
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Couldn't save"); setBusy(false);
    }
  }

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 14 }}>Edit "{event.title}"</h3>
        <div className="field"><label>Price (OMR)</label><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></div>
        <div className="field"><label>Capacity</label><input value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="numeric" /></div>
        <div className="field"><label>Description</label><textarea rows={3} value={blurb} onChange={(e) => setBlurb(e.target.value)} /></div>
        {err && <p className="errline">{err}</p>}
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        <button className="btn glass" style={{ marginTop: 8 }} onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------- Attendees sheet ---------- */
function AttendeesSheet({ event, onClose }: { event: Weyn; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => api.getAttendees(event.id), [event.id]);
  const { closing, close } = useClosing(onClose);

  function exportCsv() {
    const rows = data || [];
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = ["Name,Email,Booked At", ...rows.map((a) =>
      [escape(a.name || ""), escape(a.email || ""), escape(a.bookedAt)].join(",")
    )].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-attendees.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 14 }}>Attendees — {event.title}</h3>
        {loading && (
          <div style={{ padding: "0 4px" }}>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          </div>
        )}
        {error && <p className="errline">{error}</p>}
        {!loading && !error && (
          (data || []).length > 0 ? (
            <>
              <ul className="steps" style={{ maxHeight: 280, overflowY: "auto" }}>
                {data!.map((a, i) => (
                  <li key={i}>
                    <i className="icon-user" />
                    <span>{a.name || a.email || "Anonymous"}{a.email && a.name && <><br /><small style={{ color: "var(--text-3)" }}>{a.email}</small></>}</span>
                  </li>
                ))}
              </ul>
              <button className="btn glass" onClick={exportCsv} style={{ marginTop: 10 }}><i className="icon-download" /> Export CSV</button>
            </>
          ) : (
            <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No named attendees yet — people who book while signed in will show up here.</p>
          )
        )}
        <button className="btn glass" onClick={close} style={{ marginTop: 8 }}>Close</button>
      </div>
    </div>
  );
}

/* ---------- Marketing sheet (Feature 2: Create Once, Publish Everywhere) ---------- */
function MarketingSheet({ event, onClose }: { event: Weyn; onClose: () => void }) {
  const { data, loading, error, reload } = useAsync(() => api.getMarketing(event.id), [event.id]);
  const [regenerating, setRegenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { closing, close } = useClosing(onClose);

  async function regenerate() {
    setRegenerating(true);
    try { await api.regenerateMarketing(event.id); reload(); } finally { setRegenerating(false); }
  }
  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  const channels = data ? [
    { key: "instagram", label: "Instagram caption", icon: "camera", text: data.instagram },
    { key: "whatsapp", label: "WhatsApp message", icon: "message-circle", text: data.whatsapp },
    { key: "telegram", label: "Telegram post", icon: "send", text: data.telegram },
    { key: "twitter", label: "X / Twitter post", icon: "at-sign", text: data.twitter },
  ] : [];

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Marketing — {event.title}</h3>
        <p className="hint" style={{ margin: "0 0 14px" }}>
          {data?.aiGenerated ? "Generated with AI." : "Generated from your event details."} Copy and post anywhere.
        </p>
        {loading && (
          <div style={{ padding: "0 4px" }}>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          </div>
        )}
        {error && <p className="errline">{error}</p>}
        {!loading && !error && channels.map((c) => (
          <div key={c.key} className="marketing-card">
            <div className="marketing-card-head">
              <i className={"icon-" + c.icon} /> <b>{c.label}</b>
              <button className="copy-btn" onClick={() => copy(c.key, c.text)}>
                <i className={(copiedKey === c.key ? "icon-check" : "icon-copy")} /> {copiedKey === c.key ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="marketing-text">{c.text}</pre>
          </div>
        ))}
        <button className="btn glass" onClick={regenerate} disabled={regenerating} style={{ marginTop: 4 }}>
          <i className="icon-refresh-cw" /> {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
        <button className="btn glass" style={{ marginTop: 8 }} onClick={close}>Close</button>
      </div>
    </div>
  );
}

/* ---------- Analytics sheet ---------- */
function AnalyticsSheet({ event, onClose }: { event: Weyn; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => api.eventAnalytics(event.id), [event.id]);
  const maxTier = data ? Math.max(1, ...data.tierBreakdown.map((t) => t.sold)) : 1;
  const maxDay = data ? Math.max(1, ...data.salesByDay.map((d) => d.qty)) : 1;
  const { closing, close } = useClosing(onClose);

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 14 }}>Analytics — {event.title}</h3>
        {loading && (
          <div style={{ padding: "0 4px" }}>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          </div>
        )}
        {error && <p className="errline">{error}</p>}
        {!loading && !error && data && (
          <>
            <div className="stat-grid">
              <div className="stat"><div className="k">Tickets sold</div><div className="v">{data.ticketsSold} <small>/ {data.capacity >= 9000 ? "∞" : data.capacity}</small></div></div>
              <div className="stat"><div className="k">Revenue</div><div className="v">{data.revenue.toLocaleString()} <small>OMR</small></div></div>
            </div>

            {data.tierBreakdown.length > 0 && (
              <>
                <p className="hint" style={{ margin: "16px 0 8px" }}>Ticket type performance</p>
                {data.tierBreakdown.map((t) => (
                  <div key={t.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span>{t.name}</span><span style={{ color: "var(--text-2)" }}>{t.sold}/{t.capacity} · {t.revenue.toLocaleString()} OMR</span>
                    </div>
                    <div className="bar"><i style={{ width: `${Math.round((t.sold / maxTier) * 100)}%` }} /></div>
                  </div>
                ))}
              </>
            )}

            {data.salesByDay.length > 0 && (
              <>
                <p className="hint" style={{ margin: "16px 0 8px" }}>Sales over time</p>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                  {data.salesByDay.map((d) => (
                    <div key={d.date} title={`${d.date}: ${d.qty}`} style={{
                      flex: 1, minWidth: 4, borderRadius: 3,
                      height: `${Math.max(6, Math.round((d.qty / maxDay) * 80))}px`,
                      background: "var(--accent)",
                    }} />
                  ))}
                </div>
              </>
            )}

            {data.conversionRate === null && (
              <p className="hint" style={{ marginTop: 14 }}>
                Page-view/conversion tracking isn't wired up on the event page yet — this shows real ticket sales, not fabricated traffic numbers.
              </p>
            )}
          </>
        )}
        <button className="btn glass" style={{ marginTop: 14 }} onClick={close}>Close</button>
      </div>
    </div>
  );
}

/* ---------- Team sheet ---------- */
const ROLE_LABEL: Record<TeamRole, string> = { MANAGER: "Manager", STAFF: "Staff (check-in only)" };

function TeamSheet({ event, onClose }: { event: Weyn; onClose: () => void }) {
  const { data, loading, error, reload } = useAsync(() => api.listTeam(event.id), [event.id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("STAFF");
  const [inviting, setInviting] = useState(false);
  const [inviteErr, setInviteErr] = useState("");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { closing, close } = useClosing(onClose);

  async function invite() {
    if (!email.trim()) return;
    setInviting(true); setInviteErr(""); setLastLink(null);
    try {
      const res = await api.inviteTeamMember(event.id, email.trim(), role);
      setLastLink(res.inviteLink);
      setEmail("");
      reload();
    } catch (e: any) {
      setInviteErr(e.message || "Couldn't send invite");
    } finally {
      setInviting(false);
    }
  }
  function copyLink() {
    if (!lastLink) return;
    navigator.clipboard?.writeText(lastLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  async function revoke(memberId: string) {
    if (!confirm("Revoke this person's access to the event?")) return;
    await api.revokeTeamMember(event.id, memberId);
    reload();
  }

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Team — {event.title}</h3>
        <p className="hint" style={{ margin: "0 0 14px" }}>
          Managers get full event access. Staff can only check people in at the door.
        </p>

        <div className="field"><label>Invite by email</label><input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="teammate@email.com" /></div>
        <div className="field">
          <label>Role</label>
          <select value={role} onChange={(ev) => setRole(ev.target.value as TeamRole)}>
            <option value="STAFF">Staff (check-in only)</option>
            <option value="MANAGER">Manager (full access)</option>
          </select>
        </div>
        {inviteErr && <p className="errline">{inviteErr}</p>}
        <button className="btn" onClick={invite} disabled={inviting || !email.trim()}>
          {inviting ? "Creating invite…" : "Create invite link"}
        </button>

        {lastLink && (
          <div className="marketing-card" style={{ marginTop: 10 }}>
            <div className="marketing-card-head">
              <i className="icon-link" /> <b>Invite link — send it yourself</b>
              <button className="copy-btn" onClick={copyLink}><i className={(copied ? "icon-check" : "icon-copy")} /> {copied ? "Copied" : "Copy"}</button>
            </div>
            <pre className="marketing-text" style={{ wordBreak: "break-all" }}>{lastLink}</pre>
          </div>
        )}

        <p className="hint" style={{ margin: "18px 0 8px" }}>Team members</p>
        {loading && (
          <div style={{ padding: "0 4px" }}>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          </div>
        )}
        {error && <p className="errline">{error}</p>}
        {!loading && !error && (
          (data || []).length > 0 ? (
            <ul className="steps">
              {data!.map((m) => (
                <li key={m.id}>
                  <i className={m.role === "MANAGER" ? "icon-shield" : "icon-scan"} />
                  <span>
                    {m.user?.name || m.email} <small style={{ color: "var(--text-3)" }}>· {ROLE_LABEL[m.role]}{m.status === "PENDING" ? " · invite pending" : ""}</small>
                  </span>
                  <button className="copy-btn" onClick={() => revoke(m.id)} style={{ marginLeft: "auto" }}>Revoke</button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No team members yet.</p>
          )
        )}
        <button className="btn glass" style={{ marginTop: 14 }} onClick={close}>Close</button>
      </div>
    </div>
  );
}

/* ---------- Check-in sheet (QR scan + manual code entry) ---------- */
function CheckInSheet({ event, onClose }: { event: Weyn; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  async function submitCode(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;
    setBusy(true); setResult(null);
    try {
      const res = await api.checkInTicket(value);
      setResult({ ok: true, message: "Checked in ✓" });
      setCheckedInCount((n) => n + 1);
      void res;
    } catch (e: any) {
      setResult({ ok: false, message: e.message || "Couldn't check in that code" });
    } finally {
      setBusy(false);
      setCode("");
    }
  }

  async function startScanner() {
    setScanning(true);
    setTimeout(async () => {
      try {
        const el = document.getElementById("weyn-qr-region");
        if (!el) return;
        const scanner = new Html5Qrcode("weyn-qr-region");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 220 },
          (decoded) => { submitCode(decoded); },
          () => {}
        );
      } catch {
        setResult({ ok: false, message: "Couldn't access the camera — use manual code entry instead." });
        setScanning(false);
      }
    }, 50);
  }
  function stopScanner() {
    scannerRef.current?.stop().catch(() => {});
    setScanning(false);
  }
  const { closing, close } = useClosing(() => { stopScanner(); onClose(); });

  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Check-in — {event.title}</h3>
        <p className="hint" style={{ margin: "0 0 14px" }}>{checkedInCount} checked in this session</p>

        {!scanning ? (
          <button className="btn" onClick={startScanner}><i className="icon-camera" /> Scan QR code</button>
        ) : (
          <>
            <div id="weyn-qr-region" style={{ borderRadius: 12, overflow: "hidden", marginBottom: 10 }} />
            <button className="btn glass" onClick={stopScanner}>Stop scanning</button>
          </>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label>Or enter ticket code manually</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitCode(code)} placeholder="Ticket code" />
        </div>
        <button className="btn glass" onClick={() => submitCode(code)} disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Check in"}
        </button>

        {result && (
          <p className={result.ok ? "hint" : "errline"} style={{ marginTop: 10, color: result.ok ? "var(--accent)" : undefined }}>
            {result.message}
          </p>
        )}

        <button className="btn glass" style={{ marginTop: 14 }} onClick={close}>Close</button>
      </div>
    </div>
  );
}

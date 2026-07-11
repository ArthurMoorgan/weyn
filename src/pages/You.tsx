import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Weyn, type Venue, type Reservation, type VenueAvailabilitySlot } from "../api";
import { useAsync } from "../hooks";
import { useAccount, useTickets, useSaved } from "../store";
import Stub from "../components/Stub";
import ThemeToggle from "../components/ThemeToggle";
import CityPill from "../components/CityPill";
import InstallPrompt from "../components/InstallPrompt";
import AccountWidget from "../components/AccountWidget";
import { webPushStatus, webPushSupported, subscribeWebPush, unsubscribeWebPush } from "../webpush";

// "More" hub: instead of a wrapping tab strip, this tab is now an
// iOS-Settings-style vertical dock — one tappable row per destination, each
// drilling into a full section (with a back arrow) rather than swapping
// content under a fixed header. This is also where the theme toggle + city
// (previously crammed into every browse screen's topbar) now live, since
// those are per-user preferences, not per-screen chrome. Organizer/Admin/
// account stay real routes (see HANDOFF.md §17), just surfaced as rows here.
type ProfileTab = "overview" | "tickets" | "saved" | "lists" | "venues";
type View = "menu" | ProfileTab;

type OwnedVenue = Venue & { _count?: { reservations: number; slots: number } };

export default function You() {
  const tickets = useTickets();
  const saved = useSaved();
  const [view, setView] = useState<View>("menu");
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

  // ---- menu hub ----
  if (view === "menu") {
    return (
      <MoreMenu
        account={!!account}
        isHost={isHost}
        hasVenues={hasVenues}
        isAdmin={account?.role === "ADMIN"}
        counts={{ tickets: myTickets.length, saved: savedEvents.length, venues: venues.length, events: summaryData.stats.eventCount }}
        onOpen={setView}
      />
    );
  }

  // ---- drilled-in section ----
  const SECTION_TITLES: Record<ProfileTab, string> = {
    overview: "Your activity", tickets: "Tickets", saved: "Saved",
    lists: "My lists", venues: "Your venues",
  };
  return (
    <>
      <SectionHeader title={SECTION_TITLES[view]} onBack={() => setView("menu")} />

      {view === "overview" && (
        eventsPending ? (
          <TabSkeletonOrError error={allEvents.error} onRetry={allEvents.reload} />
        ) : (
          <OverviewTab
            account={!!account}
            tickets={myTickets}
            saved={savedEvents}
            isHost={isHost}
            summary={summaryData}
            onNavigate={setView}
          />
        )
      )}
      {view === "tickets" && (
        eventsPending ? <TabSkeletonOrError error={allEvents.error} onRetry={allEvents.reload} /> : <TicketsSection tickets={myTickets} />
      )}
      {view === "saved" && (
        eventsPending ? <TabSkeletonOrError error={allEvents.error} onRetry={allEvents.reload} /> : <SavedTab events={savedEvents} />
      )}
      {view === "lists" && account && <CollectionsSection />}
      {view === "venues" && (
        myVenues.loading || myVenues.error
          ? <TabSkeletonOrError error={myVenues.error} onRetry={myVenues.reload} />
          : <VenuesSection venues={venues} />
      )}
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
      <div className="ov-grid" style={{ paddingTop: 4 }}>
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

/* ---------- Notifications preference (lives in the hub's prefs block) ---------- */
function NotificationsPref() {
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

  if (pushState === "unsupported") return null;

  return (
    <>
      <div className="more-pref-row">
        <span><i className="icon-bell" /> Notifications</span>
        {pushState === "denied" ? (
          <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Blocked in browser</span>
        ) : pushState === "loading" ? (
          <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>…</span>
        ) : (
          <button className={"switch" + (pushState === "subscribed" ? " on" : "")} disabled={pushBusy} onClick={togglePush} aria-pressed={pushState === "subscribed"} aria-label="Toggle push notifications">
            <span className="switch-thumb" />
          </button>
        )}
      </div>
      {pushErr && <p className="errline" style={{ padding: "0 4px" }}>{pushErr}</p>}
    </>
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

/* ---------- "More" hub: account + preferences + a vertical dock ---------- */
function MoreMenu({ account, isHost, hasVenues, isAdmin, counts, onOpen }: {
  account: boolean; isHost: boolean; hasVenues: boolean; isAdmin: boolean;
  counts: { tickets: number; saved: number; venues: number; events: number };
  onOpen: (v: ProfileTab) => void;
}) {
  const acc = useAccount();

  // Each row is either a local section (drills in via onOpen) or a real
  // route (to). Only shown when relevant so the dock isn't padded with
  // dead-end rows for features the visitor hasn't touched.
  type Row = { key: string; label: string; sub?: string; icon: string; tab?: ProfileTab; to?: string; show: boolean };
  const allRows: Row[] = [
    { key: "overview", label: "You", sub: "Tickets, saved & activity", icon: "layout-grid", tab: "overview", show: true },
    { key: "tickets", label: "Tickets", sub: counts.tickets > 0 ? `${counts.tickets} upcoming` : "Nothing booked yet", icon: "ticket", tab: "tickets", show: true },
    { key: "saved", label: "Saved", sub: counts.saved > 0 ? `${counts.saved} event${counts.saved === 1 ? "" : "s"}` : "Tap the heart on any event", icon: "heart", tab: "saved", show: true },
    { key: "lists", label: "Lists", sub: "Group events to remember or share", icon: "list", tab: "lists", show: account },
    { key: "venues", label: "Your venues", sub: `${counts.venues} venue${counts.venues === 1 ? "" : "s"}`, icon: "store", tab: "venues", show: hasVenues },
    { key: "organizer", label: "Organizer dashboard", sub: isHost ? `${counts.events} live event${counts.events === 1 ? "" : "s"}` : "Host an event, free", icon: "layout-dashboard", to: isHost ? "/organizer" : "/host/events", show: true },
    { key: "account", label: "Manage account", sub: "Profile & sign-out", icon: "user-cog", to: "/account", show: account },
    { key: "admin", label: "Admin dashboard", icon: "shield-check", to: "/admin", show: isAdmin },
    { key: "support", label: "Help & support", icon: "life-buoy", to: "/support", show: true },
  ];
  const rows = allRows.filter((r) => r.show);

  return (
    <div className="more-page">
      <div className="more-head"><h1>More</h1></div>

      {/* account identity (or sign-in) */}
      {account ? (
        <div className="more-account">
          {acc?.picture
            ? <img className="more-account-pic" src={acc.picture} alt="" />
            : <span className="more-account-pic more-account-pic-fallback"><i className="icon-user" /></span>}
          <div className="more-account-info">
            <b>{acc?.name || "You"}</b>
            {acc?.email && <span>{acc.email}</span>}
          </div>
        </div>
      ) : (
        <div className="signin-card" style={{ margin: "0 16px 12px" }}>
          <AccountWidget />
        </div>
      )}

      {/* quick preferences — the theme toggle + city that used to sit in
          every browse screen's topbar now live here */}
      <div className="more-prefs">
        <div className="more-pref-row">
          <span><i className="icon-moon-star" /> Appearance</span>
          <ThemeToggle />
        </div>
        <div className="more-pref-row">
          <span><i className="icon-map-pin" /> Location</span>
          <CityPill />
        </div>
        {account && <NotificationsPref />}
      </div>

      {/* the vertical dock */}
      <nav className="more-dock" aria-label="Sections">
        {rows.map((r) => {
          const inner = (
            <>
              <span className="more-row-ic"><i className={"icon-" + r.icon} /></span>
              <span className="more-row-text">
                <b>{r.label}</b>
                {r.sub && <span>{r.sub}</span>}
              </span>
              <i className="icon-chevron-right more-row-chevron" />
            </>
          );
          return r.to ? (
            <Link key={r.key} to={r.to} className="more-row">{inner}</Link>
          ) : (
            <button key={r.key} className="more-row" onClick={() => r.tab && onOpen(r.tab)}>{inner}</button>
          );
        })}
      </nav>

      <div style={{ padding: "4px 16px 0" }}><InstallPrompt /></div>
    </div>
  );
}

/* Back-header shown when a dock row is opened — turns the hub into a
   two-level drill-down instead of a flat tab strip. */
function SectionHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="section-head">
      <button className="section-back" onClick={onBack} aria-label="Back to More">
        <i className="icon-arrow-left" />
      </button>
      <h1>{title}</h1>
    </header>
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

const VENUE_TABS = [
  { key: "reservations", label: "Reservations", icon: "icon-calendar-check" },
  { key: "calendar", label: "Calendar", icon: "icon-calendar" },
  { key: "guests", label: "Guests", icon: "icon-user" },
  { key: "analytics", label: "Analytics", icon: "icon-bar-chart" },
  { key: "hours", label: "Hours", icon: "icon-clock" },
] as const;
type VenueTabKey = typeof VENUE_TABS[number]["key"];

function VenueManager({ venue }: { venue: OwnedVenue }) {
  const [tab, setTab] = useState<VenueTabKey>("reservations");
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

      <div className="chips" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {VENUE_TABS.map((t) => (
          <button key={t.key} className={"chip" + (tab === t.key ? " on" : "")} onClick={() => setTab(t.key)}>
            <i className={t.icon} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "reservations" && (
        <VenueReservationsTab venueId={venue.id} rows={rows} loading={loading} error={error} setStatus={setStatus} onCreated={reload} />
      )}
      {tab === "calendar" && <VenueCalendar rows={rows} loading={loading} />}
      {tab === "guests" && <VenueGuests venueId={venue.id} rows={rows} />}
      {tab === "analytics" && <VenueAnalyticsPanel venueId={venue.id} />}
      {tab === "hours" && <VenueAvailabilityEditor venue={venue} />}
    </div>
  );
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
              return (
                <li key={r.id}>
                  <i className="icon-user" />
                  <span>
                    {r.guestName} <small style={{ color: "var(--text-3)" }}>· party of {r.partySize}</small>
                    {r.source === "manual" && <small style={{ color: "var(--text-3)" }}> · walk-in</small>}
                    <br />
                    <small style={{ color: "var(--text-3)" }}>{r.date.slice(0, 10)} · {r.time}</small>
                    {" "}
                    <span className={"ec-badge " + statusClass(r.status)}>{status.replace("_", "-")}</span>
                  </span>
                  <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
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
                  </div>
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
                <GuestDetail venueId={venueId} email={g.email} reservations={g.reservations} note={noteFor(g.email)} onNoteSaved={reload} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function GuestDetail({ venueId, email, reservations, note, onNoteSaved }: {
  venueId: string; email: string; reservations: VenueReservationRow[]; note: string; onNoteSaved: () => void;
}) {
  const [text, setText] = useState(note);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(note); }, [note]);

  async function save() {
    setSaving(true);
    try { await api.setVenueGuestNote(venueId, email, text); onNoteSaved(); } finally { setSaving(false); }
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
      <textarea rows={2} placeholder="Notes on this guest (allergies, preferences, VIP…)" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn glass sm" style={{ width: "auto" }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save note"}</button>
    </div>
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


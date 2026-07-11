import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Weyn, type Venue } from "../api";
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
// account/venues stay real routes (see HANDOFF.md §17, and venue-os/'s own
// comment), just surfaced as rows here.
type ProfileTab = "overview" | "tickets" | "saved" | "lists";
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
    lists: "My lists",
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
    { key: "venues", label: "Your venues", sub: `${counts.venues} venue${counts.venues === 1 ? "" : "s"}`, icon: "store", to: "/venue-os", show: hasVenues },
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


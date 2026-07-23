import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { tabSwitchVariants, pageTransition } from "../../motion";
import { Html5Qrcode } from "html5-qrcode";
import QRCode from "qrcode";
import { api, API_BASE, TEAM_PERMISSIONS, isValidEmail, type Weyn, type TeamRole, type TeamPermission, type TeamMember, type PromoCode, type Campaign, type Sponsor, type Vendor, type FloorTable, type FloorTableInput, type MarketingScheduleItem, type CheckoutFormField } from "../../api";
import { useAsync } from "../../hooks";
import { getAuthToken } from "../../store";
import FeatureLock from "../../components/FeatureLock";
import FloorPlanCanvas from "../../components/FloorPlanCanvas";
import DashboardShell from "../../components/dashboard/DashboardShell";

// The real per-event workspace HANDOFF.md §17 called for — deep-linkable
// tabs (/organizer/events/:id/:tab) instead of the old one-off modal
// sheets. Every tab below except Promo codes/Waitlist/Notify/Recurring/
// Featured is ported near-verbatim from You.tsx's sheet components (they
// had no sheet-specific coupling beyond the backdrop chrome — see the
// exploration notes); those five are new UI for backend routes that
// existed but had no frontend caller at all before this.

// Promo codes/waitlist/recurring events used to each be their own tab —
// folded into Marketing (alongside the AI copy generator) since they're all
// "grow this event" tools an organizer reaches for together, not everyday
// destinations that need their own place in the nav. 6 tabs, not 8.
const TABS = [
  { key: "overview", label: "Overview", icon: "chart-bar", group: "operations" },
  { key: "attendees", label: "Attendees", icon: "users", group: "operations" },
  { key: "checkin", label: "Check-in", icon: "qr-code", group: "operations" },
  { key: "seating", label: "Seating", icon: "grid-2x2", group: "tools" },
  { key: "team", label: "Team", icon: "users-round", group: "tools" },
  { key: "marketing", label: "Marketing", icon: "megaphone", group: "growth" },
  { key: "settings", label: "Settings", icon: "settings", group: "tools" },
];

// UX-only role gate — the server routes (requireEventAccess / *Strict) are
// the real enforcement. STAFF is door-only: Check-in and a read-only
// Overview, plus Attendees when their membership carries the viewAttendees
// permission (matches requireEventAccessOrPermission on the server). OWNER
// and MANAGER see every tab; the Team tab renders read-only for MANAGER
// inside TeamTab.
function tabAllowed(key: string, event: Weyn): boolean {
  if (event.myRole !== "STAFF") return true;
  if (key === "overview" || key === "checkin") return true;
  if (key === "attendees") return (event.myPermissions || []).includes("viewAttendees");
  return false;
}

export default function EventWorkspace() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const events = useAsync(() => api.dashboardEvents(), []);
  const sub = useAsync(() => api.mySubscription(), []);
  const event = (events.data || []).find((e) => e.id === id);

  if (events.loading) return <p className="hint" style={{ padding: "8px 6px" }}>Loading…</p>;
  if (events.error) return <p className="errline">{events.error}</p>;
  if (!event) return (
    <div className="empty">
      <div className="ic"><i className="icon-search-x" /></div>
      <p>Couldn't find that event, or you don't manage it.</p>
      <Link to="/organizer/events" className="btn glass" style={{ maxWidth: 220, margin: "8px auto 0" }}>Back to events</Link>
    </div>
  );
  // Same fix as VenueWorkspace: the bare /organizer/events/:id route (no
  // :tab) rendered the overview body via a JS default, but left the URL
  // without "/overview" — so no NavLink ever matched it and the active
  // section never highlighted. Redirect once so URL and body agree.
  if (!tab) return <Navigate to={`/organizer/events/${event.id}/overview`} replace />;

  // Only the tabs this role can use — and if a deep link points at one it
  // can't (e.g. STAFF opening /team directly), bounce to the first it can.
  const visibleTabs = TABS.filter((t) => tabAllowed(t.key, event));
  if (!visibleTabs.some((t) => t.key === tab)) {
    return <Navigate to={`/organizer/events/${event.id}/${visibleTabs[0].key}`} replace />;
  }

  const features = sub.data?.features || {};

  return (
    <>
      {/* Was 4 differently-styled elements (icon link, h2, text link, pill
          button) crammed into one row — overflowed on a 375px screen. Back
          button + title on their own row, the two navigation actions below
          on a second row so nothing has to fight for space or wrap mid-word. */}
      <div className="date-head" style={{ paddingLeft: 0, alignItems: "center", paddingBottom: 4 }}>
        <Link to="/organizer/events" className="copy-btn" style={{ marginRight: 4 }}><i className="icon-arrow-left" /></Link>
        <h2 className="page-title" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.title}</h2>
        {event.myRole && event.myRole !== "OWNER" && (
          <span className="ec-badge" style={{ marginLeft: 8, flexShrink: 0 }}>
            {event.myRole === "MANAGER" ? "Manager" : "Staff — check-in only"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "0 6px 10px" }}>
        <Link to={`/e/${event.id}`} className="btn glass sm"><i className="icon-external-link" /> View live</Link>
        {/* The full cross-event dashboard — Overview/Attendees/Finance/
            Marketing across every event, not just this one. A real
            destination (its own route, its own nav), not a modal. */}
        <Link to="/organizer" className="btn glass sm"><i className="icon-layout-dashboard" /> Organizer Dashboard</Link>
      </div>
      <DashboardShell
        ariaLabel="Event workspace sections"
        navItems={visibleTabs.map((t) => ({
          to: `/organizer/events/${event.id}/${t.key}`,
          icon: t.icon,
          label: t.label,
          group: t.group,
          active: tab === t.key,
        }))}
      >
        {/* Cross-fade + slight scale between tabs. Keyed by `event.id}-${tab}`
            (not just `tab`) so each body remounts as its own presence both on
            a tab switch AND on an event switch — the key was previously tab-
            only, so navigating straight from /organizer/events/A/settings to
            /organizer/events/B/settings (back/forward, or a direct URL edit,
            with no intervening tab change) kept the same SettingsTab/
            CheckoutFormBuilder/InviteOnlyPanel/CheckInTab instance mounted.
            Those seed editable local state straight from `event.*` via a bare
            useState() initializer with no resync effect, so the form kept
            showing event A's price/capacity/payment settings while `save()`
            posted them against event B's id — a real, silent cross-event
            data-corruption bug. mode="wait" lets the old one fade out first;
            the bodies already unmount/remount on tab change (they were
            conditionally rendered before), so this adds no extra refetch
            beyond the one an actual event switch should already trigger. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`${event.id}-${tab}`} variants={tabSwitchVariants} initial="initial" animate="animate" exit="exit" transition={pageTransition}>
            {tab === "overview" && <OverviewTab event={event} features={features} reload={events.reload} />}
            {tab === "attendees" && <AttendeesTab event={event} features={features} />}
            {tab === "marketing" && <MarketingTab event={event} features={features} />}
            {tab === "seating" && <SeatingTab event={event} />}
            {tab === "team" && <TeamTab event={event} />}
            {tab === "checkin" && <CheckInTab event={event} />}
            {tab === "settings" && <SettingsTab event={event} features={features} reload={events.reload} />}
          </motion.div>
        </AnimatePresence>
      </DashboardShell>
    </>
  );
}

/* ---------- Overview: analytics + featured toggle + invite-only ---------- */
function OverviewTab({ event, features, reload }: { event: Weyn; features: Record<string, boolean>; reload: () => void }) {
  const { data, loading, error } = useAsync(() => api.eventAnalytics(event.id), [event.id]);
  const maxTier = data ? Math.max(1, ...data.tierBreakdown.map((t) => t.sold)) : 1;
  const maxDay = data ? Math.max(1, ...data.salesByDay.map((d) => d.qty)) : 1;

  return (
    <>
      {loading && <p className="hint" style={{ padding: "0 6px" }}>Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {data && (
        <>
          <div className="stat-grid">
            <div className="stat"><div className="k">Tickets sold</div><div className="v">{data.ticketsSold} <small>/ {data.capacity >= 9000 ? "∞" : data.capacity}</small></div></div>
            <div className="stat"><div className="k">Revenue</div><div className="v">{data.revenue.toLocaleString()} <small>{event.currency || "OMR"}</small></div></div>
            {data.views !== undefined && <div className="stat"><div className="k">Page views</div><div className="v">{data.views}</div></div>}
            {data.checkIn && <div className="stat"><div className="k">Checked in</div><div className="v">{data.checkIn.checkedIn}/{data.checkIn.total}</div></div>}
          </div>

          {data.tierBreakdown.length > 0 && (
            <>
              <p className="section-label" style={{ marginTop: 16 }}>Ticket type performance</p>
              {data.tierBreakdown.map((t) => (
                <div key={t.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span>{t.name}</span><span style={{ color: "var(--text-2)" }}>{t.sold}/{t.capacity} · {t.revenue.toLocaleString()} {event.currency || "OMR"}</span>
                  </div>
                  <div className="bar"><i style={{ width: `${Math.round((t.sold / maxTier) * 100)}%` }} /></div>
                </div>
              ))}
            </>
          )}

          {data.salesByDay.length > 0 && (
            <>
              <p className="section-label" style={{ marginTop: 16 }}>Sales over time</p>
              <div className="mini-bars" style={{ height: 80 }}>
                {data.salesByDay.map((d) => (
                  <div key={d.date} className="mini-bar" title={`${d.date}: ${d.qty}`} style={{
                    height: `${Math.max(6, Math.round((d.qty / maxDay) * 80))}px`,
                  }} />
                ))}
              </div>
            </>
          )}

          {data.conversionRate !== null && (
            <p className="hint" style={{ margin: "16px 0 8px" }}>Views → bookings: {data.conversionRate}% conversion</p>
          )}

          {data.salesVelocity && (
            <div className="stat-grid" style={{ marginTop: 4 }}>
              <div className="stat">
                <div className="k">Last 3 days</div>
                <div className="v">{data.salesVelocity.last3Days} <small>{data.salesVelocity.trend > 0 ? `↑${data.salesVelocity.trend}%` : data.salesVelocity.trend < 0 ? `↓${Math.abs(data.salesVelocity.trend)}%` : ""}</small></div>
              </div>
              {data.forecast && (
                <div className="stat"><div className="k">Sellout forecast</div><div className="v">{Math.ceil(data.forecast.daysToSellout)} <small>day{Math.ceil(data.forecast.daysToSellout) === 1 ? "" : "s"}</small></div></div>
              )}
              {data.benchmark?.yourAverageSellThroughRate !== null && data.benchmark && (
                <div className="stat">
                  <div className="k">vs. your average</div>
                  <div className="v">{data.benchmark.sellThroughRate}% <small>avg {data.benchmark.yourAverageSellThroughRate}%</small></div>
                </div>
              )}
            </div>
          )}

          {data.conversionRate === null && data.views === undefined && (
            <p className="hint" style={{ marginTop: 14 }}>
              Advanced analytics (page views, conversion rate, sales velocity, forecasts) is a Pro feature.
            </p>
          )}
        </>
      )}

      <p className="section-label">Discovery</p>
      <FeaturedToggle event={event} enabled={!!features.featuredPlacement} reload={reload} />
    </>
  );
}

function FeaturedToggle({ event, enabled, reload }: { event: Weyn; enabled: boolean; reload: () => void }) {
  const [featured, setFeatured] = useState(!!event.featured);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await api.setEventFeatured(event.id, !featured);
      setFeatured(res.featured);
      reload();
    } finally { setBusy(false); }
  }

  return (
    <FeatureLock feature="featuredPlacement" enabled={enabled}>
      <div className="settings-row">
        <span>Featured placement <small style={{ color: "var(--text-3)" }}>— surfaces this event on Explore's Featured rail</small></span>
        <button className={"switch" + (featured ? " on" : "")} disabled={busy} onClick={toggle} aria-pressed={featured} aria-label="Toggle featured placement">
          <span className="switch-thumb" />
        </button>
      </div>
    </FeatureLock>
  );
}

/* ---------- Attendees + CSV export (server-side, injection-safe) ---------- */
function AttendeesTab({ event, features }: { event: Weyn; features: Record<string, boolean> }) {
  const { data, loading, error } = useAsync(() => api.getAttendees(event.id), [event.id]);
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/events/${event.id}/attendees.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-attendees.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {event.ticketingType === "organizer_payment" && (
        <>
          <p className="hint" style={{ margin: "0 0 8px" }}>Awaiting payment confirmation</p>
          <PendingPaymentsPanel event={event} />
          <p className="section-label">Confirmed attendees</p>
        </>
      )}
      {loading && (
        <div style={{ padding: "0 4px" }}>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
        </div>
      )}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        (data || []).length > 0 ? (
          <ul className="steps">
            {data!.map((a, i) => (
              <li key={i}>
                <i className="icon-user" />
                <span>{a.name || a.email || "Anonymous"}{a.email && a.name && <><br /><small style={{ color: "var(--text-3)" }}>{a.email}</small></>}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No named attendees yet — people who book while signed in will show up here.</p>
        )
      )}
      <FeatureLock feature="csvExports" enabled={!!features.csvExports}>
        <button className="btn glass" onClick={exportCsv} disabled={exporting} style={{ marginTop: 10 }}>
          <i className="icon-download" /> {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </FeatureLock>

      <p className="section-label">Transfer a ticket</p>
      <TransferTicketPanel />

      <p className="section-label">Bulk notify</p>
      <NotifyForm event={event} enabled={!!features.bulkNotifications} />
    </>
  );
}

// "organizer_payment" tickets are never trusted paid until a human here
// clicks Confirm — see server/app.js's confirm-payment route. claimedPaidAt
// is the buyer's own unverified claim, surfaced so the organizer knows
// which ones to actually go check their bank/payment account for.
function PendingPaymentsPanel({ event }: { event: Weyn }) {
  const { data, loading, error, reload } = useAsync(() => api.listPendingPayments(event.id), [event.id]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function confirm(bookingId: string) {
    setConfirmingId(bookingId);
    try {
      await api.confirmBookingPayment(event.id, bookingId);
      reload();
    } finally {
      setConfirmingId(null);
    }
  }

  if (loading) return <p className="hint">Loading…</p>;
  if (error) return <p className="errline">{error}</p>;
  if (!data || data.length === 0) return <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>Nothing waiting on confirmation right now.</p>;

  return (
    <ul className="steps">
      {data.map((b) => (
        <li key={b.id}>
          <i className={b.claimedPaidAt ? "icon-clock-alert" : "icon-clock"} />
          <span>
            {b.name || b.email || "Anonymous"}{b.tierName ? ` · ${b.tierName}` : ""} · {b.qty} ticket{b.qty === 1 ? "" : "s"}
            <br />
            <small style={{ color: "var(--text-3)" }}>
              {b.amount.toFixed(2)} {event.currency || "OMR"}{b.claimedPaidAt ? " · says they've paid" : " · not yet claimed as paid"}
            </small>
          </span>
          <button className="btn glass sm" style={{ marginLeft: "auto" }} onClick={() => confirm(b.id)} disabled={confirmingId === b.id}>
            {confirmingId === b.id ? "Confirming…" : "Confirm payment"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TransferTicketPanel() {
  const [code, setCode] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function transfer() {
    if (!code.trim() || !toEmail.trim()) return;
    setBusy(true); setResult(null);
    try {
      await api.transferTicket(code.trim(), toEmail.trim());
      setResult({ ok: true, message: "Ticket transferred — a new confirmation email was sent." });
      setCode(""); setToEmail("");
    } catch (e: any) {
      setResult({ ok: false, message: e.message || "Couldn't transfer that ticket." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 10px" }}>Reassign a ticket (by its code, shown on the attendee's QR ticket) to a different attendee's email.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ticket code" style={{ flex: "1 1 160px" }} />
        <input type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="new-attendee@email.com" style={{ flex: "1 1 200px" }} />
        <button className="btn" onClick={transfer} disabled={busy || !code.trim() || !toEmail.trim()}>{busy ? "Transferring…" : "Transfer"}</button>
      </div>
      {result && <p className={result.ok ? "hint" : "errline"}>{result.message}</p>}
    </>
  );
}

function NotifyForm({ event, enabled }: { event: Weyn; enabled: boolean }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ recipients?: number; emailed?: number; pushed?: number; scheduled?: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const campaigns = useAsync(() => (enabled ? api.listCampaigns(event.id) : Promise.resolve([])), [enabled]);
  const templates = useAsync(() => (enabled ? api.listMessageTemplates() : Promise.resolve([])), [enabled]);

  function loadTemplate(id: string) {
    const t = templates.data?.find((t) => t.id === id);
    if (!t) return;
    setSubject(t.subject || ""); setMessage(t.message);
  }
  async function saveAsTemplate() {
    if (!templateName.trim() || !message.trim()) return;
    setSavingTemplate(true);
    try {
      await api.createMessageTemplate({ name: templateName.trim(), subject: subject.trim() || undefined, message: message.trim() });
      setTemplateName("");
      templates.reload();
    } finally {
      setSavingTemplate(false);
    }
  }
  async function removeTemplate(id: string) {
    await api.deleteMessageTemplate(id);
    templates.reload();
  }

  async function send() {
    if (!subject.trim() || !message.trim()) return;
    setSending(true); setErr(""); setResult(null);
    try {
      const res = await api.notifyAttendees(event.id, {
        subject: subject.trim(), message: message.trim(),
        scheduledFor: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
      });
      setResult(res);
      setSubject(""); setMessage(""); setScheduleAt("");
      campaigns.reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't send notification");
    } finally {
      setSending(false);
    }
  }

  async function cancelCampaign(id: string) {
    try { await api.cancelCampaign(event.id, id); campaigns.reload(); } catch { /* already sent */ }
  }

  return (
    <FeatureLock feature="bulkNotifications" enabled={enabled}>
      {(templates.data || []).length > 0 && (
        <div className="field">
          <label>Start from a template</label>
          <select value="" onChange={(e) => e.target.value && loadTemplate(e.target.value)}>
            <option value="">— Type your own below —</option>
            {templates.data!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="An update about your ticket" /></div>
      <div className="field"><label>Message</label><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What's changed…" /></div>
      <div className="field"><label>Send at <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· leave blank to send now</span></label><input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} /></div>
      {err && <p className="errline">{err}</p>}
      {result?.scheduled && <p className="hint" style={{ color: "var(--accent)" }}>Scheduled — it'll go out automatically.</p>}
      {result && !result.scheduled && <p className="hint" style={{ color: "var(--accent)" }}>Sent to {result.recipients} attendees ({result.emailed} emailed, {result.pushed} pushed).</p>}
      <button className="btn" onClick={send} disabled={sending || !subject.trim() || !message.trim()}>
        {sending ? "Sending…" : scheduleAt ? "Schedule" : "Send now"}
      </button>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name, e.g. Sold out reminder" style={{ flex: 1 }} />
        <button className="btn glass sm" onClick={saveAsTemplate} disabled={savingTemplate || !templateName.trim() || !message.trim()}>
          {savingTemplate ? "Saving…" : "Save as template"}
        </button>
      </div>
      {(templates.data || []).length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {templates.data!.map((t) => (
            <span key={t.id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {t.name}
              <button onClick={() => removeTemplate(t.id)} aria-label={`Delete template ${t.name}`} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-3)", fontSize: 12 }}>✕</button>
            </span>
          ))}
        </div>
      )}

      {(campaigns.data || []).length > 0 && (
        <>
          <p className="section-label" style={{ marginTop: 18 }}>Campaign history</p>
          <ul className="steps">
            {(campaigns.data || []).map((c: Campaign) => (
              <li key={c.id}>
                <i className={c.status === "scheduled" ? "icon-clock" : c.status === "cancelled" ? "icon-x" : "icon-check"} />
                <span>
                  {c.subject || "(no subject)"}
                  <br /><small style={{ color: "var(--text-3)" }}>
                    {c.status === "scheduled" ? `Scheduled for ${new Date(c.scheduledFor!).toLocaleString()}` : c.status === "cancelled" ? "Cancelled" : `Sent ${new Date(c.sentAt!).toLocaleString()}`}
                  </small>
                </span>
                {c.status === "scheduled" && <button className="copy-btn" style={{ marginLeft: "auto" }} onClick={() => cancelCampaign(c.id)}>Cancel</button>}
              </li>
            ))}
          </ul>
        </>
      )}
    </FeatureLock>
  );
}

/* ---------- Promo codes ---------- */
function PromoCodesSection({ event, enabled }: { event: Weyn; enabled: boolean }) {
  const { data, loading, error, reload } = useAsync(() => api.listPromoCodes(event.id), [event.id]);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");
  const [discountValue, setDiscountValue] = useState("10");
  const [maxUses, setMaxUses] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    if (!code.trim()) return;
    setCreating(true); setErr("");
    try {
      await api.createPromoCode(event.id, {
        code: code.trim().toUpperCase(), discountType, discountValue: Number(discountValue) || 0,
        maxUses: maxUses ? Number(maxUses) : undefined,
        minQuantity: minQuantity ? Number(minQuantity) : undefined,
      });
      setCode(""); setMaxUses(""); setMinQuantity("");
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't create promo code");
    } finally {
      setCreating(false);
    }
  }
  async function toggleActive(p: PromoCode) {
    await api.setPromoCodeActive(event.id, p.id, !p.active);
    reload();
  }

  return (
    <FeatureLock feature="promoCodes" enabled={enabled}>
      <div className="field"><label>Code</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SUMMER25" style={{ textTransform: "uppercase" }} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Discount</label>
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value as any)}>
            <option value="percent">Percent off</option>
            <option value="flat">{`Flat ${event.currency || "OMR"} off`}</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>{discountType === "percent" ? "Percent" : event.currency || "OMR"}</label>
          <input inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
        </div>
      </div>
      <div className="field"><label>Max uses (optional)</label><input inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" /></div>
      <div className="field"><label>Group discount — minimum quantity (optional)</label><input inputMode="numeric" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} placeholder="e.g. 4 — code only applies buying 4+ tickets" /></div>
      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={create} disabled={creating || !code.trim()}>{creating ? "Creating…" : "Create promo code"}</button>

      <p className="section-label" style={{ marginTop: 18 }}>Active codes</p>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        (data || []).length > 0 ? (
          <ul className="steps">
            {data!.map((p) => (
              <li key={p.id}>
                <i className="icon-ticket-percent" />
                <span>
                  <b>{p.code}</b> <small style={{ color: "var(--text-3)" }}>· {p.discountType === "percent" ? `${p.discountValue}% off` : `${p.discountValue} ${event.currency || "OMR"} off`} · {p.usedCount}{p.maxUses ? `/${p.maxUses}` : ""} used{p.minQuantity ? ` · min ${p.minQuantity} tickets` : ""}</small>
                </span>
                <button className="copy-btn" style={{ marginLeft: "auto" }} onClick={() => toggleActive(p)}>{p.active ? "Deactivate" : "Activate"}</button>
              </li>
            ))}
          </ul>
        ) : <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No promo codes yet.</p>
      )}
    </FeatureLock>
  );
}

/* ---------- Waitlist ---------- */
function WaitlistSection({ event, enabled }: { event: Weyn; enabled: boolean }) {
  const { data, loading, error } = useAsync(() => api.listWaitlist(event.id), [event.id]);
  return (
    <FeatureLock feature="waitlists" enabled={enabled}>
      <p className="hint" style={{ margin: "0 0 12px" }}>People who tried to book after this event sold out.</p>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        (data || []).length > 0 ? (
          <ul className="steps">
            {data!.map((w) => (
              <li key={w.id}>
                <i className="icon-user" />
                <span>{w.name || w.email}{w.name && <><br /><small style={{ color: "var(--text-3)" }}>{w.email}</small></>}</span>
                {!w.notifiedAt && <span className="ec-badge" style={{ marginLeft: "auto" }}>Not notified</span>}
              </li>
            ))}
          </ul>
        ) : <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No one on the waitlist yet.</p>
      )}

      <p className="section-label" style={{ marginTop: 18 }}>Recurring events</p>
      <RecurringForm event={event} enabled={enabled} />
    </FeatureLock>
  );
}

function RecurringForm({ event, enabled }: { event: Weyn; enabled: boolean }) {
  const [count, setCount] = useState("4");
  const [intervalDays, setIntervalDays] = useState("7");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; startsAt: string }[] | null>(null);
  const [err, setErr] = useState("");

  async function create() {
    setCreating(true); setErr(""); setCreated(null);
    try {
      const res = await api.createRecurringEvents(event.id, { count: Number(count) || 1, intervalDays: Number(intervalDays) || 7 });
      setCreated(res.created);
    } catch (e: any) {
      setErr(e.message || "Couldn't create recurring events");
    } finally {
      setCreating(false);
    }
  }

  return (
    <FeatureLock feature="recurringEvents" enabled={enabled}>
      <p className="hint" style={{ margin: "0 0 10px" }}>Creates copies of this event spaced by a fixed interval — not a full recurrence-rule engine (no weekday patterns or exceptions yet).</p>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}><label>How many</label><input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></div>
        <div className="field" style={{ flex: 1 }}><label>Every N days</label><input inputMode="numeric" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} /></div>
      </div>
      {err && <p className="errline">{err}</p>}
      <button className="btn glass" onClick={create} disabled={creating}>{creating ? "Creating…" : "Create copies"}</button>
      {created && (
        <ul className="steps" style={{ marginTop: 10 }}>
          {created.map((c) => (
            <li key={c.id}><i className="icon-calendar-plus" /><span><Link to={`/organizer/events/${c.id}`}>{new Date(c.startsAt).toLocaleDateString()}</Link></span></li>
          ))}
        </ul>
      )}
    </FeatureLock>
  );
}

/* ---------- Marketing ---------- */
function MarketingTab({ event, features }: { event: Weyn; features: Record<string, boolean> }) {
  const { data, loading, error, reload } = useAsync(() => api.getMarketing(event.id), [event.id]);
  const [regenerating, setRegenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function regenerate() {
    setRegenerating(true);
    try { await api.regenerateMarketing(event.id); reload(); } finally { setRegenerating(false); }
  }
  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500); });
  }

  const channels = data ? [
    { key: "instagram", label: "Instagram caption", icon: "camera", text: data.instagram },
    { key: "instagramStory", label: "Instagram / WhatsApp Story", icon: "camera", text: data.instagramStory },
    { key: "whatsapp", label: "WhatsApp message", icon: "message-circle", text: data.whatsapp },
    { key: "whatsappBroadcast", label: "WhatsApp broadcast list", icon: "message-circle", text: data.whatsappBroadcast },
    { key: "telegram", label: "Telegram post", icon: "send", text: data.telegram },
    { key: "twitter", label: "X / Twitter post", icon: "at-sign", text: data.twitter },
  ].filter((c) => c.text) : [];

  return (
    <>
      <p className="hint" style={{ margin: "0 0 14px" }}>{data?.aiGenerated ? "Generated with AI." : "Generated from your event details."} Copy and post anywhere.</p>
      {loading && <p className="hint">Loading…</p>}
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

      {!!data?.schedule?.length && (
        <>
          <p className="section-label">Posting schedule</p>
          <PostingScheduleSection schedule={data.schedule} copy={copy} copiedKey={copiedKey} />
        </>
      )}

      <p className="section-label">Promo codes</p>
      <PromoCodesSection event={event} enabled={!!features.promoCodes} />

      <p className="section-label">Waitlist</p>
      <WaitlistSection event={event} enabled={!!features.waitlists} />

      <MoreEventTools event={event} />
    </>
  );
}

// One card per countdown stage — organizer copies each post and schedules it
// themselves (Instagram/WhatsApp native scheduling or just a phone reminder).
// Deliberately not auto-posted: same "AI drafts, human publishes" rule as the
// rest of this tab.
function PostingScheduleSection({ schedule, copy, copiedKey }: { schedule: MarketingScheduleItem[]; copy: (key: string, text: string) => void; copiedKey: string | null }) {
  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>Four posts timed to build urgency — copy each one and post it (or schedule it) on the date shown.</p>
      {schedule.map((s) => {
        const key = `schedule-${s.stage}`;
        const date = s.date ? new Date(s.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Muscat" }) : null;
        return (
          <div key={s.stage} className="marketing-card">
            <div className="marketing-card-head">
              <i className="icon-calendar" /> <b>{s.label}</b>
              {date && <span className="hint" style={{ marginLeft: 6 }}>{date}</span>}
              <button className="copy-btn" onClick={() => copy(key, s.text)}>
                <i className={copiedKey === key ? "icon-check" : "icon-copy"} /> {copiedKey === key ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="marketing-text">{s.text}</pre>
          </div>
        );
      })}
    </>
  );
}

// Promotion/Files/Sponsors/Vendors/Feedback/Automation are all occasional-use
// tools, not things an organizer checks every visit — folded behind one
// toggle rather than six always-open sections, per the standing feedback
// that this dashboard gets complicated fast when everything is expanded by
// default (see HANDOFF's Phase B note).
// A per-event QR code/poster — same qrcode lib and generate-on-click pattern
// as Settings.tsx's organizer-profile poster, just pointed at this event's
// own public page instead of the profile.
function QrPosterSection({ event }: { event: Weyn }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [flyerBusy, setFlyerBusy] = useState(false);
  const eventUrl = `${window.location.origin}/e/${event.id}`;

  async function generate() {
    setGenerating(true);
    try {
      setQrUrl(await QRCode.toDataURL(eventUrl, { margin: 1, width: 480 }));
    } finally {
      setGenerating(false);
    }
  }

  async function downloadFlyer() {
    setFlyerBusy(true);
    try {
      const token = getAuthToken();
      const res = await fetch(api.flyerUrl(event.id), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Couldn't generate the flyer");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `weyn-${event.id}-flyer.svg`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // best-effort — no error UI here, matches the plain QR download above
    } finally {
      setFlyerBusy(false);
    }
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>A QR code linking straight to this event — good for flyers, table tents, or a door sign.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input readOnly value={eventUrl} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
        <button className="copy-btn" onClick={() => navigator.clipboard?.writeText(eventUrl)}><i className="icon-copy" /> Copy</button>
      </div>
      <button className="btn glass" onClick={generate} disabled={generating}>
        <i className="icon-qr-code" /> {generating ? "Generating…" : "Generate QR poster"}
      </button>
      <button className="btn glass" onClick={downloadFlyer} disabled={flyerBusy} style={{ marginLeft: 8 }}>
        <i className="icon-download" /> {flyerBusy ? "Preparing…" : "Download full flyer (title, date, venue + QR)"}
      </button>
      {qrUrl && (
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <img src={qrUrl} alt={`QR code for ${event.title}`} style={{ width: 200, height: 200, borderRadius: 12, background: "#fff", padding: 8 }} />
          <div style={{ marginTop: 10 }}>
            <a href={qrUrl} download={`weyn-${event.id}-qr.png`} className="btn glass" style={{ display: "inline-flex", width: "auto", padding: "9px 16px" }}>
              <i className="icon-download" /> Download PNG
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function MoreEventTools({ event }: { event: Weyn }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ig-import-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ marginTop: 16 }}>
        <i className="icon-layout-list" /> More tools: promotion, QR poster, files, sponsors, vendors, feedback, automation
        <i className={open ? "icon-chevron-up" : "icon-chevron-down"} style={{ marginLeft: "auto" }} />
      </button>
      {open && (
        <>
          <p className="section-label" style={{ marginTop: 16 }}>Promotion</p>
          <PromotionSection event={event} />

          <p className="section-label">QR code / poster</p>
          <QrPosterSection event={event} />

          <p className="section-label">Files</p>
          <FileLibrarySection event={event} />

          <p className="section-label">Budget</p>
          <BudgetSection event={event} />

          <p className="section-label">Sponsors</p>
          <SponsorsSection event={event} />

          <p className="section-label">Vendors</p>
          <VendorsSection event={event} />

          <p className="section-label">Feedback</p>
          <FeedbackSection event={event} />

          <p className="section-label">Automation</p>
          <AutomationSection event={event} />
        </>
      )}
    </>
  );
}

/* ---------- Feedback Center — read-only here; attendees submit via a
   public link (shared separately, e.g. in a post-event email) ---------- */
function FeedbackSection({ event }: { event: Weyn }) {
  const { data, loading } = useAsync(() => api.listFeedback(event.id), [event.id]);
  const { data: nps } = useAsync(() => api.feedbackNps(event.id), [event.id]);
  const feedbackUrl = `${window.location.origin}/e/${event.id}?feedback=1`;
  const [copied, setCopied] = useState(false);
  const [summary, setSummary] = useState<{ summary: string; themes: string[] } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeErr, setSummarizeErr] = useState("");

  function copyLink() {
    navigator.clipboard?.writeText(feedbackUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  async function summarize() {
    setSummarizing(true); setSummarizeErr("");
    try {
      setSummary(await api.summarizeFeedback(event.id));
    } catch (e: any) {
      setSummarizeErr(e.message || "Couldn't summarize feedback right now.");
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 10px" }}>Share this link with attendees after the event to collect ratings and comments.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input readOnly value={feedbackUrl} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
        <button className="copy-btn" onClick={copyLink}><i className={copied ? "icon-check" : "icon-copy"} /> {copied ? "Copied" : "Copy"}</button>
      </div>
      {nps && nps.total > 0 && (
        <p className="hint" style={{ margin: "0 0 10px" }}>
          NPS score: <b>{nps.nps}</b> ({nps.promoters} promoters, {nps.passives} passives, {nps.detractors} detractors)
        </p>
      )}
      {loading && <p className="hint">Loading…</p>}
      {!loading && data && data.count > 0 && (
        <>
          <p className="hint" style={{ margin: "0 0 10px" }}>Average rating: <b>{data.avgRating ?? "—"}</b> / 5 ({data.count} response{data.count === 1 ? "" : "s"})</p>
          <button className="btn glass" onClick={summarize} disabled={summarizing} style={{ marginBottom: 12 }}>
            {summarizing ? "Summarizing…" : "AI-summarize comments"}
          </button>
          {summarizeErr && <p className="errline">{summarizeErr}</p>}
          {summary && (
            <div style={{ marginBottom: 14 }}>
              <p className="hint">{summary.summary}</p>
              {summary.themes.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {summary.themes.map((t) => <span key={t} className="chip">{t}</span>)}
                </div>
              )}
            </div>
          )}
          <ul className="steps">
            {data.entries.filter((e) => e.comment).map((e) => (
              <li key={e.id}>
                <i className="icon-message-square" />
                <span>{e.rating ? "★".repeat(e.rating) : ""}<br /><small style={{ color: "var(--text-3)" }}>{e.comment}</small></span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!loading && (!data || data.count === 0) && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No feedback yet.</p>}
    </>
  );
}

/* ---------- Automation Builder — only "capacity threshold" actually fires
   (see server's runAutomationScan) ---------- */
const AUTOMATION_TRIGGERS = [{ key: "capacity_threshold", label: "Capacity crosses a threshold" }];
const AUTOMATION_ACTIONS = [{ key: "notify_staff", label: "Notify me (email + push)" }];

function AutomationSection({ event }: { event: Weyn }) {
  const { data, loading, reload } = useAsync(() => api.listAutomations(event.id), [event.id]);
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("80");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createAutomation({ name: name.trim(), trigger: "capacity_threshold", action: "notify_staff", eventId: event.id, config: { thresholdPercent: Number(threshold) || 80 } });
      setName(""); reload();
    } finally {
      setSaving(false);
    }
  }
  async function toggle(id: string, enabled: boolean) {
    await api.setAutomationEnabled(id, !enabled); reload();
  }
  async function remove(id: string) {
    await api.deleteAutomation(id); reload();
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 10px", color: "var(--text-3)" }}>
        Legacy — see the new <Link to="/organizer/workflows">Workflows</Link> tab for real trigger→condition→action automations (ticket sales, low inventory, waitlists, promo codes) across every event you run.
      </p>
      <p className="hint" style={{ margin: "0 0 10px" }}>Get notified automatically when this event crosses a capacity threshold — fires once.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name, e.g. Almost sold out" style={{ flex: 2 }} />
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="numeric" style={{ flex: 1 }} placeholder="80" />
        <span style={{ alignSelf: "center", fontSize: 13, color: "var(--text-3)" }}>%</span>
        <button className="btn" onClick={add} disabled={saving || !name.trim()}>{saving ? "Adding…" : "Add"}</button>
      </div>
      {loading && <p className="hint">Loading…</p>}
      {!loading && (data || []).length > 0 && (
        <ul className="steps">
          {data!.map((r) => (
            <li key={r.id}>
              <i className="icon-zap" />
              <span>{r.name}<br /><small style={{ color: "var(--text-3)" }}>{AUTOMATION_TRIGGERS.find((t) => t.key === r.trigger)?.label || r.trigger} → {AUTOMATION_ACTIONS.find((a) => a.key === r.action)?.label || r.action}{r.lastRunAt ? " · already fired" : ""}</small></span>
              <button className="chip" style={{ marginLeft: "auto" }} onClick={() => toggle(r.id, r.enabled)}>{r.enabled ? "On" : "Off"}</button>
              <button className="copy-btn" onClick={() => remove(r.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {!loading && (data || []).length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No automations yet.</p>}
    </>
  );
}

/* ---------- File Library: URL references, not raw uploads ---------- */
function FileLibrarySection({ event }: { event: Weyn }) {
  const { data, loading, reload } = useAsync(() => api.listFiles(event.id), [event.id]);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!url.trim()) return;
    setSaving(true);
    try { await api.addFile({ url: url.trim(), eventId: event.id }); setUrl(""); reload(); } finally { setSaving(false); }
  }
  async function remove(id: string) {
    await api.deleteFile(id); reload();
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 10px" }}>Keep contracts, riders, and shared-drive links for this event in one place.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" style={{ flex: 1 }} />
        <button className="btn" onClick={add} disabled={saving || !url.trim()}>{saving ? "Adding…" : "Add"}</button>
      </div>
      {loading && <p className="hint">Loading…</p>}
      {!loading && (data || []).length > 0 && (
        <ul className="steps">
          {data!.map((f) => (
            <li key={f.id}>
              <i className="icon-file" />
              <span><a href={f.url} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{f.url}</a></span>
              <button className="copy-btn" onClick={() => remove(f.id)} style={{ marginLeft: "auto" }}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {!loading && (data || []).length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No files yet.</p>}
    </>
  );
}

/* ---------- Budget tracking with alerts ---------- */
function BudgetSection({ event }: { event: Weyn }) {
  const { data, loading, reload } = useAsync(() => api.listBudgets(event.id), [event.id]);
  const [category, setCategory] = useState("");
  const [allocatedAmount, setAllocatedAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    if (!category.trim() || !(Number(allocatedAmount) > 0)) return;
    setSaving(true); setErr("");
    try {
      await api.createBudget(event.id, { category: category.trim(), allocatedAmount: Number(allocatedAmount) });
      setCategory(""); setAllocatedAmount("");
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't create budget line");
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    await api.deleteBudget(event.id, id); reload();
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 10px" }}>Set a spending cap per category — matched against Expenses logged with the same category on the Overview dashboard.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category, e.g. Venue" style={{ flex: 2 }} />
        <input value={allocatedAmount} onChange={(e) => setAllocatedAmount(e.target.value)} placeholder={`Allocated ${event.currency || "OMR"}`} inputMode="decimal" style={{ flex: 1 }} />
        <button className="btn" onClick={add} disabled={saving || !category.trim() || !(Number(allocatedAmount) > 0)}>{saving ? "Adding…" : "Add"}</button>
      </div>
      {err && <p className="errline">{err}</p>}
      {loading && <p className="hint">Loading…</p>}
      {!loading && (data || []).length > 0 && (
        <ul className="steps">
          {data!.map((b) => (
            <li key={b.id}>
              <i className={b.overBudget ? "icon-alert-triangle" : "icon-wallet"} />
              <span>
                {b.category} <small style={{ color: b.overBudget ? "var(--danger, #e05252)" : "var(--text-3)" }}>
                  · {b.spent ?? 0} / {b.allocatedAmount} {b.currency}{b.overBudget ? " · over budget" : ""}
                </small>
              </span>
              <button className="copy-btn" style={{ marginLeft: "auto" }} onClick={() => remove(b.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {!loading && (data || []).length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No budget lines yet.</p>}
    </>
  );
}

/* ---------- Sponsor management ---------- */
function SponsorsSection({ event }: { event: Weyn }) {
  const { data, loading, reload } = useAsync(() => api.listSponsors(event.id), [event.id]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try { await api.addSponsor({ name: name.trim(), eventId: event.id, amount: amount ? Number(amount) : undefined }); setName(""); setAmount(""); reload(); } finally { setSaving(false); }
  }
  async function cycleStatus(s: Sponsor) {
    const next: Record<Sponsor["status"], Sponsor["status"]> = { prospect: "confirmed", confirmed: "delivered", delivered: "prospect" };
    await api.updateSponsorStatus(s.id, next[s.status]); reload();
  }
  async function remove(id: string) {
    await api.deleteSponsor(id); reload();
  }
  async function updateRoi(s: Sponsor, key: "impressions" | "clicks" | "leadsGenerated", value: string) {
    await api.updateSponsorRoi(s.id, { [key]: Number(value) || 0 }); reload();
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sponsor name" style={{ flex: 2 }} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={event.currency || "OMR"} inputMode="decimal" style={{ flex: 1 }} />
        <button className="btn" onClick={add} disabled={saving || !name.trim()}>{saving ? "Adding…" : "Add"}</button>
      </div>
      {loading && <p className="hint">Loading…</p>}
      {!loading && (data || []).length > 0 && (
        <ul className="steps">
          {data!.map((s) => (
            <li key={s.id} style={{ flexWrap: "wrap" }}>
              <i className="icon-award" />
              <span>{s.name}{s.amount ? ` · ${s.amount} ${event.currency || "OMR"}` : ""}{s.roi != null ? ` · ROI ${s.roi > 0 ? "+" : ""}${s.roi}%` : ""}</span>
              <button className="chip" style={{ marginLeft: "auto" }} onClick={() => cycleStatus(s)}>{s.status}</button>
              <button className="copy-btn" onClick={() => remove(s.id)}>Delete</button>
              <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 8 }}>
                <div className="field" style={{ flex: 1, margin: 0 }}>
                  <label style={{ fontSize: 11 }}>Impressions</label>
                  <input inputMode="numeric" defaultValue={s.impressions} onBlur={(e) => updateRoi(s, "impressions", e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, margin: 0 }}>
                  <label style={{ fontSize: 11 }}>Clicks</label>
                  <input inputMode="numeric" defaultValue={s.clicks} onBlur={(e) => updateRoi(s, "clicks", e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, margin: 0 }}>
                  <label style={{ fontSize: 11 }}>Leads</label>
                  <input inputMode="numeric" defaultValue={s.leadsGenerated} onBlur={(e) => updateRoi(s, "leadsGenerated", e.target.value)} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && (data || []).length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No sponsors yet.</p>}
    </>
  );
}

/* ---------- Vendor management ---------- */
const VENDOR_CATEGORIES = ["catering", "photography", "security", "cleaning", "entertainment", "other"];

function VendorsSection({ event }: { event: Weyn }) {
  const { data, loading, reload } = useAsync(() => api.listVendors(event.id), [event.id]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(VENDOR_CATEGORIES[0]);
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try { await api.addVendor({ name: name.trim(), category, eventId: event.id }); setName(""); reload(); } finally { setSaving(false); }
  }
  async function cycleStatus(v: Vendor) {
    const next: Record<string, string> = { pending: "paid", paid: "pending" };
    await api.updateVendorStatus(v.id, next[v.paymentStatus] || "pending"); reload();
  }
  async function remove(id: string) {
    await api.deleteVendor(id); reload();
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" style={{ flex: 2 }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ flex: 1 }}>
          {VENDOR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn" onClick={add} disabled={saving || !name.trim()}>{saving ? "Adding…" : "Add"}</button>
      </div>
      {loading && <p className="hint">Loading…</p>}
      {!loading && (data || []).length > 0 && (
        <ul className="steps">
          {data!.map((v) => (
            <li key={v.id}>
              <i className="icon-truck" />
              <span>{v.name}<br /><small style={{ color: "var(--text-3)" }}>{v.category}</small></span>
              <button className="chip" style={{ marginLeft: "auto" }} onClick={() => cycleStatus(v)}>{v.paymentStatus}</button>
              <button className="copy-btn" onClick={() => remove(v.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {!loading && (data || []).length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No vendors yet.</p>}
    </>
  );
}

/* ---------- Promotion Center: UTM link builder + source breakdown ---------- */
function PromotionSection({ event }: { event: Weyn }) {
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [copied, setCopied] = useState(false);
  const { data, loading, error } = useAsync(() => api.promotionSources(event.id), [event.id]);

  const baseUrl = `${window.location.origin}/e/${event.id}`;
  const params = new URLSearchParams();
  if (source.trim()) params.set("utm_source", source.trim());
  if (medium.trim()) params.set("utm_medium", medium.trim());
  if (campaign.trim()) params.set("utm_campaign", campaign.trim());
  const builtUrl = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;

  function copyLink() {
    navigator.clipboard?.writeText(builtUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>Build a tagged link for each place you share this event, then see which one actually drives bookings below.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "1 1 140px" }}><label>Source</label><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="instagram" /></div>
        <div className="field" style={{ flex: "1 1 140px" }}><label>Medium</label><input value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="bio_link" /></div>
        <div className="field" style={{ flex: "1 1 140px" }}><label>Campaign <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label><input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="launch" /></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input readOnly value={builtUrl} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
        <button className="copy-btn" onClick={copyLink}><i className={copied ? "icon-check" : "icon-copy"} /> {copied ? "Copied" : "Copy"}</button>
      </div>

      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (data || []).length > 0 && (
        <ul className="steps">
          {data!.map((s) => (
            <li key={s.source}>
              <i className="icon-link" />
              <span>{s.source}<br /><small style={{ color: "var(--text-3)" }}>{s.bookings} booking{s.bookings === 1 ? "" : "s"} · {s.tickets} ticket{s.tickets === 1 ? "" : "s"}</small></span>
              <b style={{ marginLeft: "auto" }}>{s.revenue.toFixed(2)} {event.currency || "OMR"}</b>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && (data || []).length === 0 && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No bookings yet — share a tagged link above to start tracking sources.</p>
      )}
    </>
  );
}

/* ---------- Team ---------- */
const ROLE_LABEL: Record<TeamRole, string> = { MANAGER: "Manager", STAFF: "Staff (check-in only)" };

const PERMISSION_LABEL: Record<string, string> = {
  viewAttendees: "View attendees", viewFinance: "View finance", sendNotifications: "Send bulk notifications",
};

function TeamTab({ event }: { event: Weyn }) {
  // Invite/revoke are owner-only on the server (requireEventOwnerStrict); a
  // MANAGER can list the team (requireEventOwner) but not mutate it, so they
  // see the roster read-only with no invite form or Revoke buttons.
  const canManage = event.myRole === "OWNER";
  const { data, loading, error, reload } = useAsync(() => api.listTeam(event.id), [event.id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("STAFF");
  const [permissions, setPermissions] = useState<TeamPermission[]>([]);
  const [inviting, setInviting] = useState(false);
  const [inviteErr, setInviteErr] = useState("");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function togglePermission(p: TeamPermission) {
    setPermissions((ps) => ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]);
  }

  async function invite() {
    if (!isValidEmail(email)) return;
    setInviting(true); setInviteErr(""); setLastLink(null);
    try {
      const res = await api.inviteTeamMember(event.id, email.trim(), role, role === "STAFF" ? permissions : undefined);
      setLastLink(res.inviteLink);
      setEmail(""); setPermissions([]);
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
    <>
      {canManage ? (
        <>
          <p className="hint" style={{ margin: "0 0 14px" }}>Managers get full event access. Staff can only check people in at the door.</p>
          <div className="field"><label>Invite by email</label><input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="teammate@email.com" /></div>
          <div className="field">
            <label>Role</label>
            <select value={role} onChange={(ev) => setRole(ev.target.value as TeamRole)}>
              <option value="STAFF">Staff (check-in only)</option>
              <option value="MANAGER">Manager (full access)</option>
            </select>
          </div>
          {role === "STAFF" && (
            <div className="field">
              <label>Extra permissions for this staffer <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label>
              {TEAM_PERMISSIONS.map((p) => (
                <label key={p} className="tier-toggle">
                  <input type="checkbox" checked={permissions.includes(p)} onChange={() => togglePermission(p)} />
                  {PERMISSION_LABEL[p]}
                </label>
              ))}
            </div>
          )}
          {inviteErr && <p className="errline">{inviteErr}</p>}
          <button className="btn" onClick={invite} disabled={inviting || !isValidEmail(email)}>{inviting ? "Creating invite…" : "Create invite link"}</button>

          {lastLink && (
            <div className="marketing-card" style={{ marginTop: 10 }}>
              <div className="marketing-card-head">
                <i className="icon-link" /> <b>Invite link — send it yourself</b>
                <button className="copy-btn" onClick={copyLink}><i className={(copied ? "icon-check" : "icon-copy")} /> {copied ? "Copied" : "Copy"}</button>
              </div>
              <pre className="marketing-text" style={{ wordBreak: "break-all" }}>{lastLink}</pre>
            </div>
          )}
        </>
      ) : (
        <p className="hint" style={{ margin: "0 0 14px" }}>You can view the team here. Only the event owner can invite or remove members.</p>
      )}

      <p className="section-label" style={{ marginTop: 18 }}>Team members</p>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        (data || []).length > 0 ? (
          <ul className="steps">
            {data!.map((m) => (
              <li key={m.id}>
                <i className={m.role === "MANAGER" ? "icon-shield" : "icon-scan"} />
                <span>{m.user?.name || m.email} <small style={{ color: "var(--text-3)" }}>· {ROLE_LABEL[m.role]}{m.status === "PENDING" ? " · invite pending" : ""}{m.permissions.length > 0 ? ` · ${m.permissions.map((p) => PERMISSION_LABEL[p] || p).join(", ")}` : ""}</small></span>
                {canManage && <button className="copy-btn" onClick={() => revoke(m.id)} style={{ marginLeft: "auto" }}>Revoke</button>}
              </li>
            ))}
          </ul>
        ) : <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No team members yet.</p>
      )}

      <p className="section-label" style={{ marginTop: 18 }}>Shift scheduling</p>
      <ShiftsPanel event={event} teamMembers={data || []} />

      <p className="section-label" style={{ marginTop: 18 }}>Activity log</p>
      <AuditLogPanel event={event} />
    </>
  );
}

function ShiftsPanel({ event, teamMembers }: { event: Weyn; teamMembers: TeamMember[] }) {
  const { data, loading, reload } = useAsync(() => api.listShifts(event.id), [event.id]);
  const [teamMemberId, setTeamMemberId] = useState("");
  const [role, setRole] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    if (!teamMemberId || !start || !end) return;
    setSaving(true); setErr("");
    try {
      await api.createShift(event.id, { teamMemberId, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), role: role || undefined });
      setRole(""); setStart(""); setEnd("");
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't create shift");
    } finally {
      setSaving(false);
    }
  }
  async function remove(shiftId: string) {
    await api.deleteShift(event.id, shiftId); reload();
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 10px" }}>Schedule door/floor coverage for each team member.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={teamMemberId} onChange={(e) => setTeamMemberId(e.target.value)} style={{ flex: "1 1 160px" }}>
          <option value="">Team member…</option>
          {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.user?.name || m.email}</option>)}
        </select>
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (optional)" style={{ flex: "1 1 120px" }} />
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={{ flex: "1 1 160px" }} />
        <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={{ flex: "1 1 160px" }} />
        <button className="btn" onClick={add} disabled={saving || !teamMemberId || !start || !end}>{saving ? "Adding…" : "Add shift"}</button>
      </div>
      {err && <p className="errline">{err}</p>}
      {loading && <p className="hint">Loading…</p>}
      {!loading && (data || []).length > 0 && (
        <ul className="steps">
          {data!.map((s) => (
            <li key={s.id}>
              <i className="icon-clock" />
              <span>{s.teamMember?.invitedEmail || "Team member"}{s.role ? ` · ${s.role}` : ""}<br /><small style={{ color: "var(--text-3)" }}>{new Date(s.startTime).toLocaleString()} → {new Date(s.endTime).toLocaleString()}</small></span>
              <button className="copy-btn" style={{ marginLeft: "auto" }} onClick={() => remove(s.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {!loading && (data || []).length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No shifts scheduled yet.</p>}
    </>
  );
}

function AuditLogPanel({ event }: { event: Weyn }) {
  const { data, loading, error } = useAsync(() => api.eventAuditLog(event.id), [event.id]);

  return (
    <>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (data || []).length > 0 ? (
        <ul className="steps">
          {data!.map((a) => (
            <li key={a.id}>
              <i className="icon-history" />
              <span>
                {a.action.replace(/[._]/g, " ")}
                <br /><small style={{ color: "var(--text-3)" }}>{a.actor?.name || a.actor?.email || "System"} · {new Date(a.createdAt).toLocaleString()}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : !loading && !error && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No activity recorded yet.</p>
      )}
    </>
  );
}

/* ---------- Check-in (QR scan + manual code entry) ---------- */
function CheckInTab({ event }: { event: Weyn }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [summary, setSummary] = useState<{ total: number; checkedIn: number; recent: import("../../api").CheckIn[] } | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  function reloadSummary() {
    api.eventCheckins(event.id).then(setSummary).catch(() => {});
  }
  useEffect(() => { reloadSummary(); setCheckedInCount(0); }, [event.id]);

  // `method` is passed explicitly rather than read from the `scanning` state
  // closure — the QR-decode callback below is registered once inside
  // startScanner()'s setTimeout and keeps whatever `submitCode` closure
  // existed at that moment (captured with `scanning` still false, since the
  // button that calls startScanner only renders while !scanning). Reading
  // `scanning` here would silently log every camera scan as "manual".
  async function submitCode(raw: string, method: "qr" | "manual" = "manual") {
    const value = raw.trim();
    if (!value || busy) return;
    setBusy(true); setResult(null);
    try {
      await api.checkInTicket(value, { method, eventId: event.id });
      setResult({ ok: true, message: "Checked in ✓" });
      setCheckedInCount((n) => n + 1);
      reloadSummary();
    } catch (e: any) {
      setResult({ ok: false, message: e.message || "Couldn't check in that code" });
      reloadSummary();
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
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (decoded) => { submitCode(decoded, "qr"); }, () => {});
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
  // Unlike CheckInSheet (a modal that stops the camera on its own onClose),
  // a tab panel can be navigated away from via the router with no close
  // callback firing — stop the camera on unmount instead.
  useEffect(() => () => { scannerRef.current?.stop().catch(() => {}); }, []);

  return (
    <>
      <p className="hint" style={{ margin: "0 0 14px" }}>
        {summary ? `${summary.checkedIn} / ${summary.total} checked in` : "…"} ({checkedInCount} this session)
      </p>
      {!scanning ? (
        <button className="btn" onClick={startScanner}><i className="icon-camera" /> Scan QR code</button>
      ) : (
        <>
          <div id="weyn-qr-region" style={{ borderRadius: 12, overflow: "hidden", marginBottom: 10, maxWidth: 360 }} />
          <button className="btn glass" onClick={stopScanner}>Stop scanning</button>
        </>
      )}
      <div className="field" style={{ marginTop: 14 }}>
        <label>Or enter ticket code manually</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitCode(code)} placeholder="Ticket code" />
      </div>
      <button className="btn glass" onClick={() => submitCode(code)} disabled={busy || !code.trim()}>{busy ? "Checking…" : "Check in"}</button>
      {result && (
        <p className={result.ok ? "hint" : "errline"} style={{ marginTop: 10, color: result.ok ? "var(--accent)" : undefined }}>{result.message}</p>
      )}
      {summary && summary.recent.length > 0 && (
        <>
          <p className="section-label" style={{ marginTop: 22 }}>Recent scans</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {summary.recent.slice(0, 20).map((c) => (
              <li key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                <span>{c.status === "VALID" ? "✓ Valid" : c.status === "DUPLICATE" ? "⚠ Duplicate" : "✕ Invalid"}</span>
                <span className="hint">{new Date(c.scannedAt).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/* ---------- Settings: edit fields + invite-only ---------- */
const REMINDER_OPTIONS = [
  { hours: 72, label: "3 days before" },
  { hours: 24, label: "1 day before" },
  { hours: 2, label: "2 hours before" },
];

function SettingsTab({ event, features, reload }: { event: Weyn; features: Record<string, boolean>; reload: () => void }) {
  const [price, setPrice] = useState(String(event.price));
  const [capacity, setCapacity] = useState(String(event.capacity));
  const [blurb, setBlurb] = useState(event.blurb);
  const [paymentMethod, setPaymentMethod] = useState<"link" | "transfer">(event.transferDetails ? "transfer" : "link");
  const [paymentLinkUrl, setPaymentLinkUrl] = useState(event.paymentLinkUrl || "");
  const [transferDetails, setTransferDetails] = useState(event.transferDetails || "");
  const [reminderSchedule, setReminderSchedule] = useState<number[]>(event.reminderSchedule || []);
  const [accentColor, setAccentColor] = useState(event.accentColor || "#7C3AED");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  function toggleReminder(hours: number) {
    setReminderSchedule((prev) => (prev.includes(hours) ? prev.filter((h) => h !== hours) : [...prev, hours]));
  }

  async function save() {
    setBusy(true); setErr(""); setSaved(false);
    try {
      const patch: Partial<Weyn> = { price: Number(price) || 0, capacity: Number(capacity) || event.capacity, blurb, reminderSchedule };
      if (features.customEventThemes) patch.accentColor = accentColor;
      if (event.ticketingType === "organizer_payment") {
        patch.paymentLinkUrl = paymentMethod === "link" ? paymentLinkUrl : "";
        patch.transferDetails = paymentMethod === "transfer" ? transferDetails : "";
      }
      await api.updateEvent(event.id, patch);
      setSaved(true);
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="field"><label>Price ({event.currency || "OMR"})</label><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></div>
      <div className="field"><label>Capacity</label><input value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="numeric" /></div>
      <div className="field"><label>Description</label><textarea rows={3} value={blurb} onChange={(e) => setBlurb(e.target.value)} /></div>

      {event.ticketingType === "organizer_payment" && (
        <div className="field">
          <label>How buyers pay you</label>
          <div className="chips" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button type="button" className={"chip" + (paymentMethod === "link" ? " on" : "")} onClick={() => setPaymentMethod("link")}>Payment link</button>
            <button type="button" className={"chip" + (paymentMethod === "transfer" ? " on" : "")} onClick={() => setPaymentMethod("transfer")}>Bank transfer details</button>
          </div>
          {paymentMethod === "link" ? (
            <input value={paymentLinkUrl} onChange={(e) => setPaymentLinkUrl(e.target.value)} placeholder="https://buy.stripe.com/… or paypal.me/…" />
          ) : (
            <textarea rows={3} value={transferDetails} onChange={(e) => setTransferDetails(e.target.value)} placeholder="Bank name, account name, account/IBAN number, reference to use…" />
          )}
        </div>
      )}

      <div className="field">
        <label>Automated reminders</label>
        <FeatureLock feature="scheduledAnnouncements" enabled={!!features.scheduledAnnouncements}>
          <p className="hint" style={{ margin: "0 0 8px" }}>Emails/pushes ticket holders automatically — no need to remember to send them yourself.</p>
          <div className="chips" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {REMINDER_OPTIONS.map((o) => (
              <button key={o.hours} type="button" className={"chip" + (reminderSchedule.includes(o.hours) ? " on" : "")} onClick={() => toggleReminder(o.hours)}>
                {o.label}
              </button>
            ))}
          </div>
        </FeatureLock>
      </div>

      <div className="field">
        <label>Custom accent color</label>
        <FeatureLock feature="customEventThemes" enabled={!!features.customEventThemes}>
          <p className="hint" style={{ margin: "0 0 8px" }}>Replaces the default purple on this event's page — buttons, active states, the buy bar.</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} style={{ width: 44, height: 36, padding: 2 }} />
            <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} style={{ flex: 1 }} />
            {event.accentColor && (
              <button type="button" className="copy-btn" onClick={() => setAccentColor("")}>Reset</button>
            )}
          </div>
        </FeatureLock>
      </div>

      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : saved ? "Saved ✓" : "Save changes"}</button>

      <p className="section-label" style={{ marginTop: 22 }}>Invite-only</p>
      <InviteOnlyPanel event={event} onChanged={reload} />

      <p className="section-label" style={{ marginTop: 22 }}>Booking form</p>
      <CheckoutFormBuilder event={event} onChanged={reload} />
    </>
  );
}

const CHECKOUT_FIELD_TYPES: { value: CheckoutFormField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "dropdown", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

// Custom booking-form builder: a fixed set of field types the organizer can
// add/remove/reorder (simple up/down buttons, not a drag-and-drop engine —
// per the brief's scoping, this isn't a generic form-builder). Answers are
// collected below the tier/qty picker on EventDetail.tsx/Checkout.tsx and
// land on Booking.customFieldValues.
function CheckoutFormBuilder({ event, onChanged }: { event: Weyn; onChanged: () => void }) {
  const [fields, setFields] = useState<CheckoutFormField[]>(event.checkoutFormFields || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  function addField() {
    setFields((list) => [...list, { id: `new-${Date.now()}`, type: "text", label: "", required: false }]);
    setSaved(false);
  }
  function updateField(id: string, patch: Partial<CheckoutFormField>) {
    setFields((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setSaved(false);
  }
  function removeField(id: string) {
    setFields((list) => list.filter((f) => f.id !== id));
    setSaved(false);
  }
  function moveField(index: number, dir: -1 | 1) {
    setFields((list) => {
      const next = [...list];
      const target = index + dir;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setBusy(true); setErr(""); setSaved(false);
    try {
      await api.updateCheckoutFormFields(event.id, fields);
      setSaved(true);
      onChanged();
    } catch (e: any) {
      setErr(e.message || "Couldn't save the booking form.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Extra questions guests answer when they book — shown below the ticket type/quantity picker.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {fields.map((f, i) => (
          <div key={f.id} className="dash-card" style={{ padding: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input style={{ flex: "1 1 160px" }} placeholder="Label (e.g. Phone number)" value={f.label} onChange={(e) => updateField(f.id, { label: e.target.value })} />
            <select value={f.type} onChange={(e) => updateField(f.id, { type: e.target.value as CheckoutFormField["type"], options: e.target.value === "dropdown" ? (f.options || [""]) : undefined })}>
              {CHECKOUT_FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {f.type === "dropdown" && (
              <input style={{ flex: "1 1 160px" }} placeholder="Options, comma-separated" value={(f.options || []).join(", ")}
                onChange={(e) => updateField(f.id, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={f.required} onChange={(e) => updateField(f.id, { required: e.target.checked })} /> Required
            </label>
            <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
              <button type="button" className="btn glass sm" disabled={i === 0} onClick={() => moveField(i, -1)}><i className="icon-chevron-up" /></button>
              <button type="button" className="btn glass sm" disabled={i === fields.length - 1} onClick={() => moveField(i, 1)}><i className="icon-chevron-down" /></button>
              <button type="button" className="btn glass sm" onClick={() => removeField(f.id)}><i className="icon-x" /></button>
            </div>
          </div>
        ))}
        {fields.length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No extra fields — guests just pick a ticket type and quantity.</p>}
      </div>
      <button type="button" className="btn glass" style={{ marginTop: 10 }} onClick={addField}><i className="icon-plus" /> Add field</button>

      {err && <p className="errline">{err}</p>}
      <button className="btn" style={{ marginTop: 10 }} onClick={save} disabled={busy}>{busy ? "Saving…" : saved ? "Saved ✓" : "Save booking form"}</button>
    </>
  );
}

function InviteOnlyPanel({ event, onChanged }: { event: Weyn; onChanged: () => void }) {
  const [inviteOnly, setInviteOnly] = useState(!!event.inviteOnly);
  const [inviteUrl, setInviteUrl] = useState<string | null>(
    event.inviteOnly && event.inviteCode ? `${window.location.origin}/e/${event.id}?invite=${event.inviteCode}` : null
  );
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  async function toggle() {
    setBusy(true); setErr("");
    try {
      const next = !inviteOnly;
      const res = await api.setEventInviteOnly(event.id, next);
      setInviteOnly(res.inviteOnly);
      setInviteUrl(res.inviteOnly ? res.inviteUrl : null);
      onChanged();
    } catch (e: any) {
      setErr(e.message || "Couldn't update this event.");
    } finally {
      setBusy(false);
    }
  }
  async function regenerate() {
    setRegenerating(true); setErr("");
    try {
      const res = await api.regenerateInviteCode(event.id);
      setInviteUrl(res.inviteUrl);
    } catch (e: any) {
      setErr(e.message || "Couldn't regenerate the code.");
    } finally {
      setRegenerating(false);
    }
  }
  function copy() {
    if (!inviteUrl) return;
    navigator.clipboard?.writeText(inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <>
      <p className="hint" style={{ margin: "0 0 14px" }}>When on, this event never appears in Discovery or search — only people with the link below can view or book it. Free for every organizer.</p>
      <div className="settings-row">
        <span>Invite-only</span>
        <button className={"switch" + (inviteOnly ? " on" : "")} disabled={busy} onClick={toggle} aria-pressed={inviteOnly} aria-label="Toggle invite-only">
          <span className="switch-thumb" />
        </button>
      </div>
      {err && <p className="errline">{err}</p>}
      {inviteOnly && (
        <div style={{ marginTop: 14 }}>
          <label>Invite link</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={inviteUrl || "Loading…"} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
            <button className="copy-btn" onClick={copy} disabled={!inviteUrl}><i className={copied ? "icon-check" : "icon-copy"} /> {copied ? "Copied" : "Copy"}</button>
          </div>
          <button className="btn glass" onClick={regenerate} disabled={regenerating} style={{ marginTop: 10 }}>
            <i className="icon-refresh-cw" /> {regenerating ? "Regenerating…" : "Regenerate link (invalidates the old one)"}
          </button>
        </div>
      )}
    </>
  );
}

/* ---------- Seating: assigned-seating floor plan for this event (mirrors
   You.tsx's venue Tables tab — same FloorPlanCanvas, different owner check
   via requireEventAccess instead of venue ownership). Most events don't
   need this at all (general-admission is the default); it only matters for
   a ticketed event with fixed seats, e.g. a wine tasting or a screening. */
function SeatingTab({ event }: { event: Weyn }) {
  const { data: plan, loading, reload } = useAsync(() => api.getEventFloorPlan(event.id), [event.id]);
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (plan) { setTables(plan.tables); setDirty(false); } }, [plan]);

  async function init(mode: "table" | "seat") {
    await api.initEventFloorPlan(event.id, mode);
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
      await api.setEventFloorTables(event.id, input);
      setDirty(false);
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't save the layout.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="hint" style={{ padding: "8px 6px" }}>Loading…</p>;

  if (!plan) {
    return (
      <div className="dash-card" style={{ padding: 16, margin: "0 6px" }}>
        <p className="hint" style={{ margin: "0 0 10px" }}><i className="icon-grid-2x2" /> Assigned seating (optional)</p>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 12 }}>
          Most events don't need this — leave it off for general admission. Set it up only if guests should pick a specific table or seat, like a wine tasting or a screening.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn glass" onClick={() => init("table")}>Whole tables</button>
          <button className="btn glass" onClick={() => init("seat")}>Individual seats</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 6px" }}>
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
            <button className="btn glass sm" style={{ marginLeft: "auto" }} onClick={() => removeTable(t.id)}><i className="icon-x" /></button>
          </div>
        ))}
        {tables.length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No tables yet — add one above.</p>}
      </div>

      {err && <p className="errline">{err}</p>}
      <button className="btn glass" style={{ marginTop: 10 }} onClick={save} disabled={saving || !dirty}>
        {saving ? "Saving…" : dirty ? "Save layout" : "Saved ✓"}
      </button>
    </div>
  );
}

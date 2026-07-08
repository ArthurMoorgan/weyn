import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { api, API_BASE, type Weyn, type TeamRole, type PromoCode } from "../../api";
import { useAsync } from "../../hooks";
import { getAuthToken } from "../../store";
import FeatureLock from "../../components/FeatureLock";

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
  { key: "overview", label: "Overview", icon: "chart-bar" },
  { key: "attendees", label: "Attendees", icon: "users" },
  { key: "marketing", label: "Marketing", icon: "megaphone" },
  { key: "team", label: "Team", icon: "users-round" },
  { key: "checkin", label: "Check-in", icon: "qr-code" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export default function EventWorkspace() {
  const { id, tab = "overview" } = useParams<{ id: string; tab?: string }>();
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

  const features = sub.data?.features || {};

  return (
    <>
      <div className="date-head" style={{ paddingLeft: 0, alignItems: "center" }}>
        <Link to="/organizer/events" className="copy-btn" style={{ marginRight: 4 }}><i className="icon-arrow-left" /></Link>
        <h2 style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.title}</h2>
        <Link to={`/e/${event.id}`} className="copy-btn"><i className="icon-external-link" /> View</Link>
        {/* The full cross-event dashboard — Overview/Attendees/Finance/
            Marketing across every event, not just this one. A real
            destination (its own route, its own nav), not a modal. */}
        <Link to="/organizer" className="btn glass sm" style={{ width: "auto" }}>
          <i className="icon-layout-dashboard" /> Organizer Dashboard
        </Link>
      </div>
      <nav className="profile-tabs" aria-label="Event workspace sections" style={{ padding: "0 6px 10px" }}>
        {TABS.map((t) => (
          <NavLink key={t.key} to={`/organizer/events/${event.id}/${t.key}`} className={() => "profile-tab" + (tab === t.key ? " on" : "")}>
            <i className={`icon-${t.icon}`} /> {t.label}
          </NavLink>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab event={event} features={features} reload={events.reload} />}
      {tab === "attendees" && <AttendeesTab event={event} features={features} />}
      {tab === "marketing" && <MarketingTab event={event} features={features} />}
      {tab === "team" && <TeamTab event={event} />}
      {tab === "checkin" && <CheckInTab event={event} />}
      {tab === "settings" && <SettingsTab event={event} reload={events.reload} />}
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
            <div className="stat"><div className="k">Revenue</div><div className="v">{data.revenue.toLocaleString()} <small>OMR</small></div></div>
            {data.views !== undefined && <div className="stat"><div className="k">Page views</div><div className="v">{data.views}</div></div>}
            {data.checkIn && <div className="stat"><div className="k">Checked in</div><div className="v">{data.checkIn.checkedIn}/{data.checkIn.total}</div></div>}
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

          {data.conversionRate === null && data.views === undefined && (
            <p className="hint" style={{ marginTop: 14 }}>
              Advanced analytics (page views, conversion rate) is a Pro feature.
            </p>
          )}
        </>
      )}

      <p className="hint" style={{ margin: "20px 0 8px" }}>Discovery</p>
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
          <p className="hint" style={{ margin: "20px 0 8px" }}>Confirmed attendees</p>
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

      <p className="hint" style={{ margin: "20px 0 8px" }}>Bulk notify</p>
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
              {b.amount.toFixed(2)} OMR{b.claimedPaidAt ? " · says they've paid" : " · not yet claimed as paid"}
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

function NotifyForm({ event, enabled }: { event: Weyn; enabled: boolean }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ recipients: number; emailed: number; pushed: number } | null>(null);
  const [err, setErr] = useState("");

  async function send() {
    if (!subject.trim() || !message.trim()) return;
    setSending(true); setErr(""); setResult(null);
    try {
      const res = await api.notifyAttendees(event.id, { subject: subject.trim(), message: message.trim() });
      setResult(res);
      setSubject(""); setMessage("");
    } catch (e: any) {
      setErr(e.message || "Couldn't send notification");
    } finally {
      setSending(false);
    }
  }

  return (
    <FeatureLock feature="bulkNotifications" enabled={enabled}>
      <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="An update about your ticket" /></div>
      <div className="field"><label>Message</label><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What's changed…" /></div>
      {err && <p className="errline">{err}</p>}
      {result && <p className="hint" style={{ color: "var(--accent)" }}>Sent to {result.recipients} attendees ({result.emailed} emailed, {result.pushed} pushed).</p>}
      <button className="btn" onClick={send} disabled={sending || !subject.trim() || !message.trim()}>
        {sending ? "Sending…" : "Send now"}
      </button>
      <p className="hint" style={{ marginTop: 6 }}>Sends immediately to every paid attendee — no future-dated scheduling yet.</p>
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
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    if (!code.trim()) return;
    setCreating(true); setErr("");
    try {
      await api.createPromoCode(event.id, {
        code: code.trim().toUpperCase(), discountType, discountValue: Number(discountValue) || 0,
        maxUses: maxUses ? Number(maxUses) : undefined,
      });
      setCode(""); setMaxUses("");
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
            <option value="flat">Flat OMR off</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>{discountType === "percent" ? "Percent" : "OMR"}</label>
          <input inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
        </div>
      </div>
      <div className="field"><label>Max uses (optional)</label><input inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" /></div>
      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={create} disabled={creating || !code.trim()}>{creating ? "Creating…" : "Create promo code"}</button>

      <p className="hint" style={{ margin: "18px 0 8px" }}>Active codes</p>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        (data || []).length > 0 ? (
          <ul className="steps">
            {data!.map((p) => (
              <li key={p.id}>
                <i className="icon-ticket-percent" />
                <span>
                  <b>{p.code}</b> <small style={{ color: "var(--text-3)" }}>· {p.discountType === "percent" ? `${p.discountValue}% off` : `${p.discountValue} OMR off`} · {p.usedCount}{p.maxUses ? `/${p.maxUses}` : ""} used</small>
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

      <p className="hint" style={{ margin: "18px 0 8px" }}>Recurring events</p>
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
    { key: "whatsapp", label: "WhatsApp message", icon: "message-circle", text: data.whatsapp },
    { key: "telegram", label: "Telegram post", icon: "send", text: data.telegram },
    { key: "twitter", label: "X / Twitter post", icon: "at-sign", text: data.twitter },
  ] : [];

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

      <p className="hint" style={{ margin: "20px 0 8px" }}>Promo codes</p>
      <PromoCodesSection event={event} enabled={!!features.promoCodes} />

      <p className="hint" style={{ margin: "20px 0 8px" }}>Waitlist</p>
      <WaitlistSection event={event} enabled={!!features.waitlists} />
    </>
  );
}

/* ---------- Team ---------- */
const ROLE_LABEL: Record<TeamRole, string> = { MANAGER: "Manager", STAFF: "Staff (check-in only)" };

function TeamTab({ event }: { event: Weyn }) {
  const { data, loading, error, reload } = useAsync(() => api.listTeam(event.id), [event.id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("STAFF");
  const [inviting, setInviting] = useState(false);
  const [inviteErr, setInviteErr] = useState("");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      {inviteErr && <p className="errline">{inviteErr}</p>}
      <button className="btn" onClick={invite} disabled={inviting || !email.trim()}>{inviting ? "Creating invite…" : "Create invite link"}</button>

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
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        (data || []).length > 0 ? (
          <ul className="steps">
            {data!.map((m) => (
              <li key={m.id}>
                <i className={m.role === "MANAGER" ? "icon-shield" : "icon-scan"} />
                <span>{m.user?.name || m.email} <small style={{ color: "var(--text-3)" }}>· {ROLE_LABEL[m.role]}{m.status === "PENDING" ? " · invite pending" : ""}</small></span>
                <button className="copy-btn" onClick={() => revoke(m.id)} style={{ marginLeft: "auto" }}>Revoke</button>
              </li>
            ))}
          </ul>
        ) : <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No team members yet.</p>
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
  const scannerRef = useRef<Html5Qrcode | null>(null);

  async function submitCode(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;
    setBusy(true); setResult(null);
    try {
      await api.checkInTicket(value);
      setResult({ ok: true, message: "Checked in ✓" });
      setCheckedInCount((n) => n + 1);
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
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (decoded) => { submitCode(decoded); }, () => {});
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
      <p className="hint" style={{ margin: "0 0 14px" }}>{checkedInCount} checked in this session</p>
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
    </>
  );
}

/* ---------- Settings: edit fields + invite-only ---------- */
function SettingsTab({ event, reload }: { event: Weyn; reload: () => void }) {
  const [price, setPrice] = useState(String(event.price));
  const [capacity, setCapacity] = useState(String(event.capacity));
  const [blurb, setBlurb] = useState(event.blurb);
  const [paymentMethod, setPaymentMethod] = useState<"link" | "transfer">(event.transferDetails ? "transfer" : "link");
  const [paymentLinkUrl, setPaymentLinkUrl] = useState(event.paymentLinkUrl || "");
  const [transferDetails, setTransferDetails] = useState(event.transferDetails || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true); setErr(""); setSaved(false);
    try {
      const patch: Partial<Weyn> = { price: Number(price) || 0, capacity: Number(capacity) || event.capacity, blurb };
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
      <div className="field"><label>Price (OMR)</label><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></div>
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

      {err && <p className="errline">{err}</p>}
      <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : saved ? "Saved ✓" : "Save changes"}</button>

      <p className="hint" style={{ margin: "22px 0 8px" }}>Invite-only</p>
      <InviteOnlyPanel event={event} onChanged={reload} />
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

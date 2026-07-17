import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { api, dayLabel, timeLabel, API_BASE, type Expense, type OrganizerFinance } from "../../api";
import { useAsync } from "../../hooks";
import { getAuthToken, useAccount } from "../../store";
import { staggerContainer, staggerChild, usePrefersReducedMotion } from "../../motion";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// Same greeting logic as Explore's hero (src/pages/Explore.tsx) — duplicated
// rather than shared since it's a 5-line pure function and the two pages
// have no other reason to import from each other.
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up?";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const ATTENTION_ICON: Record<string, string> = {
  manual_review: "icon-shield-alert",
  zero_sales: "icon-trending-down",
  waitlist_pending: "icon-clock",
  pending_invite: "icon-mail",
  selling_fast: "icon-flame",
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

// One page, everything that matters at a glance — per direct feedback that
// the dashboard had grown too many separate destinations for what it does.
// Finance used to be its own nav tab; its numbers (net/fees, revenue by
// event) now live here, right under the same revenue trend a Finance page
// would have opened to anyway.
export default function OrganizerOverview() {
  const account = useAccount();
  const summary = useAsync(() => api.dashboardSummary(), []);
  const overview = useAsync(() => api.organizerOverview(), []);
  const finance = useAsync(() => api.organizerFinance(), []);

  const [showMore, setShowMore] = useState(false);

  const s = summary.data;
  const o = overview.data;
  const f = finance.data;
  const maxTrend = o ? Math.max(1, ...o.revenueTrend.map((d) => d.revenue)) : 1;

  // One-shot staggered reveal for the stat cards and the "Coming up" rows.
  // motion's initial→animate only runs on mount and is never re-triggered by a
  // re-render, so it plays once when the page (or, for the async list, its
  // container) first appears and stays put through data reloads — no per-render
  // replay flag needed. Under reduced motion we drop the variants entirely so
  // the content is simply there. The elements carry a `.is-staggered` marker so
  // they opt out of the global CSS `rise-in` entrance and don't double-animate.
  const reduce = usePrefersReducedMotion();
  const containerProps = reduce ? {} : { variants: staggerContainer, initial: "initial" as const, animate: "animate" as const };
  const childProps = reduce ? {} : { variants: staggerChild };

  return (
    <>
      {summary.error && <p className="errline">{summary.error}</p>}

      <div className="dash-banner">
        <div>
          <span className="dash-banner-eyebrow">{greeting()}{account?.name ? `, ${account.name.split(" ")[0]}` : ""}</span>
          <h2>Here's how your events are doing.</h2>
        </div>
        <div className="dash-banner-metric">
          <span className="k">Net revenue</span>
          <span className="v">{f ? omr(f.netRevenue) : "—"} <small>OMR</small></span>
        </div>
      </div>

      <motion.div className="stat-grid is-staggered" {...containerProps}>
        <motion.div className="stat" {...childProps}><div className="k">Net revenue</div><div className="v">{f ? omr(f.netRevenue) : "—"} <small>OMR</small></div></motion.div>
        <motion.div className="stat" {...childProps}><div className="k">Tickets sold</div><div className="v">{s ? s.totalAttendees.toLocaleString() : "—"}</div></motion.div>
        <motion.div className="stat" {...childProps}><div className="k">Live events</div><div className="v">{s ? s.totalEvents : "—"}</div></motion.div>
        <motion.div className="stat" {...childProps}><div className="k">New today</div><div className="v">{s ? s.newRegistrationsToday : "—"}</div></motion.div>
        {o?.reputationScore && <motion.div className="stat" {...childProps}><div className="k">Reputation score</div><div className="v">{o.reputationScore.score} <small>/ 100</small></div></motion.div>}
      </motion.div>

      {/* Editorial handoff's mobile dashboard: a solid black/coral "Scan
          tickets" CTA + an outline "Create event" button, side by side —
          was missing entirely; the rest of QuickActions below still covers
          the other real shortcuts (Attendees, AI Studio, Venues, Team…). */}
      <div className="ov-primary-actions">
        <Link to="/organizer/events" className="btn"><i className="icon-scan" /> Scan tickets</Link>
        <Link to="/host/events" className="btn glass"><i className="icon-plus" /> Create event</Link>
      </div>

      <QuickActions onShowMore={() => setShowMore(true)} />

      <div className="date-head"><h2>Needs attention</h2>{o && <span>{o.needsAttention.length}</span>}</div>
      {overview.loading && <p className="hint" style={{ padding: "0 6px" }}>Loading…</p>}
      {o && o.needsAttention.length === 0 && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 6px 8px" }}>Nothing needs your attention right now.</p>
      )}
      {o && o.needsAttention.length > 0 && (
        <ul className="steps">
          {o.needsAttention.map((item, i) => (
            <li key={i}>
              <i className={ATTENTION_ICON[item.type] || "icon-alert-circle"} />
              <span>
                <Link to={`/organizer/events/${item.eventId}`}>{item.eventTitle}</Link>
                <br /><small style={{ color: "var(--text-3)" }}>{item.message}</small>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="dash-2col">
        <div className="dash-col dash-col-list">
          <div className="date-head"><h2>Coming up</h2></div>
          {overview.loading && <p className="hint" style={{ padding: "0 6px" }}>Loading…</p>}
          {o && o.nextUpcoming.length === 0 && (
            <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 6px 8px" }}>Nothing scheduled yet.</p>
          )}
          {o && o.nextUpcoming.length > 0 && (
            <motion.div className="is-staggered" {...containerProps}>
              {o.nextUpcoming.map((e) => {
                // Sell-through — sold/capacity as a percent. Capacity >= 9000 is
                // the same "no meaningful cap" placeholder used elsewhere
                // (registration-only events, huge venue placeholders), where a
                // percent bar would be meaningless — falls back to a plain count.
                const hasCapacity = e.capacity > 0 && e.capacity < 9000;
                const pct = hasCapacity ? Math.min(100, Math.round((e.sold / e.capacity) * 100)) : null;
                // Real status pill (handoff spec) derived from real sold/capacity —
                // no "Draft" state here since this summary doesn't carry isDraft.
                const soldOut = hasCapacity && e.sold >= e.capacity;
                return (
                  <motion.div key={e.id} {...childProps}>
                    <Link to={`/organizer/events/${e.id}`} className="dash-row dash-row-progress">
                      <div className="thumb" style={e.image ? { backgroundImage: `url(${e.image})`, backgroundSize: "cover", backgroundPosition: "center" } : { background: e.color }}>
                        {!e.image && e.glyph}
                      </div>
                      <div className="info">
                        <div className="dash-row-top">
                          <b>{e.title}</b>
                          <span className={"status-pill" + (soldOut ? " soldout" : " onsale")}>{soldOut ? "Sold out" : "On sale"}</span>
                        </div>
                        <span>{dayLabel({ startsAt: e.startsAt } as any)} · {timeLabel({ startsAt: e.startsAt } as any)}</span>
                        {pct != null && <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${pct}%` }} /></div>}
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>

        <div className="dash-col dash-col-chart">
          <div className="date-head"><h2>Revenue — last 14 days</h2></div>
          <div className="dash-card" style={{ padding: "16px 18px" }}>
            {overview.loading ? (
              <p className="hint">Loading…</p>
            ) : o && o.revenueTrend.some((d) => d.revenue > 0) ? (
              <div className="mini-bars" style={{ height: 90 }}>
                {o.revenueTrend.map((d) => (
                  <div key={d.date} className="mini-bar" title={`${d.date}: ${d.revenue.toLocaleString()} OMR`} style={{
                    height: `${Math.max(6, Math.round((d.revenue / maxTrend) * 90))}px`,
                  }} />
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No sales in the last 14 days yet.</p>
            )}
            {f && !f.payoutsLive && (
              <p className="hint" style={{ margin: "12px 0 0" }}>
                Payout tracking isn't real yet — these numbers reflect ticket sales, not money actually transferred to you.
              </p>
            )}
          </div>
        </div>
      </div>

      <button type="button" className="ig-import-toggle" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore} style={{ marginTop: 4 }}>
        <i className="icon-layout-list" /> Revenue by event, goals & expenses
        <i className={showMore ? "icon-chevron-up" : "icon-chevron-down"} style={{ marginLeft: "auto" }} />
      </button>

      {showMore && (
        <>
          {f && f.byEvent.length > 0 && (
            <>
              <div className="date-head"><h2>Revenue by event</h2></div>
              <ul className="steps">
                {f.byEvent.map((e) => (
                  <li key={e.eventId}>
                    <i className="icon-ticket" />
                    <span><Link to={`/organizer/events/${e.eventId}`}>{e.title}</Link><br /><small style={{ color: "var(--text-3)" }}>{e.ticketsSold} tickets</small></span>
                    <b style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{omr(e.revenue)} OMR</b>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="date-head"><h2>This month's goals</h2></div>
          <GoalsPanel />

          <div className="date-head"><h2>Expenses & P&L</h2></div>
          <FinancialDashboard finance={f} />
        </>
      )}
    </>
  );
}

// A visible map of everything the dashboard can do — most of it (Files,
// Sponsors, Vendors, Automation, Feedback, Promotion) lives inside each
// event's own "More tools" section, and Venues/Team live in Settings, so
// without this grid an organizer would only discover them by clicking
// around. Nav itself stays at 5 tabs; this is the "feels feature-rich"
// surface instead of a 12-tab nav bar.
const QUICK_ACTIONS = [
  { to: "/host/events", icon: "circle-plus", label: "New event" },
  { to: "/organizer/events", icon: "calendar", label: "Events" },
  { to: "/organizer/attendees", icon: "users", label: "Attendees" },
  { to: "/organizer/ai-studio", icon: "sparkles", label: "AI Studio" },
  { to: "/organizer/settings#venues", icon: "map-pin", label: "Venues" },
  { to: "/organizer/settings#team", icon: "users-round", label: "Team" },
] as const;

function QuickActions({ onShowMore }: { onShowMore: () => void }) {
  return (
    <div className="quick-actions-grid">
      {QUICK_ACTIONS.map((a) => (
        <Link key={a.label} to={a.to} className="quick-action">
          <i className={`icon-${a.icon}`} />
          <span>{a.label}</span>
        </Link>
      ))}
      <button type="button" className="quick-action" onClick={onShowMore}>
        <i className="icon-wallet" />
        <span>Finance & goals</span>
      </button>
    </div>
  );
}

function GoalsPanel() {
  const month = thisMonth();
  const { data, loading, reload } = useAsync(() => api.goalProgress(month), [month]);
  const [revenueGoal, setRevenueGoal] = useState("");
  const [attendanceGoal, setAttendanceGoal] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.setGoal(month, {
        revenueGoal: revenueGoal ? Number(revenueGoal) : undefined,
        attendanceGoal: attendanceGoal ? Number(attendanceGoal) : undefined,
      } as any);
      setRevenueGoal(""); setAttendanceGoal("");
      reload();
    } finally {
      setSaving(false);
    }
  }

  const goal = data?.goal;
  const progress = data?.progress;
  const revenuePct = goal?.revenueGoal ? Math.min(100, Math.round(((progress?.revenue || 0) / goal.revenueGoal) * 100)) : null;
  const attendancePct = goal?.attendanceGoal ? Math.min(100, Math.round(((progress?.attendance || 0) / goal.attendanceGoal) * 100)) : null;

  return (
    <div className="dash-card" style={{ padding: 16 }}>
      {loading && <p className="hint">Loading…</p>}
      {!loading && goal && (
        <div style={{ marginBottom: 16 }}>
          {goal.revenueGoal != null && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>Revenue</span><span style={{ color: "var(--text-2)" }}>{omr(progress?.revenue || 0)} / {omr(goal.revenueGoal)} OMR</span>
              </div>
              <div className="bar"><i style={{ width: `${revenuePct}%` }} /></div>
            </div>
          )}
          {goal.attendanceGoal != null && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>Attendance</span><span style={{ color: "var(--text-2)" }}>{progress?.attendance || 0} / {goal.attendanceGoal}</span>
              </div>
              <div className="bar"><i style={{ width: `${attendancePct}%` }} /></div>
            </div>
          )}
        </div>
      )}
      {!loading && !goal && <p style={{ color: "var(--text-2)", fontSize: 13.5, marginBottom: 12 }}>No goal set for this month yet.</p>}

      <p className="hint" style={{ margin: "0 0 10px" }}>Set (or update) this month's targets.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1 }}><label>Revenue goal (OMR)</label><input inputMode="decimal" value={revenueGoal} onChange={(e) => setRevenueGoal(e.target.value)} placeholder={goal?.revenueGoal ? String(goal.revenueGoal) : "1000"} /></div>
        <div className="field" style={{ flex: 1 }}><label>Attendance goal</label><input inputMode="numeric" value={attendanceGoal} onChange={(e) => setAttendanceGoal(e.target.value)} placeholder={goal?.attendanceGoal ? String(goal.attendanceGoal) : "200"} /></div>
      </div>
      <button className="btn" onClick={save} disabled={saving || (!revenueGoal && !attendanceGoal)}>{saving ? "Saving…" : "Save goal"}</button>
    </div>
  );
}

function FinancialDashboard({ finance }: { finance: OrganizerFinance | null | undefined }) {
  const expenses = useAsync(() => api.listExpenses(), []);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function addExpense() {
    if (!category.trim() || !(Number(amount) > 0)) return;
    setSaving(true);
    try {
      await api.createExpense({ category: category.trim(), amount: Number(amount), note: note.trim() || undefined });
      setCategory(""); setAmount(""); setNote("");
      expenses.reload();
    } finally {
      setSaving(false);
    }
  }
  async function removeExpense(id: string) {
    await api.deleteExpense(id);
    expenses.reload();
  }
  async function exportCsv() {
    setExporting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/organizer/finance/export.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "weyn-finance.csv"; link.click();
      URL.revokeObjectURL(url);
    } catch { /* FeatureLock-style silent failure is fine here — the button itself already implies Pro */ }
    finally {
      setExporting(false);
    }
  }

  return (
    <div className="dash-card" style={{ padding: 16 }}>
      {finance && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat"><div className="k">Net revenue</div><div className="v">{omr(finance.netRevenue)} <small>OMR</small></div></div>
          <div className="stat"><div className="k">Expenses</div><div className="v">{omr(finance.totalExpenses)} <small>OMR</small></div></div>
          <div className="stat"><div className="k">Net profit</div><div className="v">{omr(finance.netProfit)} <small>OMR</small></div></div>
        </div>
      )}

      <p className="hint" style={{ margin: "0 0 10px" }}>Log real costs (venue, staff, supplies) against your ticket revenue.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "1 1 140px" }}><label>Category</label><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Venue rental" /></div>
        <div className="field" style={{ flex: "1 1 100px" }}><label>Amount (OMR)</label><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150" /></div>
        <div className="field" style={{ flex: "2 1 160px" }}><label>Note <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <button className="btn" onClick={addExpense} disabled={saving || !category.trim() || !(Number(amount) > 0)} style={{ marginBottom: 16 }}>
        {saving ? "Adding…" : "Add expense"}
      </button>

      {expenses.loading && <p className="hint">Loading…</p>}
      {!expenses.loading && (expenses.data || []).length > 0 && (
        <ul className="steps" style={{ marginBottom: 12 }}>
          {expenses.data!.map((e: Expense) => (
            <li key={e.id}>
              <i className="icon-receipt" />
              <span>{e.category}{e.event ? ` · ${e.event.title}` : ""}<br /><small style={{ color: "var(--text-3)" }}>{new Date(e.date).toLocaleDateString()}{e.note ? ` · ${e.note}` : ""}</small></span>
              <b style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{omr(e.amount)} OMR</b>
              <button className="copy-btn" onClick={() => removeExpense(e.id)} style={{ marginLeft: 8 }}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {!expenses.loading && (expenses.data || []).length === 0 && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5, marginBottom: 12 }}>No expenses logged yet.</p>
      )}

      <button className="btn glass" onClick={exportCsv} disabled={exporting}>
        <i className="icon-download" /> {exporting ? "Exporting…" : "Export P&L CSV"}
      </button>
    </div>
  );
}

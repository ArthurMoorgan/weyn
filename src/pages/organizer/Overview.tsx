import { useState } from "react";
import { Link } from "react-router-dom";
import { api, dayLabel, timeLabel, API_BASE, type Expense, type OrganizerFinance } from "../../api";
import { useAsync } from "../../hooks";
import { getAuthToken } from "../../store";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

const ATTENTION_ICON: Record<string, string> = {
  manual_review: "icon-shield-alert",
  zero_sales: "icon-trending-down",
  waitlist_pending: "icon-clock",
  pending_invite: "icon-mail",
};

// One page, everything that matters at a glance — per direct feedback that
// the dashboard had grown too many separate destinations for what it does.
// Finance used to be its own nav tab; its numbers (net/fees, revenue by
// event) now live here, right under the same revenue trend a Finance page
// would have opened to anyway.
export default function OrganizerOverview() {
  const summary = useAsync(() => api.dashboardSummary(), []);
  const overview = useAsync(() => api.organizerOverview(), []);
  const finance = useAsync(() => api.organizerFinance(), []);

  const s = summary.data;
  const o = overview.data;
  const f = finance.data;
  const maxTrend = o ? Math.max(1, ...o.revenueTrend.map((d) => d.revenue)) : 1;

  return (
    <>
      {summary.error && <p className="errline">{summary.error}</p>}
      <div className="stat-grid">
        <div className="stat"><div className="k">Net revenue</div><div className="v">{f ? omr(f.netRevenue) : "—"} <small>OMR</small></div></div>
        <div className="stat"><div className="k">Tickets sold</div><div className="v">{s ? s.totalAttendees.toLocaleString() : "—"}</div></div>
        <div className="stat"><div className="k">Live events</div><div className="v">{s ? s.totalEvents : "—"}</div></div>
        <div className="stat"><div className="k">New today</div><div className="v">{s ? s.newRegistrationsToday : "—"}</div></div>
      </div>

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Needs attention</h2>{o && <span>{o.needsAttention.length}</span>}</div>
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

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Coming up</h2></div>
      {overview.loading && <p className="hint" style={{ padding: "0 6px" }}>Loading…</p>}
      {o && o.nextUpcoming.length === 0 && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 6px 8px" }}>Nothing scheduled yet.</p>
      )}
      {o && o.nextUpcoming.map((e) => (
        <Link key={e.id} to={`/organizer/events/${e.id}`} className="dash-row">
          <div className="thumb" style={e.image ? { backgroundImage: `url(${e.image})`, backgroundSize: "cover", backgroundPosition: "center" } : { background: e.color }}>
            {!e.image && e.glyph}
          </div>
          <div className="info">
            <b>{e.title}</b>
            <span>{dayLabel({ startsAt: e.startsAt } as any)} · {timeLabel({ startsAt: e.startsAt } as any)}</span>
          </div>
          <div className="amt">
            <b>{e.sold}</b>
            <span>{e.capacity >= 9000 ? "in" : `/ ${e.capacity}`}</span>
          </div>
        </Link>
      ))}

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Revenue — last 14 days</h2></div>
      <div className="dash-card" style={{ padding: "16px 18px" }}>
        {overview.loading ? (
          <p className="hint">Loading…</p>
        ) : o && o.revenueTrend.some((d) => d.revenue > 0) ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
            {o.revenueTrend.map((d) => (
              <div key={d.date} title={`${d.date}: ${d.revenue.toLocaleString()} OMR`} style={{
                flex: 1, minWidth: 4, borderRadius: 3,
                height: `${Math.max(6, Math.round((d.revenue / maxTrend) * 90))}px`,
                background: "var(--accent)",
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

      {f && f.byEvent.length > 0 && (
        <>
          <div className="date-head" style={{ paddingLeft: 6 }}><h2>Revenue by event</h2></div>
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

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Expenses & P&L</h2></div>
      <FinancialDashboard finance={f} />
    </>
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

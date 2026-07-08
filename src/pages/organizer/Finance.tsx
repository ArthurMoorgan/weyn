import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// Cross-event revenue rollup — HANDOFF.md §17's "Finance" section. Ships as
// a reporting view, not a payout ledger: no payment processor is wired to
// produce real payout events yet (see HANDOFF.md §4.5/§16), so this is
// honest about that rather than fabricating a "paid out" status.
export default function OrganizerFinance() {
  const { data, loading, error } = useAsync(() => api.organizerFinance(), []);
  const maxMonth = data ? Math.max(1, ...data.revenueByMonth.map((m) => m.revenue)) : 1;

  return (
    <>
      {loading && <p className="hint" style={{ padding: "8px 6px" }}>Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {data && (
        <>
          <div className="stat-grid">
            <div className="stat"><div className="k">Gross revenue</div><div className="v">{omr(data.totalRevenue)} <small>OMR</small></div></div>
            <div className="stat"><div className="k">Net (est.)</div><div className="v">{omr(data.netRevenue)} <small>OMR</small></div></div>
            <div className="stat"><div className="k">Weyn fees (est.)</div><div className="v">{omr(data.feesPaid)} <small>OMR</small></div></div>
          </div>

          {!data.payoutsLive && (
            <p className="hint" style={{ margin: "4px 0 16px" }}>
              Payout tracking isn't real yet — no payment processor is wired to produce actual payout events. These numbers reflect ticket sales, not money that's actually been transferred to you.
            </p>
          )}

          <div className="date-head" style={{ paddingLeft: 6 }}><h2>Revenue by month</h2></div>
          <div className="dash-card" style={{ padding: "16px 18px" }}>
            {data.revenueByMonth.length > 0 ? (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
                {data.revenueByMonth.map((m) => (
                  <div key={m.month} style={{ flex: 1, textAlign: "center" }}>
                    <div title={`${m.month}: ${m.revenue.toLocaleString()} OMR`} style={{
                      height: `${Math.max(6, Math.round((m.revenue / maxMonth) * 80))}px`,
                      borderRadius: 3, background: "var(--accent)", marginBottom: 4,
                    }} />
                    <small style={{ color: "var(--text-3)", fontSize: 10.5 }}>{m.month.slice(5)}</small>
                  </div>
                ))}
              </div>
            ) : <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No paid bookings yet.</p>}
          </div>

          <div className="date-head" style={{ paddingLeft: 6 }}><h2>Revenue by event</h2></div>
          {data.byEvent.length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 6px" }}>No revenue yet.</p>}
          {data.byEvent.length > 0 && (
            <ul className="steps">
              {data.byEvent.map((e) => (
                <li key={e.eventId}>
                  <i className="icon-ticket" />
                  <span><Link to={`/organizer/events/${e.eventId}`}>{e.title}</Link><br /><small style={{ color: "var(--text-3)" }}>{e.ticketsSold} tickets</small></span>
                  <b style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{omr(e.revenue)} OMR</b>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

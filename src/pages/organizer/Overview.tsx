import { Link } from "react-router-dom";
import { api, dayLabel, timeLabel } from "../../api";
import { useAsync } from "../../hooks";

const omr = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

const ATTENTION_ICON: Record<string, string> = {
  manual_review: "icon-shield-alert",
  zero_sales: "icon-trending-down",
  waitlist_pending: "icon-clock",
  pending_invite: "icon-mail",
};

export default function OrganizerOverview() {
  const summary = useAsync(() => api.dashboardSummary(), []);
  const overview = useAsync(() => api.organizerOverview(), []);

  const s = summary.data;
  const o = overview.data;
  const maxTrend = o ? Math.max(1, ...o.revenueTrend.map((d) => d.revenue)) : 1;

  return (
    <>
      {summary.error && <p className="errline">{summary.error}</p>}
      <div className="stat-grid">
        <div className="stat"><div className="k">Total revenue</div><div className="v">{s ? omr(s.totalRevenue) : "—"} <small>OMR</small></div></div>
        <div className="stat"><div className="k">Tickets sold</div><div className="v">{s ? s.totalAttendees.toLocaleString() : "—"}</div></div>
        <div className="stat"><div className="k">Live events</div><div className="v">{s ? s.totalEvents : "—"}</div></div>
        <div className="stat"><div className="k">New today</div><div className="v">{s ? s.newRegistrationsToday : "—"}</div></div>
      </div>

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
    </>
  );
}

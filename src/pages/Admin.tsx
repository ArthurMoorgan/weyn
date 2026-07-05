import { useNavigate } from "react-router-dom";
import { api, type ReportReason } from "../api";
import { useAsync } from "../hooks";
import { useAccount } from "../store";
import ThemeToggle from "../components/ThemeToggle";

const REASON_LABEL: Record<ReportReason, string> = {
  SPAM: "Spam", INAPPROPRIATE: "Inappropriate", FRAUD: "Fraud", DUPLICATE: "Duplicate", OTHER: "Other",
};

export default function Admin() {
  const account = useAccount();
  const nav = useNavigate();
  const metrics = useAsync(() => api.adminMetrics(), []);
  const reports = useAsync(() => api.adminListReports(), []);

  // ADMIN-gated server-side on every request this page makes — this client
  // check is just to avoid flashing the page's shell at a non-admin before
  // their first request 403s.
  if (account && account.role !== "ADMIN") {
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <div className="ic"><i className="icon-lock" /></div>
        <p>Admins only.</p>
        <button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={() => nav("/you")}>Back</button>
      </div>
    );
  }

  async function resolve(id: string, status: "DISMISSED" | "ACTIONED") {
    await api.adminResolveReport(id, status);
    reports.reload();
  }

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="en">Admin</span></div>
        <div className="tb-right"><ThemeToggle /></div>
      </header>

      <div className="page-head">
        <h1>Platform overview</h1>
        <p className="sub">Metrics and the open moderation queue</p>
      </div>

      <div className="admin-grid">
        <div>
          {metrics.loading ? <div className="spin" /> : metrics.error ? (
            <p className="errline" style={{ padding: "0 16px" }}>{metrics.error}</p>
          ) : metrics.data && (
            <div className="stat-grid" style={{ padding: "0 16px" }}>
              <div className="stat"><span className="k">Users</span><div className="v">{metrics.data.totalUsers} <small>+{metrics.data.newUsersThisWeek} this week</small></div></div>
              <div className="stat"><span className="k">Events</span><div className="v">{metrics.data.totalEvents} <small>+{metrics.data.newEventsThisWeek} this week</small></div></div>
              <div className="stat"><span className="k">Bookings</span><div className="v">{metrics.data.totalBookings}</div></div>
              <div className="stat"><span className="k">Total revenue</span><div className="v">OMR {metrics.data.totalRevenue.toFixed(2)}</div></div>
            </div>
          )}
        </div>

        <div>
          <p className="hint" style={{ margin: "20px 16px 6px" }}>
            <i className="icon-flag" /> Open reports {metrics.data ? `(${metrics.data.openReports})` : ""}
          </p>

          {reports.loading && <div className="spin" />}
          {reports.error && <p className="errline" style={{ padding: "0 16px" }}>{reports.error}</p>}
          {!reports.loading && !reports.error && (
            (reports.data || []).length > 0 ? (
              <ul className="steps" style={{ padding: "0 16px" }}>
                {reports.data!.map((r) => (
                  <li key={r.id}>
                    <i className="icon-flag" />
                    <span>
                      <b>{r.entityType}</b> · {REASON_LABEL[r.reason]}
                      {r.note ? <><br /><small style={{ color: "var(--text-3)" }}>{r.note}</small></> : null}
                      <br /><small style={{ color: "var(--text-3)" }}>
                        {r.reporter?.email || "Anonymous"} · {new Date(r.createdAt).toLocaleDateString()}
                      </small>
                    </span>
                    <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                      <button className="btn glass sm" onClick={() => resolve(r.id, "ACTIONED")}>Action</button>
                      <button className="btn glass sm" onClick={() => resolve(r.id, "DISMISSED")}>Dismiss</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 16px" }}>Nothing in the queue.</p>
            )
          )}
        </div>
      </div>
    </>
  );
}

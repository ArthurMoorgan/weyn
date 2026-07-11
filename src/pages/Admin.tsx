import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, API_BASE, type ReportReason, type VenueApplication } from "../api";
import { useAsync } from "../hooks";
import { useAccount, getAuthToken } from "../store";
import ThemeToggle from "../components/ThemeToggle";
import Tooltip from "../components/Tooltip";

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
        <Tooltip text="Back"><button className="icon-btn" onClick={() => nav("/you")} aria-label="Back"><i className="icon-arrow-left" /></button></Tooltip>
        <div className="brand"><span className="en">Admin</span></div>
        <div className="tb-right"><ThemeToggle /></div>
      </header>

      <div className="page-head compact">
        <h1>Platform overview</h1>
        <p className="sub">Metrics and the open moderation queue</p>
      </div>

      <div className="admin-grid">
        <div>
          {metrics.loading ? (
            <div className="stat-skel">
              <div className="s-tile" /><div className="s-tile" /><div className="s-tile" /><div className="s-tile" />
            </div>
          ) : metrics.error ? (
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

          {reports.loading && (
            <div style={{ padding: "0 16px" }}>
              <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
              <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
              <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
            </div>
          )}
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

        <VenueApplications />
        <WaitlistSignups />
      </div>
    </>
  );
}

/* ---------- waitlist.weynevents.com signups ---------- */
function WaitlistSignups() {
  const { data, loading, error } = useAsync(() => api.adminWaitlistSignups(), []);
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/admin/waitlist-signups.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "weyn-waitlist-signups.csv"; link.click();
      URL.revokeObjectURL(url);
    } catch { /* the export button itself is the only affordance — a failed download just leaves nothing to show */ }
    finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <p className="hint" style={{ margin: "20px 16px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span><i className="icon-mail" /> Waitlist signups {data ? `(${data.length})` : ""}</span>
        {!!data?.length && (
          <button type="button" className="btn glass sm" style={{ width: "auto" }} onClick={exportCsv} disabled={exporting}>
            <i className="icon-download" /> {exporting ? "Exporting…" : "Export CSV"}
          </button>
        )}
      </p>

      {loading && (
        <div style={{ padding: "0 16px" }}>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
        </div>
      )}
      {error && <p className="errline" style={{ padding: "0 16px" }}>{error}</p>}
      {!loading && !error && (
        (data || []).length > 0 ? (
          <ul className="steps" style={{ padding: "0 16px" }}>
            {data!.map((s) => (
              <li key={s.id}>
                <i className="icon-mail" />
                <span>
                  <b>{s.email}</b>{s.name ? ` · ${s.name}` : ""}
                  <br /><small style={{ color: "var(--text-3)" }}>
                    {s.role ? `${s.role} · ` : ""}{s.source ? `${s.source} · ` : ""}{new Date(s.createdAt).toLocaleDateString()}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 16px" }}>No signups yet.</p>
        )
      )}
    </div>
  );
}

/* ---------- Venue applications review queue ---------- */
function VenueApplications() {
  const { data, loading, error } = useAsync(() => api.adminVenueApplications("pending"), []);
  // Local mirror so approve/reject can remove a card without a full refetch.
  const [apps, setApps] = useState<VenueApplication[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState("");

  useEffect(() => { if (data) setApps(data); }, [data]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  async function approve(id: string) {
    setBusyId(id); setActionErr("");
    try {
      await api.approveVenueApplication(id);
      setApps((list) => list.filter((a) => a.id !== id));
      flash("Approved — venue is now live.");
    } catch (e: any) {
      setActionErr(e.message || "Couldn't approve that application.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id); setActionErr("");
    try {
      await api.rejectVenueApplication(id, rejectNote.trim() || undefined);
      setApps((list) => list.filter((a) => a.id !== id));
      setRejectingId(null);
      setRejectNote("");
      flash("Application rejected.");
    } catch (e: any) {
      setActionErr(e.message || "Couldn't reject that application.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <p className="hint" style={{ margin: "20px 16px 6px" }}>
        <i className="icon-store" /> Venue applications {apps.length ? `(${apps.length})` : ""}
      </p>

      {loading && (
        <div style={{ padding: "0 16px" }}>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
          <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
        </div>
      )}
      {error && <p className="errline" style={{ padding: "0 16px" }}>{error}</p>}
      {actionErr && <p className="errline" style={{ padding: "0 16px" }}>{actionErr}</p>}

      {!loading && !error && (
        apps.length > 0 ? (
          <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {apps.map((a) => (
              <div key={a.id} className="venue-app-card">
                <div className="venue-app-body">
                  {a.proofDocUrl && (
                    <a href={API_BASE + a.proofDocUrl} target="_blank" rel="noreferrer" className="venue-app-proof">
                      <img src={API_BASE + a.proofDocUrl} alt={`${a.name} ownership document`} />
                    </a>
                  )}
                  <div className="venue-app-info">
                    <b>{a.name}</b>
                    <span className="venue-app-cat">{a.businessType}{a.priceRange ? ` · ${a.priceRange}` : ""}</span>
                    <div className="venue-app-meta">
                      <div><i className="icon-user" /> {a.contactName}{a.role ? ` · ${a.role}` : ""}</div>
                      <div><i className="icon-mail" /> {a.contactEmail}</div>
                      {a.area && <div><i className="icon-map-pin" /> {a.area}</div>}
                      {a.businessRegNo && <div><i className="icon-hash" /> Reg no. {a.businessRegNo}</div>}
                    </div>
                  </div>
                </div>

                {rejectingId === a.id ? (
                  <div className="venue-app-reject">
                    <input
                      autoFocus
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Reason (optional)…"
                      onKeyDown={(e) => e.key === "Enter" && reject(a.id)}
                    />
                    <button className="btn glass sm" onClick={() => { setRejectingId(null); setRejectNote(""); }} disabled={busyId === a.id}>Cancel</button>
                    <button className="btn glass sm danger-btn" onClick={() => reject(a.id)} disabled={busyId === a.id}>Confirm reject</button>
                  </div>
                ) : (
                  <div className="venue-app-actions">
                    <button className="btn glass sm" onClick={() => approve(a.id)} disabled={busyId === a.id}>
                      <i className="icon-check" /> Approve
                    </button>
                    <button className="btn glass sm danger-btn" onClick={() => { setRejectingId(a.id); setRejectNote(""); setActionErr(""); }} disabled={busyId === a.id}>
                      <i className="icon-x" /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ padding: "24px 36px 8px" }}>
            <div className="ic"><i className="icon-store" /></div>
            <p>No pending applications</p>
          </div>
        )
      )}

      {toast && <div className="toast"><i className="icon-check" /> {toast}</div>}
    </div>
  );
}

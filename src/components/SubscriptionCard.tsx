import { useEffect, useState } from "react";
import { api } from "../api";
import { FEATURE_LABELS } from "./featureCatalog";
import CancelSubscriptionFlow from "./CancelSubscriptionFlow";

// Organizer Pro's "Subscription Dashboard" deliverable: current plan,
// renewal date, billing history, active features. Every organizer
// currently resolves to an active free "pro" grant (see
// server/features.js), so this renders the real state, not a mock — it's
// just that the real state today is "free during launch."
export default function SubscriptionCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.mySubscription>> | null>(null);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [showCancelFlow, setShowCancelFlow] = useState(false);
  const [resuming, setResuming] = useState(false);

  function reload() {
    api.mySubscription().then(setData).catch((e) => setErr(e.message || "Couldn't load subscription"));
  }

  useEffect(reload, []);

  async function resume() {
    setResuming(true);
    try {
      await api.resumeSubscription();
      reload();
    } finally {
      setResuming(false);
    }
  }

  if (err) return null; // signed-out / not an organizer yet — nothing to show
  if (!data) return <div className="sub-card sub-card-skel" />;

  const activeFeatures = Object.entries(data.features).filter(([, on]) => on).map(([key]) => key);
  const renewalLabel = data.currentPeriodEnd
    ? new Date(data.currentPeriodEnd).getFullYear() >= 2090
      ? "Free during launch — no renewal date yet"
      : `Renews ${new Date(data.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : "—";

  return (
    <div className="sub-card">
      <div className="sub-card-head">
        <div>
          <div className="sub-card-plan">
            <i className="icon-sparkles" /> {data.plan.name}
            <span className={"sub-status sub-status-" + data.status.toLowerCase()}>{data.status}</span>
          </div>
          <div className="sub-card-sub">{renewalLabel}</div>
        </div>
        <div className="sub-card-price">{data.plan.priceOmr === 0 ? "Free" : `OMR ${data.plan.priceOmr}/${data.plan.billingPeriod}`}</div>
      </div>

      <button className="sub-card-toggle" onClick={() => setExpanded((v) => !v)}>
        {activeFeatures.length} features active <i className={expanded ? "icon-chevron-up" : "icon-chevron-down"} />
      </button>
      {expanded && (
        <ul className="sub-feature-list">
          {activeFeatures.map((key) => (
            <li key={key}><i className="icon-check" /> {FEATURE_LABELS[key] || key}</li>
          ))}
        </ul>
      )}

      {data.paymentHistory.length > 0 && (
        <div className="sub-billing-history">
          <div className="filter-sheet-label">Billing history</div>
          {data.paymentHistory.map((p) => (
            <div key={p.id} className="sub-billing-row">
              <span>{new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span>OMR {p.amountOmr}</span>
              <span className={"sub-status sub-status-" + p.status.toLowerCase()}>{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pending-cancel / paused banners — both have the same "undo before
          it takes effect" shape, so one Resume action covers either. */}
      {data.cancelAtPeriodEnd && (
        <div className="marketing-card" style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "0 0 10px" }}>
            Your subscription is set to cancel{data.currentPeriodEnd ? ` on ${new Date(data.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : " at the end of this billing period"}.
          </p>
          <button className="btn glass sm" onClick={resume} disabled={resuming}>{resuming ? "Undoing…" : "Undo cancellation"}</button>
        </div>
      )}
      {data.status === "SUSPENDED" && data.pausedUntil && (
        <div className="marketing-card" style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "0 0 10px" }}>
            Paused until {new Date(data.pausedUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} — Pro features are off until then.
          </p>
          <button className="btn glass sm" onClick={resume} disabled={resuming}>{resuming ? "Resuming…" : "Resume now"}</button>
        </div>
      )}

      {!data.cancelAtPeriodEnd && data.status !== "SUSPENDED" && data.plan.priceOmr > 0 && (
        <button className="sub-card-toggle" style={{ marginTop: 10, color: "var(--text-3)" }} onClick={() => setShowCancelFlow(true)}>
          Cancel subscription
        </button>
      )}

      {showCancelFlow && (
        <CancelSubscriptionFlow onClose={() => setShowCancelFlow(false)} onChanged={reload} />
      )}
    </div>
  );
}

import { useClosing } from "../hooks";
import { FEATURE_LABELS } from "./featureCatalog";

// The "Upgrade Modal" deliverable — used throughout the platform wherever a
// FeatureLock (see FeatureLock.tsx) is tapped. Real plan, real feature
// list, but the CTA is intentionally inert right now: no payment processor
// is wired to actually charge anyone yet (see handoff.md's "Stripe
// integration, parked" section for the architecture to connect here), and
// every organizer already has every feature for free during launch — so
// there's nothing to actually purchase today. Swapping in real billing
// later only means replacing the disabled button's onClick.
const PRO_FEATURES = [
  "featuredPlacement", "advancedAnalytics", "promoCodes", "teamMembers", "waitlists", "csvExports",
];

export default function UpgradeModal({ onClose, highlightFeature }: { onClose: () => void; highlightFeature?: string }) {
  const { closing, close } = useClosing(onClose);
  return (
    <div className={"sheet-backdrop" + (closing ? " closing" : "")} onClick={close}>
      <div className={"install-sheet glass" + (closing ? " closing" : "")} onClick={(e) => e.stopPropagation()}>
        <div className="upgrade-badge"><i className="icon-sparkles" /> Weyn Pro</div>
        <h3 style={{ marginBottom: 4 }}>OMR 15/month</h3>
        <p className="sub" style={{ marginBottom: 16 }}>
          {highlightFeature && FEATURE_LABELS[highlightFeature]
            ? `Unlock ${FEATURE_LABELS[highlightFeature]} and everything else in Weyn Pro.`
            : "Grow and manage your events with Weyn Pro."}
        </p>
        <ul className="steps" style={{ textAlign: "left", marginBottom: 18 }}>
          {PRO_FEATURES.map((f) => (
            <li key={f}><i className="icon-check" /> {FEATURE_LABELS[f]}</li>
          ))}
        </ul>
        <div className="note" style={{ marginBottom: 14 }}>
          <i className="icon-info" style={{ marginRight: 6 }} />
          Every organizer already has full Pro access for free during launch — there's nothing to upgrade yet.
        </div>
        <button className="btn lg" disabled>Upgrade — coming soon</button>
        <button className="btn glass" style={{ marginTop: 8 }} onClick={close}>Close</button>
      </div>
    </div>
  );
}

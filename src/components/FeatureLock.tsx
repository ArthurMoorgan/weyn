import { useState } from "react";
import UpgradeModal from "./UpgradeModal";
import { FEATURE_LABELS } from "./featureCatalog";

// The "Feature Lock Component" deliverable — wraps a Pro-only piece of UI.
// Renders children unlocked when `enabled` is true, otherwise a locked
// placeholder (Pro badge + lock state + upgrade CTA) that opens
// UpgradeModal. Every organizer currently has every feature enabled (see
// server/features.js), so in practice this renders `children` everywhere
// it's used today — it exists so the real gate is one prop flip away
// whenever a non-Pro plan exists, not a UI that has to be built later.
export default function FeatureLock({ feature, enabled, children }: { feature: string; enabled: boolean; children: React.ReactNode }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  if (enabled) return <>{children}</>;
  return (
    <>
      <button type="button" className="feature-lock" onClick={() => setShowUpgrade(true)}>
        <i className="icon-lock" />
        <span>{FEATURE_LABELS[feature] || feature}</span>
        <span className="pro-badge">PRO</span>
      </button>
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} highlightFeature={feature} />}
    </>
  );
}

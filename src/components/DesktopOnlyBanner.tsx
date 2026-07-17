import { useState } from "react";
import { useIsNarrowViewport } from "../store";

// venue-os has no shared Layout wrapper (unlike organizer/Layout.tsx), so
// each entry point renders this itself. Non-blocking: it's a dismissible
// notice, not a gate — the dashboard is usable on a phone, just cramped,
// so we don't stop anyone from continuing.
export default function DesktopOnlyBanner() {
  const narrow = useIsNarrowViewport();
  const [dismissed, setDismissed] = useState(false);
  if (!narrow || dismissed) return null;

  return (
    <div className="feature-lock" style={{ margin: "0 0 12px" }}>
      <i className="icon-monitor" />
      <span style={{ flex: 1 }}>Venue dashboard is designed for desktop/PC use — some tools may be hard to use on a small screen.</span>
      <button type="button" className="icon-btn" style={{ flex: "0 0 auto" }} onClick={() => setDismissed(true)} aria-label="Dismiss">
        <i className="icon-x" />
      </button>
    </div>
  );
}

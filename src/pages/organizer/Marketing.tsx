import { useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { api } from "../../api";
import { useAsync } from "../../hooks";

// Cross-event marketing hub — surfaces the per-event AI copy generator
// across every event instead of one at a time, plus one genuinely new small
// piece per HANDOFF.md §17: a shareable QR/poster for the organizer's public
// profile, for offline promotion. Referrer/UTM tracking stays out of scope
// (no source data yet — see server/features.js's trafficSources flag).
export default function OrganizerMarketing() {
  const events = useAsync(() => api.dashboardEvents(), []);
  const me = useAsync(() => api.me(), []);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const profileUrl = me.data ? `${window.location.origin}/organizer/${me.data.id}` : null;

  async function generatePoster() {
    if (!profileUrl) return;
    setGenerating(true);
    try {
      const dataUrl = await QRCode.toDataURL(profileUrl, { margin: 1, width: 480 });
      setQrUrl(dataUrl);
    } finally {
      setGenerating(false);
    }
  }

  function copyProfileLink() {
    if (!profileUrl) return;
    navigator.clipboard?.writeText(profileUrl);
  }

  const active = (events.data || []).filter((e) => !e.cancelled);

  return (
    <>
      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Per-event marketing copy</h2></div>
      {events.loading && <p className="hint" style={{ padding: "0 6px" }}>Loading…</p>}
      {events.error && <p className="errline">{events.error}</p>}
      {!events.loading && active.length === 0 && <p style={{ color: "var(--text-2)", fontSize: 13.5, padding: "0 6px" }}>No active events yet.</p>}
      {active.length > 0 && (
        <ul className="steps">
          {active.map((e) => (
            <li key={e.id}>
              <i className="icon-megaphone" />
              <span>{e.title}</span>
              <Link to={`/organizer/events/${e.id}/marketing`} className="copy-btn" style={{ marginLeft: "auto" }}>Open</Link>
            </li>
          ))}
        </ul>
      )}

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Your organizer profile</h2></div>
      <div className="dash-card" style={{ padding: 16 }}>
        <p className="hint" style={{ margin: "0 0 12px" }}>Share a QR code / printable poster linking to your public organizer page — good for flyers, table tents, or a door sign.</p>
        {profileUrl && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input readOnly value={profileUrl} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
            <button className="copy-btn" onClick={copyProfileLink}><i className="icon-copy" /> Copy</button>
          </div>
        )}
        <button className="btn glass" onClick={generatePoster} disabled={generating || !profileUrl}>
          <i className="icon-qr-code" /> {generating ? "Generating…" : "Generate QR poster"}
        </button>
        {qrUrl && (
          <div style={{ marginTop: 14, textAlign: "center" }}>
            <img src={qrUrl} alt="Organizer profile QR code" style={{ width: 200, height: 200, borderRadius: 12, background: "#fff", padding: 8 }} />
            <div style={{ marginTop: 10 }}>
              <a href={qrUrl} download="weyn-organizer-qr.png" className="btn glass" style={{ display: "inline-flex", width: "auto", padding: "9px 16px" }}>
                <i className="icon-download" /> Download PNG
              </a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

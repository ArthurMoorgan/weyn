import { useEffect, useState } from "react";
import { CATS, type Cat } from "../../api";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import SubscriptionCard from "../../components/SubscriptionCard";
import QRCode from "qrcode";

// Default event settings — a pure quality-of-life addition (HANDOFF.md
// §17's "Settings" section): prefills Organizer.tsx's host form so creating
// a 10th event doesn't mean retyping the same category/capacity/refund
// policy. Relocates SubscriptionCard here from You.tsx's old Settings tab,
// since billing belongs with the rest of the organizer's tools now. Also
// picked up the QR/poster generator that used to be its own "Marketing" nav
// tab — folded in here since it's a one-time setup action, not something
// worth a whole separate destination.
export default function OrganizerSettings() {
  const { data, loading } = useAsync(() => api.getOrganizerSettings(), []);
  const me = useAsync(() => api.me(), []);
  const [cat, setCat] = useState<Cat>("music");
  const [capacity, setCapacity] = useState("60");
  const [refundPolicy, setRefundPolicy] = useState("Refund up to 48h before");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [generatingQr, setGeneratingQr] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (data.cat) setCat(data.cat);
    if (data.capacity) setCapacity(data.capacity);
    if (data.refundPolicy) setRefundPolicy(data.refundPolicy);
  }, [data]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await api.setOrganizerSettings({ cat, capacity, refundPolicy });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const profileUrl = me.data ? `${window.location.origin}/organizer/${me.data.id}` : null;
  async function generatePoster() {
    if (!profileUrl) return;
    setGeneratingQr(true);
    try {
      setQrUrl(await QRCode.toDataURL(profileUrl, { margin: 1, width: 480 }));
    } finally {
      setGeneratingQr(false);
    }
  }

  return (
    <>
      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Default event settings</h2></div>
      <div className="dash-card" style={{ padding: 16 }}>
        <p className="hint" style={{ margin: "0 0 14px" }}>Prefills these on the host form every time you create a new event.</p>
        {loading ? <p className="hint">Loading…</p> : (
          <>
            <div className="field">
              <label>Default category</label>
              <select value={cat} onChange={(e) => setCat(e.target.value as Cat)}>
                {CATS.filter((c) => c.key !== "all").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Default capacity</label><input inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
            <div className="field">
              <label>Default refund policy</label>
              <select value={refundPolicy} onChange={(e) => setRefundPolicy(e.target.value)}>
                <option>No refunds</option>
                <option>Refund up to 24h before</option>
                <option>Refund up to 48h before</option>
                <option>Full refund anytime before the event</option>
              </select>
            </div>
            <button className="btn" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save defaults"}</button>
          </>
        )}
      </div>

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Your organizer profile</h2></div>
      <div className="dash-card" style={{ padding: 16 }}>
        <p className="hint" style={{ margin: "0 0 12px" }}>A QR code / printable poster linking to your public organizer page — good for flyers, table tents, or a door sign.</p>
        {profileUrl && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input readOnly value={profileUrl} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
            <button className="copy-btn" onClick={() => navigator.clipboard?.writeText(profileUrl)}><i className="icon-copy" /> Copy</button>
          </div>
        )}
        <button className="btn glass" onClick={generatePoster} disabled={generatingQr || !profileUrl}>
          <i className="icon-qr-code" /> {generatingQr ? "Generating…" : "Generate QR poster"}
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

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Subscription</h2></div>
      <SubscriptionCard />
    </>
  );
}

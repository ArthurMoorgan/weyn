import { useEffect, useState } from "react";
import { CATS, type Cat } from "../../api";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import SubscriptionCard from "../../components/SubscriptionCard";

// Default event settings — a pure quality-of-life addition (HANDOFF.md
// §17's "Settings" section): prefills Organizer.tsx's host form so creating
// a 10th event doesn't mean retyping the same category/capacity/refund
// policy. Relocates SubscriptionCard here from You.tsx's old Settings tab,
// since billing belongs with the rest of the organizer's tools now.
export default function OrganizerSettings() {
  const { data, loading } = useAsync(() => api.getOrganizerSettings(), []);
  const [cat, setCat] = useState<Cat>("music");
  const [capacity, setCapacity] = useState("60");
  const [refundPolicy, setRefundPolicy] = useState("Refund up to 48h before");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

      <div className="date-head" style={{ paddingLeft: 6 }}><h2>Subscription</h2></div>
      <SubscriptionCard />
    </>
  );
}

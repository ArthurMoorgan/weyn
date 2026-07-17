import { useEffect, useState } from "react";
import { CATS, isValidEmail, type Cat, type TeamRole, type EventVenue } from "../../api";
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
// tab, plus the newer Payouts (default payment method) and organizer-wide
// Team sections — all one-time/occasional setup actions, not things that
// need their own top-level destination.
export default function OrganizerSettings() {
  const { data, loading } = useAsync(() => api.getOrganizerSettings(), []);
  const me = useAsync(() => api.me(), []);
  const [cat, setCat] = useState<Cat>("music");

  // React Router doesn't auto-scroll to a URL hash on client-side
  // navigation (only real page loads do that) — Overview's quick-action
  // tiles link here with #team/#venues, so without this they'd land at the
  // top of the page instead of the actual section.
  useEffect(() => {
    if (!window.location.hash) return;
    const id = window.location.hash.slice(1);
    const el = document.getElementById(id);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);
  const [capacity, setCapacity] = useState("60");
  const [refundPolicy, setRefundPolicy] = useState("Refund up to 48h before");
  const [bio, setBio] = useState("");
  const [instagram, setInstagram] = useState("");
  const [website, setWebsite] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"link" | "transfer">("link");
  const [defaultPaymentLinkUrl, setDefaultPaymentLinkUrl] = useState("");
  const [defaultTransferDetails, setDefaultTransferDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [generatingQr, setGeneratingQr] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(true);
  useEffect(() => { api.config().then((c) => setPaymentsEnabled(c.paymentsEnabled)).catch(() => {}); }, []);

  useEffect(() => {
    if (!data) return;
    if (data.cat) setCat(data.cat);
    if (data.capacity) setCapacity(data.capacity);
    if (data.refundPolicy) setRefundPolicy(data.refundPolicy);
    if (data.bio) setBio(data.bio);
    if (data.instagram) setInstagram(data.instagram);
    if (data.website) setWebsite(data.website);
    if (data.defaultTransferDetails) setPaymentMethod("transfer");
    if (data.defaultPaymentLinkUrl) setDefaultPaymentLinkUrl(data.defaultPaymentLinkUrl);
    if (data.defaultTransferDetails) setDefaultTransferDetails(data.defaultTransferDetails);
  }, [data]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await api.setOrganizerSettings({
        cat, capacity, refundPolicy, bio, instagram, website,
        defaultPaymentLinkUrl: paymentMethod === "link" ? defaultPaymentLinkUrl : "",
        defaultTransferDetails: paymentMethod === "transfer" ? defaultTransferDetails : "",
      });
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
      <div className="date-head"><h2>Default event settings</h2></div>
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
          </>
        )}
      </div>

      <div className="date-head"><h2>Your organizer profile</h2></div>
      <div className="dash-card" style={{ padding: 16 }}>
        <div className="field"><label>Bio <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· shown on your public page</span></label><textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people what you host…" /></div>
        <div className="field"><label>Instagram <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label><input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@yourhandle" /></div>
        <div className="field"><label>Website <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label><input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yoursite.com" /></div>

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

      <div className="date-head"><h2>Payouts</h2></div>
      <div className="dash-card" style={{ padding: 16 }}>
        <p className="hint" style={{ margin: "0 0 12px" }}>
          Weyn doesn't process payments — buyers pay you directly. This is the default payment link or transfer details prefilled whenever you create a new "Your Own Payment Link or Bank Transfer" event; each event can still override it individually.
        </p>
        <div className="chips" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" className={"chip" + (paymentMethod === "link" ? " on" : "")} onClick={() => setPaymentMethod("link")}>Payment link</button>
          <button type="button" className={"chip" + (paymentMethod === "transfer" ? " on" : "")} onClick={() => setPaymentMethod("transfer")}>Bank transfer details</button>
        </div>
        {paymentMethod === "link" ? (
          <input value={defaultPaymentLinkUrl} onChange={(e) => setDefaultPaymentLinkUrl(e.target.value)} placeholder="https://buy.stripe.com/… or paypal.me/…" />
        ) : (
          <textarea rows={3} value={defaultTransferDetails} onChange={(e) => setDefaultTransferDetails(e.target.value)} placeholder="Bank name, account name, account/IBAN number, reference to use…" />
        )}
        <p className="hint" style={{ marginTop: 10 }}>Revenue and per-event breakdowns are on the Overview page.</p>
        {!paymentsEnabled && (
          <div className="note" style={{ marginTop: 12, marginBottom: 0 }}>
            <i className="icon-info" style={{ marginRight: 6 }} />
            Weyn card payments (PayTabs) aren't connected on this environment yet, so "Weyn Ticketing" isn't available when creating events — use a payment link or bank transfer instead.
          </div>
        )}
      </div>

      <button className="btn" onClick={save} disabled={saving} style={{ marginBottom: 24 }}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save settings"}</button>

      <div id="team" className="date-head"><h2>Team</h2></div>
      <OrganizerTeamPanel />

      <div id="venues" className="date-head"><h2>Venue library</h2></div>
      <VenueLibraryPanel />

      <div className="date-head"><h2>Subscription</h2></div>
      <SubscriptionCard />
    </>
  );
}

// Reusable venues — save a place once (name, address, pin, capacity, notes)
// and pick it from a dropdown on the host form instead of retyping it every
// time (see Organizer.tsx's "Use a saved venue" select, which reads this
// same list). Kept in Settings rather than a new top-level nav entry — an
// occasional setup action, not a daily destination.
function VenueLibraryPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listEventVenues(), []);
  const [editing, setEditing] = useState<EventVenue | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [capacity, setCapacity] = useState("");
  const [indoorOutdoor, setIndoorOutdoor] = useState("");
  const [parkingAvailable, setParkingAvailable] = useState(false);
  const [accessibilityNotes, setAccessibilityNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Record<string, string>>({});
  const [recBusy, setRecBusy] = useState<string | null>(null);

  async function getRecommendation(id: string) {
    setRecBusy(id);
    try {
      const { recommendation } = await api.venueRecommendation(id);
      setRecommendations((prev) => ({ ...prev, [id]: recommendation }));
    } finally {
      setRecBusy(null);
    }
  }

  function startAdd() {
    setEditing(null); setAdding(true);
    setName(""); setAddress(""); setCapacity(""); setIndoorOutdoor(""); setParkingAvailable(false); setAccessibilityNotes(""); setNotes("");
  }
  function startEdit(v: EventVenue) {
    setEditing(v); setAdding(true);
    setName(v.name); setAddress(v.address || ""); setCapacity(v.capacity != null ? String(v.capacity) : "");
    setIndoorOutdoor(v.indoorOutdoor || ""); setParkingAvailable(!!v.parkingAvailable);
    setAccessibilityNotes(v.accessibilityNotes || ""); setNotes(v.notes || "");
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const payload = {
      name: name.trim(), address: address.trim() || undefined,
      capacity: capacity ? Number(capacity) : undefined,
      indoorOutdoor: indoorOutdoor || undefined, parkingAvailable,
      accessibilityNotes: accessibilityNotes.trim() || undefined, notes: notes.trim() || undefined,
    };
    try {
      if (editing) await api.updateEventVenue(editing.id, payload);
      else await api.createEventVenue(payload);
      setAdding(false); setEditing(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function remove(v: EventVenue) {
    if (!confirm(`Delete "${v.name}" from your venue library?`)) return;
    setBusyId(v.id);
    try { await api.deleteEventVenue(v.id); reload(); } finally { setBusyId(null); }
  }

  return (
    <div className="dash-card" style={{ padding: 16 }}>
      <p className="hint" style={{ margin: "0 0 14px" }}>
        Save your regular venues once — pick them from a dropdown instead of retyping name, address and pin every time you host.
      </p>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}

      {!loading && (data || []).length > 0 && (
        <ul className="steps" style={{ marginBottom: 14 }}>
          {data!.map((v) => (
            <li key={v.id} style={{ flexWrap: "wrap" }}>
              <i className="icon-map-pin" />
              <span>
                {v.name} {v.capacity ? <small style={{ color: "var(--text-3)" }}>· cap {v.capacity}</small> : null}
                {v.address && <><br /><small style={{ color: "var(--text-3)" }}>{v.address}</small></>}
                {recommendations[v.id] && <><br /><small style={{ color: "var(--accent)" }}>{recommendations[v.id]}</small></>}
              </span>
              <button className="copy-btn" onClick={() => getRecommendation(v.id)} disabled={recBusy === v.id} style={{ marginLeft: "auto" }}>
                {recBusy === v.id ? "Thinking…" : "Insights"}
              </button>
              <button className="copy-btn" onClick={() => startEdit(v)}>Edit</button>
              <button className="copy-btn" onClick={() => remove(v)} disabled={busyId === v.id}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {!loading && (data || []).length === 0 && !adding && (
        <p style={{ color: "var(--text-2)", fontSize: 13.5, margin: "0 0 14px" }}>No saved venues yet.</p>
      )}

      {adding ? (
        <>
          <div className="field"><label>Venue name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shatti rooftop" /></div>
          <div className="field"><label>Address / area</label><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Shatti Al Qurum, Muscat" /></div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label>Capacity</label><input inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}>
              <label>Indoor / outdoor</label>
              <select value={indoorOutdoor} onChange={(e) => setIndoorOutdoor(e.target.value)}>
                <option value="">—</option>
                <option value="indoor">Indoor</option>
                <option value="outdoor">Outdoor</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>
          <label className="tier-toggle">
            <input type="checkbox" checked={parkingAvailable} onChange={(e) => setParkingAvailable(e.target.checked)} />
            Parking available
          </label>
          <div className="field"><label>Accessibility notes <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label><input value={accessibilityNotes} onChange={(e) => setAccessibilityNotes(e.target.value)} placeholder="Step-free entry, accessible restroom…" /></div>
          <div className="field"><label>Notes <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional, supplier contacts etc.</span></label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : editing ? "Save changes" : "Add venue"}</button>
            <button className="btn glass" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</button>
          </div>
        </>
      ) : (
        <button className="btn glass" onClick={startAdd}><i className="icon-plus" /> Add a venue</button>
      )}
    </div>
  );
}

// Org-wide staff — invites someone to every currently-active event at once
// (see server/db.js's organizerTeamMembers comment: still real per-event
// EventTeamMember rows underneath, not a new access-control concept, so it
// doesn't reach events created after the invite — flagged below rather than
// silently implied to be fully automatic).
function OrganizerTeamPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listOrganizerTeam(), []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("STAFF");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  async function invite() {
    if (!isValidEmail(email)) return;
    setInviting(true); setInviteMsg("");
    try {
      const res = await api.inviteOrganizerTeam(email.trim(), role);
      setInviteMsg(`Invited to ${res.eventCount} event${res.eventCount === 1 ? "" : "s"}.`);
      setEmail("");
      reload();
    } catch (e: any) {
      setInviteMsg(e.message || "Couldn't send invite");
    } finally {
      setInviting(false);
    }
  }

  async function revoke(memberEmail: string) {
    if (!confirm(`Remove ${memberEmail} from all your events?`)) return;
    setBusyEmail(memberEmail);
    try {
      await api.revokeOrganizerTeam(memberEmail);
      reload();
    } finally {
      setBusyEmail(null);
    }
  }

  return (
    <div className="dash-card" style={{ padding: 16 }}>
      <p className="hint" style={{ margin: "0 0 14px" }}>
        Adds someone to every event you currently have live — new events after that still need their own invite from that event's Team tab.
      </p>
      <div className="field"><label>Invite by email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@email.com" /></div>
      <div className="field">
        <label>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
          <option value="STAFF">Staff (check-in only)</option>
          <option value="MANAGER">Manager (full access)</option>
        </select>
      </div>
      {inviteMsg && <p className="hint" style={{ color: "var(--accent)" }}>{inviteMsg}</p>}
      <button className="btn" onClick={invite} disabled={inviting || !isValidEmail(email)}>{inviting ? "Inviting…" : "Invite to all events"}</button>

      <p className="hint" style={{ margin: "18px 0 8px" }}>Team members</p>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !error && (
        (data || []).length > 0 ? (
          <ul className="steps">
            {data!.map((m) => (
              <li key={m.email}>
                <i className={m.role === "MANAGER" ? "icon-shield" : "icon-scan"} />
                <span>
                  {m.name || m.email} <small style={{ color: "var(--text-3)" }}>· {m.role === "MANAGER" ? "Manager" : "Staff"} · {m.eventCount} event{m.eventCount === 1 ? "" : "s"}{m.hasPending ? " · invite pending" : ""}</small>
                </span>
                <button className="copy-btn" onClick={() => revoke(m.email)} disabled={busyEmail === m.email} style={{ marginLeft: "auto" }}>Remove</button>
              </li>
            ))}
          </ul>
        ) : <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No team members yet.</p>
      )}
    </div>
  );
}

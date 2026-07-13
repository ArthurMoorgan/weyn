import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Weyn, type MarketingLink, type ReferralCode, type MarketingCalendarItem, type BrandKit, type AdVariant } from "../../api";
import { useAsync } from "../../hooks";
import FeatureLock from "../../components/FeatureLock";

// Marketing Hub: a real top-level section (not folded into a single event's
// workspace) for the marketing tools that are either cross-event by nature
// (the calendar) or per-event but want a dedicated, roomier UI than the
// per-event Marketing tab's card list (ad copy, UTM links, referrals) —
// same reasoning Workflows.tsx gives for being its own destination. The
// per-event Marketing tab (EventWorkspace.tsx) still exists for the
// Instagram/WhatsApp/Telegram/Twitter copy + promo codes + waitlist; this
// hub is additive, not a replacement.
const SECTIONS = [
  { key: "ads", label: "Ad copy & outreach", icon: "megaphone" },
  { key: "links", label: "UTM links", icon: "link" },
  { key: "referrals", label: "Referral program", icon: "users" },
  { key: "calendar", label: "Posting calendar", icon: "calendar" },
  { key: "brand", label: "Brand kit", icon: "palette" },
] as const;
type SectionKey = typeof SECTIONS[number]["key"];

export default function MarketingHub() {
  const [section, setSection] = useState<SectionKey>("ads");
  const events = useAsync(() => api.dashboardEvents(), []);
  const sub = useAsync(() => api.mySubscription(), []);
  const features = sub.data?.features || {};

  return (
    <>
      <p className="hint" style={{ margin: "4px 0 8px" }}><i className="icon-megaphone" /> Marketing Hub</p>
      <p className="hint" style={{ margin: "0 0 14px", color: "var(--text-3)" }}>
        Every marketing tool across your events, in one place — ad copy, trackable links, a simple referral program, and a cross-event posting calendar.
      </p>

      <div className="profile-tabs" style={{ marginBottom: 14 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={"profile-tab" + (section === s.key ? " on" : "")}
            onClick={() => setSection(s.key)}
          >
            <i className={"icon-" + s.icon} /> {s.label}
          </button>
        ))}
      </div>

      {section === "ads" && <AdCopySection events={events.data || []} loading={events.loading} enabled={!!features.adCopyGeneration} />}
      {section === "links" && <UtmLinksSection events={events.data || []} loading={events.loading} enabled={!!features.utmLinkBuilder} />}
      {section === "referrals" && <ReferralsSection events={events.data || []} loading={events.loading} enabled={!!features.referralPrograms} />}
      {section === "calendar" && <CalendarSection enabled={!!features.marketingCalendar} />}
      {section === "brand" && <BrandKitSection enabled={!!features.brandKit} />}
    </>
  );
}

/* ---------- shared: per-event picker used by ad copy/links/referrals ---------- */
function EventSelect({ events, value, onChange }: { events: Weyn[]; value: string; onChange: (id: string) => void }) {
  if (!events.length) {
    return (
      <div className="empty" style={{ padding: "24px 0" }}>
        <p>No events yet.</p>
        <Link to="/host/events" className="btn glass" style={{ maxWidth: 220, margin: "8px auto 0" }}>Host an event</Link>
      </div>
    );
  }
  return (
    <select className="toolbar-field" style={{ marginBottom: 14, width: "100%" }} value={value} onChange={(e) => onChange(e.target.value)}>
      {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
    </select>
  );
}

/* ---------- Ad copy & outreach ---------- */
function AdCopySection({ events, loading, enabled }: { events: Weyn[]; loading: boolean; enabled: boolean }) {
  const [eventId, setEventId] = useState("");
  const activeId = eventId || events[0]?.id || "";
  const { data, error, reload } = useAsync(() => (activeId ? api.getMarketing(activeId) : Promise.resolve(null)), [activeId]);
  const [regenerating, setRegenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500); });
  }
  async function regenerate() {
    if (!activeId) return;
    setRegenerating(true);
    try { await api.regenerateMarketing(activeId); reload(); } finally { setRegenerating(false); }
  }

  if (loading) return <p className="hint">Loading…</p>;

  return (
    <FeatureLock feature="adCopyGeneration" enabled={enabled}>
      <EventSelect events={events} value={activeId} onChange={setEventId} />
      {error && <p className="errline">{error}</p>}
      {data && (
        <>
          <p className="hint" style={{ margin: "0 0 12px" }}>
            {data.aiGenerated ? "Generated with AI." : "Generated from your event details."} Google/Meta ad variants respect each platform's character limits — copy straight into Ads Manager.
          </p>

          <p className="section-label">Google Ads (Search)</p>
          {(data.googleAdVariants || []).map((v: AdVariant, i: number) => (
            <AdVariantCard key={`g-${i}`} variant={v} keyId={`g-${i}`} copy={copy} copiedKey={copiedKey} limits="30 / 90 chars" />
          ))}

          <p className="section-label">Meta Ads (Facebook / Instagram)</p>
          {(data.metaAdVariants || []).map((v: AdVariant, i: number) => (
            <AdVariantCard key={`m-${i}`} variant={v} keyId={`m-${i}`} copy={copy} copiedKey={copiedKey} limits="40 / 125 chars" />
          ))}

          <p className="section-label">Press release</p>
          <div className="marketing-card">
            <div className="marketing-card-head">
              <i className="icon-newspaper" /> <b>Announcement</b>
              <button className="copy-btn" onClick={() => copy("press", data.pressRelease || "")}>
                <i className={copiedKey === "press" ? "icon-check" : "icon-copy"} /> {copiedKey === "press" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="marketing-text">{data.pressRelease}</pre>
          </div>

          <p className="section-label">Influencer / partner outreach</p>
          <div className="marketing-card">
            <div className="marketing-card-head">
              <i className="icon-send" /> <b>Direct message</b>
              <button className="copy-btn" onClick={() => copy("dm", data.influencerDm || "")}>
                <i className={copiedKey === "dm" ? "icon-check" : "icon-copy"} /> {copiedKey === "dm" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="marketing-text">{data.influencerDm}</pre>
          </div>

          <button className="btn glass" onClick={regenerate} disabled={regenerating} style={{ marginTop: 4 }}>
            <i className="icon-refresh-cw" /> {regenerating ? "Regenerating…" : "Regenerate all"}
          </button>
        </>
      )}
    </FeatureLock>
  );
}

function AdVariantCard({ variant, keyId, copy, copiedKey, limits }: { variant: AdVariant; keyId: string; copy: (k: string, t: string) => void; copiedKey: string | null; limits: string }) {
  const text = `${variant.headline}\n${variant.description}`;
  return (
    <div className="marketing-card">
      <div className="marketing-card-head">
        <i className="icon-megaphone" /> <b>{variant.headline}</b>
        <span className="hint" style={{ marginLeft: 6 }}>{limits}</span>
        <button className="copy-btn" onClick={() => copy(keyId, text)}>
          <i className={copiedKey === keyId ? "icon-check" : "icon-copy"} /> {copiedKey === keyId ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="marketing-text">{variant.description}</pre>
    </div>
  );
}

/* ---------- UTM link builder ---------- */
function UtmLinksSection({ events, loading, enabled }: { events: Weyn[]; loading: boolean; enabled: boolean }) {
  const [eventId, setEventId] = useState("");
  const activeId = eventId || events[0]?.id || "";
  const { data: links, loading: linksLoading, reload } = useAsync(() => (activeId ? api.listMarketingLinks(activeId) : Promise.resolve([])), [activeId]);
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function create() {
    if (!activeId || !label.trim() || !source.trim() || !medium.trim() || !campaign.trim()) return;
    setSaving(true); setErr("");
    try {
      await api.createMarketingLink(activeId, { label: label.trim(), utmSource: source.trim(), utmMedium: medium.trim(), utmCampaign: campaign.trim() });
      setLabel(""); setSource(""); setMedium(""); setCampaign("");
      reload();
    } catch (e: any) {
      setErr(e.message || "Couldn't create link");
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (!activeId) return;
    await api.deleteMarketingLink(activeId, id);
    reload();
  }
  function copy(id: string, url: string) {
    navigator.clipboard?.writeText(url).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); });
  }

  if (loading) return <p className="hint">Loading…</p>;

  return (
    <FeatureLock feature="utmLinkBuilder" enabled={enabled}>
      <EventSelect events={events} value={activeId} onChange={setEventId} />

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>New trackable link</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div className="field" style={{ margin: 0 }}><label>Label</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Instagram bio link" /></div>
          <div className="field" style={{ margin: 0 }}><label>Source</label><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="instagram" /></div>
          <div className="field" style={{ margin: 0 }}><label>Medium</label><input value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="social" /></div>
          <div className="field" style={{ margin: 0 }}><label>Campaign</label><input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="launch" /></div>
        </div>
        {err && <p className="errline">{err}</p>}
        <button className="btn glass sm" style={{ width: "auto" }} onClick={create} disabled={saving || !activeId}>
          <i className="icon-plus" /> {saving ? "Creating…" : "Create link"}
        </button>
      </div>

      {linksLoading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !links?.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No links yet — create one above.</p>
      ) : (
        <ul className="steps">
          {(links as MarketingLink[]).map((l) => (
            <li key={l.id}>
              <i className="icon-link" />
              <span>
                <b>{l.label}</b> <span className="hint">{l.clicks} click{l.clicks === 1 ? "" : "s"}</span>
                <br />
                <small style={{ color: "var(--text-3)", wordBreak: "break-all" }}>{l.url}</small>
              </span>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button className="copy-btn" onClick={() => copy(l.id, l.url)}>
                  <i className={copiedId === l.id ? "icon-check" : "icon-copy"} /> {copiedId === l.id ? "Copied" : "Copy"}
                </button>
                <button className="btn glass sm" onClick={() => remove(l.id)}><i className="icon-x" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </FeatureLock>
  );
}

/* ---------- Referral program ---------- */
function ReferralsSection({ events, loading, enabled }: { events: Weyn[]; loading: boolean; enabled: boolean }) {
  const [eventId, setEventId] = useState("");
  const activeId = eventId || events[0]?.id || "";
  const { data: codes, loading: codesLoading, reload } = useAsync(() => (activeId ? api.referralLeaderboard(activeId) : Promise.resolve([])), [activeId]);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function create() {
    if (!activeId) return;
    setSaving(true);
    try {
      await api.createReferralCode(activeId, { ownerName: ownerName.trim() || undefined, ownerEmail: ownerEmail.trim() || undefined });
      setOwnerName(""); setOwnerEmail("");
      reload();
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (!activeId) return;
    await api.deleteReferralCode(activeId, id);
    reload();
  }
  function referralUrl(code: string) {
    return `${window.location.origin}/e/${activeId}?ref=${code}`;
  }
  function copy(id: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); });
  }

  if (loading) return <p className="hint">Loading…</p>;

  return (
    <FeatureLock feature="referralPrograms" enabled={enabled}>
      <EventSelect events={events} value={activeId} onChange={setEventId} />
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-3)" }}>
        Give attendees a shareable code — referred bookings tally up here for a leaderboard. No automatic payout; if you want to reward top referrers, that's on you to arrange.
      </p>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>New referral code</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div className="field" style={{ margin: 0 }}><label>Name (optional)</label><input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>Email (optional)</label><input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} /></div>
        </div>
        <button className="btn glass sm" style={{ width: "auto" }} onClick={create} disabled={saving || !activeId}>
          <i className="icon-plus" /> {saving ? "Creating…" : "Create code"}
        </button>
      </div>

      {codesLoading ? (
        <div className="list-row-skel"><div className="s-ic" /><div className="s-txt" /></div>
      ) : !codes?.length ? (
        <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>No referral codes yet — create one above.</p>
      ) : (
        <ul className="steps">
          {(codes as ReferralCode[]).map((c, i) => (
            <li key={c.id}>
              <i className="icon-users" />
              <span>
                <b>#{i + 1} {c.ownerName || c.code}</b> <span className="ec-badge confirmed">{c.referralCount} referral{c.referralCount === 1 ? "" : "s"}</span>
                <br />
                <small style={{ color: "var(--text-3)", wordBreak: "break-all" }}>{referralUrl(c.code)}</small>
              </span>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button className="copy-btn" onClick={() => copy(c.id, referralUrl(c.code))}>
                  <i className={copiedId === c.id ? "icon-check" : "icon-copy"} /> {copiedId === c.id ? "Copied" : "Copy"}
                </button>
                <button className="btn glass sm" onClick={() => remove(c.id)}><i className="icon-x" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </FeatureLock>
  );
}

/* ---------- Cross-event marketing calendar ---------- */
function CalendarSection({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useAsync(() => api.marketingCalendar(), []);
  const items = (data as MarketingCalendarItem[] | undefined) || [];

  return (
    <FeatureLock feature="marketingCalendar" enabled={enabled}>
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-3)" }}>
        Every upcoming T-7/T-3/T-1/day-of posting date across all your events, in one timeline — open an event's own Marketing tab to get the actual copy for a date.
      </p>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="errline">{error}</p>}
      {!loading && !items.length && <p style={{ color: "var(--text-2)", fontSize: 13.5 }}>Nothing scheduled yet.</p>}
      {!!items.length && (
        <ul className="steps">
          {items.map((it, i) => {
            const date = it.date ? new Date(it.date) : null;
            const past = date ? date.getTime() < Date.now() : false;
            return (
              <li key={i} style={{ opacity: past ? 0.5 : 1 }}>
                <i className="icon-calendar" />
                <span>
                  <Link to={`/organizer/events/${it.eventId}/marketing`}><b>{it.eventTitle}</b></Link>
                  {" — "}{it.label}
                  <br />
                  <small style={{ color: "var(--text-3)" }}>
                    {date ? date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Muscat" }) : "—"}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </FeatureLock>
  );
}

/* ---------- Brand kit ---------- */
function BrandKitSection({ enabled }: { enabled: boolean }) {
  const { data, loading, reload } = useAsync(() => api.getBrandKit(), []);
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  if (!loading && data && !hydrated) {
    setLogoUrl(data.logoUrl || "");
    setPrimaryColor(data.primaryColor || "");
    setToneOfVoice(data.toneOfVoice || "");
    setHydrated(true);
  }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await api.setBrandKit({ logoUrl: logoUrl.trim() || null, primaryColor: primaryColor.trim() || null, toneOfVoice: toneOfVoice.trim() || null });
      setSaved(true);
      reload();
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FeatureLock feature="brandKit" enabled={enabled}>
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-3)" }}>
        Set your look and tone once — every AI-generated marketing copy (captions, ads, press releases) will follow it.
      </p>
      {loading ? (
        <p className="hint">Loading…</p>
      ) : (
        <div className="dash-card" style={{ padding: 14 }}>
          <div className="field"><label>Logo URL</label><input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" /></div>
          <div className="field"><label>Primary color</label><input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#7C3AED" /></div>
          <div className="field"><label>Tone of voice</label><input value={toneOfVoice} onChange={(e) => setToneOfVoice(e.target.value)} placeholder="e.g. playful and casual" /></div>
          <button className="btn glass" onClick={save} disabled={saving} style={{ marginTop: 4 }}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save brand kit"}
          </button>
        </div>
      )}
    </FeatureLock>
  );
}

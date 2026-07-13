import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Weyn, type MarketingLink, type ReferralCode, type MarketingCalendarItem, type BrandKit, type AdVariant, type SocialAccountConnection, type SocialPost, type MarketingContact, type GrowthIdea, type FreeToolIdea, type PersuasionAngle } from "../../api";
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
  { key: "accounts", label: "Connected accounts", icon: "instagram" },
  { key: "email", label: "Email list", icon: "mail" },
  { key: "growth", label: "Growth ideas", icon: "trending-up" },
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
      {section === "accounts" && <ConnectedAccountsSection events={events.data || []} loading={events.loading} enabled={!!features.socialAutoPosting} />}
      {section === "email" && <EmailListSection events={events.data || []} loading={events.loading} enabled={!!features.emailCampaigns} />}
      {section === "growth" && <GrowthIdeasSection events={events.data || []} loading={events.loading} />}
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

  // Psychology-informed copy variants — a toggle next to the existing ad
  // copy, not a new page (per spec).
  const [angle, setAngle] = useState<PersuasionAngle>("scarcity");
  const [angling, setAngling] = useState(false);
  const [angledResult, setAngledResult] = useState<{ instagram?: string; whatsapp?: string; metaAdVariants?: AdVariant[] } | null>(null);

  // Bulk ad creative — "generate more variants" for A/B testing at scale.
  const [bulkPlatform, setBulkPlatform] = useState<"google" | "meta">("meta");
  const [bulkCount, setBulkCount] = useState(6);
  const [bulkVariants, setBulkVariants] = useState<AdVariant[] | null>(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);

  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500); });
  }
  async function regenerate() {
    if (!activeId) return;
    setRegenerating(true);
    try { await api.regenerateMarketing(activeId); reload(); } finally { setRegenerating(false); }
  }
  async function applyAngle() {
    if (!activeId) return;
    setAngling(true);
    try { setAngledResult(await api.angledCopy(activeId, angle)); } finally { setAngling(false); }
  }
  async function generateMoreVariants() {
    if (!activeId) return;
    setBulkGenerating(true);
    try {
      const res = await api.bulkAdVariants(activeId, { platform: bulkPlatform, count: bulkCount });
      setBulkVariants(res.variants);
    } finally {
      setBulkGenerating(false);
    }
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

          <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
            <p className="hint" style={{ margin: "0 0 10px" }}>Generate more variants (bulk A/B testing)</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select className="toolbar-field" value={bulkPlatform} onChange={(e) => setBulkPlatform(e.target.value as "google" | "meta")}>
                <option value="meta">Meta (Facebook/Instagram)</option>
                <option value="google">Google Search</option>
              </select>
              <input type="number" min={1} max={10} className="toolbar-field" style={{ width: 70 }} value={bulkCount} onChange={(e) => setBulkCount(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
              <button className="btn glass sm" style={{ width: "auto" }} onClick={generateMoreVariants} disabled={bulkGenerating || !activeId}>
                <i className="icon-refresh-cw" /> {bulkGenerating ? "Generating…" : "Generate more variants"}
              </button>
            </div>
            {bulkVariants && bulkVariants.map((v, i) => (
              <AdVariantCard key={`bulk-${i}`} variant={v} keyId={`bulk-${i}`} copy={copy} copiedKey={copiedKey} limits={bulkPlatform === "google" ? "30 / 90 chars" : "40 / 125 chars"} />
            ))}
          </div>

          <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
            <p className="hint" style={{ margin: "0 0 10px" }}>Psychology-informed copy variants</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select className="toolbar-field" value={angle} onChange={(e) => setAngle(e.target.value as PersuasionAngle)}>
                <option value="scarcity">Scarcity</option>
                <option value="social_proof">Social proof</option>
                <option value="urgency">Urgency / FOMO</option>
                <option value="exclusivity">Exclusivity</option>
              </select>
              <button className="btn glass sm" style={{ width: "auto" }} onClick={applyAngle} disabled={angling || !activeId}>
                <i className="icon-zap" /> {angling ? "Re-angling…" : "Re-angle copy"}
              </button>
            </div>
            {angledResult && (
              <>
                {angledResult.instagram && (
                  <div className="marketing-card" style={{ marginTop: 10 }}>
                    <div className="marketing-card-head"><i className="icon-instagram" /> <b>Instagram ({angle.replace("_", " ")})</b>
                      <button className="copy-btn" onClick={() => copy("angle-ig", angledResult.instagram || "")}><i className={copiedKey === "angle-ig" ? "icon-check" : "icon-copy"} /> {copiedKey === "angle-ig" ? "Copied" : "Copy"}</button>
                    </div>
                    <pre className="marketing-text">{angledResult.instagram}</pre>
                  </div>
                )}
                {(angledResult.metaAdVariants || []).map((v, i) => (
                  <AdVariantCard key={`angle-${i}`} variant={v} keyId={`angle-${i}`} copy={copy} copiedKey={copiedKey} limits="40 / 125 chars" />
                ))}
              </>
            )}
          </div>

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

/* ---------- Connected accounts (Meta OAuth) + real Instagram posting ---------- */
function ConnectedAccountsSection({ events, loading, enabled }: { events: Weyn[]; loading: boolean; enabled: boolean }) {
  const { data: accounts, loading: acctLoading, reload } = useAsync(() => api.listSocialAccounts(), []);
  const meta = (accounts as SocialAccountConnection[] | undefined)?.find((a) => a.provider === "meta");

  const [eventId, setEventId] = useState("");
  const activeId = eventId || events[0]?.id || "";
  const { data: marketing } = useAsync(() => (activeId ? api.getMarketing(activeId) : Promise.resolve(null)), [activeId]);
  const { data: posts, reload: reloadPosts } = useAsync(() => (activeId ? api.listSocialPosts(activeId) : Promise.resolve([])), [activeId]);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [postErr, setPostErr] = useState("");

  if (!loading && marketing && caption === "" && marketing.instagram) {
    // hydrate the caption box once from the existing AI-drafted copy so
    // there's something sensible to post without retyping it
    setCaption(marketing.instagram);
  }

  async function disconnect(id: string) {
    if (!confirm("Disconnect this account? You'll need to reconnect to post again.")) return;
    await api.disconnectSocialAccount(id);
    reload();
  }
  async function post(confirmRepost?: boolean) {
    if (!activeId || !caption.trim()) return;
    setPosting(true); setPostErr("");
    try {
      await api.postToInstagram(activeId, { caption: caption.trim(), confirmRepost });
      reloadPosts();
    } catch (e: any) {
      if (e?.error?.code === "ALREADY_POSTED" || e?.code === "ALREADY_POSTED") {
        if (confirm("This event was already posted to Instagram. Post again anyway?")) return post(true);
      } else {
        setPostErr(e.message || "Couldn't post");
      }
    } finally {
      setPosting(false);
    }
  }

  if (loading || acctLoading) return <p className="hint">Loading…</p>;

  return (
    <FeatureLock feature="socialAutoPosting" enabled={enabled}>
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-3)" }}>
        Connect your Instagram/Facebook so Weyn can actually publish your event copy for you — not just hand you text to paste.
      </p>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        {meta ? (
          <>
            <p className="hint" style={{ margin: "0 0 8px" }}>
              <i className="icon-instagram" /> Connected — posting via <b>{meta.pageName || "your Facebook Page"}</b>
            </p>
            <button className="btn glass sm" style={{ width: "auto" }} onClick={() => disconnect(meta.id)}>
              <i className="icon-x" /> Disconnect
            </button>
          </>
        ) : (
          <>
            <p className="hint" style={{ margin: "0 0 10px" }}>Not connected yet.</p>
            <a className="btn glass sm" style={{ width: "auto" }} href={api.connectMetaUrl()}>
              <i className="icon-instagram" /> Connect Instagram / Facebook
            </a>
            <p className="hint" style={{ marginTop: 10, color: "var(--text-3)" }}>
              Requires this Weyn deployment to have Meta app credentials configured — if the button leads to an error, this isn't turned on here yet.
            </p>
          </>
        )}
      </div>

      <EventSelect events={events} value={activeId} onChange={setEventId} />

      {meta && activeId && (
        <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
          <p className="hint" style={{ margin: "0 0 10px" }}>Post to Instagram</p>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} style={{ width: "100%", marginBottom: 10 }} placeholder="Caption…" />
          {postErr && <p className="errline">{postErr}</p>}
          <button className="btn glass sm" style={{ width: "auto" }} onClick={() => post()} disabled={posting || !caption.trim()}>
            <i className="icon-send" /> {posting ? "Posting…" : "Post now"}
          </button>
        </div>
      )}

      {activeId && !!(posts as SocialPost[] | undefined)?.length && (
        <>
          <p className="section-label">Post history</p>
          <ul className="steps">
            {(posts as SocialPost[]).map((p) => (
              <li key={p.id}>
                <i className={p.status === "posted" ? "icon-check" : "icon-x"} />
                <span>
                  <b>{p.provider}</b> — {p.status} <span className="hint">{new Date(p.postedAt).toLocaleString()}</span>
                  {p.error && <><br /><small style={{ color: "var(--text-3)" }}>{p.error}</small></>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </FeatureLock>
  );
}

/* ---------- Email list: real subscriber list + campaign send ---------- */
function EmailListSection({ events, loading, enabled }: { events: Weyn[]; loading: boolean; enabled: boolean }) {
  const { data: contacts, loading: contactsLoading, reload } = useAsync(() => api.listMarketingContacts(), []);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [saving, setSaving] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  const [eventId, setEventId] = useState("");
  const activeId = eventId || events[0]?.id || "";
  const { data: marketing } = useAsync(() => (activeId ? api.getMarketing(activeId) : Promise.resolve(null)), [activeId]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ recipients: number; sent: number } | null>(null);

  if (!loading && marketing && subject === "" && body === "" && marketing.whatsapp) {
    setSubject(`You're invited: an event you might like`);
    setBody(marketing.whatsapp);
  }

  const subscribedCount = (contacts as MarketingContact[] | undefined)?.filter((c) => c.subscribed).length ?? 0;

  async function addContact() {
    if (!email.trim()) return;
    setSaving(true);
    try { await api.addMarketingContact({ email: email.trim(), name: name.trim() || undefined }); setEmail(""); setName(""); reload(); } finally { setSaving(false); }
  }
  async function importCsv() {
    if (!csv.trim()) return;
    setSaving(true); setImportMsg("");
    try {
      const res = await api.importMarketingContacts(csv);
      setImportMsg(`Imported ${res.imported} of ${res.total} (${res.skipped} skipped)`);
      setCsv("");
      reload();
    } finally {
      setSaving(false);
    }
  }
  async function removeContact(id: string) {
    await api.deleteMarketingContact(id);
    reload();
  }
  async function send() {
    if (!activeId || !subject.trim() || !body.trim()) return;
    setSending(true); setSendResult(null);
    try {
      const res = await api.sendEmailCampaign(activeId, { subject: subject.trim(), body: body.trim() });
      setSendResult({ recipients: res.recipients, sent: res.sent });
    } finally {
      setSending(false);
    }
  }

  return (
    <FeatureLock feature="emailCampaigns" enabled={enabled}>
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-3)" }}>
        A real, separately-consented subscriber list — distinct from ticket buyers — with a genuine one-click unsubscribe on every send.
      </p>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>Add a subscriber</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div className="field" style={{ margin: 0 }}><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></div>
          <div className="field" style={{ margin: 0 }}><label>Name (optional)</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <button className="btn glass sm" style={{ width: "auto" }} onClick={addContact} disabled={saving || !email.trim()}>
          <i className="icon-plus" /> Add
        </button>
      </div>

      <div className="dash-card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="hint" style={{ margin: "0 0 10px" }}>Import CSV (email,name per line)</p>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} style={{ width: "100%", marginBottom: 10 }} placeholder={"email,name\njane@example.com,Jane"} />
        {importMsg && <p className="hint">{importMsg}</p>}
        <button className="btn glass sm" style={{ width: "auto" }} onClick={importCsv} disabled={saving || !csv.trim()}>
          <i className="icon-upload" /> Import
        </button>
      </div>

      {contactsLoading ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          <p className="hint" style={{ margin: "0 0 8px" }}>{subscribedCount} subscribed contact{subscribedCount === 1 ? "" : "s"}</p>
          <ul className="steps">
            {((contacts as MarketingContact[] | undefined) || []).map((c) => (
              <li key={c.id} style={{ opacity: c.subscribed ? 1 : 0.5 }}>
                <i className="icon-mail" />
                <span><b>{c.email}</b> {c.name && <span className="hint">{c.name}</span>} {!c.subscribed && <span className="hint">(unsubscribed)</span>}</span>
                <button className="btn glass sm" style={{ marginLeft: "auto", width: "auto" }} onClick={() => removeContact(c.id)}><i className="icon-x" /></button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="section-label">Send a campaign</p>
      <EventSelect events={events} value={activeId} onChange={setEventId} />
      <div className="dash-card" style={{ padding: 14 }}>
        <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label>Body</label><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} style={{ width: "100%" }} /></div>
        {sendResult && <p className="hint">Sent to {sendResult.sent} of {sendResult.recipients} recipients.</p>}
        <button className="btn glass" onClick={send} disabled={sending || !activeId || !subject.trim() || !body.trim()} style={{ marginTop: 4 }}>
          <i className="icon-send" /> {sending ? "Sending…" : `Send to ${subscribedCount} subscriber${subscribedCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </FeatureLock>
  );
}

/* ---------- Growth ideas: tactical suggestions + free-tool/lead-magnet concepts ---------- */
function GrowthIdeasSection({ events, loading }: { events: Weyn[]; loading: boolean }) {
  const [eventId, setEventId] = useState("");
  const activeId = eventId || events[0]?.id || "";
  const { data: growth, loading: growthLoading, reload: reloadGrowth } = useAsync(() => (activeId ? api.growthIdeas(activeId) : Promise.resolve(null)), [activeId]);
  const { data: freeTool, loading: freeToolLoading, reload: reloadFreeTool } = useAsync(() => (activeId ? api.freeToolIdeas(activeId) : Promise.resolve(null)), [activeId]);

  if (loading) return <p className="hint">Loading…</p>;

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px", color: "var(--text-3)" }}>
        Concrete, tactical ideas for this specific event — not generic "post on social media" advice.
      </p>
      <EventSelect events={events} value={activeId} onChange={setEventId} />

      <p className="section-label">Growth ideas <button className="copy-btn" onClick={reloadGrowth}><i className="icon-refresh-cw" /> Regenerate</button></p>
      {growthLoading ? <p className="hint">Loading…</p> : (
        <ul className="steps">
          {(growth?.ideas || []).map((idea, i) => (
            <li key={i}>
              <i className="icon-trending-up" />
              <span><b>{idea.title}</b><br /><small style={{ color: "var(--text-3)" }}>{idea.description}</small></span>
            </li>
          ))}
        </ul>
      )}

      <p className="section-label">Free tool / lead magnet ideas <button className="copy-btn" onClick={reloadFreeTool}><i className="icon-refresh-cw" /> Regenerate</button></p>
      {freeToolLoading ? <p className="hint">Loading…</p> : (
        <ul className="steps">
          {(freeTool?.ideas || []).map((idea, i) => (
            <li key={i}>
              <i className="icon-gift" />
              <span><b>{idea.name}</b><br /><small style={{ color: "var(--text-3)" }}>{idea.description}</small><br /><small style={{ color: "var(--text-3)" }}>Why: {idea.why}</small></span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, CATS, type Cat, type TicketingType } from "../api";
import { getOrganizer, setOrganizer, useAccount } from "../store";
import MapPicker from "../components/MapPicker";
import ThemeToggle from "../components/ThemeToggle";
import AccountWidget from "../components/AccountWidget";

// default datetime-local value = ~3h from now, rounded
function defaultWhen() {
  const d = new Date(Date.now() + 3 * 3600e3);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TICKETING_OPTIONS: { key: TicketingType; label: string; icon: string; hint: string; disabled?: boolean }[] = [
  // Weyn Ticketing is disabled for now — card payments aren't live yet, so we
  // don't let anyone list an event as Weyn-ticketed (also enforced server-side
  // in POST /api/events). Re-enable by removing `disabled` once PayTabs is set up.
  { key: "weyn", label: "Weyn Ticketing", icon: "ticket", hint: "Coming soon — we'll track capacity, sales, and payments for you", disabled: true },
  { key: "external", label: "External Ticket Link", icon: "external-link", hint: "Send people to your own ticketing site" },
  { key: "cash", label: "Cash at the Door", icon: "banknote", hint: "No pre-booking — just show up and pay" },
  { key: "registration", label: "Registration Form", icon: "clipboard-list", hint: "Send people to a signup/registration link" },
];

export default function Organizer() {
  const nav = useNavigate();
  const account = useAccount();
  const fileRef = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<{ file: File; url: string } | null>(null);
  const [loc, setLoc] = useState<{ lat: number; lng: number }>({ lat: 23.61, lng: 58.54 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(false);

  // Feature 1: Import from Instagram
  const [igOpen, setIgOpen] = useState(false);
  const [igUrl, setIgUrl] = useState("");
  const [igCaption, setIgCaption] = useState("");
  const [igNeedsCaption, setIgNeedsCaption] = useState(false);
  const [igBusy, setIgBusy] = useState(false);
  const [igErr, setIgErr] = useState("");
  const [importedImagePath, setImportedImagePath] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [importedFromInstagram, setImportedFromInstagram] = useState(false);

  const [f, setF] = useState({
    title: "", organizer: getOrganizer() === "You" ? "" : getOrganizer(),
    cat: "music" as Cat, when: defaultWhen(),
    venue: "", area: "Muscat", price: "5", capacity: "60",
    minAge: "0", tags: "", refundPolicy: "Refund up to 48h before", blurb: "",
    ticketingType: "cash" as TicketingType, externalTicketUrl: "", organizerContact: "",
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });

  // multiple ticket tiers (weyn ticketing only)
  const [useTiers, setUseTiers] = useState(false);
  const [tiers, setTiers] = useState([{ name: "General", price: "5", capacity: "50" }]);
  const setTier = (i: number, k: "name" | "price" | "capacity") => (e: any) =>
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: e.target.value } : t)));
  const addTier = () => setTiers((ts) => [...ts, { name: "", price: "", capacity: "" }]);
  const removeTier = (i: number) => setTiers((ts) => ts.filter((_, j) => j !== i));

  function pickImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("That file isn't an image."); return; }
    if (file.size > 6 * 1024 * 1024) { setErr("Image must be under 6 MB."); return; }
    setErr("");
    setImportedImagePath(null);
    setImg({ file, url: URL.createObjectURL(file) });
  }

  async function runInstagramImport(e: React.FormEvent) {
    e.preventDefault();
    setIgBusy(true); setIgErr("");
    try {
      const result = await api.importInstagram(igNeedsCaption ? { caption: igCaption } : { url: igUrl });
      setF((s) => ({
        ...s,
        title: result.title || s.title,
        blurb: result.blurb || s.blurb,
        tags: result.tags?.join(", ") || s.tags,
      }));
      if (result.imagePath) {
        setImportedImagePath(result.imagePath);
        setImg(null);
      }
      setSourceUrl(result.sourceUrl);
      setImportedFromInstagram(true);
      setIgNeedsCaption(false);
      setIgOpen(false);
    } catch (e: any) {
      if (e.needsCaption || /paste the caption/i.test(e.message || "")) {
        setIgNeedsCaption(true);
        setIgErr(e.message);
      } else {
        setIgErr(e.message || "Couldn't import that post");
      }
    } finally {
      setIgBusy(false);
    }
  }

  async function publish() {
    if (!img && !importedImagePath) { setErr("Add a cover photo — it's what people see first."); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (!f.title.trim() || !f.venue.trim()) { setErr("Please add at least a title and a venue."); return; }
    if ((f.ticketingType === "external" || f.ticketingType === "registration") && !f.externalTicketUrl.trim()) {
      setErr("Add the link where people get tickets/register."); return;
    }
    const tierPayload = f.ticketingType === "weyn" && useTiers
      ? tiers.map((t) => ({ name: t.name.trim(), price: Number(t.price) || 0, capacity: Number(t.capacity) || 0 }))
             .filter((t) => t.name)
      : null;
    if (f.ticketingType === "weyn" && useTiers && (!tierPayload || tierPayload.length === 0 || tierPayload.some((t) => t.capacity < 1))) {
      setErr("Give each ticket type a name and a capacity of at least 1."); return;
    }
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      const startsAt = f.when ? new Date(f.when).toISOString() : new Date(Date.now() + 3 * 3600e3).toISOString();
      Object.entries({
        title: f.title, organizer: f.organizer || "You", cat: f.cat, startsAt,
        venue: f.venue, area: f.area, lat: loc.lat, lng: loc.lng,
        price: f.price, capacity: f.capacity,
        minAge: f.minAge, tags: f.tags, refundPolicy: f.refundPolicy, blurb: f.blurb,
        ticketingType: f.ticketingType, externalTicketUrl: f.externalTicketUrl, organizerContact: f.organizerContact,
        sourceUrl: sourceUrl || "", importedFromInstagram: String(importedFromInstagram),
      }).forEach(([k, v]) => fd.append(k, String(v)));
      if (tierPayload) fd.append("tiers", JSON.stringify(tierPayload));
      if (img) fd.append("image", img.file);
      else if (importedImagePath) fd.append("existingImage", importedImagePath);

      const created = await api.createEvent(fd);
      setOrganizer(created.organizer);
      setToast(true);
      setTimeout(() => nav("/you"), 1100);
    } catch (e: any) {
      setErr(e.message || "Couldn't publish");
      setBusy(false);
    }
  }

  const price = Number(f.price) || 0;
  const fee = (price * 0.08).toFixed(2);
  const keep = price > 0 ? (price - Number(fee)).toFixed(2) : "0.00";
  const coverUrl = img?.url || (importedImagePath ? importedImagePath : null);

  // Publishing an event now requires a real, verified identity — this is
  // what the backend's ownership checks (server/auth.js) are actually keyed
  // to, not just a typed display name. Signing in also becomes the identity
  // that can later edit/cancel this exact event.
  if (!account) {
    return (
      <>
        <header className="topbar">
          <div className="brand"><span className="en">Host an event</span></div>
          <div className="tb-right"><ThemeToggle /></div>
        </header>
        <div className="page-head">
          <h1>Everything you need to run an event</h1>
          <p className="sub">Free to publish. Weyn handles the page, the guest list, and the tickets — you just show up.</p>
        </div>

        <OnboardingGrid />

        <div style={{ padding: "4px 20px 0" }}>
          <div className="onboard-cta">
            <b>Sign in to get started</b>
            <span>We use your Google account to verify who owns each event — so only you can edit or cancel what you publish.</span>
            <div className="onboard-signin"><AccountWidget /></div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="en">Host an event</span></div>
        <div className="tb-right">
          <ThemeToggle />
          <span className="pill"><i className="icon-radio-tower" /> Organizer</span>
        </div>
      </header>

      <div className="page-head">
        <h1>List your event</h1>
        <p className="sub">Free to publish. It goes live the moment you hit publish.</p>
      </div>

      <div className="form">
        <div className="form-fields">
        {/* Feature 1: Import from Instagram */}
        <button type="button" className="ig-import-toggle" onClick={() => setIgOpen((v) => !v)}>
          <i className="icon-camera" /> Import from Instagram
          <i className={(igOpen ? "icon-chevron-up" : "icon-chevron-down")} style={{ marginLeft: "auto" }} />
        </button>
        {igOpen && (
          <form className="ig-import-body" onSubmit={runInstagramImport}>
            {!igNeedsCaption ? (
              <>
                <input value={igUrl} onChange={(e) => setIgUrl(e.target.value)} placeholder="https://www.instagram.com/p/..." />
                <button className="btn" type="submit" disabled={igBusy}>{igBusy ? "Reading post…" : "Import"}</button>
              </>
            ) : (
              <>
                <p className="hint" style={{ margin: "0 0 8px" }}>{igErr}</p>
                <textarea rows={4} value={igCaption} onChange={(e) => setIgCaption(e.target.value)} placeholder="Paste the Instagram caption here…" />
                <button className="btn" type="submit" disabled={igBusy}>{igBusy ? "Reading caption…" : "Use this caption"}</button>
              </>
            )}
            {igErr && !igNeedsCaption && <p className="errline">{igErr}</p>}
          </form>
        )}

        {/* cover image (required) */}
        <div className="field">
          <label>Cover photo</label>
          {coverUrl ? (
            <div className="preview-wrap">
              <img className="preview-img" src={coverUrl} alt="cover preview" />
              <button className="rm" onClick={() => { setImg(null); setImportedImagePath(null); if (fileRef.current) fileRef.current.value = ""; }} aria-label="Remove photo"><i className="icon-x" /></button>
            </div>
          ) : (
            <div className="dropzone" onClick={() => fileRef.current?.click()}>
              <i className="icon-image-up" />
              <p><b>Add a cover photo</b></p>
              <small>This becomes your event's cover · JPG, PNG or WebP · up to 6 MB</small>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
        </div>

        <div className="field">
          <label>Event title</label>
          <input value={f.title} onChange={set("title")} placeholder="Friday Rooftop Sessions" />
        </div>
        <div className="field">
          <label>You / your organization</label>
          <input value={f.organizer} onChange={set("organizer")} placeholder="The Cellar" />
        </div>

        <div className="field">
          <label>Category</label>
          <select value={f.cat} onChange={set("cat")}>
            {CATS.filter((c) => c.key !== "all").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Date & time</label>
          <input type="datetime-local" value={f.when} onChange={set("when")} />
        </div>

        <div className="field">
          <label>Venue name</label>
          <input value={f.venue} onChange={set("venue")} placeholder="Shatti rooftop" />
        </div>

        {/* location pin */}
        <div className="field">
          <label>Pin the location</label>
          <MapPicker
            value={loc}
            onChange={({ lat, lng, label }) => {
              setLoc({ lat, lng });
              if (!label) return;
              // Only backfill fields the organizer hasn't already typed into —
              // never clobber a manually-entered venue name or area.
              setF((s) => ({
                ...s,
                venue: s.venue.trim() ? s.venue : label,
                area: s.area.trim() ? s.area : label,
              }));
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Area</label>
            <input value={f.area} onChange={set("area")} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Min age</label>
            <input value={f.minAge} onChange={set("minAge")} inputMode="numeric" />
          </div>
        </div>

        {!(f.ticketingType === "weyn" && useTiers) && (
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Price (OMR)</label>
              <input value={f.price} onChange={set("price")} inputMode="decimal" placeholder="0 = free" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Capacity</label>
              <input value={f.capacity} onChange={set("capacity")} inputMode="numeric" />
            </div>
          </div>
        )}

        {/* Feature 8: Bring Your Own Tickets */}
        <div className="field">
          <label>How do people get in?</label>
          <div className="ticketing-grid">
            {TICKETING_OPTIONS.map((opt) => (
              <button
                key={opt.key} type="button"
                disabled={opt.disabled}
                aria-disabled={opt.disabled}
                title={opt.disabled ? "Coming soon — payments aren't set up yet" : undefined}
                className={"ticketing-opt" + (f.ticketingType === opt.key ? " on" : "") + (opt.disabled ? " disabled" : "")}
                onClick={() => { if (!opt.disabled) setF({ ...f, ticketingType: opt.key }); }}
              >
                <i className={"icon-" + opt.icon} />
                <b>{opt.label}{opt.disabled && <span className="soon-tag">Soon</span>}</b>
                <span>{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="note" style={{ marginTop: -6 }}>
          <i className="icon-info" style={{ marginRight: 6 }} />
          <b>Weyn Ticketing is coming soon.</b> Card payments through Weyn aren't live yet, so for now use an external ticket link, a registration form, or cash at the door to manage entry.
        </div>
        {f.ticketingType === "weyn" && (
          <div className="field">
            <label className="tier-toggle">
              <input type="checkbox" checked={useTiers} onChange={(e) => setUseTiers(e.target.checked)} />
              Multiple ticket types (e.g. General, VIP, Early Bird)
            </label>
            {useTiers && (
              <div className="tier-editor">
                <div className="tier-head"><span>Type</span><span>OMR</span><span>Qty</span><span /></div>
                {tiers.map((t, i) => (
                  <div className="tier-row" key={i}>
                    <input placeholder="e.g. VIP" value={t.name} onChange={setTier(i, "name")} />
                    <input placeholder="0" inputMode="decimal" value={t.price} onChange={setTier(i, "price")} />
                    <input placeholder="50" inputMode="numeric" value={t.capacity} onChange={setTier(i, "capacity")} />
                    <button type="button" className="tier-del" onClick={() => removeTier(i)} disabled={tiers.length === 1} aria-label="Remove">
                      <i className="icon-x" />
                    </button>
                  </div>
                ))}
                <button type="button" className="tier-add" onClick={addTier}><i className="icon-plus" /> Add ticket type</button>
              </div>
            )}
          </div>
        )}
        {(f.ticketingType === "external" || f.ticketingType === "registration") && (
          <div className="field">
            <label>{f.ticketingType === "external" ? "Ticket link" : "Registration link"}</label>
            <input value={f.externalTicketUrl} onChange={set("externalTicketUrl")} placeholder="https://…" />
          </div>
        )}
        {f.ticketingType === "cash" && (
          <div className="field">
            <label>Contact for questions <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label>
            <input value={f.organizerContact} onChange={set("organizerContact")} placeholder="WhatsApp number or email" />
          </div>
        )}

        <div className="field">
          <label>Tags <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· comma separated</span></label>
          <input value={f.tags} onChange={set("tags")} placeholder="outdoor, family-friendly, acoustic" />
        </div>

        <div className="field">
          <label>Refund policy</label>
          <select value={f.refundPolicy} onChange={set("refundPolicy")}>
            <option>Refund up to 48h before</option>
            <option>Refund up to 24h before</option>
            <option>Refund up to 7 days before</option>
            <option>No refunds</option>
            <option>Free entry</option>
          </select>
        </div>

        <div className="field">
          <label>Description</label>
          <textarea value={f.blurb} onChange={set("blurb")} rows={3} placeholder="Tell people why this is the one to be at." />
        </div>

        {f.ticketingType === "weyn" && (
          <div className="note">
            You keep <b>{keep} OMR</b> per ticket. Weyn's fee is just {fee} OMR (8%){price === 0 && " — free events cost nothing"}.
          </div>
        )}

        {err && <p className="errline">{err}</p>}

        <button className="btn lg" onClick={publish} disabled={busy}>
          <i className="icon-rocket" /> {busy ? "Publishing…" : "Publish to Weyn"}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-3)", margin: "12px 0 0" }}>
          Saved to the Weyn backend. Appears in Explore instantly.
        </p>
        </div>

        {/* desktop-only sticky preview — hidden on mobile via .form-preview's
            own display, since .form is a single column there */}
        <div className="form-preview">
          <div
            className="preview-cover"
            style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
          >
            {!coverUrl && "Cover preview"}
          </div>
          <h4>{f.title || "Your event title"}</h4>
          <div className="preview-meta">
            {(f.organizer || "You")} · {f.venue || "Venue"}{f.area ? `, ${f.area}` : ""}
          </div>
          <div className="preview-meta">
            {f.when ? new Date(f.when).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date & time"}
          </div>
        </div>
      </div>

      {toast && <div className="toast"><i className="icon-check" /> Published — opening your dashboard</div>}
    </>
  );
}

const ONBOARD_ITEMS = [
  { icon: "calendar-plus", title: "Create events", body: "A page with your photo, details, and location — live in under a minute." },
  { icon: "users", title: "Manage attendees", body: "See who's coming, with names and emails for anyone signed in with Google." },
  { icon: "ticket", title: "Sell tickets", body: "Free, paid, cash-at-door, or your own external link — you choose per event." },
  { icon: "chart-bar", title: "Track registrations", body: "Live sold counts, revenue, and capacity from your dashboard on You." },
] as const;

function OnboardingGrid() {
  return (
    <div className="onboard-grid">
      {ONBOARD_ITEMS.map((item) => (
        <div key={item.title} className="onboard-item">
          <div className="onboard-ic"><i className={"icon-" + item.icon} /></div>
          <b>{item.title}</b>
          <span>{item.body}</span>
        </div>
      ))}
    </div>
  );
}

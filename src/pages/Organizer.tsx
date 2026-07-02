import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, CATS, type Cat, type TicketingType } from "../api";
import { getOrganizer, setOrganizer } from "../store";
import MapPicker from "../components/MapPicker";
import ThemeToggle from "../components/ThemeToggle";

// default datetime-local value = ~3h from now, rounded
function defaultWhen() {
  const d = new Date(Date.now() + 3 * 3600e3);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TICKETING_OPTIONS: { key: TicketingType; label: string; icon: string; hint: string }[] = [
  { key: "weyn", label: "Weyn Ticketing", icon: "ticket", hint: "We track capacity and sales for you" },
  { key: "external", label: "External Ticket Link", icon: "external-link", hint: "Send people to your own ticketing site" },
  { key: "cash", label: "Cash at the Door", icon: "cash", hint: "No pre-booking — just show up and pay" },
  { key: "registration", label: "Registration Form", icon: "clipboard-list", hint: "Send people to a signup/registration link" },
];

export default function Organizer() {
  const nav = useNavigate();
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
    ticketingType: "weyn" as TicketingType, externalTicketUrl: "", organizerContact: "",
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });

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

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="en">Host an event</span></div>
        <div className="tb-right">
          <ThemeToggle />
          <span className="pill"><i className="ti ti-broadcast" /> Organizer</span>
        </div>
      </header>

      <div className="page-head">
        <h1>List your event</h1>
        <p className="sub">Free to publish. It goes live the moment you hit publish.</p>
      </div>

      <div className="form">
        {/* Feature 1: Import from Instagram */}
        <button type="button" className="ig-import-toggle" onClick={() => setIgOpen((v) => !v)}>
          <i className="ti ti-brand-instagram" /> Import from Instagram
          <i className={"ti " + (igOpen ? "ti-chevron-up" : "ti-chevron-down")} style={{ marginLeft: "auto" }} />
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
              <button className="rm" onClick={() => { setImg(null); setImportedImagePath(null); if (fileRef.current) fileRef.current.value = ""; }} aria-label="Remove photo"><i className="ti ti-x" /></button>
            </div>
          ) : (
            <div className="dropzone" onClick={() => fileRef.current?.click()}>
              <i className="ti ti-photo-up" />
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
            onChange={({ lat, lng, label }) => { setLoc({ lat, lng }); if (label && !f.venue.trim()) setF((s) => ({ ...s, venue: label })); }}
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

        {/* Feature 8: Bring Your Own Tickets */}
        <div className="field">
          <label>How do people get in?</label>
          <div className="ticketing-grid">
            {TICKETING_OPTIONS.map((opt) => (
              <button
                key={opt.key} type="button"
                className={"ticketing-opt" + (f.ticketingType === opt.key ? " on" : "")}
                onClick={() => setF({ ...f, ticketingType: opt.key })}
              >
                <i className={"ti ti-" + opt.icon} />
                <b>{opt.label}</b>
                <span>{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>
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

        <button className="btn" onClick={publish} disabled={busy}>
          <i className="ti ti-rocket" /> {busy ? "Publishing…" : "Publish to Weyn"}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-3)", margin: "12px 0 0" }}>
          Saved to the Weyn backend. Appears in Explore instantly.
        </p>
      </div>

      {toast && <div className="toast"><i className="ti ti-check" /> Published — opening your dashboard</div>}
    </>
  );
}

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type PriceRange, type VenueCategory } from "../api";
import { useAccount } from "../store";
import MapPicker from "../components/MapPicker";
import ThemeToggle from "../components/ThemeToggle";
import AccountWidget from "../components/AccountWidget";
import Tooltip from "../components/Tooltip";

// ============================================================
// Host your venue — a distinct flow from Organizer.tsx (event hosting).
// Internal step state, no router changes. Mount at whatever path you like,
// e.g. <Route path="/host-venue" element={<HostVenue />} /> in main.tsx.
// ============================================================

const BUSINESS_TYPES: { key: VenueCategory; label: string; icon: string }[] = [
  { key: "restaurant", label: "Restaurant", icon: "utensils" },
  { key: "cafe", label: "Café", icon: "coffee" },
  { key: "lounge", label: "Lounge", icon: "martini" },
  { key: "rooftop", label: "Rooftop", icon: "building" },
  { key: "beach_club", label: "Beach Club", icon: "umbrella" },
  { key: "experience", label: "Experience", icon: "sparkles" },
];

const GUEST_TAGS = [
  "Date night", "Family friendly", "Business lunch",
  "Live music", "Group celebrations", "Quiet work",
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type DaySlot = { enabled: boolean; start: string; end: string; capacity: string };

type Plan = {
  key: "standard";
  name: string;
  price: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    key: "standard",
    name: "Weyn Reservations",
    price: "OMR 29/month",
    features: [
      "Reservation management",
      "Venue listing",
      "Availability management",
      "Customer dashboard",
      "Analytics",
    ],
  },
];

const STEP_LABELS = [
  "Business type", "Guests", "Photos", "Details", "Availability", "Plan", "Review",
];

const TOTAL_STEPS = STEP_LABELS.length;

export default function HostVenue() {
  const nav = useNavigate();
  const account = useAccount();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0); // 0-indexed, 0..TOTAL_STEPS-1
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);

  // Step 1
  const [category, setCategory] = useState<VenueCategory | null>(null);

  // Step 2
  const [tags, setTags] = useState<string[]>([]);

  // Step 3 — photos. First photo becomes coverImage, rest become photos[].
  // Reuses Organizer.tsx's image-upload conventions (accept image/*, 6MB cap,
  // object URLs for live preview). There is no standalone image-upload
  // endpoint yet — only POST /api/events bundles one via multer — so photos
  // are read as data URLs client-side and sent as strings to POST /api/venues,
  // which accepts coverImage/photos as plain strings.
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [photoErr, setPhotoErr] = useState("");

  // Step 4 — business details
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("Muscat");
  const [loc, setLoc] = useState<{ lat: number; lng: number }>({ lat: 23.61, lng: 58.54 });
  const [priceRange, setPriceRange] = useState<PriceRange>("$$");

  // Step 5 — availability (client-side only, no bulk-create API yet)
  const [availability, setAvailability] = useState<Record<number, DaySlot>>(() => {
    const init: Record<number, DaySlot> = {};
    DAYS.forEach((_, i) => { init[i] = { enabled: false, start: "10:00", end: "22:00", capacity: "20" }; });
    return init;
  });

  // Step 6 — subscription
  const [tier, setTier] = useState<"standard" | null>("standard");

  function addPhotos(files: FileList | File[]) {
    const list = Array.from(files);
    const accepted: { file: File; url: string }[] = [];
    let errMsg = "";
    for (const file of list) {
      if (!file.type.startsWith("image/")) { errMsg = "Only image files are allowed."; continue; }
      if (file.size > 6 * 1024 * 1024) { errMsg = "Each image must be under 6 MB."; continue; }
      accepted.push({ file, url: URL.createObjectURL(file) });
    }
    setPhotoErr(errMsg);
    if (accepted.length) setPhotos((p) => [...p, ...accepted]);
  }

  function removePhoto(i: number) {
    setPhotos((p) => p.filter((_, j) => j !== i));
  }

  function toggleTag(t: string) {
    setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  }

  function updateDay(i: number, patch: Partial<DaySlot>) {
    setAvailability((s) => ({ ...s, [i]: { ...s[i], ...patch } }));
  }

  // ---- validation per step, gates the Next button ----
  const canNext = useMemo(() => {
    switch (step) {
      case 0: return !!category;
      case 1: return true; // tags optional
      case 2: return photos.length > 0;
      case 3: return name.trim().length > 0 && address.trim().length > 0 && area.trim().length > 0;
      case 4: return true; // availability optional / client-side only
      case 5: return !!tier;
      default: return true;
    }
  }, [step, category, photos, name, address, area, tier]);

  function goNext() {
    if (!canNext) return;
    setErr("");
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }
  function goBack() {
    setErr("");
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    if (!category || !tier || !account) return;
    setBusy(true); setErr("");
    try {
      const created = await api.applyForVenue({
        businessType: category,
        name: name.trim(),
        contactName: account.name,
        contactEmail: account.email,
        description: description.trim() || undefined,
        area: area.trim(),
        guestTags: tags,
        priceRange,
        subscriptionTier: tier,
      });
      setDone({ id: created.id, name: name.trim() });
    } catch (e: any) {
      setErr(e.message || "Couldn't submit your application. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ---- signed-out gate ----
  if (!account) {
    return (
      <>
        <header className="topbar">
          <div className="brand"><span className="en">Host your venue</span></div>
          <div className="tb-right"><ThemeToggle /></div>
        </header>
        <div className="page-head">
          <h1>Bring your venue to Weyn</h1>
          <p className="sub">List your restaurant, café, lounge, or experience — reservations, availability, and guests, all in one place.</p>
        </div>
        <div style={{ padding: "4px 20px 0" }}>
          <div className="onboard-cta">
            <b>Sign in to get started</b>
            <span>We verify your identity so only you can manage this venue's listing and reservations.</span>
            <div className="onboard-signin"><AccountWidget /></div>
          </div>
        </div>
      </>
    );
  }

  // ---- success screen ----
  if (done) {
    return (
      <>
        <header className="topbar">
          <div className="brand"><span className="en">Host your venue</span></div>
          <div className="tb-right"><ThemeToggle /></div>
        </header>
        <div style={{ padding: "48px 24px", textAlign: "center" }}>
          <div
            className="hostvenue-success-mark"
            style={{
              width: 64, height: 64, borderRadius: "50%", margin: "0 auto 20px",
              display: "grid", placeItems: "center", background: "var(--success-soft)",
              color: "var(--success)", fontSize: 28,
            }}
          >
            <i className="icon-check" />
          </div>
          <h1 style={{ marginBottom: 10 }}>Application submitted</h1>
          <p className="sub" style={{ margin: "0 auto 24px", maxWidth: 340 }}>
            Thanks, {done.name}. The Weyn team reviews every venue by hand — approval usually takes a few minutes, and can take up to 2 days. We'll email you as soon as you're approved.
          </p>
          <button className="btn lg" onClick={() => nav("/")}>Back to Explore</button>
        </div>
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .hostvenue-success-mark { animation: hostvenue-pop .4s cubic-bezier(.2,.9,.3,1.6); }
          }
          @keyframes hostvenue-pop { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        `}</style>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="en">Host your venue</span></div>
        <div className="tb-right">
          <ThemeToggle />
          <span className="pill"><i className="icon-store" /> Venue</span>
        </div>
      </header>

      {/* progress indicator */}
      <div style={{ padding: "10px 16px 0" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {STEP_LABELS.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1, height: 4, borderRadius: 999,
                background: i <= step ? "var(--accent)" : "var(--surface-2)",
                transition: "background-color .2s",
              }}
            />
          ))}
        </div>
        <p className="hint" style={{ margin: "0 0 4px" }}>
          Step {step + 1} of {TOTAL_STEPS} · {STEP_LABELS[step]}
        </p>
      </div>

      <div className="form hv-form">
        <div className="form-fields">
          {step === 0 && <StepBusinessType category={category} setCategory={setCategory} nav={nav} />}
          {step === 1 && <StepGuests tags={tags} toggleTag={toggleTag} />}
          {step === 2 && (
            <StepPhotos
              photos={photos}
              addPhotos={addPhotos}
              removePhoto={removePhoto}
              dragOver={dragOver}
              setDragOver={setDragOver}
              fileInputRef={fileInputRef}
              photoErr={photoErr}
            />
          )}
          {step === 3 && (
            <StepDetails
              name={name} setName={setName}
              description={description} setDescription={setDescription}
              address={address} setAddress={setAddress}
              area={area} setArea={setArea}
              loc={loc} setLoc={setLoc}
              priceRange={priceRange} setPriceRange={setPriceRange}
            />
          )}
          {step === 4 && <StepAvailability availability={availability} updateDay={updateDay} />}
          {step === 5 && <StepPlan tier={tier} setTier={setTier} />}
          {step === 6 && (
            <StepReview
              category={category}
              tags={tags}
              photos={photos}
              name={name}
              description={description}
              address={address}
              area={area}
              priceRange={priceRange}
              availability={availability}
              tier={tier}
            />
          )}

          {err && <p className="errline">{err}</p>}

        </div>
      </div>

      {/* fixed bottom bar, same treatment as the app's other sticky action
          bars (.buybar, .ob-cta) — position:fixed means its place in the
          DOM doesn't affect where it renders, so it can stay wherever the
          step content naturally ends */}
      <div className="hv-nav">
        {step > 0 && (
          <button type="button" className="btn glass" onClick={goBack} disabled={busy}>
            <i className="icon-arrow-left" /> Back
          </button>
        )}
        {step < TOTAL_STEPS - 1 ? (
          <button type="button" className="btn lg" onClick={goNext} disabled={!canNext}>
            Next <i className="icon-arrow-right" />
          </button>
        ) : (
          <button type="button" className="btn lg" onClick={submit} disabled={busy}>
            <i className="icon-rocket" /> {busy ? "Submitting…" : "Submit venue"}
          </button>
        )}
      </div>
    </>
  );
}

// ============================================================
// Step 1 — business type
// ============================================================
function StepBusinessType({
  category, setCategory, nav,
}: {
  category: VenueCategory | null;
  setCategory: (c: VenueCategory) => void;
  nav: ReturnType<typeof useNavigate>;
}) {
  return (
    <>
      <div className="page-head compact" style={{ padding: "0 0 10px" }}>
        <h1>What best describes your business?</h1>
        <p className="sub">Pick the category that fits closest — you can refine details later.</p>
      </div>
      <div className="onboard-grid">
        {BUSINESS_TYPES.map((t) => (
          <button
            type="button"
            key={t.key}
            className="ticketing-opt"
            style={{ alignItems: "flex-start" }}
            aria-pressed={category === t.key}
            onClick={() => setCategory(t.key)}
          >
            <i className={"icon-" + t.icon} />
            <b style={category === t.key ? { color: "var(--accent)" } : undefined}>{t.label}</b>
          </button>
        ))}
        <button
          type="button"
          className="ticketing-opt"
          style={{ alignItems: "flex-start", gridColumn: "1 / -1" }}
          onClick={() => nav("/host")}
        >
          <i className="icon-calendar-plus" />
          <b>Event Organizer</b>
          <span>Hosting a one-off event instead of a venue? Go to event hosting.</span>
        </button>
      </div>
    </>
  );
}

// ============================================================
// Step 2 — guest tags
// ============================================================
function StepGuests({ tags, toggleTag }: { tags: string[]; toggleTag: (t: string) => void }) {
  return (
    <>
      <div className="page-head compact" style={{ padding: "0 0 10px" }}>
        <h1>What do guests usually come for?</h1>
        <p className="sub">Select all that apply — this helps the right guests find you.</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {GUEST_TAGS.map((t) => (
          <button
            type="button"
            key={t}
            className={"chip" + (tags.includes(t) ? " on" : "")}
            onClick={() => toggleTag(t)}
          >
            {t}
          </button>
        ))}
      </div>
    </>
  );
}

// ============================================================
// Step 3 — drag-and-drop photo upload
// ============================================================
function StepPhotos({
  photos, addPhotos, removePhoto, dragOver, setDragOver, fileInputRef, photoErr,
}: {
  photos: { file: File; url: string }[];
  addPhotos: (files: FileList | File[]) => void;
  removePhoto: (i: number) => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  photoErr: string;
}) {
  return (
    <>
      <div className="page-head compact" style={{ padding: "0 0 10px" }}>
        <h1>Add photos</h1>
        <p className="sub">Your first photo becomes the cover image guests see first.</p>
      </div>
      <div
        className="dropzone"
        style={dragOver ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) addPhotos(e.dataTransfer.files);
        }}
      >
        <i className="icon-image-up" />
        <p><b>Drag photos here, or click to browse</b></p>
        <small>JPG, PNG or WebP · up to 6 MB each</small>
      </div>
      <input
        ref={fileInputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { if (e.target.files) addPhotos(e.target.files); e.target.value = ""; }}
      />
      {photoErr && <p className="errline">{photoErr}</p>}

      {photos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 14 }}>
          {photos.map((p, i) => (
            <div className="preview-wrap" key={p.url}>
              <img className="preview-img" style={{ height: 90 }} src={p.url} alt={`photo ${i + 1}`} />
              {i === 0 && (
                <span className="ec-badge" style={{ position: "absolute", top: 6, left: 6 }}>Cover</span>
              )}
              <Tooltip text="Remove photo">
                <button className="rm" onClick={() => removePhoto(i)} aria-label="Remove photo">
                  <i className="icon-x" />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ============================================================
// Step 4 — business details
// ============================================================
function StepDetails({
  name, setName, description, setDescription, address, setAddress, area, setArea,
  loc, setLoc, priceRange, setPriceRange,
}: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  address: string; setAddress: (v: string) => void;
  area: string; setArea: (v: string) => void;
  loc: { lat: number; lng: number }; setLoc: (v: { lat: number; lng: number }) => void;
  priceRange: PriceRange; setPriceRange: (v: PriceRange) => void;
}) {
  return (
    <>
      <div className="page-head compact" style={{ padding: "0 0 10px" }}>
        <h1>Business details</h1>
        <p className="sub">Tell guests what makes this place worth visiting.</p>
      </div>
      <div className="field">
        <label>Venue name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Cellar Rooftop" />
      </div>
      <div className="field">
        <label>Description <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A relaxed rooftop lounge with skyline views…" />
      </div>
      <div className="field">
        <label>Pin the location</label>
        <MapPicker
          value={loc}
          onChange={({ lat, lng, label }) => {
            setLoc({ lat, lng });
            if (!label) return;
            if (!address.trim()) setAddress(label);
            if (!area.trim()) setArea(label);
          }}
        />
      </div>
      <div className="field">
        <label>Address</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Shatti Al Qurum, Muscat" />
      </div>
      <div className="field">
        <label>Area</label>
        <input value={area} onChange={(e) => setArea(e.target.value)} />
      </div>
      <div className="field">
        <label>Price range</label>
        <div style={{ display: "flex", gap: 8 }}>
          {(["$", "$$", "$$$"] as PriceRange[]).map((p) => (
            <button
              type="button"
              key={p}
              className={"chip" + (priceRange === p ? " on" : "")}
              onClick={() => setPriceRange(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ============================================================
// Step 5 — weekly recurring availability builder (client-side only)
// ============================================================
function StepAvailability({
  availability, updateDay,
}: {
  availability: Record<number, DaySlot>;
  updateDay: (i: number, patch: Partial<DaySlot>) => void;
}) {
  return (
    <>
      <div className="page-head compact" style={{ padding: "0 0 10px" }}>
        <h1>Set your weekly availability</h1>
        <p className="sub">Toggle the days you're open and set hours and capacity. You can fine-tune this later from your dashboard.</p>
      </div>
      <div className="note">
        <i className="icon-info" style={{ marginRight: 6 }} />
        This is saved with your submission for the Weyn team to set up — recurring slots aren't wired to live reservations yet.
      </div>
      <div className="hv-avail-list">
        {DAYS.map((day, i) => {
          const d = availability[i];
          return (
            <div key={day} className={"hv-avail-day" + (d.enabled ? " on" : "")}>
              <label className="hv-avail-day-head">
                <input type="checkbox" checked={d.enabled} onChange={(e) => updateDay(i, { enabled: e.target.checked })} />
                <span>{day}</span>
                {!d.enabled && <span className="hv-avail-closed">Closed</span>}
              </label>
              {d.enabled && (
                <div className="hv-avail-ranges">
                  <div className="hv-avail-range">
                    <input type="time" value={d.start} onChange={(e) => updateDay(i, { start: e.target.value })} aria-label={`${day} opening time`} />
                    <span>–</span>
                    <input type="time" value={d.end} onChange={(e) => updateDay(i, { end: e.target.value })} aria-label={`${day} closing time`} />
                    <input inputMode="numeric" value={d.capacity} onChange={(e) => updateDay(i, { capacity: e.target.value })} placeholder="Cap." className="hv-avail-capacity" aria-label={`${day} capacity`} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ============================================================
// Step 6 — subscription selection
// ============================================================
function StepPlan({ tier, setTier }: { tier: "standard" | null; setTier: (t: "standard") => void }) {
  return (
    <>
      <div className="page-head compact" style={{ padding: "0 0 10px" }}>
        <h1>Choose your plan</h1>
        <p className="sub">Pick the plan that fits your venue — you can change it any time.</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {PLANS.map((p) => (
          <button
            type="button"
            key={p.key}
            onClick={() => setTier(p.key)}
            className="ticketing-opt"
            style={{ alignItems: "flex-start", padding: "16px 16px", textAlign: "left" }}
            aria-pressed={tier === p.key}
          >
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "baseline" }}>
              <b style={{ fontSize: 16 }}>{p.name}</b>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{p.price}</span>
            </div>
            <ul style={{ margin: "8px 0 0", padding: "0 0 0 18px", color: "var(--text-2)", fontSize: 13 }}>
              {p.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </button>
        ))}
      </div>
      <div className="note" style={{ marginTop: 14 }}>
        <i className="icon-info" style={{ marginRight: 6 }} />
        Billing setup is handled by the Weyn team after signup — we'll be in touch.
      </div>
    </>
  );
}

// ============================================================
// Step 7 — review & submit
// ============================================================
function StepReview({
  category, tags, photos, name, description, address, area, priceRange, availability, tier,
}: {
  category: VenueCategory | null;
  tags: string[];
  photos: { file: File; url: string }[];
  name: string;
  description: string;
  address: string;
  area: string;
  priceRange: PriceRange;
  availability: Record<number, DaySlot>;
  tier: "standard" | null;
}) {
  const catLabel = BUSINESS_TYPES.find((b) => b.key === category)?.label || "—";
  const plan = PLANS.find((p) => p.key === tier);
  const openDays = DAYS.filter((_, i) => availability[i].enabled);

  return (
    <>
      <div className="page-head compact" style={{ padding: "0 0 10px" }}>
        <h1>Review &amp; submit</h1>
        <p className="sub">Make sure everything looks right before you submit.</p>
      </div>

      {photos[0] && <img className="preview-img" style={{ height: 160, marginBottom: 14 }} src={photos[0].url} alt="cover preview" />}

      <div className="facts">
        <div className="fact"><i className="icon-store" /><div><b>{name || "Untitled venue"}</b><span>{catLabel}</span></div></div>
        <div className="fact"><i className="icon-map-pin" /><div><b>{address || "—"}</b><span>{area}</span></div></div>
        <div className="fact"><i className="icon-tag" /><div><b>{priceRange}</b><span>Price range</span></div></div>
        <div className="fact"><i className="icon-image" /><div><b>{photos.length} photo{photos.length === 1 ? "" : "s"}</b><span>First photo is the cover</span></div></div>
        <div className="fact"><i className="icon-calendar" /><div><b>{openDays.length ? openDays.join(", ") : "No days set"}</b><span>Open days</span></div></div>
        <div className="fact"><i className="icon-credit-card" /><div><b>{plan?.name || "—"}</b><span>{plan?.price}</span></div></div>
      </div>

      {description && <p className="blurb">{description}</p>}

      {tags.length > 0 && (
        <div className="tagrow">
          {tags.map((t) => <span className="tg" key={t}>{t}</span>)}
        </div>
      )}

      <div className="note" style={{ marginTop: 18 }}>
        <i className="icon-info" style={{ marginRight: 6 }} />
        Billing setup is handled by the Weyn team after signup — we'll be in touch.
      </div>
    </>
  );
}

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

type OwnershipRole = "owner" | "manager" | "authorized";
const OWNERSHIP_ROLES: { key: OwnershipRole; label: string; hint: string }[] = [
  { key: "owner", label: "Owner", hint: "I own this business." },
  { key: "manager", label: "Manager", hint: "I manage this venue day-to-day." },
  { key: "authorized", label: "Authorized representative", hint: "I'm authorized to act on the owner's behalf." },
];

type DaySlot = { enabled: boolean; start: string; end: string; capacity: string };

export type SubscriptionTier = "basic" | "growth" | "premium";

type Plan = {
  key: SubscriptionTier;
  name: string;
  price: string;
  priceOmr: number;
  features: string[];
};

// Three tiers, each strictly a superset of the one below it — makes the
// step's "compare" reading trivial (every feature carries up) and matches
// how the approval flow reads subscriptionTier back off the Venue: no
// separate feature-flag table yet, just this tier key gating what's shown.
const PLANS: Plan[] = [
  {
    key: "basic",
    name: "Basic",
    price: "OMR 5/month",
    priceOmr: 5,
    features: [
      "Venue listing on Weyn",
      "Reservation management",
      "Availability calendar",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: "OMR 15/month",
    priceOmr: 15,
    features: [
      "Everything in Basic",
      "Customer dashboard",
      "Booking analytics",
      "Guest tags & highlights (e.g. \"Date night\", \"Family friendly\")",
    ],
  },
  {
    key: "premium",
    name: "Premium",
    price: "OMR 30/month",
    priceOmr: 30,
    features: [
      "Everything in Growth",
      "Priority placement in Discovery",
      "Featured badge on your listing",
      "Priority support",
    ],
  },
];

const STEP_LABELS = [
  "Business type", "Guests", "Photos", "Details", "Verify ownership", "Availability", "Plan", "Review",
];

const TOTAL_STEPS = STEP_LABELS.length;

export default function HostVenue() {
  const nav = useNavigate();
  const account = useAccount();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

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
  // Business contact — defaults to the signed-in account so most applicants
  // never have to type anything, but stays editable: the person applying
  // (e.g. a manager) is often not who guests/reviewers should actually
  // reach for this venue. Previously this was hardcoded to account.name/
  // account.email with no way to correct it, and there was no phone field
  // in the UI at all despite the backend/notification email expecting one.
  const [contactName, setContactName] = useState(account?.name || "");
  const [contactEmail, setContactEmail] = useState(account?.email || "");
  const [contactPhone, setContactPhone] = useState("");

  // Step 5 — verify ownership (role + optional reg number + REQUIRED proof doc)
  const [role, setRole] = useState<OwnershipRole | null>(null);
  const [businessRegNo, setBusinessRegNo] = useState("");
  const [proof, setProof] = useState<{ file: File; url: string } | null>(null);
  const [proofErr, setProofErr] = useState("");
  const [proofDragOver, setProofDragOver] = useState(false);

  // Step 6 — availability (client-side only, no bulk-create API yet)
  const [availability, setAvailability] = useState<Record<number, DaySlot>>(() => {
    const init: Record<number, DaySlot> = {};
    DAYS.forEach((_, i) => { init[i] = { enabled: false, start: "10:00", end: "22:00", capacity: "20" }; });
    return init;
  });

  // Step 7 — subscription. No default — with three real, different price
  // points now (vs. the old single-plan "standard" that was safe to
  // pre-select), the applicant should make an active choice.
  const [tier, setTier] = useState<SubscriptionTier | null>(null);

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

  function setProofFile(files: FileList | File[]) {
    const file = Array.from(files)[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setProofErr("Please upload an image of your document."); return; }
    if (file.size > 6 * 1024 * 1024) { setProofErr("The document image must be under 6 MB."); return; }
    setProofErr("");
    setProof({ file, url: URL.createObjectURL(file) });
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
      case 3: return name.trim().length > 0 && address.trim().length > 0 && area.trim().length > 0
        && contactName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
      case 4: return !!role && !!proof; // ownership: role + proof doc required
      case 5: return true; // availability optional, but now actually saved — see submit()
      case 6: return !!tier;
      default: return true;
    }
  }, [step, category, photos, name, address, area, role, proof, tier, contactName, contactEmail]);

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
    if (!category || !tier || !account || !role || !proof) return;
    setBusy(true); setErr("");
    try {
      const [cover, ...rest] = photos;
      // Only send days actually toggled on — an untouched day still carries
      // its default start/end/capacity, which would otherwise imply the
      // applicant chose 10:00–22:00 for days they never looked at.
      const enabledAvailability = Object.entries(availability)
        .filter(([, d]) => d.enabled)
        .map(([dayOfWeek, d]) => ({
          dayOfWeek: Number(dayOfWeek), startTime: d.start, endTime: d.end,
          capacity: Math.max(1, parseInt(d.capacity, 10) || 1),
        }));
      const created = await api.applyForVenue({
        businessType: category,
        name: name.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || undefined,
        description: description.trim() || undefined,
        venue: address.trim() || undefined,
        area: area.trim(),
        lat: loc.lat,
        lng: loc.lng,
        guestTags: tags,
        priceRange,
        subscriptionTier: tier,
        role,
        businessRegNo: businessRegNo.trim() || undefined,
        availability: enabledAvailability.length ? enabledAvailability : undefined,
        proofDoc: proof.file,
        coverImage: cover?.file,
        photos: rest.map((p) => p.file),
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
              contactName={contactName} setContactName={setContactName}
              contactEmail={contactEmail} setContactEmail={setContactEmail}
              contactPhone={contactPhone} setContactPhone={setContactPhone}
            />
          )}
          {step === 4 && (
            <StepVerify
              role={role} setRole={setRole}
              businessRegNo={businessRegNo} setBusinessRegNo={setBusinessRegNo}
              proof={proof}
              setProofFile={setProofFile}
              removeProof={() => setProof(null)}
              dragOver={proofDragOver}
              setDragOver={setProofDragOver}
              proofInputRef={proofInputRef}
              proofErr={proofErr}
            />
          )}
          {step === 5 && <StepAvailability availability={availability} updateDay={updateDay} />}
          {step === 6 && <StepPlan tier={tier} setTier={setTier} />}
          {step === 7 && (
            <StepReview
              category={category}
              tags={tags}
              photos={photos}
              name={name}
              description={description}
              address={address}
              area={area}
              priceRange={priceRange}
              role={role}
              businessRegNo={businessRegNo}
              proof={proof}
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
  contactName, setContactName, contactEmail, setContactEmail, contactPhone, setContactPhone,
}: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  address: string; setAddress: (v: string) => void;
  area: string; setArea: (v: string) => void;
  loc: { lat: number; lng: number }; setLoc: (v: { lat: number; lng: number }) => void;
  priceRange: PriceRange; setPriceRange: (v: PriceRange) => void;
  contactName: string; setContactName: (v: string) => void;
  contactEmail: string; setContactEmail: (v: string) => void;
  contactPhone: string; setContactPhone: (v: string) => void;
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

      {/* Prefilled from the signed-in account, but editable — the person
          applying isn't always who guests/reviewers should reach for this
          venue (e.g. a manager applying on the owner's behalf). */}
      <div className="filter-sheet-label" style={{ marginTop: 8 }}>Venue contact</div>
      <div className="field">
        <label>Contact name</label>
        <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" />
      </div>
      <div className="field">
        <label>Contact email</label>
        <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="you@business.com" />
      </div>
      <div className="field">
        <label>Contact phone <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label>
        <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+968 9xxx xxxx" />
      </div>
    </>
  );
}

// ============================================================
// Step 5 — verify ownership (role + optional reg number + REQUIRED proof doc)
// ============================================================
function StepVerify({
  role, setRole, businessRegNo, setBusinessRegNo, proof, setProofFile, removeProof,
  dragOver, setDragOver, proofInputRef, proofErr,
}: {
  role: OwnershipRole | null; setRole: (r: OwnershipRole) => void;
  businessRegNo: string; setBusinessRegNo: (v: string) => void;
  proof: { file: File; url: string } | null;
  setProofFile: (files: FileList | File[]) => void;
  removeProof: () => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  proofInputRef: React.RefObject<HTMLInputElement>;
  proofErr: string;
}) {
  return (
    <>
      <div className="page-head compact" style={{ padding: "0 0 10px" }}>
        <h1>Verify ownership</h1>
        <p className="sub">Upload a photo of your trade licence, commercial registration, or an authorization letter — we verify every venue by hand before it goes live.</p>
      </div>

      <div className="field">
        <label>Your role at this venue</label>
        <div className="onboard-grid">
          {OWNERSHIP_ROLES.map((r) => (
            <button
              type="button"
              key={r.key}
              className="ticketing-opt"
              style={{ alignItems: "flex-start", gridColumn: r.key === "authorized" ? "1 / -1" : undefined }}
              aria-pressed={role === r.key}
              onClick={() => setRole(r.key)}
            >
              <b style={role === r.key ? { color: "var(--accent)" } : undefined}>{r.label}</b>
              <span>{r.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Business registration / trade licence no. <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· optional</span></label>
        <input value={businessRegNo} onChange={(e) => setBusinessRegNo(e.target.value)} placeholder="e.g. 1234567" />
      </div>

      <div className="field">
        <label>Ownership document</label>
        {proof ? (
          <div className="preview-wrap" style={{ maxWidth: 220 }}>
            <img className="preview-img" style={{ height: 150 }} src={proof.url} alt="ownership document preview" />
            <Tooltip text="Remove document">
              <button className="rm" onClick={removeProof} aria-label="Remove document">
                <i className="icon-x" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <>
            <div
              className="dropzone"
              style={dragOver ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
              onClick={() => proofInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) setProofFile(e.dataTransfer.files);
              }}
            >
              <i className="icon-file-check" />
              <p><b>Drag your document here, or click to browse</b></p>
              <small>Trade licence, CR, or authorization letter · JPG, PNG or WebP · up to 6 MB</small>
            </div>
            <input
              ref={proofInputRef} type="file" accept="image/*" hidden
              onChange={(e) => { if (e.target.files) setProofFile(e.target.files); e.target.value = ""; }}
            />
          </>
        )}
        {proofErr && <p className="errline">{proofErr}</p>}
      </div>
    </>
  );
}

// ============================================================
// Step 6 — weekly recurring availability builder (client-side only)
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
// Step 7 — subscription selection
// ============================================================
function StepPlan({ tier, setTier }: { tier: SubscriptionTier | null; setTier: (t: SubscriptionTier) => void }) {
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
// Step 8 — review & submit
// ============================================================
function StepReview({
  category, tags, photos, name, description, address, area, priceRange, role, businessRegNo, proof, availability, tier,
}: {
  category: VenueCategory | null;
  tags: string[];
  photos: { file: File; url: string }[];
  name: string;
  description: string;
  address: string;
  area: string;
  priceRange: PriceRange;
  role: OwnershipRole | null;
  businessRegNo: string;
  proof: { file: File; url: string } | null;
  availability: Record<number, DaySlot>;
  tier: SubscriptionTier | null;
}) {
  const catLabel = BUSINESS_TYPES.find((b) => b.key === category)?.label || "—";
  const roleLabel = OWNERSHIP_ROLES.find((r) => r.key === role)?.label || "—";
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
        <div className="fact"><i className="icon-shield-check" /><div><b>{roleLabel}{proof ? " · document attached" : ""}</b><span>{businessRegNo.trim() ? `Reg no. ${businessRegNo.trim()}` : "Ownership verification"}</span></div></div>
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

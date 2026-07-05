import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, VENUE_CATS, type PriceRange, type VenueCategory } from "../api";
import { getAuthToken, useAccount } from "../store";
import MapPicker from "../components/MapPicker";
import ThemeToggle from "../components/ThemeToggle";

// ---------------------------------------------------------------
// Host your venue — a separate multi-step onboarding flow for
// restaurants/cafes/lounges/rooftops/beach clubs/experiences that want
// reservation hosting. Distinct from Organizer.tsx's event-hosting flow.
// ---------------------------------------------------------------

const TOTAL_STEPS = 7;

type BusinessCard = { key: VenueCategory; label: string; icon: string };
const BUSINESS_CARDS: BusinessCard[] = [
  { key: "restaurant", label: "Restaurant", icon: "utensils" },
  { key: "cafe", label: "Cafe", icon: "coffee" },
  { key: "lounge", label: "Lounge", icon: "martini" },
  { key: "rooftop", label: "Rooftop", icon: "building-2" },
  { key: "beach_club", label: "Beach Club", icon: "umbrella" },
  { key: "experience", label: "Experience", icon: "sparkles" },
];

const GUEST_TAGS = [
  "Date night", "Family friendly", "Business lunch", "Live music",
  "Group celebrations", "Quiet work", "Weekend brunch", "Special occasions",
];

const PRICE_RANGES: PriceRange[] = ["$", "$$", "$$$"];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type TimeRange = { start: string; end: string; capacity: string };
type DayAvailability = { enabled: boolean; ranges: TimeRange[] };

type SubscriptionTier = "starter" | "growth";

const TIER_INFO: Record<SubscriptionTier, { label: string; price: string; features: string[] }> = {
  starter: {
    label: "Starter",
    price: "OMR 19/month",
    features: ["Reservation management", "Venue listing", "Availability management", "Customer reservation dashboard", "Basic analytics"],
  },
  growth: {
    label: "Growth",
    price: "OMR 39/month",
    features: ["Everything in Starter", "Featured placement", "Advanced analytics", "Custom branding", "Priority support"],
  },
};

interface PhotoItem {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  uploadedUrl?: string;
}

function newDayAvailability(): DayAvailability {
  return { enabled: false, ranges: [{ start: "18:00", end: "22:00", capacity: "20" }] };
}

export default function HostVenue() {
  const nav = useNavigate();
  const account = useAccount();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);

  // Step 1
  const [category, setCategory] = useState<VenueCategory | null>(null);

  // Step 2
  const [tags, setTags] = useState<string[]>([]);

  // Step 3
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Step 4
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loc, setLoc] = useState<{ lat: number; lng: number }>({ lat: 23.61, lng: 58.54 });
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("Muscat");
  const [priceRange, setPriceRange] = useState<PriceRange | null>(null);

  // Step 5 — client-side only, no bulk-create API yet (TODO backend gap)
  const [availability, setAvailability] = useState<Record<string, DayAvailability>>(() =>
    Object.fromEntries(DAYS.map((d) => [d, newDayAvailability()]))
  );

  // Step 6
  const [tier, setTier] = useState<SubscriptionTier | null>(null);

  // Step 7 (submit)
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);

  function toggleTag(tag: string) {
    setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));
  }

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const items: PhotoItem[] = arr.map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    setPhotos((p) => [...p, ...items]);
    items.forEach((item) => uploadPhoto(item));
  }

  // NOTE: there is no standalone image-upload endpoint in this backend — the
  // only upload mechanism (multer) is bundled into POST /api/events for event
  // cover photos. Rather than invent a fake upload call here, we treat the
  // local object URL as the "uploaded" result so the flow works end-to-end
  // client-side. TODO(backend): add a real POST /api/uploads (or similar)
  // that HostVenue.tsx can call, then swap this stub for a real fetch.
  async function uploadPhoto(item: PhotoItem) {
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
    setPhotos((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, status: "done", uploadedUrl: p.previewUrl } : p))
    );
  }

  function removePhoto(id: string) {
    setPhotos((p) => p.filter((x) => x.id !== id));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  function setDayEnabled(day: string, enabled: boolean) {
    setAvailability((a) => ({ ...a, [day]: { ...a[day], enabled } }));
  }
  function addRange(day: string) {
    setAvailability((a) => ({
      ...a,
      [day]: { ...a[day], ranges: [...a[day].ranges, { start: "18:00", end: "22:00", capacity: "20" }] },
    }));
  }
  function removeRange(day: string, idx: number) {
    setAvailability((a) => ({
      ...a,
      [day]: { ...a[day], ranges: a[day].ranges.filter((_, i) => i !== idx) },
    }));
  }
  function setRange(day: string, idx: number, patch: Partial<TimeRange>) {
    setAvailability((a) => ({
      ...a,
      [day]: { ...a[day], ranges: a[day].ranges.map((r, i) => (i === idx ? { ...r, ...patch } : r)) },
    }));
  }

  function canGoNext(): boolean {
    switch (step) {
      case 1: return category !== null;
      case 2: return tags.length > 0;
      case 3: return photos.some((p) => p.status === "done");
      case 4: return !!(name.trim() && address.trim() && priceRange);
      case 5: return true; // optional
      case 6: return tier !== null;
      default: return true;
    }
  }

  function goNext() {
    if (!canGoNext()) return;
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  function coverAndPhotos(): { coverImage?: string; photos: string[] } {
    const done = photos.filter((p) => p.status === "done" && p.uploadedUrl);
    const [first, ...rest] = done;
    return { coverImage: first?.uploadedUrl, photos: rest.map((p) => p.uploadedUrl!) };
  }

  async function submit() {
    if (!category || !priceRange || !tier) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const { coverImage, photos: restPhotos } = coverAndPhotos();
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/venues`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          category,
          description: description.trim() || undefined,
          venue: address.trim(),
          area: area.trim(),
          lat: loc.lat,
          lng: loc.lng,
          coverImage,
          photos: restPhotos,
          priceRange,
          tags,
          subscriptionTier: tier,
        }),
      });
      const isJson = (res.headers.get("content-type") || "").includes("application/json");
      const body = isJson ? await res.json().catch(() => ({})) : {};
      if (!res.ok) {
        const err = (body as any).error;
        const message = typeof err === "string" ? err : err?.message;
        throw new Error(message || `Request failed (${res.status})`);
      }
      setSuccess(true);
    } catch (e: any) {
      setSubmitError(e.message || "Couldn't submit your venue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- sign-in gate, same convention as Organizer.tsx ----
  if (!account) {
    return (
      <>
        <header className="topbar">
          <div className="brand"><span className="en">Host your venue</span></div>
          <div className="tb-right"><ThemeToggle /></div>
        </header>
        <div className="page-head">
          <h1>Bring reservations to your venue</h1>
          <p className="sub">List your restaurant, cafe, lounge, rooftop, beach club, or experience — and start taking bookings through Weyn.</p>
        </div>
        <div style={{ padding: "20px 20px 0" }}>
          <div className="onboard-cta">
            <b>Sign in to get started</b>
            <span>We verify your identity so only you can manage the venue you list.</span>
          </div>
        </div>
      </>
    );
  }

  if (success) {
    return (
      <>
        <header className="topbar">
          <div className="brand"><span className="en">Host your venue</span></div>
          <div className="tb-right"><ThemeToggle /></div>
        </header>
        <div className="hv-success">
          <div className="hv-success-check"><i className="icon-check" /></div>
          <h1>Congratulations — you're on your way!</h1>
          <p className="sub">
            <b>{name}</b> has been submitted to Weyn. Our team will review your listing and reach out
            about billing setup shortly — no payment needed from you today.
          </p>
          <div className="hv-success-notes">
            <div className="fact">
              <i className="icon-clock" />
              <div>
                <b>What happens next</b>
                <span>Your venue typically appears on Weyn within 1–2 business days after a quick review.</span>
              </div>
            </div>
            <div className="fact">
              <i className="icon-credit-card" />
              <div>
                <b>Billing</b>
                <span>The Weyn team will follow up directly to set up your {tier === "growth" ? "Growth" : "Starter"} plan.</span>
              </div>
            </div>
          </div>
          <button className="btn lg" onClick={() => nav("/you")}>Go to your dashboard</button>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="en">Host your venue</span></div>
        <div className="tb-right"><ThemeToggle /></div>
      </header>

      <div className="hv-progress">
        <div className="hv-progress-label">Step {step} of {TOTAL_STEPS}</div>
        <div className="hv-progress-track">
          <div className="hv-progress-fill" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      <div className="hv-step" key={step}>
        {step === 1 && (
          <StepBusiness
            category={category}
            onSelect={setCategory}
            onOrganizer={() => nav("/host")}
          />
        )}
        {step === 2 && <StepTags tags={tags} onToggle={toggleTag} />}
        {step === 3 && (
          <StepPhotos
            photos={photos}
            dragOver={dragOver}
            fileRef={fileRef}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onPick={(files) => files && addFiles(files)}
            onRemove={removePhoto}
          />
        )}
        {step === 4 && (
          <StepDetails
            name={name} setName={setName}
            description={description} setDescription={setDescription}
            loc={loc} setLoc={setLoc}
            address={address} setAddress={setAddress}
            area={area} setArea={setArea}
            priceRange={priceRange} setPriceRange={setPriceRange}
          />
        )}
        {step === 5 && (
          <StepAvailability
            availability={availability}
            setDayEnabled={setDayEnabled}
            addRange={addRange}
            removeRange={removeRange}
            setRange={setRange}
          />
        )}
        {step === 6 && <StepSubscription tier={tier} setTier={setTier} />}
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
            tier={tier}
            submitError={submitError}
          />
        )}
      </div>

      <div className="hv-nav">
        {step > 1 && (
          <button className="btn glass" onClick={goBack} disabled={submitting}>
            <i className="icon-chevron-left" /> Back
          </button>
        )}
        {step < TOTAL_STEPS ? (
          <button className="btn lg" onClick={goNext} disabled={!canGoNext()}>
            Next <i className="icon-chevron-right" />
          </button>
        ) : (
          <button className="btn lg" onClick={submit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit venue"}
          </button>
        )}
      </div>
    </>
  );
}

// ============================================================
// Step 1 — business type
// ============================================================
function StepBusiness({
  category, onSelect, onOrganizer,
}: { category: VenueCategory | null; onSelect: (c: VenueCategory) => void; onOrganizer: () => void }) {
  return (
    <>
      <div className="page-head compact">
        <h1>What best describes your business?</h1>
        <p className="sub">This helps guests find you in the right category.</p>
      </div>
      <div className="hv-card-grid">
        {BUSINESS_CARDS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={"hv-select-card" + (category === c.key ? " on" : "")}
            onClick={() => onSelect(c.key)}
          >
            <i className={"icon-" + c.icon} />
            <span>{c.label}</span>
          </button>
        ))}
        <button type="button" className="hv-select-card hv-organizer-card" onClick={onOrganizer}>
          <i className="icon-calendar-plus" />
          <span>Event Organizer</span>
          <small>Hosting a one-off event instead? Go here.</small>
        </button>
      </div>
    </>
  );
}

// ============================================================
// Step 2 — guest tags
// ============================================================
function StepTags({ tags, onToggle }: { tags: string[]; onToggle: (t: string) => void }) {
  return (
    <>
      <div className="page-head compact">
        <h1>What do guests usually come for?</h1>
        <p className="sub">Pick as many as apply — this shapes how your venue is discovered.</p>
      </div>
      <div className="hv-chip-grid">
        {GUEST_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={"chip" + (tags.includes(t) ? " on" : "")}
            onClick={() => onToggle(t)}
          >
            {t}
          </button>
        ))}
      </div>
    </>
  );
}

// ============================================================
// Step 3 — photos
// ============================================================
function StepPhotos({
  photos, dragOver, fileRef, onDrop, onDragOver, onDragLeave, onPick, onRemove,
}: {
  photos: PhotoItem[];
  dragOver: boolean;
  fileRef: React.RefObject<HTMLInputElement>;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onPick: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <div className="page-head compact">
        <h1>Show off your venue</h1>
        <p className="sub">Add a few photos — the first one becomes your cover image.</p>
      </div>
      <div
        className={"dropzone" + (dragOver ? " on" : "")}
        onClick={() => fileRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <i className="icon-image-up" />
        <p><b>Drag photos here, or click to browse</b></p>
        <small>JPG, PNG or WebP</small>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { onPick(e.target.files); e.target.value = ""; }}
      />
      {photos.length > 0 && (
        <div className="hv-photo-grid">
          {photos.map((p, i) => (
            <div className="hv-photo-thumb" key={p.id}>
              <img src={p.previewUrl} alt="" />
              {p.status === "uploading" && <div className="hv-photo-spinner"><div className="spin" /></div>}
              {i === 0 && p.status === "done" && <span className="ec-badge featured hv-cover-badge">Cover</span>}
              <button type="button" className="rm" onClick={() => onRemove(p.id)} aria-label="Remove photo">
                <i className="icon-x" />
              </button>
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
  name, setName, description, setDescription, loc, setLoc, address, setAddress, area, setArea, priceRange, setPriceRange,
}: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  loc: { lat: number; lng: number }; setLoc: (v: { lat: number; lng: number }) => void;
  address: string; setAddress: (v: string) => void;
  area: string; setArea: (v: string) => void;
  priceRange: PriceRange | null; setPriceRange: (v: PriceRange) => void;
}) {
  return (
    <>
      <div className="page-head compact">
        <h1>Tell us about your business</h1>
        <p className="sub">The essentials guests will see on your listing.</p>
      </div>
      <div className="form" style={{ padding: "8px 0 0" }}>
        <div className="form-fields">
          <div className="field">
            <label>Business name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shatti Rooftop" />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Tell guests what makes this place worth visiting." />
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
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, building, area" />
          </div>
          <div className="field">
            <label>Area</label>
            <input value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
          <div className="field">
            <label>Price range</label>
            <div className="hv-price-row">
              {PRICE_RANGES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={"hv-select-card hv-price-card" + (priceRange === p ? " on" : "")}
                  onClick={() => setPriceRange(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// Step 5 — availability
// ============================================================
function StepAvailability({
  availability, setDayEnabled, addRange, removeRange, setRange,
}: {
  availability: Record<string, DayAvailability>;
  setDayEnabled: (day: string, enabled: boolean) => void;
  addRange: (day: string) => void;
  removeRange: (day: string, idx: number) => void;
  setRange: (day: string, idx: number, patch: Partial<TimeRange>) => void;
}) {
  return (
    <>
      <div className="page-head compact">
        <h1>Set your weekly availability</h1>
        <p className="sub">Optional for now — you can fine-tune exact slots later from your dashboard.</p>
      </div>
      <div className="hv-avail-list">
        {DAYS.map((day) => {
          const d = availability[day];
          return (
            <div className={"hv-avail-day" + (d.enabled ? " on" : "")} key={day}>
              <label className="hv-avail-day-head">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => setDayEnabled(day, e.target.checked)}
                />
                <span>{day}</span>
              </label>
              {d.enabled && (
                <div className="hv-avail-ranges">
                  {d.ranges.map((r, idx) => (
                    <div className="hv-avail-range" key={idx}>
                      <input type="time" value={r.start} onChange={(e) => setRange(day, idx, { start: e.target.value })} />
                      <span>to</span>
                      <input type="time" value={r.end} onChange={(e) => setRange(day, idx, { end: e.target.value })} />
                      <input
                        type="number" min={1} inputMode="numeric"
                        className="hv-avail-capacity"
                        value={r.capacity}
                        onChange={(e) => setRange(day, idx, { capacity: e.target.value })}
                        placeholder="Capacity"
                      />
                      <button type="button" className="tier-del" onClick={() => removeRange(day, idx)} disabled={d.ranges.length === 1} aria-label="Remove slot">
                        <i className="icon-x" />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="tier-add" onClick={() => addRange(day)}>
                    <i className="icon-plus" /> Add time range
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="note" style={{ marginTop: 14 }}>
        <i className="icon-info" style={{ marginRight: 6 }} />
        These slots are saved locally for now — bulk availability setup on the backend is coming soon.
        You can configure exact time slots with the Weyn team after signup.
      </div>
    </>
  );
}

// ============================================================
// Step 6 — subscription
// ============================================================
function StepSubscription({ tier, setTier }: { tier: SubscriptionTier | null; setTier: (t: SubscriptionTier) => void }) {
  return (
    <>
      <div className="page-head compact">
        <h1>Choose your plan</h1>
        <p className="sub">Pick the plan that fits how you want to grow.</p>
      </div>
      <div className="hv-tier-grid">
        {(Object.keys(TIER_INFO) as SubscriptionTier[]).map((key) => {
          const info = TIER_INFO[key];
          return (
            <button
              key={key}
              type="button"
              className={"hv-tier-card" + (tier === key ? " on" : "")}
              onClick={() => setTier(key)}
            >
              <div className="hv-tier-head">
                <b>{info.label}</b>
                <span>{info.price}</span>
              </div>
              <ul>
                {info.features.map((f) => (
                  <li key={f}><i className="icon-check" /> {f}</li>
                ))}
              </ul>
            </button>
          );
        })}
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
  category, tags, photos, name, description, address, area, priceRange, tier, submitError,
}: {
  category: VenueCategory | null;
  tags: string[];
  photos: PhotoItem[];
  name: string;
  description: string;
  address: string;
  area: string;
  priceRange: PriceRange | null;
  tier: SubscriptionTier | null;
  submitError: string;
}) {
  const catLabel = VENUE_CATS.find((c) => c.key === category)?.label || "—";
  const doneCount = photos.filter((p) => p.status === "done").length;
  return (
    <>
      <div className="page-head compact">
        <h1>Review &amp; submit</h1>
        <p className="sub">Double-check everything before it goes to the Weyn team.</p>
      </div>
      <div className="facts">
        <div className="fact"><i className="icon-store" /><div><b>{name || "—"}</b><span>{catLabel}</span></div></div>
        <div className="fact"><i className="icon-map-pin" /><div><b>{address || "—"}</b><span>{area}</span></div></div>
        <div className="fact"><i className="icon-tag" /><div><b>{priceRange || "—"}</b><span>Price range</span></div></div>
        <div className="fact"><i className="icon-image" /><div><b>{doneCount} photo{doneCount === 1 ? "" : "s"}</b><span>Uploaded</span></div></div>
        <div className="fact"><i className="icon-clock" /><div><b>Availability configured</b><span>Set in step 5 — saved locally for now</span></div></div>
        <div className="fact"><i className="icon-credit-card" /><div><b>{tier ? TIER_INFO[tier].label : "—"}</b><span>{tier ? TIER_INFO[tier].price : "Plan"}</span></div></div>
      </div>
      {description && <p className="blurb">{description}</p>}
      {tags.length > 0 && (
        <div className="tagrow">
          {tags.map((t) => <span className="tg" key={t}>{t}</span>)}
        </div>
      )}
      {submitError && <p className="errline">{submitError}</p>}
    </>
  );
}

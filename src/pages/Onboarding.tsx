import { useEffect, useMemo, useState } from "react";
import { SignUpButton } from "@clerk/react";
import { api, CATS, type Cat, type Weyn, dayLabel, timeLabel } from "../api";
import Stub from "../components/Stub";
import Logo from "../components/Logo";

// Self-contained first-run onboarding flow. Not wired into App.tsx's route
// table — a follow-up pass decides how/when this mounts (see repo notes).
// All progress is local component state; only the final selections are
// persisted, to localStorage, under the weyn.onboarding.* keys below.

const INTERESTS_KEY = "weyn.onboarding.interests";
const SOCIAL_KEY = "weyn.onboarding.socialPrefs";
const DISCOVERY_KEY = "weyn.onboarding.discoveryPrefs";

const INTERESTS = [
  { key: "music", label: "Music", icon: "music" },
  { key: "food", label: "Food", icon: "utensils" },
  { key: "business", label: "Business", icon: "briefcase" },
  { key: "networking", label: "Networking", icon: "users" },
  { key: "sports", label: "Sports", icon: "trophy" },
  { key: "arts", label: "Arts", icon: "palette" },
  { key: "comedy", label: "Comedy", icon: "smile" },
  { key: "family", label: "Family", icon: "heart" },
  { key: "luxury", label: "Luxury", icon: "gem" },
  { key: "nightlife", label: "Nightlife", icon: "moon" },
];

const SOCIAL_PREFS = [
  { key: "solo", label: "Going solo", icon: "user" },
  { key: "friends", label: "With friends", icon: "users" },
  { key: "networking", label: "Networking", icon: "handshake" },
  { key: "family", label: "Family outings", icon: "home" },
  { key: "date", label: "Date nights", icon: "heart" },
];

// Discovery step reuses the same taste categories — asking again, but
// framed around "what to see more of" rather than "what are you into",
// is intentional (mirrors real onboarding flows that double-check signal).
const DISCOVERY = INTERESTS;

function readList(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) || "") as string[]; }
  catch { return []; }
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

// ---- generic multi-select card grid, shared by steps 2/3/4 ----
function CardGrid({ items, selected, onToggle }: { items: { key: string; label: string; icon: string }[]; selected: string[]; onToggle: (key: string) => void }) {
  return (
    <div className="ob-grid">
      {items.map((it) => {
        const on = selected.includes(it.key);
        return (
          <button
            key={it.key}
            type="button"
            className={"ob-card" + (on ? " on" : "")}
            onClick={() => onToggle(it.key)}
            aria-pressed={on}
          >
            <i className={"icon-" + it.icon} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="ob-dots" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={total}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={"ob-dot" + (i === step ? " on" : i < step ? " done" : "")} />
      ))}
    </div>
  );
}

const TOTAL_STEPS = 7;

export default function Onboarding({ onDone }: { onDone?: () => void } = {}) {
  const [step, setStep] = useState(0);
  const [interests, setInterests] = useState<string[]>(() => readList(INTERESTS_KEY));
  const [socialPrefs, setSocialPrefs] = useState<string[]>(() => readList(SOCIAL_KEY));
  const [discoveryPrefs, setDiscoveryPrefs] = useState<string[]>(() => readList(DISCOVERY_KEY));
  const [locationState, setLocationState] = useState<"idle" | "asking" | "granted" | "denied">("idle");
  const [previewEvents, setPreviewEvents] = useState<Weyn[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  function next() { setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1)); }

  function persistInterests(list: string[]) {
    setInterests(list);
    localStorage.setItem(INTERESTS_KEY, JSON.stringify(list));
  }
  function persistSocial(list: string[]) {
    setSocialPrefs(list);
    localStorage.setItem(SOCIAL_KEY, JSON.stringify(list));
  }
  function persistDiscovery(list: string[]) {
    setDiscoveryPrefs(list);
    localStorage.setItem(DISCOVERY_KEY, JSON.stringify(list));
  }

  async function requestLocation() {
    setLocationState("asking");
    try {
      await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!("geolocation" in navigator)) { reject(new Error("unsupported")); return; }
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
      });
      setLocationState("granted");
    } catch {
      // Denied, timed out, or unsupported — never fatal, never blocks progress.
      setLocationState("denied");
    } finally {
      next();
    }
  }

  // Fetch a small preview once step 6 (index 5) is reached.
  useEffect(() => {
    if (step !== 5) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    api.listEvents()
      .then((all) => {
        if (cancelled) return;
        const chosen = interests.length ? interests : discoveryPrefs;
        let list = all.filter((e) => !e.cancelled);
        if (chosen.length) {
          const matched = list.filter((e) => chosen.includes(e.cat as Cat));
          list = matched.length ? matched : list;
        }
        list = [...list].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
        setPreviewEvents(list.slice(0, 6));
      })
      .catch((err) => { if (!cancelled) setPreviewError(err?.message || "Couldn't load events."); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [step, interests, discoveryPrefs]);

  const stepMeta = useMemo(() => ({
    0: "Welcome",
    1: "Interests",
    2: "Social",
    3: "Discovery",
    4: "Location",
    5: "Preview",
    6: "Sign up",
  }[step]), [step]);

  return (
    <div className="ob-shell">
      {step > 0 && <ProgressDots step={step} total={TOTAL_STEPS} />}

      <div className="ob-stage" key={step} aria-label={stepMeta}>
        {/* ---- 1. Welcome ---- */}
        {step === 0 && (
          <div className="ob-step ob-center">
            <Logo size={40} />
            <h1 className="ob-headline">Discover what's happening around you.</h1>
            <p className="ob-sub">A quick setup so Weyn can show you events worth going to.</p>
            <button className="btn lg" onClick={next}>Get started</button>
          </div>
        )}

        {/* ---- 2. Interests ---- */}
        {step === 1 && (
          <div className="ob-step">
            <h2 className="ob-title">What are you into?</h2>
            <p className="ob-sub">Pick as many as you like.</p>
            <CardGrid items={INTERESTS} selected={interests} onToggle={(k) => persistInterests(toggle(interests, k))} />
            <button className="btn lg ob-cta" onClick={next} disabled={interests.length === 0}>Continue</button>
          </div>
        )}

        {/* ---- 3. Social preference ---- */}
        {step === 2 && (
          <div className="ob-step">
            <h2 className="ob-title">What type of experiences do you enjoy?</h2>
            <p className="ob-sub">Pick as many as you like.</p>
            <CardGrid items={SOCIAL_PREFS} selected={socialPrefs} onToggle={(k) => persistSocial(toggle(socialPrefs, k))} />
            <button className="btn lg ob-cta" onClick={next} disabled={socialPrefs.length === 0}>Continue</button>
          </div>
        )}

        {/* ---- 4. Discovery preference ---- */}
        {step === 3 && (
          <div className="ob-step">
            <h2 className="ob-title">What would you like to see more of?</h2>
            <p className="ob-sub">Pick as many as you like.</p>
            <CardGrid items={DISCOVERY} selected={discoveryPrefs} onToggle={(k) => persistDiscovery(toggle(discoveryPrefs, k))} />
            <button className="btn lg ob-cta" onClick={next} disabled={discoveryPrefs.length === 0}>Continue</button>
          </div>
        )}

        {/* ---- 5. Location permission ---- */}
        {step === 4 && (
          <div className="ob-step ob-center">
            <div className="ob-icon-badge"><i className="icon-map-pin" /></div>
            <h2 className="ob-title">Enable location</h2>
            <p className="ob-sub">For better local recommendations.</p>
            <button className="btn lg" onClick={requestLocation} disabled={locationState === "asking"}>
              {locationState === "asking" ? "Requesting…" : "Allow location"}
            </button>
            <button className="btn glass ob-cta" onClick={next}>Skip</button>
          </div>
        )}

        {/* ---- 6. Personalized preview ---- */}
        {step === 5 && (
          <div className="ob-step">
            <h2 className="ob-title">Here's what we found for you</h2>
            <p className="ob-sub">Based on what you picked.</p>
            {previewLoading && (
              <div className="ex-list">
                {[0, 1, 2].map((i) => <div key={i} className="ec-skel"><div className="s-thumb" /><div className="s-lines"><div className="s-a" /><div className="s-b" /></div></div>)}
              </div>
            )}
            {!previewLoading && previewError && (
              <div className="empty"><div className="ic"><i className="icon-cloud-off" /></div><p>{previewError}</p></div>
            )}
            {!previewLoading && !previewError && previewEvents && (
              previewEvents.length ? (
                <div className="ex-list">
                  {previewEvents.map((e) => (
                    <div key={e.id} className="ob-preview-card">
                      <Stub e={e} />
                      <span className="t-caption ob-preview-when">{dayLabel(e)} · {timeLabel(e)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty"><div className="ic"><i className="icon-calendar-off" /></div><p>Nothing matching yet — check back soon.</p></div>
              )
            )}
            <button className="btn lg ob-cta" onClick={next}>Continue</button>
          </div>
        )}

        {/* ---- 7. Sign up ---- */}
        {step === 6 && (
          <div className="ob-step ob-center">
            <Logo size={36} />
            <h2 className="ob-title">Create your account</h2>
            <p className="ob-sub">Save events, get reminders, and pick up where you left off.</p>
            <SignUpButton mode="modal" forceRedirectUrl="/">
              <button className="btn lg" onClick={() => onDone?.()}>Sign up</button>
            </SignUpButton>
            <button className="btn glass ob-cta" onClick={() => onDone?.()}>Maybe later</button>
          </div>
        )}
      </div>
    </div>
  );
}

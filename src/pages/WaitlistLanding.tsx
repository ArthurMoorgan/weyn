import { useState, lazy, Suspense } from "react";
import { Field } from "@base-ui/react/field";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import SplitText from "../components/landing/SplitText";
import RotatingText from "../components/landing/RotatingText";
import ScrollReveal from "../components/landing/ScrollReveal";
import CardSwap, { Card } from "../components/landing/CardSwap";
import GlassSurface from "../components/landing/GlassSurface";

// The public face of weynevents.com while the real app is admin-only (see
// HANDOFF.md) — served standalone, no Clerk/Router/tab-shell, when the page
// is loaded on waitlist.weynevents.com or by a non-admin visitor to the
// main app (see main.tsx and AuthGate.tsx). Deliberately its own tiny
// render tree rather than a route inside the main app: nothing here needs
// auth, the API client, or the tab bar, and keeping it separate means
// visitors here never download any of that.
//
// Ferrofluid (the WebGL hero background) is lazy — ogl + shader compilation
// is the heaviest single piece of this page, and the headline/form must be
// usable immediately even on a slow connection or a browser with no WebGL.
// SplitText/RotatingText stay in this chunk directly: they gate the
// headline itself, so lazy-loading them would just trade a layout flash
// for a network round-trip with no real benefit.
const Ferrofluid = lazy(() => import("../components/landing/Ferrofluid"));
// FloatingLines pulls in three.js (a genuinely heavy dependency) just for a
// low-opacity decorative backdrop further down the page — same reasoning as
// Ferrofluid above, so it doesn't block first paint on a page whose whole
// point is loading fast for a cold, unconverted visitor.
const FloatingLines = lazy(() => import("../components/landing/FloatingLines"));

type Role = "attendee" | "organizer" | "venue";

const ROLES: { key: Role; label: string; icon: string }[] = [
  { key: "attendee", label: "Find events", icon: "sparkles" },
  { key: "organizer", label: "Host events", icon: "circle-plus" },
  { key: "venue", label: "List my venue", icon: "store" },
];

const ROTATING_PHRASES = ["discover events", "host events", "reserve a table"];

// Short, concrete claims to sit next to the screenshots — the kind of
// specifics ("real photos", "dark mode that isn't an afterthought") that
// read as "we actually built this" rather than a generic feature list.
const PROOF_POINTS = [
  { icon: "search", text: "Search by vibe, not just venue name — \"live music\" and \"tonight\" both work." },
  { icon: "moon", text: "A dark mode that's a first-class design, not an inverted filter." },
  { icon: "map-pin", text: "Real venues, real distances — every listing is pinned on an actual map." },
];

const FEATURES = [
  {
    icon: "sparkles",
    title: "Discover what's actually good",
    body: "One feed for Muscat — gigs, pop-ups, rooftop nights, and everything in between. No more piecing it together from a dozen Instagram stories.",
  },
  {
    icon: "circle-plus",
    title: "Host in minutes, not days",
    body: "Publish an event free, sell tickets your way — a link, cash at the door, or your own payment link — and watch sales land in real time.",
  },
  {
    icon: "utensils",
    title: "Reserve a table, skip the back-and-forth",
    body: "Book a spot at Muscat's cafes, restaurants, and lounges without a single WhatsApp message.",
  },
  {
    icon: "chart-bar",
    title: "Built for organizers, not just listings",
    body: "Real dashboards — attendees, revenue, promotion, even AI-assisted event copy — so running an event feels less like guesswork.",
  },
] as const;

interface WaitlistLandingProps {
  // Set by AuthGate when a signed-in-but-non-admin visitor lands here on
  // weynevents.com itself (as opposed to a fresh, signed-out visitor on
  // waitlist.weynevents.com) — swaps the footer's "Sign in" link for a
  // short explanation plus a sign-out action instead.
  signedInAs?: string;
  onSignOut?: () => void;
  // AuthGate also needs a way back to the real sign-in flow for an admin
  // who hasn't authenticated yet — rendered as a discreet footer link
  // rather than surfaced as the default action, since this page's whole
  // point is that it's the front door for everyone else.
  onRequestSignIn?: () => void;
}

export default function WaitlistLanding({ signedInAs, onSignOut, onRequestSignIn }: WaitlistLandingProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("attendee");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [shotTheme, setShotTheme] = useState<"light" | "dark">("light");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, role, source: "waitlist.weynevents.com" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || "Something went wrong — please try again.");
      }
      setDone(true);
    } catch (e: any) {
      setErr(e.message || "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wl-page">
      <header className="wl-top wl-container">
        <Logo size={28} />
        <ThemeToggle />
      </header>

      <section className="wl-hero">
        <div className="wl-hero-bg" aria-hidden="true">
          <Suspense fallback={null}>
            <Ferrofluid
              colors={["#4F46E5", "#4A8DFF", "#8B7CF6"]}
              speed={0.35}
              scale={1.1}
              turbulence={0.8}
              fluidity={0.15}
              rimWidth={0.22}
              sharpness={2.5}
              shimmer={0.8}
              glow={1.6}
              flowDirection="up"
              opacity={0.55}
              mouseInteraction
              mouseStrength={0.8}
              mouseRadius={0.35}
            />
          </Suspense>
        </div>

        <div className="wl-hero-content">
          <span className="wl-eyebrow">Coming soon to Muscat</span>
          <SplitText
            tag="h1"
            className="wl-headline"
            text="Every event worth going to, in one place."
            splitType="words"
            delay={40}
            duration={0.9}
            from={{ opacity: 0, y: 24 }}
            to={{ opacity: 1, y: 0 }}
            textAlign="center"
          />
          <p className="wl-sub">
            The easiest way to{" "}
            <RotatingText
              texts={ROTATING_PHRASES}
              mainClassName="wl-rotating"
              staggerFrom="last"
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-120%", opacity: 0 }}
              staggerDuration={0.015}
              transition={{ type: "spring", damping: 28, stiffness: 380 }}
              rotationInterval={2400}
            />{" "}
            in Muscat. We're putting the finishing touches on it — join the waitlist to be
            first in when we open the doors.
          </p>

          {done ? (
            <div className="wl-success">
              <i className="icon-check-circle" />
              <b>You're on the list.</b>
              <span>We'll email you the moment Weyn is ready.</span>
            </div>
          ) : (
            <div className="wl-glass-wrap">
              <GlassSurface
                width="100%"
                height="auto"
                borderRadius={24}
                backgroundOpacity={0.14}
                distortionScale={-120}
                blur={9}
                className="wl-glass-form"
              >
                <form className="wl-form" onSubmit={submit}>
                  <div className="wl-roles" role="radiogroup" aria-label="What are you interested in?">
                    {ROLES.map((r) => (
                      <button
                        type="button"
                        key={r.key}
                        role="radio"
                        aria-checked={role === r.key}
                        className={"wl-role" + (role === r.key ? " on" : "")}
                        onClick={() => setRole(r.key)}
                      >
                        <i className={"icon-" + r.icon} />
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <div className="wl-fields">
                    <Field.Root className="field">
                      <Field.Label className="wl-field-label">Name (optional)</Field.Label>
                      <Field.Control
                        type="text"
                        className="wl-input"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                      />
                    </Field.Root>
                    <Field.Root className="field">
                      <Field.Label className="wl-field-label">Email</Field.Label>
                      <Field.Control
                        type="email"
                        className="wl-input"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        required
                      />
                    </Field.Root>
                    <button type="submit" className="btn" disabled={busy || !email.trim()}>
                      {busy ? "Joining…" : "Join the waitlist"}
                    </button>
                  </div>
                  {err && <p className="errline">{err}</p>}
                </form>
              </GlassSurface>
            </div>
          )}
        </div>
      </section>

      <section className="wl-shots">
        <div className="wl-shots-head">
          <h2>A first look</h2>
          <p>Built for the way Muscat actually goes out — this is the real app, not a mockup.</p>
        </div>

        <div className="wl-shots-grid">
          <div className="wl-browser-frame">
            <div className="wl-browser-chrome">
              <span className="wl-browser-dot" />
              <span className="wl-browser-dot" />
              <span className="wl-browser-dot" />
              <span className="wl-browser-url"><i className="icon-lock" />weynevents.com</span>
            </div>
            <img src="/marketing/desktop-discover.webp" alt="Weyn's discovery feed on desktop, showing a featured event and a grid of trending events with real photos" loading="lazy" />
          </div>

          <div className="wl-phones-col">
            <button
              type="button"
              className="wl-theme-switch"
              onClick={() => setShotTheme((t) => (t === "light" ? "dark" : "light"))}
              aria-label="Preview the app in light or dark mode"
            >
              <span className={shotTheme === "light" ? "on" : ""}><i className="icon-sun" />Light</span>
              <span className={shotTheme === "dark" ? "on" : ""}><i className="icon-moon" />Dark</span>
            </button>
            <div className="wl-phones-row">
              <div className="wl-phone-frame">
                <div className="wl-phone-notch" />
                <img
                  src={shotTheme === "light" ? "/marketing/mobile-discover-light.webp" : "/marketing/mobile-discover-dark.webp"}
                  alt={`Weyn's discovery feed on mobile in ${shotTheme} mode`}
                  loading="lazy"
                />
              </div>
              <div className="wl-phone-frame wl-phone-frame-small">
                <div className="wl-phone-notch" />
                <img src="/marketing/mobile-event.webp" alt="An event detail page with photos, location, and ticket price" loading="lazy" />
              </div>
            </div>
          </div>
        </div>

        <ul className="wl-proof-points">
          {PROOF_POINTS.map((p) => (
            <li key={p.text}>
              <i className={"icon-" + p.icon} />
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="wl-story wl-container">
        <div className="wl-story-lines" aria-hidden="true">
          <Suspense fallback={null}>
            <FloatingLines
              enabledWaves={["bottom", "middle"]}
              lineCount={5}
              lineDistance={11}
              interactive={false}
              parallax={false}
              animationSpeed={1.3}
              linesGradient={["#4F46E5", "#4A8DFF", "#8B7CF6"]}
              mixBlendMode="screen"
            />
          </Suspense>
        </div>
        <span className="wl-section-eyebrow">How Weyn was created</span>
        <ScrollReveal
          containerClassName="wl-reveal"
          baseOpacity={0.15}
          baseRotation={4}
          blurStrength={6}
        >
          Muscat's nightlife and events scene has always been alive — it just never had a home. A gig gets announced on one Instagram story, a pop-up on another, and the good stuff spreads through screenshots forwarded in WhatsApp groups. By the time you hear about it, half the tickets are gone or the event's already happened.
        </ScrollReveal>
        <ScrollReveal
          containerClassName="wl-reveal"
          baseOpacity={0.15}
          baseRotation={4}
          blurStrength={6}
        >
          Weyn started as a simple question: what if finding out what's happening tonight took one look, not ten apps? We built it for the organizers piecing together spreadsheets and door lists by hand, and for everyone else just trying to figure out where to go.
        </ScrollReveal>
      </section>

      <section className="wl-vision wl-container">
        <span className="wl-section-eyebrow">The vision</span>
        <ScrollReveal
          containerClassName="wl-reveal wl-reveal-accent"
          baseOpacity={0.15}
          baseRotation={4}
          blurStrength={6}
        >
          A city where every event worth going to is one search away — and every organizer, from a first-time host to a full venue, has real tools to run it. Not a listings board. A platform that actually works the night of.
        </ScrollReveal>
      </section>

      <section className="wl-features wl-container">
        <div className="wl-shots-head">
          <h2>What you get</h2>
          <p>Four things Weyn does well, built for how Muscat actually goes out.</p>
        </div>
        <div className="wl-cardswap-wrap">
          <CardSwap width={300} height={220} cardDistance={44} verticalDistance={50} delay={4200} pauseOnHover skewAmount={5}>
            {FEATURES.map((f, i) => (
              <Card key={f.title} customClass="wl-feature-card">
                <span className="wl-feature-card-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <div className="wl-feature-card-body">
                  <i className={"icon-" + f.icon} />
                  <b>{f.title}</b>
                  <span>{f.body}</span>
                </div>
              </Card>
            ))}
          </CardSwap>
        </div>
      </section>

      <footer className="wl-foot wl-container">
        <span>Weyn — Muscat, Oman</span>
        <div className="wl-foot-right">
          {signedInAs ? (
            <span className="wl-foot-note">
              Signed in as {signedInAs} — this app isn't public yet.{" "}
              <button type="button" className="wl-linklike" onClick={onSignOut}>Sign out</button>
            </span>
          ) : onRequestSignIn ? (
            <button type="button" className="wl-linklike" onClick={onRequestSignIn}>Team sign in</button>
          ) : null}
          <a href="mailto:support@weynevents.com">support@weynevents.com</a>
        </div>
      </footer>
    </div>
  );
}

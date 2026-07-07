import { useState } from "react";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

// The public face of weynevents.com while the real app is admin-only (see
// HANDOFF.md) — served standalone, no Clerk/Router/tab-shell, when the page
// is loaded on waitlist.weynevents.com (see main.tsx's hostname check).
// Deliberately its own tiny render tree rather than a route inside the main
// app: nothing here needs auth, the API client, or the tab bar, and keeping
// it separate means visitors here never download any of that.
type Role = "attendee" | "organizer" | "venue";

const ROLES: { key: Role; label: string; icon: string }[] = [
  { key: "attendee", label: "Find events", icon: "sparkles" },
  { key: "organizer", label: "Host events", icon: "circle-plus" },
  { key: "venue", label: "List my venue", icon: "store" },
];

export default function WaitlistLanding() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("attendee");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

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
      <header className="wl-top">
        <Logo size={28} />
        <ThemeToggle />
      </header>

      <main className="wl-hero">
        <span className="wl-eyebrow">Coming soon to Muscat</span>
        <h1>Every event worth going to, in one place.</h1>
        <p className="wl-sub">
          Weyn is a new way to discover events, book tickets, and host your own — built for
          Muscat. We're putting the finishing touches on it. Join the waitlist to be first in
          when we open the doors.
        </p>

        {done ? (
          <div className="wl-success">
            <i className="icon-check-circle" />
            <b>You're on the list.</b>
            <span>We'll email you the moment Weyn is ready.</span>
          </div>
        ) : (
          <form className="wl-form" onSubmit={submit}>
            <div className="wl-roles">
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r.key}
                  className={"wl-role" + (role === r.key ? " on" : "")}
                  onClick={() => setRole(r.key)}
                >
                  <i className={"icon-" + r.icon} />
                  {r.label}
                </button>
              ))}
            </div>
            <div className="wl-fields">
              <input
                type="text"
                placeholder="Your name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <button type="submit" className="btn" disabled={busy || !email.trim()}>
                {busy ? "Joining…" : "Join the waitlist"}
              </button>
            </div>
            {err && <p className="errline">{err}</p>}
          </form>
        )}
      </main>

      <footer className="wl-foot">
        <span>Weyn — Muscat, Oman</span>
        <a href="mailto:support@weynevents.com">support@weynevents.com</a>
      </footer>
    </div>
  );
}

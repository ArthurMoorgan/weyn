import { Suspense, lazy, useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useUser, useClerk } from "@clerk/react";
import { getAuthToken } from "../store";
import LoadingMark from "./LoadingMark";

// Lazy: SignIn/SignUp (see AuthWall.tsx) pull in a substantial chunk of
// Clerk's UI internals. AuthGate wraps every route in the app, so an eager
// import here meant every signed-in visitor's critical-path bundle paid for
// UI they'd never render — this defers that cost to the rare signed-out visit.
const AuthWall = lazy(() => import("./AuthWall"));
// The same landing page served standalone on waitlist.weynevents.com (see
// main.tsx) — reused here so a non-admin visitor to the real domain gets
// the identical "join the waitlist" experience instead of the sign-up
// form, per the app being in private beta (server/app.js's
// ADMIN_ALLOWLIST_EMAILS gate). Lazy for the same reason as AuthWall: most
// visitors during this beta will land here, but it's still not something
// an eventual real signed-in admin session should pay to download.
const WaitlistLanding = lazy(() => import("../pages/WaitlistLanding"));

type AdminStatus = "checking" | "admin" | "blocked" | "error";

// An account is now required to use Weyn at all. This is a layout route (see
// main.tsx) wrapping every route EXCEPT /onboarding — a first-time visitor
// still sees the walkthrough (category picker, location prompt, event
// preview) before being asked to commit, same as before; onboarding's own
// final "sign up" step just no longer has a skip button. This gate is what
// actually enforces it everywhere else: a direct deep link (a shared
// /e/:id, a bookmarked /you, a reload after onboarding is long done) always
// hits this check first, so there's no route that quietly stays reachable
// signed-out.
//
// Tradeoff worth knowing about: this also blocks a signed-out visitor from
// viewing a *shared event link* before creating an account, a real cost to
// the viral "someone sends me a link" growth loop. That's this ask as
// stated, not an oversight — flagging it because it's a one-line revert
// (delete this component from the route tree) if you want it back.
//
// Private-beta layer (new): even a successfully signed-in visitor doesn't
// automatically get into the app — the server rejects every request from
// anyone not on ADMIN_ALLOWLIST_EMAILS (see server/app.js and HANDOFF.md
// §10). This gate mirrors that client-side so a non-admin sees the
// waitlist landing page instead of a broken, all-401s app shell: it makes
// one cheap request (GET /api/me) once signed in, and that response's
// status is the only source of truth for whether the real app renders.
export default function AuthGate() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const location = useLocation();
  const [showSignIn, setShowSignIn] = useState(false);
  const [adminStatus, setAdminStatus] = useState<AdminStatus>("checking");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setAdminStatus("blocked");
      return;
    }
    let cancelled = false;
    setAdminStatus("checking");
    (async () => {
      const token = await getAuthToken();
      const res = await fetch("/api/me", { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
      if (cancelled) return;
      if (res && res.ok) return setAdminStatus("admin");
      // A rate limit, a 5xx, or the fetch itself failing (network hiccup)
      // is NOT the same thing as "this account isn't on the allowlist" —
      // QA found this was previously collapsed into one "blocked" state,
      // which bounced an already-signed-in admin to the public waitlist
      // landing page the moment they got rate-limited (e.g. from refreshing
      // aggressively or having several tabs open). Only a real 401/403/404
      // means "you don't belong here."
      if (!res || res.status === 429 || res.status >= 500) return setAdminStatus("error");
      setAdminStatus("blocked");
    })();
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, user?.id, retryCount]);

  // Auto-retry a transient error once after a few seconds — a rate limit
  // window is usually short-lived, no need to make the user find and click
  // a button for what's likely to resolve on its own.
  useEffect(() => {
    if (adminStatus !== "error") return;
    const t = setTimeout(() => setRetryCount((n) => n + 1), 4000);
    return () => clearTimeout(t);
  }, [adminStatus]);

  // Local visual-QA escape hatch (see qa-explore.cjs): Clerk's dev-instance
  // client-trust CAPTCHA can't be reliably automated headlessly (testing
  // tokens don't bypass it as of clerk-js current), so Playwright runs set
  // this env var to render the app shell without auth. import.meta.env.DEV
  // is statically false in production builds — this branch is dead code on
  // weynevents.com even if the env var were somehow set there.
  if (import.meta.env.DEV && import.meta.env.VITE_QA_BYPASS_AUTHGATE === "1") {
    return <Outlet />;
  }

  // First-time visitors see the walkthrough before being asked to commit —
  // this moved here from Explore.tsx's own effect, since Explore now sits
  // behind this same gate and would never get a chance to redirect. /onboarding
  // itself is a sibling route outside this layout (see main.tsx), so this
  // is the only place that needs to know about it.
  if (!localStorage.getItem("weyn.onboarding.completed") && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (!isLoaded || adminStatus === "checking") {
    // No LoadingMark here on purpose — this state's lifetime overlaps
    // almost exactly with index.html's splash overlay (see splash.ts),
    // which shows the same animated mark already. Rendering a second one
    // underneath just showed a jarring duplicate for the ~0.5–1s handoff
    // between the two before the splash finishes fading out.
    return <div className="route-loading" aria-busy="true" />;
  }

  if (adminStatus === "error") {
    return (
      <div className="route-loading" aria-busy="true" style={{ flexDirection: "column", gap: 12 }}>
        <LoadingMark size={40} />
        <p style={{ color: "var(--text-2)", fontSize: 14, textAlign: "center", padding: "0 24px" }}>
          Having trouble reaching Weyn — retrying automatically…
        </p>
        <button className="btn glass sm" style={{ width: "auto" }} onClick={() => setRetryCount((n) => n + 1)}>
          Retry now
        </button>
      </div>
    );
  }

  if (adminStatus === "blocked") {
    if (!isSignedIn && showSignIn) {
      return (
        <Suspense fallback={<div className="route-loading" aria-busy="true"><LoadingMark /></div>}>
          <div className="authwall-back-wrap">
            <button className="icon-btn authwall-back" onClick={() => setShowSignIn(false)} aria-label="Back">
              <i className="icon-arrow-left" />
            </button>
            <AuthWall />
          </div>
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<div className="route-loading" aria-busy="true"><LoadingMark /></div>}>
        <WaitlistLanding
          signedInAs={isSignedIn ? user?.primaryEmailAddress?.emailAddress || user?.username || undefined : undefined}
          onSignOut={() => signOut()}
          onRequestSignIn={!isSignedIn ? () => setShowSignIn(true) : undefined}
        />
      </Suspense>
    );
  }

  return <Outlet />;
}

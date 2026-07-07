import { Suspense, lazy, useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useUser, useClerk } from "@clerk/react";
import { getAuthToken } from "../store";

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

type AdminStatus = "checking" | "admin" | "blocked";

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
      if (!cancelled) setAdminStatus(res && res.ok ? "admin" : "blocked");
    })();
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, user?.id]);

  // First-time visitors see the walkthrough before being asked to commit —
  // this moved here from Explore.tsx's own effect, since Explore now sits
  // behind this same gate and would never get a chance to redirect. /onboarding
  // itself is a sibling route outside this layout (see main.tsx), so this
  // is the only place that needs to know about it.
  if (!localStorage.getItem("weyn.onboarding.completed") && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (!isLoaded || adminStatus === "checking") {
    return <div className="route-loading" aria-busy="true" />;
  }

  if (adminStatus === "blocked") {
    if (!isSignedIn && showSignIn) {
      return (
        <Suspense fallback={<div className="route-loading" aria-busy="true" />}>
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
      <Suspense fallback={<div className="route-loading" aria-busy="true" />}>
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

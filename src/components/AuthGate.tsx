import { useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useUser, SignIn, SignUp } from "@clerk/react";
import Logo from "./Logo";

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
export default function AuthGate() {
  const { isLoaded, isSignedIn } = useUser();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");
  const location = useLocation();

  // First-time visitors see the walkthrough before being asked to commit —
  // this moved here from Explore.tsx's own effect, since Explore now sits
  // behind this same gate and would never get a chance to redirect. /onboarding
  // itself is a sibling route outside this layout (see main.tsx), so this
  // is the only place that needs to know about it.
  if (!localStorage.getItem("weyn.onboarding.completed") && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (!isLoaded) {
    return <div className="route-loading" aria-busy="true" />;
  }

  if (!isSignedIn) {
    return (
      <div className="authwall">
        <div className="authwall-inner">
          <Logo size={36} />
          <h1 className="authwall-title">Welcome to Weyn</h1>
          <p className="authwall-sub">Create an account to discover, book, and host events in Muscat.</p>
          <div className="authwall-form">
            {/* key= forces a remount on mode switch — SignIn/SignUp keep
                internal step state (e.g. mid-verification) that shouldn't
                carry over when the user taps the toggle below. */}
            {mode === "sign-up" ? (
              <SignUp key="sign-up" forceRedirectUrl="/" />
            ) : (
              <SignIn key="sign-in" forceRedirectUrl="/" />
            )}
          </div>
          <button className="authwall-switch" onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}>
            {mode === "sign-up" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

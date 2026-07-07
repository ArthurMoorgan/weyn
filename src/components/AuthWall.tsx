import { useState } from "react";
import { SignIn, SignUp } from "@clerk/react";
import Logo from "./Logo";

// Split out of AuthGate.tsx and lazy-loaded from there — SignIn/SignUp pull
// in a substantial chunk of Clerk's UI internals, and AuthGate wraps every
// route in the app. Importing them eagerly meant every signed-in visitor
// (the overwhelming majority of loads) paid for that weight in their
// critical-path bundle despite never rendering this component. Isolating it
// here means that cost only lands on the rare signed-out visitor.
export default function AuthWall() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");

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

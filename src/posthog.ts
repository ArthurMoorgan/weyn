// Dynamically imported, never a static top-level import of "posthog-js" —
// that library is a meaningful chunk of code, and a static import here
// would land it in main.tsx's entry bundle for every single visitor (the
// exact mistake AuthGate.tsx made with Clerk's SignIn/SignUp, see
// HANDOFF.md §3). Deferring it costs one microtask on first call and keeps
// analytics off the critical path entirely.
type PostHogModule = typeof import("posthog-js");

// No-op if the project token isn't set — same pattern as every other
// optional integration in this codebase (Sentry, VAPID, Resend): local dev
// and any environment without the key just doesn't send anything, rather
// than throwing.
const TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN as string | undefined;

let posthogPromise: Promise<PostHogModule["default"]> | null = null;

function loadPostHog(): Promise<PostHogModule["default"]> | null {
  if (!TOKEN) return null;
  if (!posthogPromise) {
    posthogPromise = import("posthog-js").then((mod) => {
      const posthog = mod.default;
      posthog.init(TOKEN, {
        api_host: (import.meta.env.VITE_POSTHOG_HOST as string) || "https://us.i.posthog.com",
        // React Router changes the URL via history.pushState, which
        // posthog-js's own pageview autocapture already detects — no manual
        // route-change wiring needed.
        capture_pageview: true,
        person_profiles: "identified_only",
      });
      return posthog;
    });
  }
  return posthogPromise;
}

export function initPostHog() {
  loadPostHog();
}

// Called once Clerk resolves who's signed in (see ClerkAuthBridge in
// main.tsx) — links whatever anonymous activity already happened this
// session to the real user, and tags every event after with their id.
export function identifyPostHog(userId: string, props?: Record<string, unknown>) {
  loadPostHog()?.then((posthog) => posthog.identify(userId, props));
}

export function resetPostHog() {
  loadPostHog()?.then((posthog) => posthog.reset());
}

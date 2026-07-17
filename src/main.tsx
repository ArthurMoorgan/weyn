import {ClerkProvider, useAuth, useUser} from "@clerk/react";
import React, { lazy, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { Capacitor } from "@capacitor/core";
import "./ikonate.css";
import "./index.css";
import App from "./App";
import { setTokenGetter } from "./store";
// Onboarding (the first-run redirect target) stays eagerly bundled — it's
// critical path for a brand new visitor. The 4 bottom-tab pages (Explore,
// Reservations, Tickets, You) are imported and rendered by App.tsx itself,
// not routed here — see the comment there for why. Everything else is
// code-split: each route becomes its own chunk fetched on navigation, which
// pulls the heavy deps out of the initial bundle — leaflet (MapPicker/
// MiniMap, used by host + venue-detail) and html5-qrcode (You.tsx's door
// scanner, ~200KB) now only download when someone actually visits those
// routes.
import Onboarding from "./pages/Onboarding";
import ErrorBoundary from "./components/ErrorBoundary";
import AuthGate from "./components/AuthGate";
import RouteTransitions from "./motion/RouteTransitions";
import { initPush, identifyPushUser, clearPushUser } from "./push";
import { getAuthToken } from "./store";
import { markSplashShown, dismissSplash } from "./splash";
import { initPostHog, identifyPostHog, resetPostHog } from "./posthog";

const EventDetail = lazy(() => import("./pages/EventDetail"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Saved = lazy(() => import("./pages/Saved"));
const Organizer = lazy(() => import("./pages/Organizer"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const CheckoutCancel = lazy(() => import("./pages/CheckoutCancel"));
const OrganizerPaymentCheckout = lazy(() => import("./pages/OrganizerPaymentCheckout"));
const InviteAccept = lazy(() => import("./pages/InviteAccept"));
const CollectionPage = lazy(() => import("./pages/Collection"));
const Admin = lazy(() => import("./pages/Admin"));
const OrganizerProfile = lazy(() => import("./pages/OrganizerProfile"));
const HostVenue = lazy(() => import("./pages/HostVenue"));
const VenueDetail = lazy(() => import("./pages/VenueDetail"));
const Support = lazy(() => import("./pages/Support"));
const Account = lazy(() => import("./pages/Account"));
const NotFound = lazy(() => import("./pages/NotFound"));
const OrganizerLayout = lazy(() => import("./pages/organizer/Layout"));
const OrganizerOverview = lazy(() => import("./pages/organizer/Overview"));
const OrganizerEvents = lazy(() => import("./pages/organizer/Events"));
const OrganizerEventWorkspace = lazy(() => import("./pages/organizer/EventWorkspace"));
const OrganizerAttendees = lazy(() => import("./pages/organizer/Attendees"));
const OrganizerMarketingHub = lazy(() => import("./pages/organizer/MarketingHub"));
const OrganizerWorkflows = lazy(() => import("./pages/organizer/Workflows"));
const OrganizerAiStudio = lazy(() => import("./pages/organizer/AiStudio"));
const OrganizerSettings = lazy(() => import("./pages/organizer/Settings"));
const VenueList = lazy(() => import("./pages/venue-os/VenueList"));
const VenueWorkspace = lazy(() => import("./pages/venue-os/Workspace"));

// as close to page-load as this module can get, so the splash's minimum
// on-screen duration is measured from real first-paint, not from whenever
// Explore's data finishes loading.
markSplashShown();

// Deferred to after `load` (idle-callback if available) — calling this
// synchronously here put posthog-js's dynamic import + its pageview request
// in the browser's critical request chain for the FIRST paint, which
// Lighthouse flagged (1.5s chain latency) for a request that has nothing to
// do with rendering the page. Analytics can wait until the page is actually
// usable.
function deferInitPostHog() {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => initPostHog(), { timeout: 4000 });
  else setTimeout(initPostHog, 1000);
}
if (document.readyState === "complete") deferInitPostHog();
else window.addEventListener("load", deferInitPostHog, { once: true });

// BrowserRouter (real paths) on web — required for server-side OG/meta tags
// on shared event links, which HashRouter makes structurally impossible
// (the fragment after # never reaches the server). HashRouter stays for the
// native app: Capacitor loads dist/ from a local file/capacitor:// scheme
// with no server behind it to rewrite arbitrary paths, so a deep link or
// in-app reload on a nested route would 404 under BrowserRouter there.
const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter;

// Unlike Maps' graceful-degradation pattern, there's no
// fallback path without Clerk anymore — auth just won't work without this,
// same as if CLERK_SECRET_KEY/DATABASE_URL were missing on the server.
const PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) || "";

// api.ts is a plain module (not a component), so it can't call the useAuth()
// hook itself to get a fresh session token on every authenticated request.
// This bridges Clerk's getToken() into store.ts's module-level tokenGetter
// once ClerkProvider has mounted — see store.ts's getAuthToken/setTokenGetter.
// Lives here (above <Routes>, inside <ClerkProvider>) rather than in App.tsx
// so every route gets a working token, not just the tabbed ones nested
// under App — EventDetail's booking flow and InviteAccept's accept-invite
// call also need an authenticated fetch and sit outside App's <Outlet>.
function ClerkAuthBridge() {
  const { getToken, isLoaded } = useAuth();
  const { user } = useUser();
  useEffect(() => {
    if (!isLoaded) return;
    setTokenGetter(() => getToken());
    return () => setTokenGetter(null);
  }, [isLoaded, getToken]);
  useEffect(() => {
    if (user) identifyPostHog(user.id, { email: user.primaryEmailAddress?.emailAddress });
    else resetPostHog();
  }, [user?.id]);
  // Link this device's OneSignal subscription to Weyn's own userId (not
  // Clerk's user.id — see /api/me) on sign-in, and unlink on sign-out, so
  // server-side notifyUser(userId) calls can reach this device. Fetches
  // /api/me itself rather than useAccount() so this stays a plain effect
  // independent of that hook's render lifecycle.
  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { clearPushUser(); return; }
    let cancelled = false;
    getAuthToken()
      .then((token) => fetch("/api/me", { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => { if (!cancelled && me?.id) identifyPushUser(me.id); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isLoaded, user?.id]);
  return null;
}

// dismissSplash() used to be called only from Explore.tsx's data-loaded
// effect — fine when "/" was always the first page a browser ever hit, but
// broken for two real cases: a brand-new visitor landing on a shared link
// (/e/:id, /invite/:token) who never mounts Explore at all, and a brand-new
// visitor who gets redirected from Explore to /onboarding before Explore's
// own fetch resolves. Either way index.html's #splash overlay
// (`document.documentElement.classList` stuck on "show-splash") never gets
// torn down — the whole app is permanently hidden behind the logo screen.
// Mounted once at the root, independent of which route loads first.
function SplashDismisser() {
  useEffect(() => { dismissSplash(); }, []);
  return null;
}

// waitlist.weynevents.com serves ONLY the waitlist landing page — no Clerk,
// no Router, no tab shell. Checked before any of that mounts so a visitor
// there never downloads any of it. `?waitlist=1` is a local-dev escape
// hatch (no easy way to hit a real subdomain against `npm run dev`).
const isWaitlistHost =
  window.location.hostname === "waitlist.weynevents.com" ||
  new URLSearchParams(window.location.search).has("waitlist");

if (isWaitlistHost) {
  import("./pages/WaitlistLanding").then(({ default: WaitlistLanding }) => {
    markSplashShown();
    dismissSplash();
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <WaitlistLanding />
      </React.StrictMode>
    );
  });
} else {
  renderMainApp();
}

function renderMainApp() {
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* Wraps every route, not just the tabbed ones — EventDetail's booking
          flow, OrganizerProfile's follow button, and the invite-accept page
          all need Clerk hooks too (clerk init's default scaffold only wrapped
          the nested tab routes, which would crash any page outside them the
          moment it called useUser()/useAuth()). */}
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        afterSignOutUrl="/"
        appearance={{
          // Clerk's default modal aligns the card to the top of the backdrop
          // (so a long form scrolls into view instead of getting clipped) —
          // on a short mobile viewport that reads as "the sheet opens pinned
          // to the top of the screen." Centering it vertically still lets
          // the backdrop scroll if a form is ever taller than the viewport.
          elements: { modalBackdrop: { alignItems: "center" } },
        }}
      >

        <ClerkAuthBridge />
        <SplashDismisser />
        {/* Above <Router>, not inside it — a shared layoutId morph (e.g. an
            Explore card into EventDetail's hero) has to survive React
            Router unmounting/remounting App across that navigation, and
            MotionConfig's reduced-motion context needs to keep applying to
            whatever's still mounted while that happens. reducedMotion="user"
            defers to each animation's own opt-out rather than force-disabling
            everything, matching prefers-reduced-motion at the OS level. */}
        <MotionConfig reducedMotion="user">
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          {/* Directional fade+scale between route groups. Owns the frozen
              <Routes location> + Suspense so a lazy chunk suspending can't
              block the outgoing page's EXIT animation — see RouteTransitions. */}
          <RouteTransitions>
            {/* /onboarding is the one route reachable signed-out — everything
                else sits behind AuthGate, see that file for why. */}
            <Route
              path="/onboarding"
              element={
                <Onboarding
                  onDone={() => {
                    localStorage.setItem("weyn.onboarding.completed", "1");
                    window.location.replace("/");
                  }}
                />
              }
            />
            <Route element={<AuthGate />}>
              {/* "/", "/tickets", "/you" have no element here — App.tsx
                  renders those 3 bottom-tab pages itself, keeping each
                  mounted (scroll position, in-flight state, etc. preserved)
                  once visited instead of remounting on every tab switch like
                  a normal Outlet would. These Routes exist only so the router
                  matches the path and mounts <App/> at all; see App.tsx for
                  the actual rendering. */}
              <Route element={<App />}>
                <Route path="/" />
                {/* Reservations is no longer its own tab — venue browsing
                    folded into Discover's Venues mode. Keep the old path
                    working by redirecting it home. */}
                <Route path="/reservations" element={<Navigate to="/" replace />} />
                <Route path="/tickets" />
                <Route path="/saved" element={<Saved />} />
                <Route path="/host/events" element={<Organizer />} />
                <Route path="/host/venue" element={<HostVenue />} />
                <Route path="/you" />
                <Route path="/admin" element={<Admin />} />
                {/* /organizer/* — the real organizer dashboard (HANDOFF.md
                    §17), rendered through App's shared shell same as /admin.
                    Every sub-path here is a static segment ("events",
                    "attendees", ...), which React Router ranks above the
                    single dynamic /organizer/:id public-profile route below
                    at the same depth — the two coexist safely unless an
                    organizer's id is literally the string "events" etc,
                    which cuid-style ids never are. */}
                <Route path="/organizer" element={<OrganizerLayout />}>
                  <Route index element={<OrganizerOverview />} />
                  <Route path="events" element={<OrganizerEvents />} />
                  <Route path="events/:id" element={<OrganizerEventWorkspace />} />
                  <Route path="events/:id/:tab" element={<OrganizerEventWorkspace />} />
                  <Route path="attendees" element={<OrganizerAttendees />} />
                  <Route path="marketing" element={<OrganizerMarketingHub />} />
                  <Route path="workflows" element={<OrganizerWorkflows />} />
                  <Route path="ai-studio" element={<OrganizerAiStudio />} />
                  <Route path="settings" element={<OrganizerSettings />} />
                </Route>
                {/* /venue-os/* — the venue owner's own dashboard (promoted
                    out of You.tsx's "Your venues" tab the same way
                    /organizer was promoted out of its old tab). Static
                    segment ranking note doesn't apply here the same way —
                    :venueId is always a cuid, never literally a nav label. */}
                <Route path="/venue-os" element={<VenueList />} />
                <Route path="/venue-os/:venueId" element={<VenueWorkspace />} />
                <Route path="/venue-os/:venueId/:tab" element={<VenueWorkspace />} />
              </Route>
              <Route path="/e/:id" element={<EventDetail />} />
              <Route path="/e/:id/checkout" element={<Checkout />} />
              <Route path="/reservations/:id" element={<VenueDetail />} />
              <Route path="/organizer/:id" element={<OrganizerProfile />} />
              <Route path="/checkout/success" element={<CheckoutSuccess />} />
              <Route path="/checkout/cancel" element={<CheckoutCancel />} />
              <Route path="/checkout/organizer-payment" element={<OrganizerPaymentCheckout />} />
              <Route path="/invite/:token" element={<InviteAccept />} />
              <Route path="/collections/:id" element={<CollectionPage />} />
              <Route path="/support" element={<Support />} />
              <Route path="/account" element={<Account />} />
              {/* Catch-all — unknown paths used to render a bare black
                  screen (no matching route, nothing mounted). */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </RouteTransitions>
        </Router>
        </MotionConfig>
      </ClerkProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// register the service worker so the app is installable + works offline
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// no-op on web; requests permission + registers for APNs on native iOS/Android
initPush();
}

import {ClerkProvider, useAuth} from "@clerk/react";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, BrowserRouter, Routes, Route } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import "leaflet/dist/leaflet.css";
import "./lucide.css";
import "./index.css";
import App from "./App";
import { setTokenGetter } from "./store";
import Explore from "./pages/Explore";
import EventDetail from "./pages/EventDetail";
import Saved from "./pages/Saved";
import Organizer from "./pages/Organizer";
import You from "./pages/You";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import CheckoutCancel from "./pages/CheckoutCancel";
import InviteAccept from "./pages/InviteAccept";
import CollectionPage from "./pages/Collection";
import Admin from "./pages/Admin";
import OrganizerProfile from "./pages/OrganizerProfile";
import HostHub from "./pages/HostHub";
import HostVenue from "./pages/HostVenue";
import Reservations from "./pages/Reservations";
import VenueDetail from "./pages/VenueDetail";
import Onboarding from "./pages/Onboarding";
import ErrorBoundary from "./components/ErrorBoundary";
import { initPush } from "./push";
import { markSplashShown } from "./splash";

// as close to page-load as this module can get, so the splash's minimum
// on-screen duration is measured from real first-paint, not from whenever
// Explore's data finishes loading.
markSplashShown();

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
  useEffect(() => {
    if (!isLoaded) return;
    setTokenGetter(() => getToken());
    return () => setTokenGetter(null);
  }, [isLoaded, getToken]);
  return null;
}

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
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route element={<App />}>
              <Route path="/" element={<Explore />} />
              <Route path="/reservations" element={<Reservations />} />
              <Route path="/saved" element={<Saved />} />
              <Route path="/host" element={<HostHub />} />
              <Route path="/host/events" element={<Organizer />} />
              <Route path="/host/venue" element={<HostVenue />} />
              <Route path="/you" element={<You />} />
              <Route path="/admin" element={<Admin />} />
            </Route>
            <Route path="/e/:id" element={<EventDetail />} />
            <Route path="/reservations/:id" element={<VenueDetail />} />
            <Route path="/organizer/:id" element={<OrganizerProfile />} />
            <Route path="/checkout/success" element={<CheckoutSuccess />} />
            <Route path="/checkout/cancel" element={<CheckoutCancel />} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route path="/collections/:id" element={<CollectionPage />} />
            <Route path="/onboarding" element={<Onboarding />} />
          </Routes>
        </Router>
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

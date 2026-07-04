import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, BrowserRouter, Routes, Route } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
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
import { initPush } from "./push";

// BrowserRouter (real paths) on web — required for server-side OG/meta tags
// on shared event links, which HashRouter makes structurally impossible
// (the fragment after # never reaches the server). HashRouter stays for the
// native app: Capacitor loads dist/ from a local file/capacitor:// scheme
// with no server behind it to rewrite arbitrary paths, so a deep link or
// in-app reload on a nested route would 404 under BrowserRouter there.
const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<Explore />} />
          <Route path="/saved" element={<Saved />} />
          <Route path="/host" element={<Organizer />} />
          <Route path="/you" element={<You />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
        <Route path="/e/:id" element={<EventDetail />} />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout/cancel" element={<CheckoutCancel />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/collections/:id" element={<CollectionPage />} />
      </Routes>
    </Router>
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

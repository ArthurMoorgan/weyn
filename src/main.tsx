import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
import Explore from "./pages/Explore";
import EventDetail from "./pages/EventDetail";
import Saved from "./pages/Saved";
import Organizer from "./pages/Organizer";
import You from "./pages/You";
import { initPush } from "./push";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<Explore />} />
          <Route path="/saved" element={<Saved />} />
          <Route path="/host" element={<Organizer />} />
          <Route path="/you" element={<You />} />
        </Route>
        <Route path="/e/:id" element={<EventDetail />} />
      </Routes>
    </HashRouter>
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

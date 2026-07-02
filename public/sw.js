// Weyn service worker — offline app shell + installability.
// Conservative: never caches the API, uploads, or dev modules, so local dev stays live.

const CACHE = "weyn-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map tiles, fonts, cross-origin → network
  // never intercept live data or dev tooling
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/uploads") ||
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src") ||
    url.pathname.includes("node_modules")
  ) return;

  // navigations: network-first so online users always get fresh HTML; offline → cached shell
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }

  // static assets (icons, manifest, built JS/CSS): cache-first, fill cache on miss
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => hit)
    )
  );
});

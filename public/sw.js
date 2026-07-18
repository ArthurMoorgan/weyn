// Weyn service worker — offline app shell + installability.
// Conservative: never caches the API, uploads, or dev modules, so local dev stays live.

// Bumped to v2: /icons3d/*.webp changed (colored icon art) and the old
// cache-first strategy below had no version-based invalidation — a visitor
// who'd loaded the site before would keep seeing the stale cached icons
// forever, hard refresh included, since the SW intercepts the fetch before
// it reaches the network. Bumping this string forces `activate` to purge
// the old cache and re-fetch everything fresh.
const CACHE = "weyn-v2";
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

// Web Push (VAPID) — server/webpush.js sends JSON.stringify({title, body,
// data, url}) as the push payload; this listener is what actually turns
// that payload into a visible OS notification. Without it, a subscribed
// browser silently receives the push event and shows nothing.
self.addEventListener("push", (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { title: "Weyn", body: e.data?.text() || "" }; }
  const { title = "Weyn", body = "", url = "/", data = {} } = payload;
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { ...data, url },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) if (c.url.includes(self.location.origin) && "focus" in c) return c.focus();
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map tiles, fonts, cross-origin → network
  // never intercept live data, dev tooling, or /icons3d — that art gets
  // swapped in place under the same filenames (see the CACHE-bump comment
  // above), so cache-first here would silently strand visitors on
  // whatever version they first loaded.
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/uploads") ||
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src") ||
    url.pathname.startsWith("/icons3d") ||
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

// Keeps the app opening offline. The page is fetched fresh when online and falls back to the saved copy.
const CACHE = "gowerfiles-v16";
const SHELL = ["./", "index.html", "app.js", "firebase-config.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
const CDN = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // Firebase's own sign-in pages must never be intercepted.
  if (url.origin === location.origin && url.pathname.startsWith("/__/")) return;

  if (url.origin === location.origin) {
    // Own files: network first, saved copy when offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match("index.html")))
    );
    return;
  }

  if (CDN.indexOf(url.hostname) >= 0) {
    // Firebase code and fonts: saved copy first, refreshed in the background.
    e.respondWith(
      caches.match(req).then((m) => {
        const fresh = fetch(req).then((res) => {
          if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => m);
        return m || fresh;
      })
    );
  }
});

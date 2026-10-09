// Minimal service worker — exists only to satisfy browser PWA-installability
// criteria ("Add to Home Screen" / install prompt). Deliberately does no
// caching: every request just passes straight through to the network, so
// this app always shows live data and never serves stale cached pages.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

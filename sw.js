const CACHE_NAME = "bthm-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/index.js",
  "/style.css",
  "/manifest.json",
  "/heart.png",
  "/favicon.ico",
  "/audio/lower-limit-crossed.mp3",
  "/audio/upper-limit-crossed.mp3",
  "/audio/within-range.mp3",
];

// Cache all assets on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Remove old caches on activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first: serve from cache, fall back to network
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// Show a system notification when the page posts an ALERT message
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "ALERT") return;
  event.waitUntil(
    self.registration.showNotification("HR Monitor Alert", {
      body: event.data.message,
      icon: "/heart.png",
      tag: "hr-alert",         // replaces previous alert instead of stacking
      renotify: true,           // vibrate/sound even if same tag
    })
  );
});

// Network-first, cache-as-fallback. This dashboard shows live trade data
// (data.json refreshed every ~15min) — a cache-first strategy would risk
// showing stale numbers as if current, which is worse than no offline
// support at all. The cache exists only so the app still opens (with
// last-known data) when actually offline, never to prefer old data over new.
const CACHE_NAME = 'house-dashboards-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

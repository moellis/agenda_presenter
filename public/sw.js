// Zwischenspeicher, damit die Anzeige auch nach einem Neustart ohne Netz startet.
// Nur in sicheren Kontexten (https oder localhost) verfügbar.
const CACHE = 'agenda-v2';
const PRECACHE = ['/display.css', '/display.js', '/mobile.css', '/mobile.js', '/fonts/outfit-latin.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;               // Daten: Seite kümmert sich selbst (localStorage)

  if (req.mode === 'navigate') {                               // Seiten: erst Netz, sonst Zwischenspeicher
    e.respondWith(
      fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }
  if (/^\/(display\.|mobile\.|fonts\/|uploads\/)/.test(url.pathname)) { // Dateien: Zwischenspeicher zuerst, im Hintergrund erneuern
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; }).catch(() => hit);
        return hit || net;
      })
    );
  }
});

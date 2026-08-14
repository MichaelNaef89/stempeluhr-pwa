/* Service Worker – App-Shell Cache, damit die App komplett offline läuft. */

const VERSION = 'v6';
const SHELL_CACHE = `stempeluhr-shell-${VERSION}`;
const FONT_CACHE = `stempeluhr-fonts-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './db.js',
  './sync.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // einzeln adden: ein fehlendes File soll nicht die ganze Installation killen
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== FONT_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Google-Fonts: stale-while-revalidate, damit die Schrift auch offline da ist.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Nur eigene Origin behandeln.
  if (url.origin !== self.location.origin) return;

  // API-Aufrufe nie cachen – die brauchen immer den aktuellen Server-Stand
  // (bzw. sollen bei fehlender Verbindung einfach fehlschlagen, das übernimmt sync.js).
  if (url.pathname.startsWith('/api/')) return;

  // Navigationen: Netz zuerst (für Updates), Fallback auf gecachte index.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Assets: Cache zuerst, im Hintergrund aktualisieren.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});

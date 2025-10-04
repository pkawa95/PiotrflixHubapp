/* PiotrFlix SW — basic offline cache */
const CACHE_NAME = 'piotrflix-v1';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',

  // Ikony / grafiki w static/
  './static/logo.png',
  './static/icon.png',
  './static/favicon.ico',
  './static/apple-touch-icon.png',
  './static/apple-touch-icon-120x120.png',
  './static/apple-touch-icon-152x152.png',
  './static/apple-touch-icon-precomposed.png',
  './static/icon-192.png',
  './static/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;

      if (sameOrigin) {
        return fetch(req)
          .then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
            return res;
          })
          .catch(() => {
            if (req.headers.get('accept')?.includes('text/html')) {
              return caches.match('./index.html');
            }
          });
      } else {
        return fetch(req).catch(() => undefined);
      }
    })
  );
});

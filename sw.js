/* ============================================================
   sw.js — offline support for Inkwell
   Bump CACHE whenever the shell files change so clients refresh.
   ============================================================ */
const CACHE = 'inkwell-v1';

/* Relative URLs so the app works from any GitHub Pages sub-path. */
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/store.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fails as a unit, so add individually and tolerate a miss
      .then(cache => Promise.all(SHELL.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Navigations: try the network, fall back to the cached shell offline.
     A share-target launch is a navigation with query params, so always
     fall back to index.html rather than the exact URL. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('index.html', { ignoreSearch: true })
          .then(hit => hit || caches.match('./', { ignoreSearch: true }))
      )
    );
    return;
  }

  /* Google Fonts (and any other cross-origin asset): cache, then revalidate. */
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(req).then(hit => {
          const network = fetch(req).then(res => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
            return res;
          }).catch(() => hit);
          return hit || network;
        })
      )
    );
    return;
  }

  /* Same-origin assets: cache first, refresh in the background. */
  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(hit => {
        const network = fetch(req).then(res => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        }).catch(() => hit);
        return hit || network;
      })
    )
  );
});

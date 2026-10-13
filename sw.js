/* ============================================================
   sw.js — offline support for Inkwell
   Bump VERSION whenever the shell files change: the cache name
   is built from it, so every client picks the new files up.
   ============================================================ */
const VERSION = '1.1.0';
const CACHE = 'inkwell-' + VERSION;

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

/* Fetch straight from the network, past every HTTP cache, and keep
   the result. This is what makes "Update app" actually update.
   Resolves with how many files really came down, so the page can tell
   a successful refresh from a device that is simply offline. */
function prime(cache) {
  let fetched = 0;
  return Promise.all(SHELL.map(url =>
    fetch(new Request(url, { cache: 'reload' }))
      .then(res => {
        if (!res || !res.ok) return null;
        fetched++;
        return cache.put(url, res);
      })
      .catch(() => null)
  )).then(() => fetched);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(prime)
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

function reply(event, data) {
  if (event.ports && event.ports[0]) { try { event.ports[0].postMessage(data); } catch (_) {} }
}

self.addEventListener('message', event => {
  const msg = event.data || {};

  if (msg.type === 'skip-waiting') { self.skipWaiting(); return; }

  if (msg.type === 'version') { reply(event, { version: VERSION, cache: CACHE }); return; }

  /* Re-download the shell over the top of whatever is cached, then tell
     the page it is safe to reload. Used when the worker itself has not
     changed but the files it serves have. */
  if (msg.type === 'refresh') {
    event.waitUntil(
      caches.open(CACHE)
        .then(prime)
        .then(fetched => reply(event, {
          ok: fetched === SHELL.length,
          fetched: fetched,
          total: SHELL.length,
          version: VERSION
        }))
        .catch(() => reply(event, { ok: false, fetched: 0, total: SHELL.length }))
    );
    return;
  }
});

/* Hand back the shell with `?u=<stamp>` on its own stylesheet and scripts.

   This is what lets an open app move onto new files. A navigation to a URL
   the browser already knows lets it answer the page's stylesheet and script
   requests from a copy it is already holding, without consulting this worker
   at all — so new files sit in the cache unused until the app is closed and
   opened again, which is why updating an installed PWA has a reputation for
   needing a reinstall. Stamped URLs have never been requested before, so
   they have to come through here. The stamp is stripped again before the
   cache is touched, so it never becomes a second copy of anything. */
function stampShell(res, stamp) {
  return res.text().then(html => new Response(
    html.replace(/(href|src)=(["'])((?:css|js)\/[^"']+)\2/g,
                 '$1=$2$3?u=' + encodeURIComponent(stamp) + '$2'),
    { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  ));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Navigations: try the network, fall back to the cached shell offline.
     A share-target launch is a navigation with query params, so always
     fall back to index.html rather than the exact URL. */
  if (req.mode === 'navigate') {
    const stamp = url.searchParams.get('u');
    event.respondWith(
      fetch(req)
        .catch(() =>
          caches.match('index.html', { ignoreSearch: true })
            .then(hit => hit || caches.match('./', { ignoreSearch: true }))
        )
        .then(res => (res && res.ok && stamp ? stampShell(res, stamp) : res))
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

  /* Same-origin assets: cache first, refresh in the background.

     The background copy asks the server to revalidate rather than trusting
     the browser's own HTTP cache. GitHub Pages hands these files out with a
     ten-minute lifetime, and without this the refresh could quietly write a
     ten-minute-old copy back over one we had just fetched. Revalidating costs
     a 304 and the page is already being served from the cache by then. */
  const fresh = (() => {
    try { return new Request(req, { cache: 'no-cache' }); }
    catch (_) { return req; }
  })();

  /* One cache entry per file, whatever query a relaunch put on the request. */
  const key = url.origin + url.pathname;

  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(key).then(hit => {
        const network = fetch(hit ? fresh : req).then(res => {
          if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
          return res;
        }).catch(() => hit);
        return hit || network;
      })
    )
  );
});

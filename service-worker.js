/* Synapse · service-worker.js
   - App shell is precached, so the app opens offline.
   - Same-origin files: stale-while-revalidate (fast, and refreshed in the background).
   - Fonts and PDF/ZIP libraries from public CDNs: cache-first, saved the first time they're used.
   - AI provider and Wikimedia requests are never cached or intercepted.
   Bump VERSION whenever the shell files change. */
const VERSION = 'synapse-v4';
const SHELL_CACHE = VERSION + '-shell';
const CDN_CACHE = VERSION + '-cdn';

const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.json',
  'js/util.js', 'js/markdown.js', 'js/diagrams.js', 'js/schema.js', 'js/providers.js', 'js/openai.js', 'js/storage.js',
  'js/images.js', 'js/generator.js', 'js/mock.js', 'js/stats.js', 'js/pdf.js', 'js/certificate.js', 'js/zip.js',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/favicon.svg', 'assets/icons/apple-touch-icon.png',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'raw.githubusercontent.com'];
const PASS_THROUGH = ['generativelanguage.googleapis.com', 'commons.wikimedia.org', 'upload.wikimedia.org'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => { /* keep going if one file fails */ })))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (PASS_THROUGH.includes(url.hostname)) return;

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        } catch (err) {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const hit = await cache.match(req, { ignoreSearch: true });
        const network = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        if (hit) { event.waitUntil(network); return hit; }
        const res = await network;
        if (res) return res;
        if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
        return Response.error();
      })
    );
  }
});

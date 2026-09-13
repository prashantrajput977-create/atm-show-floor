/* Show Floor service worker
   Shell is precached so the app opens with no signal.
   Fonts and Tesseract are cached on first use.
   Supabase traffic is never cached. */

const V = 'sf-v5';
const SHELL = 'shell-' + V;
const RUNTIME = 'rt-' + V;

const CORE = [
  './',
  './index.html',
  './css/app.css',
  './js/vendor/supabase.js',
  './js/config.js',
  './js/store.js',
  './js/ocr.js',
  './js/ui.js',
  './js/views.js',
  './js/app.js',
  './manifest.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(CORE.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const NEVER = /supabase\.co\/(rest|auth|realtime|storage|functions)/;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (NEVER.test(req.url)) return;                 // always live
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* navigations: shell first, network as refresh */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        caches.open(SHELL).then(c => c.put('./index.html', r.clone())).catch(() => {});
        return r;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  /* app files: race the network against the cache so a fresh deploy is picked up
     immediately on good signal, and a weak connection still opens instantly */
  if (sameOrigin) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(r => {
          if (r && r.ok) caches.open(SHELL).then(c => c.put(req, r.clone())).catch(() => {});
          return r;
        });
        if (!hit) return net;
        const slow = new Promise(res => setTimeout(() => res(hit), 2500));
        return Promise.race([net.catch(() => hit), slow]);
      })
    );
    return;
  }

  /* fonts, Tesseract, other CDN assets: cache on first use */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r && (r.ok || r.type === 'opaque')) {
        caches.open(RUNTIME).then(c => c.put(req, r.clone())).catch(() => {});
      }
      return r;
    }).catch(() => hit))
  );
});

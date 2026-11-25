// Service worker: permite usar la app sin conexión.
// Estrategia: se sirve desde caché y se actualiza en segundo plano; el índice y la página, primero por red.
const CACHE = 'opo-sermas-v2';
const BASE = ['./', 'index.html', 'styles.css', 'config.js', 'js/app.js', 'js/md.js', 'js/db.js', 'js/sync.js', 'manifest.webmanifest', 'icons/icon-192.png', 'data/indice.json'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const guardar = res => { if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); } return res; };
  const redPrimero = req.mode === 'navigate' || /indice\.json$|\.(js|css)$/.test(url.pathname);
  if (redPrimero) {
    e.respondWith(fetch(req).then(guardar).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || caches.match('index.html'))));
  } else {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(guardar)));
  }
});

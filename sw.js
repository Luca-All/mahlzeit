// App-Shell offline verfügbar machen. Die Daten selbst cached Firestore.
const CACHE = 'mahlzeit-v6';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/store.js',
  'js/util.js',
  'js/nutrition.js',
  'js/points.js',
  'js/badges.js',
  'js/season.js',
  'js/suggest.js',
  'js/recap.js',
  'js/config.js',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Firebase-SDK: Die URL enthält die Version, also ändert sich der Inhalt nie.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      }))
    );
    return;
  }

  // Eigene Dateien: erst Netz (damit Updates sofort ankommen), sonst Cache.
  // no-cache, damit nach einem Update nicht neue und alte Module gemischt laufen.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' }).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('index.html')))
    );
  }
});

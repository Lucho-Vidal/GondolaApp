const CACHE_NAME = 'changocheck-shell-v9';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Solo interceptar peticiones GET
  if (request.method !== 'GET') {
    return;
  }

  // Bypass estricto (Network-Only) para Supabase (REST, Auth y WebSockets)
  if (url.hostname.endsWith('supabase.co') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // Para navegaciones (HTML), usar Network-First con fallback a caché offline (CA-08)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match('./index.html', { ignoreSearch: true }) || caches.match('./');
        })
    );
    return;
  }

  // Para assets propios (CSS, JS, iconos), usar Network-First con fallback a caché offline
  // Esto evita que cambios de diseño/lógica queden desincronizados en móviles
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(request, { ignoreSearch: true });
        })
    );
  }
});

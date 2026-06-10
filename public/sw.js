/* PerfilaPro · Service Worker mínimo (PWA panel)
 *
 * Alcance consciente: aunque el SW se registra con scope "/" (vive en la raíz),
 * solo se REGISTRA desde panel.html, y su lógica está pensada para el panel
 * (padre/club/B2B). Estrategias:
 *   - Navegación  → network-first; offline cae al shell cacheado de /panel.html.
 *   - Estáticos   → stale-while-revalidate (css/js/svg/png/fuentes).
 *   - /api/*      → NUNCA se cachea (datos auth con JWT, siempre frescos).
 *   - Cross-origin (fuentes Google) → se deja pasar sin interceptar.
 *
 * Reversibilidad: borra este archivo + el bloque de registro en panel.html.
 * El SW se autodesinstala si el navegador no lo encuentra (404) tras un deploy.
 */
const VERSION = 'pp-panel-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// App shell mínimo para que el panel arranque offline (luego pide datos por API).
const SHELL_ASSETS = [
  '/panel.html',
  '/styles/brand.css',
  '/manifest.webmanifest',
  '/icon-maskable.svg',
  '/assets/brand/svg/perfilapro-isotype-verde.svg',
  '/assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll falla en bloque si un asset 404ea; los añadimos best-effort.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((u) => cache.add(u))))
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
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET y mismo origen; lo demás (POST a /api, fuentes cross-origin) pasa directo.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Datos dinámicos: nunca cachear. Que vaya siempre a red.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    return;
  }

  // Navegación (abrir/recargar el panel): network-first, fallback al shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          // Cachea la última versión buena del shell del panel.
          if (resp.ok && url.pathname.startsWith('/panel')) {
            const copy = resp.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/panel.html', copy));
          }
          return resp;
        })
        .catch(async () => {
          // Offline: solo damos shell para rutas del panel; el resto que falle natural.
          if (url.pathname.startsWith('/panel')) {
            const cached = await caches.match('/panel.html');
            if (cached) return cached;
          }
          return Response.error();
        })
    );
    return;
  }

  // Estáticos: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

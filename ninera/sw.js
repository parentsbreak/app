// Service worker de la app de niñeras (fase 1, 26/10/2026): copia del de la raíz (sw.js).
// Registrado desde ninera/, su alcance es ninera/: más específico que el del panel (que
// cubre todo el sitio), así que en esta carpeta gana este. Tiene su propia suscripción push.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// Sin listener de 'fetch' a propósito (29/09/2026, como el del panel). El que había mandaba
// TODAS las descargas (la app y cada consulta a Supabase) por el service worker, sin guardar
// nada en caché. Solo sumaba demora: después de un rato sin usar la app el navegador duerme el
// service worker, y había que despertarlo antes de cada descarga. Sin este listener el
// navegador descarga directo. El service worker solo recibe las notificaciones push.

/* ---- Push real (Web Push + VAPID) ----
   Payload: {titulo, mensaje, url}. Los íconos están en la raíz del sitio, un nivel arriba. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const titulo = data.titulo || 'Parents’ Break';
  const opciones = {
    body: data.mensaje || '',
    icon: '../icon-192.png',
    badge: '../icon-192.png',
    tag: data.id || (titulo + Date.now()),
    data: { url: data.url || './' },
  };
  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Resuelto siempre contra el scope real del service worker (ninera/ dentro del subpath del
  // repo en GitHub Pages): un path que empiece con "/" a secas apuntaría a la raíz de
  // github.io, que no existe, y tiraba 404 (bug encontrado probando en vivo con el del panel).
  const rutaCruda = (event.notification.data && event.notification.data.url) || './';
  const url = new URL(rutaCruda, self.registration.scope).href;
  // Siempre abre una ventana nueva, NO intenta reusar/navegar una pestaña ya abierta. En el
  // panel, reciclar una pestaña existente una vez agarró una que no era la app (tenía el código
  // de sw.js abierto en texto plano) y se quedó ahí en vez de llevar a la app.
  event.waitUntil(self.clients.openWindow(url));
});

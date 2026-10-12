/* Willrot service worker — keep VERSION in sync with APP_VERSION in index.html */
const VERSION = '1.2.0';
const SHELL = `willrot-shell-${VERSION}`;
const RUNTIME = `willrot-runtime-${VERSION}`;
const SHELL_FILES = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/icon-32.png',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase API/auth: always network (data is cached in localStorage by the app)
  if (url.hostname.endsWith('.supabase.co')) return;

  // CDN scripts + fonts: stale-while-revalidate
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Same-origin: network-first so new deploys land immediately, cache as offline fallback
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(async () => (await caches.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    );
  }
});

// ---------- Web Push ----------
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'Willrot';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'You have habits due today.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-96.png',
    tag: data.tag || 'willrot',
    renotify: true,
    data: { url: data.url || './#/today' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './#/today', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { w.focus(); return w.navigate(target).catch(() => {}); }
    }
    return self.clients.openWindow(target);
  }));
});

// ── Mi Sistema Service Worker v6 ──────────────────────────────────
const CACHE   = 'mi-sistema-v6';
const ASSETS  = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icon.svg', '/sw.js'];
const API_RE  = /\/api\//; // API calls are never cached

// Scheduled notification timers (persist while SW is alive)
const scheduled = new Map();

// ── INSTALL ────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// ── ACTIVATE ───────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH (cache-first for assets, network-only for API) ───────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Never cache API calls
  if (API_RE.test(e.request.url)) {
    e.respondWith(fetch(e.request).catch(() => new Response(
      JSON.stringify({ ok: false, error: 'Sin conexión' }),
      { headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => null);
      return cached || net;
    })
  );
});

// ── MESSAGES FROM PAGE ─────────────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE') {
    scheduled.forEach(t => clearTimeout(t));
    scheduled.clear();

    const now = Date.now();
    (e.data.items || []).forEach(n => {
      const delay = n.fireAt - now;
      if (delay <= 0 || delay > 24 * 3600 * 1000) return;

      const tid = setTimeout(() => {
        self.registration.showNotification(n.title, {
          body:               n.body || '',
          icon:               '/icon.svg',
          badge:              '/icon.svg',
          vibrate:            n.urgent ? [400,100,400,100,400,100,400] : [200,100,200],
          requireInteraction: n.urgent,
          tag:                n.tag,
          renotify:           true,
          silent:             false,
          data:               { url: '/', taskId: n.taskId },
          actions: [
            { action: 'done',   title: '✅ Completar' },
            { action: 'snooze', title: '⏰ +10 min'   },
          ]
        });
        scheduled.delete(n.tag);
      }, delay);

      scheduled.set(n.tag, tid);
    });

    if (e.source) e.source.postMessage({ type: 'SCHEDULED', count: scheduled.size });
  }

  if (e.data.type === 'PING') {
    if (e.source) e.source.postMessage({ type: 'PONG', scheduled: scheduled.size });
  }

  if (e.data.type === 'CLEAR') {
    scheduled.forEach(t => clearTimeout(t));
    scheduled.clear();
  }
});

// ── PUSH (server-sent push, future use) ───────────────────────────
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || '⏰ Mi Sistema', {
      body:               data.body || '',
      icon:               '/icon.svg',
      badge:              '/icon.svg',
      vibrate:            [300,100,300,100,300],
      requireInteraction: data.urgent || false,
      tag:                data.tag || 'push',
      renotify:           true,
      data:               { url: data.url || '/' }
    })
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  const { action, notification } = e;
  notification.close();

  if (action === 'done') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'MARK_DONE', taskId: notification.data?.taskId }));
        if (!clients.length) self.clients.openWindow(notification.data?.url || '/');
      })
    );
    return;
  }

  if (action === 'snooze') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SNOOZE', taskId: notification.data?.taskId }));
        if (!clients.length) self.clients.openWindow('/');
      })
    );
    return;
  }

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); return; }
      self.clients.openWindow(notification.data?.url || '/');
    })
  );
});

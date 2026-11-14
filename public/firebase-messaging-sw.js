/*
 * Calendar reminders on phones and computers (Andy, 2026-11-14, 4A). The server sends each reminder through
 * Firebase Cloud Messaging; this small worker shows it as a pop-up and opens the calendar when it is tapped.
 * It lives beside the app's own offline worker, in its own scope, so the two never get in each other's way.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = {}; }
  const d = payload.data || payload.notification || payload || {};
  const title = d.title || 'Insight-IQ';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/pwa-192.png',
    badge: '/favicon.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { link: d.link || '/calendar' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.link) || '/calendar', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) {
        if ('navigate' in c) c.navigate(url).catch(() => undefined);
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});

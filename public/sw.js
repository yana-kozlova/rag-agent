self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Use clients.claim() carefully to avoid bfcache issues
  event.waitUntil(
    self.clients.matchAll().then((clientList) => {
      // Only claim if necessary, don't block bfcache
      return Promise.resolve();
    })
  );
});

// Optional: handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});

// (Intentionally minimal) — no postMessage handler



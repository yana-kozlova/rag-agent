self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle push notifications
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'New notification', body: event.data?.text() || 'You have a new notification' };
    }
  }
  
  const title = data.title || 'AI SDK RAG';
  const options = {
    body: data.body || 'You have a new notification',
    icon: data.icon || '/avatars/bot.svg',
    badge: data.badge || '/avatars/bot.svg',
    tag: data.tag || 'default',
    data: data.data || {},
    requireInteraction: data.requireInteraction || false,
    // Platforms cap how many buttons they render (usually two) and some show
    // none at all, so actions are always an enhancement, never the only path.
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    ...data.options,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/**
 * Run a notification action against the server.
 *
 * The service worker can be alive with no page open, so this posts directly
 * rather than handing off to a client. `credentials: 'include'` is what carries
 * the session cookie; without it the request is anonymous and gets a 401.
 */
function runAction(action, notification) {
  const data = notification.data || {};

  return fetch('/api/push/action', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      eventId: data.eventId,
      calendarId: data.calendarId,
      title: notification.title,
      body: notification.body,
      minutes: data.snoozeMinutes,
    }),
  })
    .then((res) => res.json().catch(() => ({ ok: res.ok })))
    .then((result) => {
      if (!result || result.ok === false) throw new Error(result?.error || 'Action failed');
      return result;
    });
}

/** Brief confirmation so an action never looks like it silently did nothing. */
function confirm(title, body) {
  return self.registration.showNotification(title, {
    body,
    icon: '/avatars/bot.svg',
    badge: '/avatars/bot.svg',
    tag: 'action-result',
  });
}

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  notification.close();

  // A button was pressed rather than the notification body.
  if (event.action) {
    event.waitUntil(
      runAction(event.action, notification)
        .then((result) => {
          if (event.action === 'snooze') {
            return confirm('⏰ Snoozed', 'I will remind you again shortly.');
          }
          if (event.action === 'delete-event') {
            return confirm('🗑️ Event deleted', 'Removed from your calendar.');
          }
          if (event.action === 'save-note') {
            return confirm('💾 Saved', 'Added to your knowledge base.');
          }
          return result;
        })
        .catch((error) =>
          confirm('⚠️ Could not complete that', String(error.message || error))
        )
    );
    return;
  }


  // Resolve against the SW scope: notification payloads carry relative paths
  // ('/'), while client.url is always absolute. Comparing the two directly
  // never matched, so every click opened a redundant tab.
  const urlToOpen = new URL(notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Prefer an exact match, but focus any same-origin window rather than
      // stacking up tabs when the user is already in the app.
      const exact = clientList.find((client) => client.url === urlToOpen);
      const sameOrigin = clientList.find((client) =>
        client.url.startsWith(self.location.origin)
      );
      const target = exact || sameOrigin;

      if (target && 'focus' in target) {
        if ('navigate' in target && target.url !== urlToOpen) {
          return target.navigate(urlToOpen).then((c) => (c || target).focus());
        }
        return target.focus();
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

// (Intentionally minimal) — no postMessage handler



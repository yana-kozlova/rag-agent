'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;
    // Register once on mount
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(() => {
        // eslint-disable-next-line no-console
        console.log('[SW] registered');
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[SW] registration failed', err);
      });
  }, []);

  return null;
}



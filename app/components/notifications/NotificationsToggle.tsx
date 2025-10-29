'use client';

import { useEffect, useState } from 'react';

export function NotificationsToggle() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [supported, setSupported] = useState<boolean>(true);
  const [secure, setSecure] = useState<boolean>(true);
  

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isSupported = 'Notification' in window;
    setSupported(isSupported);
    setSecure(window.isSecureContext === true);
    if (!isSupported) return;
    try {
      const stored = localStorage.getItem('notifications.enabled');
      setEnabled(stored === 'true');
    } catch {}
    setPermission(Notification.permission);

    
  }, []);

  const requestPermission = async (): Promise<NotificationPermission> => {
    if (!supported) return 'denied';
    try {
      // Normalize Safari callback-style and Promise-style
      const maybePromise = Notification.requestPermission as unknown as ((cb?: (res: NotificationPermission) => void) => Promise<NotificationPermission> | void);
      const result = await new Promise<NotificationPermission>((resolve) => {
        const out = maybePromise((res) => resolve(res));
        if (out && typeof (out as any).then === 'function') {
          (out as Promise<NotificationPermission>).then(resolve).catch(() => resolve('denied'));
        }
      });
      setPermission(result);
      return result;
    } catch {
      setPermission('denied');
      return 'denied';
    }
  };

  const showNativeNotification = async (title: string, body: string) => {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && 'showNotification' in reg) {
          await reg.showNotification(title, { body } as NotificationOptions);
          return true;
        }
      }
    } catch (e: any) {}
    try {
      // Fallback to constructor if SW not available
      // eslint-disable-next-line no-new
      new Notification(title, { body } as NotificationOptions);
      return true;
    } catch (e: any) {
      return false;
    }
  };

  

  const handleToggle = async (next: boolean) => {
    if (!supported) return;
    if (!secure && next) {
      // Persist off, show guidance
      setEnabled(false);
      try { localStorage.setItem('notifications.enabled', 'false'); } catch {}
      return;
    }
    if (next) {
      const current = Notification.permission;
      if (current === 'default') {
        const res = await requestPermission();
        if (res !== 'granted') {
          setEnabled(false);
          try { localStorage.setItem('notifications.enabled', 'false'); } catch {}
          return;
        }
      } else if (current === 'denied') {
        setEnabled(false);
        try { localStorage.setItem('notifications.enabled', 'false'); } catch {}
        return;
      }
      setEnabled(true);
      try { localStorage.setItem('notifications.enabled', 'true'); } catch {}
      // Fire a confirmation notification via SW or constructor
      await showNativeNotification('Notifications enabled', 'You will receive alerts on this device.');
    } else {
      setEnabled(false);
      try { localStorage.setItem('notifications.enabled', 'false'); } catch {}
      
    }
  };

  const sendTest = async () => {
    if (!supported || Notification.permission !== 'granted' || !secure) return;
    await showNativeNotification('Test notification', 'This is how alerts will appear.');
  };

  

  return (
    <div className="space-y-2">
      <div className="form-control">
        <label className="label cursor-pointer justify-between">
          <span className="label-text">Enable notifications</span>
          <input
            type="checkbox"
            className="toggle"
            checked={enabled}
            onChange={(e) => handleToggle(e.currentTarget.checked)}
            disabled={!supported}
          />
        </label>
      </div>
      {!supported && (
        <div className="text-sm text-warning">Notifications are not supported in this browser.</div>
      )}
      {supported && !secure && (
        <div className="text-sm text-warning">Notifications require a secure context (HTTPS) or localhost.</div>
      )}
      {supported && permission === 'denied' && (
        <div className="text-sm text-warning">Notifications are blocked. Allow them in your browser settings.</div>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-outline btn-sm" onClick={sendTest} disabled={!enabled || permission !== 'granted'}>
          Send test notification
        </button>
      </div>
    </div>
  );
}



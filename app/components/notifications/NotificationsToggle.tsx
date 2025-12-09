'use client';

import { useEffect, useState, useCallback } from 'react';

export function NotificationsToggle() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [supported, setSupported] = useState<boolean>(true);
  const [secure, setSecure] = useState<boolean>(true);
  const [pushSupported, setPushSupported] = useState<boolean>(false);
  const [subscribing, setSubscribing] = useState<boolean>(false);
  const [nextScheduled, setNextScheduled] = useState<string | null>(null);

  const fetchNextScheduled = useCallback(async () => {
    try {
      const res = await fetch('/api/push/next-scheduled');
      if (res.ok) {
        const data = await res.json();
        setNextScheduled(data.nextScheduledLocal);
      }
    } catch (e) {
      // Ignore errors
    }
  }, []);

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const checkSubscription = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        // Verify subscription exists on server
        try {
          const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: subscription.endpoint,
              keys: {
                p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
                auth: arrayBufferToBase64(subscription.getKey('auth')!),
              },
            }),
          });
          if (res.ok) {
            setEnabled(true);
          }
        } catch (e) {
          // Subscription might be invalid, unsubscribe
          await subscription.unsubscribe();
        }
      }
    } catch (e) {
      console.error('[NotificationsToggle] Error checking subscription:', e);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isSupported = 'Notification' in window;
    setSupported(isSupported);
    setSecure(window.isSecureContext === true);
    
    // Check Push API support
    const isPushSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    setPushSupported(isPushSupported);
    
    if (!isSupported) return;
    try {
      const stored = localStorage.getItem('notifications.enabled');
      setEnabled(stored === 'true');
    } catch {}
    setPermission(Notification.permission);

    // Check if we already have a subscription
    if (isPushSupported) {
      checkSubscription();
    }

    // Fetch next scheduled time
    fetchNextScheduled();
    const interval = setInterval(fetchNextScheduled, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [checkSubscription, fetchNextScheduled]);

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

  

  const subscribeToPush = async (): Promise<boolean> => {
    if (!pushSupported) return false;
    
    try {
      setSubscribing(true);
      const reg = await navigator.serviceWorker.ready;
      
      // Get VAPID public key from server
      let vapidPublicKey = '';
      try {
        const res = await fetch('/api/push/vapid-key');
        if (res.ok) {
          const data = await res.json();
          vapidPublicKey = data.publicKey || '';
        }
      } catch (e) {
        console.error('[NotificationsToggle] Error fetching VAPID key:', e);
      }
      
      if (!vapidPublicKey) {
        console.warn('[NotificationsToggle] VAPID public key not available');
        return false;
      }
      
      let subscription = await reg.pushManager.getSubscription();
      
      if (!subscription) {
        // Convert VAPID key from base64 URL-safe to Uint8Array
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // @ts-ignore - Uint8Array is valid for PushSubscriptionOptions
          applicationServerKey,
        });
      }

      // Send subscription to server
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
            auth: arrayBufferToBase64(subscription.getKey('auth')!),
          },
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to save subscription');
      }

      return true;
    } catch (error) {
      console.error('[NotificationsToggle] Error subscribing to push:', error);
      return false;
    } finally {
      setSubscribing(false);
    }
  };

  const unsubscribeFromPush = async (): Promise<boolean> => {
    if (!pushSupported) return false;
    
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        
        // Remove from server
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }
      
      return true;
    } catch (error) {
      console.error('[NotificationsToggle] Error unsubscribing from push:', error);
      return false;
    }
  };

  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
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
      
      // Subscribe to push notifications if supported
      if (pushSupported) {
        const subscribed = await subscribeToPush();
        if (!subscribed) {
          setEnabled(false);
          try { localStorage.setItem('notifications.enabled', 'false'); } catch {}
          return;
        }
      }
      
      setEnabled(true);
      try { localStorage.setItem('notifications.enabled', 'true'); } catch {}
      // Fire a confirmation notification via SW or constructor
      await showNativeNotification('Notifications enabled', 'You will receive alerts on this device, even when the tab is closed.');
    } else {
      // Unsubscribe from push notifications
      if (pushSupported) {
        await unsubscribeFromPush();
      }
      
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
      {pushSupported && enabled && (
        <div className="space-y-1">
          <div className="text-sm text-success">✓ Push notifications enabled. You&apos;ll receive alerts even when the tab is closed.</div>
          {nextScheduled && (
            <div className="text-xs text-muted-foreground">
              Next reminder: {nextScheduled}
            </div>
          )}
        </div>
      )}
      {supported && !pushSupported && (
        <div className="text-sm text-warning">Push notifications require a modern browser with Service Worker support.</div>
      )}
      <div className="flex gap-2">
        <button 
          type="button" 
          className="btn btn-outline btn-sm" 
          onClick={sendTest} 
          disabled={!enabled || permission !== 'granted' || subscribing}
        >
          {subscribing ? 'Subscribing...' : 'Send test notification'}
        </button>
      </div>
    </div>
  );
}



import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/env.mjs';

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * A button rendered on the notification itself.
 *
 * `action` is the id the service worker receives back in `event.action`.
 * Most platforms surface only the first two, and several (notably iOS Safari)
 * render none — so an action must never be the only way to do something.
 */
export interface PushAction {
  action: string;
  title: string;
  icon?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: any;
  icon?: string;
  badge?: string;
  tag?: string;
  actions?: PushAction[];
  requireInteraction?: boolean;
}

const VAPID_PUBLIC_KEY = env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = env.VAPID_SUBJECT || env.NEXTAUTH_URL || 'mailto:admin@example.com';

let webpush: any = null;

async function getWebPush() {
  if (!webpush) {
    // @ts-ignore - web-push doesn't have types
    webpush = await import('web-push');
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    }
  }
  return webpush.default;
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
  context = 'push'
): Promise<boolean> {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.warn(`[${context}] VAPID keys not configured. Push notifications will not work.`);
      return false;
    }

    const webpushInstance = await getWebPush();

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/avatars/bot.svg',
      badge: payload.badge || '/avatars/bot.svg',
      tag: payload.tag || 'default',
      data: payload.data || {},
      // Browsers cap the visible count themselves; sending more is harmless.
      actions: payload.actions ?? [],
      requireInteraction: payload.requireInteraction ?? false,
    });

    await webpushInstance.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      },
      notificationPayload
    );
    return true;
  } catch (error: any) {
    if (error.statusCode === 410 || error.statusCode === 404) {
      console.log(`[${context}] Subscription expired, removing:`, subscription.endpoint);
      try {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
      } catch (e) {
        console.error(`[${context}] Error removing expired subscription:`, e);
      }
    }
    console.error(`[${context}] Error sending notification:`, error);
    return false;
  }
}

export async function sendToSubscriptions(
  subscriptions: Array<{ endpoint: string; keys: any }>,
  payload: PushPayload,
  context = 'push'
) {
  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      sendPushNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        payload,
        context
      )
    )
  );

  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { successCount, total: subscriptions.length };
}

/**
 * Guard for cron-triggered endpoints.
 *
 * Fails *closed*: with no CRON_SECRET configured these routes are reachable by
 * anyone who knows the path, so an unset secret is treated as misconfiguration
 * rather than as "no auth needed". Development is exempted so local runs work.
 */
export function validateCronSecret(req: Request): boolean {
  const cronSecret = env.CRON_SECRET || process.env.CRON_SECRET;

  if (!cronSecret || typeof cronSecret !== 'string' || cronSecret.trim().length === 0) {
    if (process.env.NODE_ENV !== 'production') return true;
    console.error(
      '[push] CRON_SECRET is not set in production — refusing to run cron endpoint.'
    );
    return false;
  }

  const authHeader = req.headers.get('authorization');
  const providedSecret =
    authHeader?.replace('Bearer ', '') || new URL(req.url).searchParams.get('secret');

  if (!providedSecret) return false;

  return timingSafeEqual(providedSecret, cronSecret);
}

/** Constant-time string compare, so the secret can't be probed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}


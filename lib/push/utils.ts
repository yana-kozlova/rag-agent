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

export interface PushPayload {
  title: string;
  body: string;
  data?: any;
  icon?: string;
  badge?: string;
  tag?: string;
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

export function validateCronSecret(req: Request): boolean {
  const cronSecret = env.CRON_SECRET || process.env.CRON_SECRET;
  if (!cronSecret || typeof cronSecret !== 'string' || cronSecret.trim().length === 0) {
    return true; // No secret required
  }

  const authHeader = req.headers.get('authorization');
  const providedSecret = authHeader?.replace('Bearer ', '') || 
                       new URL(req.url).searchParams.get('secret');
  
  return providedSecret === cronSecret;
}


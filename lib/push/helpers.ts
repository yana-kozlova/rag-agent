import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { eq } from 'drizzle-orm';
import { sendToSubscriptions, PushPayload } from '@/lib/push/utils';

/**
 * Send push notification to a specific user
 */
export async function notifyUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; total: number }> {
  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId as any));

  if (subscriptions.length === 0) {
    return { sent: 0, total: 0 };
  }

  const result = await sendToSubscriptions(
    subscriptions.map((sub) => ({ endpoint: sub.endpoint, keys: sub.keys })),
    payload,
    'push/notify-user'
  );

  return { sent: result.successCount, total: result.total };
}

/**
 * Send push notification when important information is saved
 */
export async function notifyImportantInfoSaved(
  userId: string,
  content: string
): Promise<void> {
  await notifyUser(userId, {
    title: '💾 Important info saved',
    body: `Your information has been added to the knowledge base: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`,
    data: { url: '/resources', type: 'info-saved' },
    icon: '/avatars/bot.svg',
    badge: '/avatars/bot.svg',
    tag: 'info-saved',
  });
}

/**
 * Send push notification for daily summary
 */
export async function notifyDailySummary(
  userId: string,
  summary: {
    eventsToday: number;
    eventsUpcoming: number;
    newResources?: number;
  }
): Promise<void> {
  const parts: string[] = [];
  if (summary.eventsToday > 0) {
    parts.push(`${summary.eventsToday} event${summary.eventsToday > 1 ? 's' : ''} today`);
  }
  if (summary.eventsUpcoming > 0) {
    parts.push(`${summary.eventsUpcoming} upcoming`);
  }
  if (summary.newResources && summary.newResources > 0) {
    parts.push(`${summary.newResources} new resource${summary.newResources > 1 ? 's' : ''}`);
  }

  const body = parts.length > 0 
    ? `Your day: ${parts.join(', ')}`
    : 'No events scheduled for today';

  await notifyUser(userId, {
    title: '📊 Daily Summary',
    body,
    data: { url: '/', type: 'daily-summary' },
    icon: '/avatars/bot.svg',
    badge: '/avatars/bot.svg',
    tag: 'daily-summary',
  });
}


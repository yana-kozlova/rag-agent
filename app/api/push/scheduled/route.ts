import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { sendToSubscriptions, validateCronSecret } from '@/lib/push/utils';

export const runtime = 'nodejs';

/**
 * Scheduled push notification endpoint (called daily at 9:00 AM by cron)
 */
export async function GET(req: Request) {
  try {
    if (!validateCronSecret(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const subscriptions = await db.select().from(pushSubscriptions);

    if (subscriptions.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No subscriptions found',
        sent: 0,
        total: 0,
      });
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

    const { successCount, total } = await sendToSubscriptions(
      subscriptions.map((sub) => ({ endpoint: sub.endpoint, keys: sub.keys })),
      {
        title: 'Good morning! ☀️',
        body: `Time: ${timeString}. Rise and shine!`,
        data: { url: '/', timestamp: now.toISOString() },
        icon: '/avatars/bot.svg',
        badge: '/avatars/bot.svg',
        tag: 'scheduled-reminder',
      },
      'push/scheduled'
    );

    return NextResponse.json({
      ok: true,
      sent: successCount,
      failed: total - successCount,
      total,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[push/scheduled] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}


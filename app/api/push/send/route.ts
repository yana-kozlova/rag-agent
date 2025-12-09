import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { eq } from 'drizzle-orm';
import { sendToSubscriptions } from '@/lib/push/utils';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { title, message, userId: targetUserId, data } = body;

    if (!title || !message) {
      return NextResponse.json(
        { ok: false, error: 'Title and message are required' },
        { status: 400 }
      );
    }

    // Get user's push subscriptions
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, (targetUserId || userId) as any));

    if (subscriptions.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No subscriptions found',
        sent: 0,
      });
    }

    const { successCount, total } = await sendToSubscriptions(
      subscriptions.map((sub) => ({ endpoint: sub.endpoint, keys: sub.keys })),
      {
        title,
        body: message,
        data: data || {},
        icon: '/avatars/bot.svg',
        badge: '/avatars/bot.svg',
      },
      'push/send'
    );

    return NextResponse.json({
      ok: true,
      sent: successCount,
      total,
    });
  } catch (error: any) {
    console.error('[push/send] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}


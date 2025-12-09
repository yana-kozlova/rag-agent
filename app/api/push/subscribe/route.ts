import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { endpoint, keys } = body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return NextResponse.json(
        { ok: false, error: 'Invalid subscription data' },
        { status: 400 }
      );
    }

    // Check if subscription already exists
    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1);

    if (existing.length > 0) {
      // Update existing subscription
      await db
        .update(pushSubscriptions)
        .set({
          userId: userId as any,
          keys: keys as any,
          updatedAt: new Date(),
        })
        .where(eq(pushSubscriptions.endpoint, endpoint));

      return NextResponse.json({ ok: true, message: 'Subscription updated' });
    }

    // Create new subscription
    await db.insert(pushSubscriptions).values({
      userId: userId as any,
      endpoint,
      keys: keys as any,
    });

    return NextResponse.json({ ok: true, message: 'Subscription saved' });
  } catch (error: any) {
    console.error('[push/subscribe] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { ok: false, error: 'Endpoint is required' },
        { status: 400 }
      );
    }

    // Delete subscription
    await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));

    return NextResponse.json({ ok: true, message: 'Subscription removed' });
  } catch (error: any) {
    console.error('[push/subscribe] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}


import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { eq } from 'drizzle-orm';
import { sendToSubscriptions, validateCronSecret } from '@/lib/push/utils';
import {
  claimDueNotifications,
  claimQueueRow,
  markQueueRow,
  reclaimStaleDeliveries,
} from '@/lib/push/queue';
import type { PushPayload } from '@/lib/push/utils';

export const runtime = 'nodejs';
export const maxDuration = 60;

type QueueRow = { id: string; userId: string; payload: PushPayload };

/**
 * Delivers one already-claimed row. The caller owns it, so this is free to
 * mark the outcome without re-checking status.
 */
async function deliver(row: QueueRow): Promise<'sent' | 'failed'> {
  const subs = await db
    .select({ endpoint: pushSubscriptions.endpoint, keys: pushSubscriptions.keys })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, row.userId));

  if (subs.length === 0) {
    // Nothing to deliver to; retiring the row stops it being retried forever.
    await markQueueRow(row.id, 'failed');
    return 'failed';
  }

  const { successCount } = await sendToSubscriptions(
    subs.map((s) => ({ endpoint: s.endpoint, keys: s.keys })),
    row.payload,
    'push/drain'
  );

  const outcome = successCount > 0 ? 'sent' : 'failed';
  await markQueueRow(row.id, outcome);
  return outcome;
}

/**
 * QStash callback: deliver exactly one notification, right now.
 *
 * This is the precise path — QStash was told the instant when the row was
 * queued and calls back then, so a "remind me in 10 minutes" lands at ten
 * minutes rather than at whenever the sweep next happens to run.
 *
 * Authentication is the same CRON_SECRET every cron endpoint checks; QStash
 * forwards it via `Upstash-Forward-Authorization`. Quiet hours are deliberately
 * not applied: a snooze is something the user explicitly asked for at a
 * specific time, so honouring it beats silencing it.
 */
export async function POST(req: Request) {
  try {
    if (!validateCronSecret(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = z
      .object({ queueRowId: z.string().uuid() })
      .safeParse(await req.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid callback payload' },
        { status: 400 }
      );
    }

    const row = await claimQueueRow(parsed.data.queueRowId);

    // Already delivered, cancelled, or claimed by the sweep a moment ago.
    // A 200 keeps QStash from retrying something that is not going to change.
    if (!row) {
      return NextResponse.json({ ok: true, sent: 0, claimed: false });
    }

    const outcome = await deliver(row);

    return NextResponse.json({
      ok: true,
      claimed: true,
      sent: outcome === 'sent' ? 1 : 0,
    });
  } catch (error: any) {
    console.error('[push/drain] Callback error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Periodic sweep: whatever QStash did not deliver.
 *
 * Runs on an external scheduler rather than a Vercel cron. It is a safety net
 * for two cases — QStash was unconfigured or unreachable when the row was
 * queued, and a delivery that died mid-flight — so an hourly cadence is
 * sufficient. Delivery precision comes from the callback above, not from here.
 */
export async function GET(req: Request) {
  try {
    if (!validateCronSecret(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // Rows stuck in `sending` from a killed invocation become eligible again.
    const reclaimed = await reclaimStaleDeliveries();
    const due = await claimDueNotifications(now);

    if (due.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, due: 0, reclaimed });
    }

    let sent = 0;
    let failed = 0;

    for (const row of due) {
      try {
        const outcome = await deliver(row);
        if (outcome === 'sent') sent++;
        else failed++;
      } catch (error) {
        console.error(`[push/drain] Failed row ${row.id}:`, error);
        await markQueueRow(row.id, 'failed');
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      reclaimed,
      due: due.length,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[push/drain] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

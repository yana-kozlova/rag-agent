import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateCronSecret } from '@/lib/push/utils';
import { deliverToUser, type DeliveryResult } from '@/lib/push/deliver';
import {
  claimDueNotifications,
  claimQueueRow,
  markQueueRow,
  recordFailedAttempt,
  reclaimStaleDeliveries,
} from '@/lib/push/queue';
import type { NotificationPayload } from '@/lib/push/utils';

export const runtime = 'nodejs';
export const maxDuration = 60;

type QueueRow = { id: string; userId: string; payload: NotificationPayload };

/**
 * Delivers one already-claimed row. The caller owns it, so this is free to
 * mark the outcome without re-checking status.
 *
 * The two failures are not the same failure. An account with no Telegram chat
 * linked is retired immediately — nothing about the next sweep would make a
 * missing link appear. A request Telegram did not accept goes back in the queue
 * with its attempt counted, because the alternative is that one bad moment on
 * the network silently discards a reminder the user asked for.
 */
async function deliver(row: QueueRow): Promise<DeliveryResult> {
  const result = await deliverToUser(row.userId, row.payload, 'push/drain');

  if (result === 'sent' || result === 'unreachable') {
    await markQueueRow(row.id, result === 'sent' ? 'sent' : 'failed');
    return result;
  }

  await recordFailedAttempt(row.id);
  return 'failed';
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
    let unreachable = 0;

    for (const row of due) {
      try {
        const outcome = await deliver(row);
        if (outcome === 'sent') sent++;
        else if (outcome === 'unreachable') unreachable++;
        else failed++;
      } catch (error) {
        // A throw here is as likely to be transient as a rejected send, so it
        // is counted the same way rather than retiring the row outright.
        console.error(`[push/drain] Failed row ${row.id}:`, error);
        await recordFailedAttempt(row.id);
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      unreachable,
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

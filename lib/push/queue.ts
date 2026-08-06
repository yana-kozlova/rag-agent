import { db } from '@/lib/db';
import { notificationQueue } from '@/lib/db/schema/notification-queue';
import { and, eq, inArray, lt, lte } from 'drizzle-orm';
import type { NotificationPayload } from './utils';
import { scheduleDelivery } from './qstash';

/**
 * Rows move pending → sending → sent|failed.
 *
 * `sending` exists because two things can now reach the same row: the QStash
 * callback for that exact notification, and the periodic sweep that catches
 * whatever QStash missed. Without an atomic hand-off between them the user
 * gets the same push twice.
 */
export type QueueStatus = 'pending' | 'sending' | 'sent' | 'failed';

/**
 * Schedule a notification for later delivery.
 *
 * The row is written first and QStash is told second, deliberately: a row with
 * no QStash message still goes out on the sweep, whereas a QStash message with
 * no row would fire into nothing. Durability first, precision second.
 */
export async function enqueueNotification(params: {
  userId: string;
  notifyAt: Date;
  payload: NotificationPayload;
  kind: string;
}): Promise<string | null> {
  let id: string | null = null;

  try {
    const [row] = await db
      .insert(notificationQueue)
      .values({
        userId: params.userId,
        notifyAt: params.notifyAt,
        payload: params.payload,
        kind: params.kind,
      })
      .returning({ id: notificationQueue.id });

    id = row?.id ?? null;
  } catch (error) {
    console.error('[push/queue] Failed to enqueue:', error);
    return null;
  }

  if (!id) return null;

  // Best effort: failure here costs precision, not the notification.
  await scheduleDelivery({ queueRowId: id, notifyAt: params.notifyAt });

  return id;
}

/**
 * Take ownership of one row by id — the QStash callback path.
 *
 * The status predicate is what makes this safe: only the caller whose UPDATE
 * actually matched gets a row back, so a duplicate callback returns undefined
 * and sends nothing.
 */
export async function claimQueueRow(id: string) {
  try {
    const [row] = await db
      .update(notificationQueue)
      .set({ status: 'sending', claimedAt: new Date() })
      .where(and(eq(notificationQueue.id, id), eq(notificationQueue.status, 'pending')))
      .returning();

    return row ?? null;
  } catch (error) {
    console.error(`[push/queue] Failed to claim row ${id}:`, error);
    return null;
  }
}

/**
 * Take ownership of every row that is due — the sweep path.
 *
 * Selecting ids in a subquery and updating those keeps the claim atomic while
 * still honouring a limit, which a bare UPDATE cannot express.
 */
export async function claimDueNotifications(now: Date, limit = 50) {
  try {
    const due = db
      .select({ id: notificationQueue.id })
      .from(notificationQueue)
      .where(
        and(eq(notificationQueue.status, 'pending'), lte(notificationQueue.notifyAt, now))
      )
      .limit(limit);

    return await db
      .update(notificationQueue)
      .set({ status: 'sending', claimedAt: new Date() })
      .where(inArray(notificationQueue.id, due))
      .returning();
  } catch (error) {
    console.error('[push/queue] Failed to claim due notifications:', error);
    return [];
  }
}

/**
 * Return rows abandoned mid-delivery to the pending pool.
 *
 * A serverless function killed between claiming and marking leaves a row in
 * `sending` forever; without this the notification is lost silently. The
 * timeout only needs to exceed a single delivery attempt.
 *
 * Measured from `claimedAt`, never `createdAt`: a row queued in the morning
 * for the evening is not stale the moment it is finally picked up, and using
 * the wrong column would reclaim rows out from under a live delivery and send
 * the same push twice.
 */
export async function reclaimStaleDeliveries(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

  try {
    const reclaimed = await db
      .update(notificationQueue)
      .set({ status: 'pending', claimedAt: null })
      .where(
        and(eq(notificationQueue.status, 'sending'), lt(notificationQueue.claimedAt, cutoff))
      )
      .returning({ id: notificationQueue.id });

    return reclaimed.length;
  } catch (error) {
    console.error('[push/queue] Failed to reclaim stale deliveries:', error);
    return 0;
  }
}

/**
 * How many times a delivery that failed for a transient reason is worth
 * repeating. Bounded because "retry until it works" against a chat the user has
 * blocked is a loop with no exit.
 */
const MAX_DELIVERY_ATTEMPTS = 3;

/**
 * A delivery that failed for a reason that might not repeat — a network blip, a
 * 5xx from Telegram.
 *
 * The row goes back to `pending` so the next sweep tries again, unless it has
 * spent its attempts, at which point it is retired for good. Without this a
 * single failed request retired the notification permanently: `failed` is
 * terminal, and `reclaimStaleDeliveries` only rescues rows still sitting in
 * `sending`. The `attempts` column has been on this table since it was created
 * and nothing ever wrote to it; this is what it was for.
 */
export async function recordFailedAttempt(id: string): Promise<'retrying' | 'gave-up'> {
  try {
    const [row] = await db
      .select({ attempts: notificationQueue.attempts })
      .from(notificationQueue)
      .where(eq(notificationQueue.id, id))
      .limit(1);

    const previous = Number(row?.attempts);
    const attempts = (Number.isFinite(previous) ? previous : 0) + 1;
    const giveUp = attempts >= MAX_DELIVERY_ATTEMPTS;

    await db
      .update(notificationQueue)
      .set(
        giveUp
          ? { status: 'failed', attempts: String(attempts), sentAt: new Date() }
          : { status: 'pending', attempts: String(attempts), claimedAt: null }
      )
      .where(eq(notificationQueue.id, id));

    return giveUp ? 'gave-up' : 'retrying';
  } catch (error) {
    // The row is still claimed, so `reclaimStaleDeliveries` will free it — the
    // attempt simply goes uncounted, which is the safe direction to err in.
    console.error(`[push/queue] Failed to record a failed attempt for ${id}:`, error);
    return 'retrying';
  }
}

export async function markQueueRow(id: string, status: 'sent' | 'failed'): Promise<void> {
  try {
    await db
      .update(notificationQueue)
      .set({ status, sentAt: new Date() })
      .where(eq(notificationQueue.id, id));
  } catch (error) {
    console.error(`[push/queue] Failed to mark row ${id} as ${status}:`, error);
  }
}

/**
 * Cancel pending rows for a user, optionally narrowed to one kind.
 * Used when the underlying thing no longer exists — e.g. the event got deleted.
 *
 * Any QStash callback already scheduled for a deleted row finds nothing and
 * no-ops, so the message does not need cancelling on their side.
 */
export async function cancelPending(userId: string, kind?: string): Promise<number> {
  try {
    const deleted = await db
      .delete(notificationQueue)
      .where(
        kind
          ? and(
              eq(notificationQueue.userId, userId),
              eq(notificationQueue.kind, kind),
              eq(notificationQueue.status, 'pending')
            )
          : and(
              eq(notificationQueue.userId, userId),
              eq(notificationQueue.status, 'pending')
            )
      )
      .returning({ id: notificationQueue.id });

    return deleted.length;
  } catch (error) {
    console.error('[push/queue] Failed to cancel pending:', error);
    return 0;
  }
}

import { db } from '@/lib/db';
import { sentNotifications } from '@/lib/db/schema/sent-notifications';
import { lt } from 'drizzle-orm';

/**
 * Claim the right to send a notification exactly once.
 *
 * Returns true only for the caller that wins the insert; every later attempt
 * with the same (userId, dedupeKey) hits the unique constraint and gets false.
 * Doing this via the DB rather than an in-memory set is what makes it hold
 * across serverless invocations, where nothing is shared between runs.
 */
export async function claimNotification(
  userId: string,
  dedupeKey: string,
  kind: string
): Promise<boolean> {
  try {
    const inserted = await db
      .insert(sentNotifications)
      .values({ userId, dedupeKey, kind })
      .onConflictDoNothing()
      .returning({ id: sentNotifications.id });

    return inserted.length > 0;
  } catch (error) {
    console.error('[push/dedupe] Failed to claim notification:', error);
    // Fail closed: if we can't prove it's unsent, don't spam the user.
    return false;
  }
}

/** Drop ledger rows older than `days` so the table doesn't grow forever. */
export async function pruneNotificationLedger(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const deleted = await db
      .delete(sentNotifications)
      .where(lt(sentNotifications.sentAt, cutoff))
      .returning({ id: sentNotifications.id });
    return deleted.length;
  } catch (error) {
    console.error('[push/dedupe] Failed to prune ledger:', error);
    return 0;
  }
}

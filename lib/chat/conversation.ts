import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { conversations } from '@/lib/db/schema/chat';

/**
 * The user's one ongoing conversation, created if it does not exist yet.
 *
 * This existed three times — in `save-user-message.ts`, in `telegram/history.ts`
 * and in the history route — written as "select ... limit 1, else insert", and
 * every copy was wrong in the same two ways.
 *
 * The insert raced: the web chat and Telegram share one row on purpose, so two
 * first messages arriving together each saw nothing and each inserted. Nothing
 * in the schema forbade the second row. That is now a unique index on
 * `user_id`, which turns the race into a conflict, and the conflict into a
 * re-read of whatever the winner wrote.
 *
 * The select was unordered: `limit 1` over two rows may return either, and
 * different call sites could pick differently on consecutive requests — the
 * reader showing one thread while the writer appended to the other. The
 * ordering below is not load-bearing any more, now that a second row cannot be
 * created, but it is what makes this correct on a database where two already
 * exist and the migration has not run yet.
 */
export async function getOrCreateConversation(userId: string): Promise<string> {
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(conversations.createdAt, conversations.id)
    .limit(1);

  if (existing[0]) return existing[0].id;

  const [created] = await db
    .insert(conversations)
    .values({ userId })
    .onConflictDoNothing({ target: conversations.userId })
    .returning({ id: conversations.id });

  if (created) return created.id;

  // Lost the insert race: the winner's row is committed, so read it back.
  const [winner] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(conversations.createdAt, conversations.id)
    .limit(1);

  if (!winner) {
    throw new Error(`Could not open a conversation for user ${userId}`);
  }

  return winner.id;
}

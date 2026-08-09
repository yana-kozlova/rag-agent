import { desc, eq } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import { db } from '@/lib/db';
import { messages } from '@/lib/db/schema/chat';
import { getOrCreateConversation } from '@/lib/chat/conversation';

/**
 * Chat history for the Telegram surface.
 *
 * It reads and writes the same `conversations` row the web chat uses, so the
 * two are one thread rather than two: something mentioned on the laptop is
 * still context an hour later on the phone.
 */

/** How much of the thread to replay. Enough to stay coherent, not to bankrupt. */
const HISTORY_LIMIT = 20;

/**
 * Matches the web chat's convention of a single ongoing conversation per user.
 *
 * Resolved once per incoming message and passed to both helpers below, so a
 * turn cannot straddle two rows. The get-or-create itself lives in
 * `lib/chat/conversation.ts` — it was written out three times, once here, and
 * every copy raced on a user's first message.
 */
export async function getConversationId(userId: string): Promise<string> {
  return getOrCreateConversation(userId);
}

export async function loadRecentTurns(
  conversationId: string,
  limit = HISTORY_LIMIT
): Promise<ModelMessage[]> {
  // Newest-first so the limit keeps the *recent* end, then flipped back into
  // reading order for the model. Ordered by `seq`, not `created_at`: a turn's
  // question and answer are written in one statement and share a timestamp, so
  // sorting on that can hand the model its own reply as the user's next line.
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.seq))
    .limit(limit);

  return rows
    .reverse()
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content }));
}

export async function persistTurn(
  conversationId: string,
  userText: string,
  assistantText: string
): Promise<void> {
  await db.insert(messages).values([
    { conversationId, role: 'user' as const, content: userText },
    { conversationId, role: 'assistant' as const, content: assistantText },
  ]);
}

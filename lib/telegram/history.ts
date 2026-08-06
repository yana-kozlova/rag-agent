import { desc, eq } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema/chat';

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
 * Resolved once per incoming message and passed to both helpers below — calling
 * it from each of them would repeat two queries and, on a user's very first
 * message, risk inserting two conversations.
 */
export async function getConversationId(userId: string): Promise<string> {
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .limit(1);

  if (existing[0]) return existing[0].id;

  const [created] = await db
    .insert(conversations)
    .values({ userId })
    .returning({ id: conversations.id });

  return created.id;
}

export async function loadRecentTurns(
  conversationId: string,
  limit = HISTORY_LIMIT
): Promise<ModelMessage[]> {
  // Newest-first so the limit keeps the *recent* end, then flipped back into
  // reading order for the model.
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
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

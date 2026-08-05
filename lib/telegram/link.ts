import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

/**
 * Binding a Telegram chat to an account.
 *
 * A Telegram update proves only which chat sent it, never who owns that chat.
 * So the proof has to start on the authenticated side: the signed-in web app
 * issues a short-lived code, and `/start <code>` in the bot redeems it. Whoever
 * completes this owns the account's whole knowledge base, which is why the code
 * is random, single-use and expires quickly rather than being anything guessable
 * like an email or user id.
 */

const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * 24 random bytes → 32 base64url characters. Telegram caps a `start` payload at
 * 64 characters from `[A-Za-z0-9_-]`, which base64url already satisfies.
 */
function generateCode(): string {
  return randomBytes(24).toString('base64url');
}

export async function issueLinkCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await db
    .update(users)
    .set({ telegramLinkCode: code, telegramLinkExpiresAt: expiresAt })
    .where(eq(users.id, userId));

  return { code, expiresAt };
}

/**
 * Redeem a code for a chat id. Returns the linked user, or null when the code
 * is unknown or expired — the caller must not disclose which.
 */
export async function redeemLinkCode(
  code: string,
  chatId: string
): Promise<{ id: string; name: string | null } | null> {
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.telegramLinkCode, code), gt(users.telegramLinkExpiresAt, new Date())))
    .limit(1);

  const user = rows[0];
  if (!user) return null;

  // Clear the chat off any other account first: `telegram_chat_id` is unique,
  // so re-linking a chat that already belongs somewhere would otherwise fail.
  await db
    .update(users)
    .set({ telegramChatId: null })
    .where(eq(users.telegramChatId, chatId));

  await db
    .update(users)
    .set({ telegramChatId: chatId, telegramLinkCode: null, telegramLinkExpiresAt: null })
    .where(eq(users.id, user.id));

  return user;
}

/** The chat this account is linked to, if any. */
export async function getLinkedChatId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ chatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0]?.chatId ?? null;
}

/** Who this chat speaks for, or null when it was never linked. */
export async function findUserByChatId(
  chatId: string
): Promise<{ id: string; name: string | null } | null> {
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.telegramChatId, chatId))
    .limit(1);

  return rows[0] ?? null;
}

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { getBotUsername, isTelegramConfigured } from '@/lib/telegram/api';
import { getLinkedChatId, issueLinkCode } from '@/lib/telegram/link';

/**
 * Issue a code that binds a Telegram chat to this account.
 *
 * Session-authenticated on purpose — this is the authenticated end of the
 * linking flow, so it must NOT be listed in the middleware's public paths the
 * way the webhook and its callback are.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const chatId = await getLinkedChatId(session.user.id);

  return NextResponse.json({
    configured: isTelegramConfigured(),
    linked: Boolean(chatId),
    chatId,
  });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: 'Telegram is not configured' }, { status: 503 });
  }

  const { code, expiresAt } = await issueLinkCode(session.user.id);
  const username = await getBotUsername();

  return NextResponse.json({
    code,
    expiresAt: expiresAt.toISOString(),
    command: `/start ${code}`,
    deepLink: username ? `https://t.me/${username}?start=${code}` : null,
  });
}

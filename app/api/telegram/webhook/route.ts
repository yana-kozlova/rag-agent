import { NextResponse } from 'next/server';
import { env } from '@/lib/env.mjs';
import { publishJob } from '@/lib/push/qstash';
import { processUpdate } from '@/lib/telegram/process';

/**
 * Where Telegram delivers updates.
 *
 * Telegram re-sends any update it does not get a prompt 200 for, and an agent
 * turn with tool calls can run for half a minute — so the work is handed to
 * QStash and this returns immediately. Without QStash (local development, where
 * Upstash cannot reach the origin anyway) it falls back to running inline,
 * which is slower but keeps a dev tunnel usable.
 */

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isFromTelegram(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const queued = await publishJob({
    path: '/api/telegram/process',
    body: { update },
    // A failed agent turn has already replied with an apology; retrying would
    // just say it again.
    retries: 0,
  });

  if (!queued) {
    try {
      await processUpdate(update as any);
    } catch (error) {
      console.error('[telegram/webhook] inline processing failed:', error);
    }
  }

  // Always 200: a non-2xx makes Telegram redeliver the same update, and a
  // duplicate reply is worse than a dropped one.
  return NextResponse.json({ ok: true });
}

/**
 * Verify the secret Telegram echoes back on every update.
 *
 * Fails closed in production, matching `validateCronSecret`: an unset secret
 * means anyone who learns this URL can impersonate the user to their own
 * assistant, so it is treated as misconfiguration rather than as "no auth".
 */
function isFromTelegram(req: Request): boolean {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return true;
    console.error('[telegram/webhook] TELEGRAM_WEBHOOK_SECRET is unset — refusing updates.');
    return false;
  }

  return req.headers.get('x-telegram-bot-api-secret-token') === secret;
}

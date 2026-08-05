import { NextResponse } from 'next/server';
import { validateCronSecret } from '@/lib/push/utils';
import { processUpdate } from '@/lib/telegram/process';

/**
 * Runs one Telegram update, called back by QStash after the webhook handed it
 * off. Carries no session — `processUpdate` resolves the user from the chat id
 * and pushes them onto the request context itself.
 */

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let update: unknown;
  try {
    ({ update } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!update) {
    return NextResponse.json({ error: 'Missing update' }, { status: 400 });
  }

  try {
    await processUpdate(update as any);
  } catch (error) {
    console.error('[telegram/process] failed:', error);
    // 200 anyway: QStash retries on 5xx, and the user has already been told
    // something went wrong.
  }

  return NextResponse.json({ ok: true });
}

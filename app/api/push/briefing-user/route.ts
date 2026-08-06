import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateCronSecret } from '@/lib/push/utils';
import { runBriefingForUser } from '@/lib/push/briefing-run';

export const runtime = 'nodejs';
// One user's briefing: calendar fan-out plus an LLM call. Its own budget.
export const maxDuration = 60;

/**
 * Per-user briefing worker.
 *
 * The dispatcher (/api/push/scheduled) publishes one of these per due user via
 * QStash, so each user's work runs in its own short invocation with its own
 * retries. Authentication is the same CRON_SECRET every push endpoint checks,
 * forwarded by QStash as a plain `Authorization` header.
 *
 * The heavy lifting and — crucially — the authoritative gate live in
 * runBriefingForUser, so a duplicate delivery or a not-actually-due user
 * no-ops cleanly.
 */
export async function POST(req: Request) {
  try {
    if (!validateCronSecret(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = z
      .object({ userId: z.string().uuid() })
      .safeParse(await req.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 });
    }

    const result = await runBriefingForUser(parsed.data.userId, new Date());
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('[push/briefing-user] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

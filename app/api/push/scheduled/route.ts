import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { validateCronSecret } from '@/lib/push/utils';
import { pruneNotificationLedger } from '@/lib/push/dedupe';
import { isBriefingDue } from '@/lib/push/briefing-gate';
import { runBriefingForUser } from '@/lib/push/briefing-run';
import { isQstashConfigured, publishJob } from '@/lib/push/qstash';
import { mapWithConcurrency } from '@/lib/push/concurrency';

export const runtime = 'nodejs';
export const maxDuration = 60;

// How many QStash publishes to keep in flight at once.
const PUBLISH_CONCURRENCY = 25;
// Cap on users processed inline in one run (no QStash, or publish failures).
// The heavy work is per-user seconds, so this is the guard against the 60s wall.
const MAX_INLINE = 20;

/**
 * Daily briefing dispatcher.
 *
 * Invoked hourly. It does no per-user I/O for users who aren't due: the cheap
 * in-memory gate (isBriefingDue, off the cached timezone) filters ~95% of
 * subscribers out before any token refresh or Google call. Whoever is left is
 * handed to a per-user worker — one QStash message each, so their work
 * parallelises across short invocations instead of sharing this one's budget.
 *
 * Without QStash (local dev, or a publish failure) the user is run inline here,
 * bounded, so nothing silently drops in small deployments.
 */
export async function GET(req: Request) {
  try {
    if (!validateCronSecret(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // Cheap: scheduling fields only. Everything expensive is deferred to the
    // worker, which re-loads the full row for the users that survive the gate.
    const candidates = await db
      .selectDistinct({
        userId: users.id,
        timezone: users.timezone,
        briefingHour: users.briefingHour,
        briefingEnabled: users.briefingEnabled,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId));

    const due = candidates.filter((c) => isBriefingDue(c, now));

    if (due.length === 0) {
      await pruneNotificationLedger();
      return NextResponse.json({ ok: true, candidates: candidates.length, due: 0, dispatched: 0 });
    }

    let dispatched = 0;
    let ranInline = 0;
    let deferred = 0;
    let errors = 0;

    const runInline = async (userId: string) => {
      if (ranInline >= MAX_INLINE) {
        deferred++;
        return;
      }
      ranInline++;
      try {
        await runBriefingForUser(userId, now);
      } catch (error) {
        console.error(`[push/scheduled] Inline run failed for ${userId}:`, error);
        errors++;
      }
    };

    if (isQstashConfigured()) {
      // Fan out: one message per due user, published with bounded concurrency
      // so the publish loop itself doesn't blow the time budget at scale.
      const ids = await mapWithConcurrency(due, PUBLISH_CONCURRENCY, (c) =>
        publishJob({ path: '/api/push/briefing-user', body: { userId: c.userId } })
      );
      for (let i = 0; i < ids.length; i++) {
        if (ids[i]) dispatched++;
        else await runInline(due[i]!.userId); // publish failed — don't drop the user
      }
    } else {
      // No QStash: process inline, bounded. Fine for a personal deployment,
      // where the gated set is tiny; larger ones must configure QStash.
      for (const c of due) await runInline(c.userId);
    }

    // Cheap housekeeping so the dedupe ledger stays small.
    await pruneNotificationLedger();

    return NextResponse.json({
      ok: true,
      candidates: candidates.length,
      due: due.length,
      dispatched,
      ranInline,
      deferred,
      errors,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[push/scheduled] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

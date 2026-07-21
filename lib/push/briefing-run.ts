import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { sendToSubscriptions } from '@/lib/push/utils';
import { getAccessTokenForUser, resolveUserTimezone } from '@/lib/push/google-token';
import { getLocalHour, getLocalDateKey } from '@/lib/push/timezone';
import { claimNotification } from '@/lib/push/dedupe';
import { generateBriefing, fetchTodayEvents } from '@/lib/push/briefing';
import { fetchDayNotes } from '@/lib/push/day-notes';
import { scanDay } from '@/lib/push/insight-scan';
import { enqueueNotification } from '@/lib/push/queue';
import { GoogleCalendarService } from '@/lib/services/calendar';

export type BriefingRunResult =
  | { status: 'sent'; sent: number; queued: number }
  | { status: 'skipped'; reason: 'disabled' | 'not-hour' | 'claimed' };

/**
 * Build and send one user's daily briefing, then queue their proactive
 * insights. This is the whole of the per-user work — the dispatcher used to run
 * it inline in a loop; now the worker endpoint runs one of these per invocation
 * so thousands of users no longer share a single 60-second budget.
 *
 * It re-derives everything from `userId` and re-gates authoritatively, so it is
 * safe no matter who calls it: a stale dispatch, a QStash retry, or an unknown
 * timezone that only resolves here. The dedupe claim guarantees one briefing per
 * local day regardless of how many times this runs.
 */
export async function runBriefingForUser(userId: string, now: Date): Promise<BriefingRunResult> {
  const [u] = await db
    .select({
      timezone: users.timezone,
      briefingHour: users.briefingHour,
      briefingEnabled: users.briefingEnabled,
      proactiveEnabled: users.proactiveEnabled,
      quietHoursStart: users.quietHoursStart,
      quietHoursEnd: users.quietHoursEnd,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!u || !u.briefingEnabled) return { status: 'skipped', reason: 'disabled' };

  const accessToken = await getAccessTokenForUser(userId);
  // Resolves (and caches) the zone if the dispatcher deferred an unknown one.
  const tz = await resolveUserTimezone(userId, accessToken, u.timezone);

  // Authoritative gate — the dispatcher's pre-gate is only a hint, and QStash
  // delivery could land in a later hour than intended.
  if (getLocalHour(now, tz) !== u.briefingHour) return { status: 'skipped', reason: 'not-hour' };

  // One briefing per local day, even under retries or a doubled dispatch.
  const dedupeKey = `briefing:${getLocalDateKey(now, tz)}`;
  if (!(await claimNotification(userId, dedupeKey, 'daily-briefing'))) {
    return { status: 'skipped', reason: 'claimed' };
  }

  const events = accessToken
    ? await fetchTodayEvents(new GoogleCalendarService(accessToken, userId), userId, now, tz)
    : [];

  // One retrieval, two consumers: the briefing works it into its sentence, the
  // scan matches it against who the user is meeting.
  const notes = await fetchDayNotes(userId, events);

  const briefing = await generateBriefing(events, tz, notes);

  const subs = await db
    .select({ endpoint: pushSubscriptions.endpoint, keys: pushSubscriptions.keys })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  const { successCount } = await sendToSubscriptions(
    subs.map((s) => ({ endpoint: s.endpoint, keys: s.keys })),
    {
      title: briefing.title,
      body: briefing.body,
      data: {
        url: '/',
        type: 'daily-briefing',
        date: getLocalDateKey(now, tz),
        snoozeMinutes: 60,
      },
      icon: '/avatars/bot.svg',
      badge: '/avatars/bot.svg',
      tag: 'daily-briefing',
      actions: [
        { action: 'snooze', title: 'Later' },
        { action: 'save-note', title: 'Save' },
      ],
    },
    'push/briefing-user'
  );

  // Proactive insights ride the same events and notes, so the scan costs no
  // further calls. Each is queued for its own moment rather than sent now — a
  // "no break for four hours" warning is useful ten minutes before, not at
  // breakfast.
  let queued = 0;
  if (u.proactiveEnabled) {
    const insights = scanDay({
      events,
      notes,
      now,
      tz,
      quietHours: {
        quietHoursStart: u.quietHoursStart,
        quietHoursEnd: u.quietHoursEnd,
      },
    });

    for (const insight of insights) {
      // Claimed at scan time, so a re-run cannot queue the same nudge twice.
      if (!(await claimNotification(userId, insight.dedupeKey, insight.kind))) continue;

      await enqueueNotification({
        userId,
        notifyAt: insight.notifyAt,
        payload: insight.payload,
        kind: insight.kind,
      });
      queued++;
    }
  }

  return { status: 'sent', sent: successCount, queued };
}

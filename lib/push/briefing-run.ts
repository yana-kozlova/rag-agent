import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { deliverToUser } from '@/lib/push/deliver';
import { getAccessTokenForUser, resolveUserTimezone } from '@/lib/push/google-token';
import { getLocalHour, getLocalDateKey } from '@/lib/push/timezone';
import { claimNotification } from '@/lib/push/dedupe';
import {
  generateBriefing,
  fetchTodayEvents,
  type BriefingDate,
  type BriefingEvent,
  type BriefingTask,
} from '@/lib/push/briefing';
import { upcomingTimeline } from '@/lib/actions/timeline';
import { briefingTasks } from '@/lib/actions/tasks';
import { BRIEFING_HORIZON_DAYS } from '@/lib/timeline/timeline';
import { BRIEFING_HORIZON_DAYS as TASK_HORIZON_DAYS, daysLate } from '@/lib/tasks/tasks';
import { fetchDayNotes } from '@/lib/push/day-notes';
import { scanDay } from '@/lib/push/insight-scan';
import { enqueueNotification } from '@/lib/push/queue';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { askAboutOverdue } from '@/lib/telegram/tasks';

/**
 * The week's saved dates, or none.
 *
 * Degrades on its own: the briefing has already paid for a calendar fetch and a
 * retrieval by the time this runs, and a failure here must cost the birthday
 * line rather than the whole morning.
 */
async function upcomingDatesForBriefing(userId: string): Promise<BriefingDate[]> {
  try {
    const { occurrences } = await upcomingTimeline(userId, BRIEFING_HORIZON_DAYS);
    return occurrences.map((occurrence) => ({
      title: occurrence.event.title,
      kind: occurrence.event.kind,
      daysAway: occurrence.daysAway,
      years: occurrence.years,
    }));
  } catch (error) {
    console.error('[push/briefing] Reading the timeline failed (non-fatal):', error);
    return [];
  }
}

/**
 * What is outstanding this morning, or none.
 *
 * Same contract as `upcomingDatesForBriefing` and for the same reason: a failure
 * reading tasks costs the tasks block, never the briefing.
 *
 * Only overdue tasks and deadlines landing inside the horizon are carried.
 * Anything already committed to today has a calendar event and is therefore
 * already in the schedule above — listing it here as well would print one
 * commitment twice under two headings.
 */
async function outstandingTasksForBriefing(userId: string): Promise<BriefingTask[]> {
  try {
    const { today, overdue, due } = await briefingTasks(userId, TASK_HORIZON_DAYS);

    return [
      ...overdue.map((task) => ({
        id: task.id,
        title: task.title,
        daysLate: daysLate(task.dueOn, today),
        due: null,
      })),
      ...due.map((task) => ({
        id: task.id,
        title: task.title,
        daysLate: 0,
        due: (task.dueOn === today ? 'today' : 'tomorrow') as 'today' | 'tomorrow',
      })),
    ];
  } catch (error) {
    console.error('[push/briefing] Reading tasks failed (non-fatal):', error);
    return [];
  }
}

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
      locale: users.locale,
      // Where the overdue-task questions go. `deliverToUser` resolves this
      // itself for the briefing; these messages are sent directly, so they need
      // it here.
      telegramChatId: users.telegramChatId,
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

  // `null` means the calendar could not be read, which is not the same fact as
  // an empty day and is not reported as one. Both ways of failing land here:
  // no usable token — a refresh token Google has expired or revoked returns
  // null from `getAccessTokenForUser` — and a read that Google refused.
  let events: BriefingEvent[] | null = null;

  if (!accessToken) {
    console.error(`[push/briefing] No usable Google token for ${userId}; calendar unreadable`);
  } else {
    try {
      events = await fetchTodayEvents(
        new GoogleCalendarService(accessToken, userId),
        userId,
        now,
        tz
      );
    } catch (error) {
      console.error(`[push/briefing] Calendar read failed for ${userId}:`, error);
    }
  }

  // One retrieval, two consumers: the briefing works it into its sentence, the
  // scan matches it against who the user is meeting.
  const notes = await fetchDayNotes(userId, events ?? []);

  // Saved dates falling within the week. Read from the timeline rather than the
  // calendar because that is where they are: a birthday nobody created a
  // calendar event for is exactly the thing this is meant to catch.
  const dates = await upcomingDatesForBriefing(userId);

  // Outstanding work, from our own table rather than Google — so a broken
  // calendar costs the schedule and never the deadline that passed yesterday.
  const outstanding = await outstandingTasksForBriefing(userId);

  const briefing = await generateBriefing(
    events,
    tz,
    notes,
    u.locale,
    dates,
    outstanding,
    now
  );

  const delivered = await deliverToUser(
    userId,
    {
      title: briefing.title,
      body: briefing.body,
      actions: ['snooze', 'save'],
      snoozeMinutes: 60,
      data: { type: 'daily-briefing', date: getLocalDateKey(now, tz) },
    },
    'push/briefing-user'
  );

  // Overdue tasks are asked about after the briefing, one short message each so
  // that answering one leaves the others live — see `askAboutOverdue`. Only when
  // the briefing itself arrived: questions about yesterday's deadlines with no
  // briefing above them are a bot talking to itself.
  if (delivered === 'sent' && u.telegramChatId) {
    try {
      await askAboutOverdue(u.telegramChatId, outstanding, u.locale);
    } catch (error) {
      console.error('[push/briefing] Asking about overdue tasks failed (non-fatal):', error);
    }
  }

  // Proactive insights ride the same events and notes, so the scan costs no
  // further calls. Each is queued for its own moment rather than sent now — a
  // "no break for four hours" warning is useful ten minutes before, not at
  // breakfast.
  let queued = 0;
  if (u.proactiveEnabled) {
    const insights = scanDay({
      // Nothing to scan when the calendar is unreadable — a nudge inferred from
      // an absence of events would be inferred from an absence of knowledge.
      events: events ?? [],
      notes,
      now,
      tz,
      quietHours: {
        quietHoursStart: u.quietHoursStart,
        quietHoursEnd: u.quietHoursEnd,
      },
      locale: u.locale,
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

  return { status: 'sent', sent: delivered === 'sent' ? 1 : 0, queued };
}

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { deliverToUser } from '@/lib/push/deliver';
import { getAccessTokenResult, resolveUserTimezone } from '@/lib/push/google-token';
import { needsReconnect } from '@/lib/auth/google-access';
import { getLocalHour, getLocalDateKey } from '@/lib/push/timezone';
import { claimNotification } from '@/lib/push/dedupe';
import {
  generateBriefing,
  fetchTodayEvents,
  type BriefingDate,
  type BriefingEvent,
  type BriefingCounts,
  type BriefingTask,
  type CalendarProblem,
} from '@/lib/push/briefing';
import { upcomingTimeline } from '@/lib/actions/timeline';
import { briefingTasks, listTaskSuggestions } from '@/lib/actions/tasks';
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
 * Overdue tasks and deadlines landing inside the horizon always. A task the user
 * committed to *today* is normally left out, because committing writes a Google
 * event and it is therefore already in the schedule above — printing it here as
 * well would show one commitment twice under two headings.
 *
 * `inSchedule` is what makes that conditional rather than absolute, and it had
 * to be. The exclusion assumes there is a schedule for the task to be in, and
 * twice there is not: when the calendar could not be read at all, and when the
 * task carries no `google_event_id` because writing the event failed. In both
 * cases the day's committed work was printed *nowhere* — dropped from the tasks
 * block as a duplicate of a list that did not exist. That is the exact failure
 * this block was added to prevent, one step in: tasks live in our own table
 * precisely so a broken calendar cannot swallow them, and then a broken calendar
 * swallowed them anyway.
 */
async function outstandingTasksForBriefing(
  userId: string,
  /** Whether today's schedule was actually readable and will be printed. */
  inSchedule: boolean
): Promise<{ tasks: BriefingTask[]; someday: number }> {
  try {
    const { today, overdue, due, scheduled, someday } = await briefingTasks(
      userId,
      TASK_HORIZON_DAYS
    );

    // A commitment nothing else will show this morning.
    const unlisted = scheduled.filter((task) => !inSchedule || !task.googleEventId);

    const tasks: BriefingTask[] = [
      ...overdue.map((task) => ({
        id: task.id,
        title: task.title,
        daysLate: daysLate(task.dueOn, today),
        due: null,
      })),
      ...unlisted.map((task) => ({
        id: task.id,
        title: task.title,
        daysLate: 0,
        due: null,
        committed: true,
      })),
      ...due.map((task) => ({
        id: task.id,
        title: task.title,
        daysLate: 0,
        due: (task.dueOn === today ? 'today' : 'tomorrow') as 'today' | 'tomorrow',
      })),
    ];

    return { tasks, someday: someday.length };
  } catch (error) {
    console.error('[push/briefing] Reading tasks failed (non-fatal):', error);
    return { tasks: [], someday: 0 };
  }
}

/**
 * How many needs are sitting in notes undecided, or none.
 *
 * The same number `/tasks` offers, because it is the same call with the same
 * default limit — a briefing quoting a count the page then contradicts is worse
 * than no count. Degrades to zero on its own, like the two reads above it: a
 * failure here must cost one line and never the morning.
 */
async function suggestionCountForBriefing(userId: string): Promise<number> {
  try {
    return (await listTaskSuggestions(userId)).length;
  } catch (error) {
    console.error('[push/briefing] Reading task suggestions failed (non-fatal):', error);
    return 0;
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

  const token = await getAccessTokenResult(userId);
  const accessToken = token.ok ? token.token : null;
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

  // And of the two ways, which one — because only one of them is the user's to
  // fix, and a morning that tells them to reconnect Google when Google was
  // merely down is a morning that teaches them to skip the line.
  let problem: CalendarProblem = 'unreadable';

  if (!accessToken) {
    if (!token.ok && needsReconnect(token.reason)) problem = 'google-access';
    console.error(
      `[push/briefing] No usable Google token for ${userId} (${
        token.ok ? 'unknown' : token.reason
      }); calendar unreadable`
    );
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

  // Retrieved for the proactive scan, which matches notes against who the user
  // is meeting. The briefing itself no longer reads them: it had one consumer
  // for them, the generated opening sentence, and that is gone.
  const notes = await fetchDayNotes(userId, events ?? []);

  // Saved dates falling within the week. Read from the timeline rather than the
  // calendar because that is where they are: a birthday nobody created a
  // calendar event for is exactly the thing this is meant to catch.
  const dates = await upcomingDatesForBriefing(userId);

  // Outstanding work, from our own table rather than Google — so a broken
  // calendar costs the schedule and never the deadline that passed yesterday.
  // `events !== null` is what tells it whether today's committed work is already
  // being printed above or has to be carried here.
  const outstanding = await outstandingTasksForBriefing(userId, events !== null);

  // What the knowledge base has been quietly accumulating. `metadata.needs` is
  // extracted from every note and lands nowhere until somebody opens `/tasks`,
  // so without a line here the pile is invisible by construction.
  const counts: BriefingCounts = {
    someday: outstanding.someday,
    fromNotes: await suggestionCountForBriefing(userId),
  };

  const briefing = await generateBriefing(
    events,
    tz,
    u.locale,
    dates,
    outstanding.tasks,
    problem,
    counts
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
      await askAboutOverdue(u.telegramChatId, outstanding.tasks, u.locale);
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

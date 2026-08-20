import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import {
  taskCompletions,
  taskInputSchema,
  taskPatchSchema,
  taskSuggestions,
  tasks,
  type Task,
  type TaskInput,
  type TaskPatch,
} from '@/lib/db/schema/tasks';
import { getAccessTokenForUser } from '@/lib/push/google-token';
import { getLocalDateKey, localDateTimeToIso } from '@/lib/push/timezone';
import { GoogleCalendarService } from '@/lib/services/calendar';
import {
  addTaskDays,
  bucketTasks,
  matchTaskByTitle,
  needKey,
  nextDueDate,
  type TaskBuckets,
  type TaskMatch,
  type TaskRecurrence,
} from '@/lib/tasks/tasks';
import { timezoneFor } from './user-timezone';

/**
 * Writing and reading tasks.
 *
 * The part worth reading twice is the calendar coupling. A task's `dueOn` is
 * private to this app; only `scheduledFor` reaches Google, and only through
 * `scheduleTask`. That one-way boundary is what keeps the calendar a record of
 * days the user agreed to spend rather than a pile of everything outstanding.
 *
 * Every write that touches Google does the database first and the calendar
 * second, and a calendar failure is reported but never rolls the row back —
 * the same ordering `logWellbeingEntry` uses for the same reason. A task saved
 * without its event is a task; a lost task is nothing, and the event can be
 * created again by scheduling it once more.
 */

/** Nothing pages the list, but one runaway import must not make it unusable. */
const MAX_TASK_ROWS = 500;

/** Google's `end.date` is exclusive: one day on the 18th ends on the 19th. */
const ALL_DAY_END_OFFSET = 1;

/** How long a task takes when a time was given but no end. */
const DEFAULT_TASK_MINUTES = 30;

/** The user's own today, not the server's — every bucket turns on it. */
async function todayFor(userId: string): Promise<{ today: string; timezone: string }> {
  const timezone = await timezoneFor(userId);
  return { today: getLocalDateKey(new Date(), timezone), timezone };
}

/** The next calendar day, for an all-day event's exclusive end. */
function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + ALL_DAY_END_OFFSET));
  return shifted.toISOString().slice(0, 10);
}

/**
 * A calendar service for a caller that may have no session.
 *
 * Built here rather than taken as an argument so a cron or Telegram path gets
 * the same behaviour as the web one. Returns null when the account has no usable
 * refresh token, which is a real and recoverable state — the task still saves,
 * it just does not get an event.
 */
async function calendarFor(userId: string): Promise<GoogleCalendarService | null> {
  const token = await getAccessTokenForUser(userId);
  return token ? new GoogleCalendarService(token, userId) : null;
}

export type TaskWriteResult = {
  success: boolean;
  task?: Task;
  duplicate?: boolean;
  /** Set when the row was written but Google refused the event. */
  calendarError?: string;
  message: string;
};

/**
 * Create a task.
 *
 * A duplicate is reported rather than raised: the identity index catches the
 * model saving "купити форму" a second time while the first is still open, and
 * the right answer there is to hand back the task that already exists, not an
 * error the model will try to work around by rewording the title.
 */
export async function createTask(params: {
  userId: string;
  input: TaskInput;
  source?: 'user' | 'extraction' | 'telegram';
  resourceId?: string | null;
  /**
   * Wall-clock "HH:mm" in the user's own zone, for a caller holding a time
   * rather than an instant — which the tool always is, since a model is given
   * "о 15:00" and has no business inventing a UTC offset for it. Turned into an
   * offset-bearing instant by `scheduleTask`, and ignored without a day, because
   * an hour on no day is not a plan.
   */
  startTime?: string;
  endTime?: string;
}): Promise<TaskWriteResult> {
  const input = taskInputSchema.parse(params.input);

  const row = {
    userId: params.userId,
    title: input.title,
    note: input.note ?? null,
    dueOn: input.dueOn ?? null,
    scheduledFor: input.scheduledFor ?? null,
    scheduledStart: input.scheduledStart ?? null,
    scheduledEnd: input.scheduledEnd ?? null,
    priority: input.priority ?? null,
    area: input.area ?? null,
    recurrence: input.recurrence ?? 'none',
    recurrenceInterval: input.recurrenceInterval ?? 1,
    resourceId: params.resourceId ?? null,
    source: params.source ?? 'user',
  };

  const [inserted] = await db.insert(tasks).values(row).onConflictDoNothing().returning();

  if (!inserted) {
    // The identity index rejected it. Read back matching that index exactly —
    // including `lower(btrim(title))` and the open-only predicate — because a
    // looser lookup could hand back a different task and confirm the wrong one.
    const [existing] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, params.userId),
          eq(tasks.status, 'open'),
          sql`lower(btrim(${tasks.title})) = lower(btrim(${input.title}))`,
          input.dueOn ? eq(tasks.dueOn, input.dueOn) : isNull(tasks.dueOn)
        )
      )
      .limit(1);

    // Nothing came back: the row that blocked the insert was closed or deleted
    // in the moment between. Reporting "already on the list" while handing over
    // no task would have the caller confirm something it cannot show.
    if (!existing) {
      return { success: false, message: 'Could not save that task. Try again.' };
    }

    return {
      success: true,
      task: existing,
      duplicate: true,
      message: 'That task is already on the list.',
    };
  }

  // A task created already committed to a day gets its event straight away.
  // The wall time is preferred over the stored instant: a caller passing
  // `startTime` has the user's own words, while `scheduledStart` is only set
  // when someone already did the offset arithmetic.
  if (inserted.scheduledFor) {
    return scheduleTask({
      userId: params.userId,
      taskId: inserted.id,
      day: inserted.scheduledFor,
      startTime:
        params.startTime ??
        (inserted.scheduledStart ? inserted.scheduledStart.slice(11, 16) : undefined),
      endTime:
        params.endTime ?? (inserted.scheduledEnd ? inserted.scheduledEnd.slice(11, 16) : undefined),
    });
  }

  return { success: true, task: inserted, duplicate: false, message: 'Task saved.' };
}

/** One task, scoped to its owner. Null when it is not theirs or not there. */
async function findTask(userId: string, taskId: string): Promise<Task | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)))
    .limit(1);

  return row ?? null;
}

/**
 * The task a caller meant, by id or by name.
 *
 * Tools take either because the model usually has neither: it has the words the
 * user just said. An id is trusted outright; a name goes through
 * `matchTaskByTitle`, which refuses an ambiguous one rather than picking.
 */
export async function resolveTask(params: {
  userId: string;
  taskId?: string;
  title?: string;
}): Promise<TaskMatch<Task>> {
  if (params.taskId) {
    const found = await findTask(params.userId, params.taskId);
    return found ? { status: 'match', task: found } : { status: 'none' };
  }

  if (!params.title) return { status: 'none' };

  return matchTaskByTitle(await listTasks(params.userId), params.title);
}

/**
 * Commit a task to a day, which is what puts it on the calendar.
 *
 * All-day and timed are two different promises and Google is told which. A day
 * with no hour becomes an all-day event marked `transparent` — it holds no time,
 * so it must not count as a conflict and must not appear in the briefing's
 * schedule beside its own line in the tasks block. A day with an hour is an
 * ordinary opaque event, because at that point it really does take the time.
 *
 * Rescheduling patches the existing event rather than replacing it, so
 * `googleEventId` stays stable and a task cannot accumulate copies of itself.
 */
export async function scheduleTask(params: {
  userId: string;
  taskId: string;
  day: string;
  /** "HH:mm" in the user's own zone. Omitted means the whole day. */
  startTime?: string;
  endTime?: string;
}): Promise<TaskWriteResult> {
  const task = await findTask(params.userId, params.taskId);
  if (!task) return { success: false, message: 'No such task.' };

  const { timezone } = await todayFor(params.userId);
  const timed = Boolean(params.startTime);

  const scheduledStart = params.startTime
    ? localDateTimeToIso(params.day, params.startTime, timezone)
    : null;

  const scheduledEnd = timed
    ? localDateTimeToIso(
        params.day,
        params.endTime ?? addMinutes(params.startTime as string, DEFAULT_TASK_MINUTES),
        timezone
      )
    : null;

  const [updated] = await db
    .update(tasks)
    .set({
      scheduledFor: params.day,
      scheduledStart,
      scheduledEnd,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.userId, params.userId), eq(tasks.id, params.taskId)))
    .returning();

  const calendar = await calendarFor(params.userId);
  if (!calendar) {
    return {
      success: true,
      task: updated,
      message: 'Task scheduled, but the calendar could not be reached to add it.',
    };
  }

  const boundaries = timed
    ? { start: scheduledStart as string, end: scheduledEnd as string }
    : { start: { date: params.day }, end: { date: nextDay(params.day) } };

  try {
    const event = task.googleEventId
      ? await calendar.patchEvent(task.googleCalendarId ?? 'primary', task.googleEventId, {
          ...boundaries,
          transparency: timed ? 'opaque' : 'transparent',
        })
      : await calendar.createEvent('primary', {
          title: task.title,
          description: task.note ?? undefined,
          ...boundaries,
          transparency: timed ? 'opaque' : 'transparent',
        });

    if (event?.id && event.id !== task.googleEventId) {
      const [linked] = await db
        .update(tasks)
        .set({ googleEventId: event.id, googleCalendarId: 'primary', updatedAt: new Date() })
        .where(and(eq(tasks.userId, params.userId), eq(tasks.id, params.taskId)))
        .returning();

      return { success: true, task: linked, message: 'Task scheduled and added to the calendar.' };
    }

    return { success: true, task: updated, message: 'Task rescheduled.' };
  } catch (error) {
    // The row is already correct; only the mirror failed. Reported so the caller
    // can say so, never rolled back — the plan is the user's, the event is a copy.
    console.error('[tasks] Calendar write failed:', error);
    return {
      success: true,
      task: updated,
      calendarError: error instanceof Error ? error.message : 'unknown',
      message: 'Task scheduled, but adding it to the calendar failed.',
    };
  }
}

/** "09:00" plus n minutes, wrapping is impossible within a day's tail. */
function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Take a task off its day, and its event off the calendar.
 *
 * An event Google no longer has counts as done — `deleteEvent` reports that as
 * `alreadyGone` rather than throwing. Without that, a user who deleted the event
 * on Google's side could never unschedule the task pointing at it: every attempt
 * failed and the row kept a dead id forever.
 */
export async function unscheduleTask(params: {
  userId: string;
  taskId: string;
}): Promise<TaskWriteResult> {
  const task = await findTask(params.userId, params.taskId);
  if (!task) return { success: false, message: 'No such task.' };

  let calendarError: string | undefined;

  if (task.googleEventId) {
    const calendar = await calendarFor(params.userId);
    if (calendar) {
      try {
        await calendar.deleteEvent(task.googleCalendarId ?? 'primary', task.googleEventId);
      } catch (error) {
        console.error('[tasks] Calendar delete failed:', error);
        calendarError = error instanceof Error ? error.message : 'unknown';
      }
    }
  }

  // The ids are cleared whatever Google said. Keeping a dead id would make the
  // task permanently unschedulable, which is a worse state than an orphan event
  // the user can delete by hand.
  const [updated] = await db
    .update(tasks)
    .set({
      scheduledFor: null,
      scheduledStart: null,
      scheduledEnd: null,
      googleEventId: null,
      googleCalendarId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.userId, params.userId), eq(tasks.id, params.taskId)))
    .returning();

  return {
    success: true,
    task: updated,
    calendarError,
    message: calendarError
      ? 'Task unscheduled, but its calendar event may still be there.'
      : 'Task unscheduled.',
  };
}

/**
 * Close a task — or, when it recurs, roll it to its next occurrence.
 *
 * The completion is logged either way, so a recurring task has a past. The
 * unique index on `(task_id, completed_on)` is what makes a double press safe:
 * Telegram's keyboard-clearing is best-effort, so the same button really can
 * fire twice, and rolling twice would silently skip an occurrence.
 */
export async function completeTask(params: {
  userId: string;
  taskId: string;
}): Promise<TaskWriteResult> {
  const task = await findTask(params.userId, params.taskId);
  if (!task) return { success: false, message: 'No such task.' };
  if (task.status !== 'open') {
    return { success: true, task, duplicate: true, message: 'That task was already closed.' };
  }

  const { today } = await todayFor(params.userId);

  const [logged] = await db
    .insert(taskCompletions)
    .values({
      userId: params.userId,
      taskId: task.id,
      completedOn: today,
      dueOn: task.dueOn,
    })
    .onConflictDoNothing()
    .returning();

  // Already closed today. Rolling again would skip an occurrence.
  if (!logged) {
    return { success: true, task, duplicate: true, message: 'That was already marked done today.' };
  }

  const rolled =
    task.recurrence !== 'none' && task.dueOn
      ? nextDueDate(task.dueOn, task.recurrence as TaskRecurrence, task.recurrenceInterval, today)
      : null;

  if (rolled) {
    // A rolled task keeps its identity and loses its plan: the day of work was
    // for the occurrence just closed, and its event has already happened.
    const [next] = await db
      .update(tasks)
      .set({
        dueOn: rolled,
        scheduledFor: null,
        scheduledStart: null,
        scheduledEnd: null,
        googleEventId: null,
        googleCalendarId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.userId, params.userId), eq(tasks.id, params.taskId)))
      .returning();

    return { success: true, task: next, message: `Done. Next one is due ${rolled}.` };
  }

  const [closed] = await db
    .update(tasks)
    .set({ status: 'done', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.userId, params.userId), eq(tasks.id, params.taskId)))
    .returning();

  return { success: true, task: closed, message: 'Done.' };
}

/** Reopen a task closed by mistake. The completion log keeps its record. */
export async function reopenTask(params: {
  userId: string;
  taskId: string;
}): Promise<TaskWriteResult> {
  const [updated] = await db
    .update(tasks)
    .set({ status: 'open', completedAt: null, updatedAt: new Date() })
    .where(and(eq(tasks.userId, params.userId), eq(tasks.id, params.taskId)))
    .returning();

  return updated
    ? { success: true, task: updated, message: 'Task reopened.' }
    : { success: false, message: 'No such task.' };
}

/**
 * Edit the fields that are not dates on a calendar.
 *
 * The schema is `taskPatchSchema`, not `taskInputSchema.partial()`: the latter
 * also admits `scheduledFor`, so an edit could set the day of work without
 * creating the event that is meant to be it, leaving the row claiming a day
 * Google never heard of. Scheduling goes through `scheduleTask` or not at all.
 */
export async function updateTask(params: {
  userId: string;
  taskId: string;
  patch: TaskPatch;
}): Promise<TaskWriteResult> {
  const patch = taskPatchSchema.parse(params.patch);

  const [updated] = await db
    .update(tasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(tasks.userId, params.userId), eq(tasks.id, params.taskId)))
    .returning();

  return updated
    ? { success: true, task: updated, message: 'Task updated.' }
    : { success: false, message: 'No such task.' };
}

/**
 * Delete a task outright, and its event with it.
 *
 * Reached from the API route, never from a tool — the wellbeing and timeline
 * precedent: a model choosing which of the user's rows to drop is a failure mode
 * this data cannot afford. Closing a task is the reversible action and that one
 * the model may do.
 */
export async function deleteTask(userId: string, taskId: string): Promise<{ success: boolean }> {
  const task = await findTask(userId, taskId);
  if (!task) return { success: false };

  if (task.googleEventId) {
    const calendar = await calendarFor(userId);
    if (calendar) {
      try {
        await calendar.deleteEvent(task.googleCalendarId ?? 'primary', task.googleEventId);
      } catch (error) {
        console.error('[tasks] Calendar delete failed during task delete:', error);
      }
    }
  }

  await db.delete(tasks).where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)));
  return { success: true };
}

/** Every open task, soonest first. The list the user asked to see in full. */
export async function listTasks(
  userId: string,
  opts: { includeClosed?: boolean } = {}
): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(
      opts.includeClosed
        ? eq(tasks.userId, userId)
        : and(eq(tasks.userId, userId), eq(tasks.status, 'open'))
    )
    .orderBy(asc(tasks.dueOn), asc(tasks.scheduledFor), desc(tasks.createdAt))
    .limit(MAX_TASK_ROWS);
}

export type TasksView = {
  today: string;
  timezone: string;
  buckets: TaskBuckets<Task>;
  counts: { open: number; overdue: number; today: number };
};

/** Everything the page and the widget render, in one read. */
export async function getTasksView(userId: string): Promise<TasksView> {
  const { today, timezone } = await todayFor(userId);
  const open = await listTasks(userId);
  const buckets = bucketTasks(open, today);

  return {
    today,
    timezone,
    buckets,
    counts: {
      open: open.length,
      overdue: buckets.overdue.length,
      today: buckets.today.length,
    },
  };
}

export type TaskSuggestion = {
  resourceId: string;
  resourceTitle: string;
  needKey: string;
  need: string;
  priority: 'high' | 'medium' | 'low' | null;
  context: string | null;
};

/**
 * Needs the extractor found that have not been turned into tasks or waved away.
 *
 * Computed rather than stored, which is why there is no suggestions table: a
 * suggestion is a reading of a note, and materialising readings means keeping
 * them in step with notes that get edited, merged and compacted. `metadata` is
 * the note's own record and always current; this subtracts the decisions already
 * made from it.
 */
export async function listTaskSuggestions(userId: string, limit = 20): Promise<TaskSuggestion[]> {
  const rows = await db
    // `title` is a column, not a metadata key — `resourceMetadataSchema` has no
    // top-level title, and reading `metadata.title` through its `passthrough()`
    // silently returned undefined for every note, so every suggestion was
    // labelled with a raw slice of its own content.
    .select({
      id: resources.id,
      title: resources.title,
      content: resources.content,
      metadata: resources.metadata,
    })
    .from(resources)
    .where(
      and(
        eq(resources.userId, userId),
        sql`jsonb_array_length(coalesce(${resources.metadata}->'needs', '[]'::jsonb)) > 0`
      )
    )
    .orderBy(desc(resources.createdAt))
    .limit(MAX_TASK_ROWS);

  if (rows.length === 0) return [];

  const decided = await db
    .select({ resourceId: taskSuggestions.resourceId, needKey: taskSuggestions.needKey })
    .from(taskSuggestions)
    .where(
      and(
        eq(taskSuggestions.userId, userId),
        inArray(
          taskSuggestions.resourceId,
          rows.map((r) => r.id)
        )
      )
    );

  const handled = new Set(decided.map((d) => `${d.resourceId}::${d.needKey}`));
  const out: TaskSuggestion[] = [];

  for (const row of rows) {
    const meta = row.metadata as { needs?: Array<Record<string, unknown>> } | null;
    const needs = Array.isArray(meta?.needs) ? meta.needs : [];

    for (const entry of needs) {
      const need = typeof entry?.need === 'string' ? entry.need.trim() : '';
      if (!need) continue;

      const key = needKey(need);
      if (!key || handled.has(`${row.id}::${key}`)) continue;

      // One decision per need per note, so a note repeating itself does not
      // produce the same suggestion twice on one screen.
      handled.add(`${row.id}::${key}`);

      out.push({
        resourceId: row.id,
        resourceTitle: row.title?.trim() || row.content.slice(0, 60),
        needKey: key,
        need,
        priority:
          entry?.priority === 'high' || entry?.priority === 'medium' || entry?.priority === 'low'
            ? entry.priority
            : null,
        context: typeof entry?.context === 'string' ? entry.context : null,
      });

      if (out.length >= limit) return out;
    }
  }

  return out;
}

/**
 * Accept a suggestion into a real task, or wave it away for good.
 *
 * Both write the same row, because both mean "this one is handled" and the list
 * has to stop offering it either way. Only `reason` tells them apart, and only
 * for someone later wondering where a task came from.
 */
export async function resolveSuggestion(params: {
  userId: string;
  resourceId: string;
  needKey: string;
  accept: boolean;
  input?: TaskInput;
}): Promise<TaskWriteResult> {
  let taskId: string | null = null;
  let created: TaskWriteResult | null = null;

  if (params.accept) {
    if (!params.input) return { success: false, message: 'Nothing to save.' };

    created = await createTask({
      userId: params.userId,
      input: params.input,
      source: 'extraction',
      resourceId: params.resourceId,
    });

    taskId = created.task?.id ?? null;
  }

  await db
    .insert(taskSuggestions)
    .values({
      userId: params.userId,
      resourceId: params.resourceId,
      needKey: params.needKey,
      reason: params.accept ? 'accepted' : 'dismissed',
      taskId,
    })
    .onConflictDoNothing();

  return created ?? { success: true, message: 'Suggestion dismissed.' };
}

/**
 * What the morning briefing needs: what is late, and what is due now.
 *
 * A separate read from `getTasksView` because it runs on the cron path with its
 * own failure contract — see `upcomingTasksForBriefing` in `briefing-run`.
 */
export async function briefingTasks(userId: string, horizonDays: number): Promise<{
  today: string;
  overdue: Task[];
  due: Task[];
  scheduled: Task[];
}> {
  const { today } = await todayFor(userId);
  const open = await listTasks(userId);
  const buckets = bucketTasks(open, today);

  const horizon = addTaskDays(today, horizonDays);

  return {
    today,
    overdue: buckets.overdue,
    // Deadlines landing inside the horizon that the user has not committed to a
    // day yet — the ones still needing a decision.
    due: buckets.upcoming.filter((t) => t.dueOn !== null && t.dueOn <= horizon && !t.scheduledFor),
    scheduled: buckets.today,
  };
}

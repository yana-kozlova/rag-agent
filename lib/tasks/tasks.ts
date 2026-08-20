/**
 * What a task is, independent of the database that stores it.
 *
 * The distinction this module exists to hold is that **a deadline and a day of
 * work are different dates**, and a to-do list that keeps only one of them is
 * wrong in one of two ways. Keep only the deadline and every task with a due
 * date shouts on the day it is due and is silent for the fortnight when it could
 * actually have been done. Keep only the working day and the deadline stops
 * existing, so nothing knows that Friday is the last chance.
 *
 * So `dueOn` is the last acceptable day and never leaves this app, while
 * `scheduledFor` is the day the user committed to doing it — and committing is
 * what writes a Google Calendar event, because at that point it really is a plan
 * for a day and belongs beside everything else claiming that day. Most tasks
 * carry one of the two; a task carrying neither is not broken, it is the ordinary
 * "sometime" item that a list of only dated things has nowhere to put.
 *
 * Lives in `lib/tasks` rather than beside the columns it constrains because the
 * tasks page and widget are client components, and importing from
 * `lib/db/schema/tasks.ts` would drag drizzle and every table definition into the
 * browser (same reason as `lib/timeline/timeline.ts` and `lib/wellbeing/scale.ts`).
 */

// Pure calendar-date arithmetic with no server clock in it, and already tested.
// A second copy here would be the same twelve characters drifting separately.
import { daysBetween } from '@/lib/timeline/timeline';

export const TASK_STATUSES = ['open', 'done', 'dropped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The same three the extractor already assigns to `metadata.needs`. */
export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'annual'] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

/** A task is a line in a list, not a paragraph. Room for a real sentence. */
export const MAX_TASK_TITLE = 200;

/** The detail that makes a task actionable — an address, a document number. */
export const MAX_TASK_NOTE = 1000;

/** "Дім", "Артем", "робота". A grouping label, not a description. */
export const MAX_TASK_AREA = 60;

/** Guard against `interval: 0` (an infinite roll) and against absurd values. */
export const MAX_RECURRENCE_INTERVAL = 365;

/** How far ahead the dashboard widget looks — deliberately past tomorrow. */
export const WIDGET_HORIZON_DAYS = 3;

/** How far ahead the morning briefing counts a deadline as worth a line. */
export const BRIEFING_HORIZON_DAYS = 1;

/**
 * A ceiling on rolling a recurrence forward.
 *
 * A daily task untouched for years would otherwise spin a long loop on the way
 * to tomorrow. 4000 covers ten years of daily and fifty of monthly, past which
 * the answer is not a date anyone wants anyway.
 */
const MAX_ROLL_STEPS = 4000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The same day-of-month, `months` later, clamped into a month that is too short.
 *
 * 31 January plus one month is 28 February, not 3 March. The clamp is why
 * `nextDueDate` always recomputes from the original date rather than stepping
 * from the last answer: stepping would turn a "31st of the month" task into a
 * 28th-of-the-month task permanently after one February.
 */
function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);

  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;

  return `${pad(nextYear, 4)}-${pad(nextMonth)}-${pad(Math.min(day, daysInMonth(nextYear, nextMonth)))}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return [
    pad(shifted.getUTCFullYear(), 4),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
  ].join('-');
}

/**
 * When a recurring task comes due next, having just been completed on `today`.
 *
 * Two rules, both load-bearing:
 *
 * **At least one step past the old due date.** Completing a daily task early
 * must not leave it due again on a day already gone.
 *
 * **Then forward until it is past today.** Miss three days of vitamins and the
 * next dose is tomorrow, not the day before yesterday — a recurrence that
 * re-emerges already overdue is a task that can never be caught up with, and a
 * list that permanently accuses is a list that gets ignored.
 *
 * The anchor is always the schedule, never the completion. "Every two weeks
 * from whenever I last did it" is a real and different intention that this
 * deliberately does not express — see the note in the plan.
 *
 * Returns null for a task that does not recur, which is the caller's signal to
 * close it rather than roll it.
 */
export function nextDueDate(
  dueOn: string,
  recurrence: TaskRecurrence,
  interval: number,
  today: string
): string | null {
  if (recurrence === 'none') return null;

  const step = Math.max(1, Math.min(Math.trunc(interval) || 1, MAX_RECURRENCE_INTERVAL));

  if (recurrence === 'daily' || recurrence === 'weekly') {
    const stepDays = recurrence === 'weekly' ? step * 7 : step;
    const behind = daysBetween(dueOn, today);

    // At least one step; more when the due date is already behind us.
    const steps = Math.max(1, Math.floor(behind / stepDays) + 1);
    return addDays(dueOn, Math.min(steps, MAX_ROLL_STEPS) * stepDays);
  }

  const stepMonths = recurrence === 'annual' ? step * 12 : step;

  // Months are not a fixed number of days, so this counts rather than solves —
  // but always from `dueOn`, so the day-of-month clamp never compounds.
  let steps = 1;
  let next = addMonths(dueOn, stepMonths);
  while (next <= today && steps < MAX_ROLL_STEPS) {
    steps += 1;
    next = addMonths(dueOn, stepMonths * steps);
  }

  return next;
}

/** A deadline that has passed. Equal to today is due, not late. */
export function isOverdue(dueOn: string | null, today: string): boolean {
  return dueOn !== null && dueOn < today;
}

/** How many days late, for the copy that says so. Zero when not overdue. */
export function daysLate(dueOn: string | null, today: string): number {
  return isOverdue(dueOn, today) ? daysBetween(dueOn as string, today) : 0;
}

/**
 * The two dates, and nothing else.
 *
 * Split from `BucketableTask` because `withinHorizon` reads only these, and
 * demanding `status` from it made a caller holding a already-filtered list —
 * the dashboard widget — unable to use it, so the widget grew its own copy of
 * the rule and the copy drifted. A constraint wider than what a function reads
 * is how duplication gets invited in.
 */
export type DatedTask = {
  dueOn: string | null;
  scheduledFor: string | null;
};

/** What bucketing needs. Structural, so both a DB row and a view fit. */
export type BucketableTask = DatedTask & { status: string };

export type TaskBuckets<T> = {
  /** Deadline passed. Nothing moved it — the date is the user's, not ours. */
  overdue: T[];
  /** Committed to today, which is also what put an event on the calendar. */
  today: T[];
  /** Dated and still ahead. The list the user asked to see in full. */
  upcoming: T[];
  /** Neither deadline nor plan. The "вільні завдання" this feature is named for. */
  someday: T[];
};

/** The earliest date that says anything about when a task needs attention. */
function sortKey(task: DatedTask): string {
  const dates = [task.dueOn, task.scheduledFor].filter((d): d is string => d !== null);
  return dates.length > 0 ? dates.sort()[0] : '';
}

/**
 * Split open tasks into the four sections every surface renders.
 *
 * The buckets are mutually exclusive on purpose. An earlier shape had a fifth
 * "recurring" section, which meant a weekly task appeared both there and under
 * its own due date — and a list that shows one item twice is a list whose counts
 * cannot be trusted. Recurrence is a property of a task, shown as a badge beside
 * it, not a place it lives.
 *
 * Precedence is deadline-first: an overdue task that also happens to be
 * scheduled for today is overdue, because that is the fact about it that changes
 * what the user should do.
 */
export function bucketTasks<T extends BucketableTask>(tasks: T[], today: string): TaskBuckets<T> {
  const buckets: TaskBuckets<T> = { overdue: [], today: [], upcoming: [], someday: [] };

  for (const task of tasks) {
    if (task.status !== 'open') continue;

    if (isOverdue(task.dueOn, today)) buckets.overdue.push(task);
    else if (task.scheduledFor === today) buckets.today.push(task);
    else if (task.dueOn !== null || task.scheduledFor !== null) buckets.upcoming.push(task);
    else buckets.someday.push(task);
  }

  // Oldest deadline first everywhere it means anything: in `overdue` that is the
  // most late, in `upcoming` the most imminent.
  for (const key of ['overdue', 'today', 'upcoming'] as const) {
    buckets[key].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }

  return buckets;
}

/** Tasks needing attention within `days`, for the widget and the briefing. */
export function withinHorizon<T extends DatedTask>(tasks: T[], today: string, days: number): T[] {
  const limit = addDays(today, days);

  return tasks.filter((task) => {
    const key = sortKey(task);
    return key !== '' && key <= limit;
  });
}

/**
 * A `metadata.needs` entry folded to a key, so the same need read out of the
 * same note twice is recognised as already handled.
 *
 * Deliberately cruder than the symptom matcher in `lib/wellbeing/symptoms.ts`:
 * that one matches blind across a user's whole vocabulary and drives a chart,
 * while this only has to recognise *the same string from the same note*. The
 * pairing is `(resourceId, needKey)`, so two genuinely different needs colliding
 * would need to be near-identical text on one note.
 */
export function needKey(need: string): string {
  return need
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * Find the task a user meant by name.
 *
 * Returns `ambiguous` rather than a best guess, on the `matchDirective`
 * precedent and for a sharper version of its reason: closing the wrong task
 * makes a thing that still needs doing disappear from the only list that was
 * tracking it, and nobody notices until the deadline has passed. Asking which
 * one costs a sentence; guessing costs the task.
 *
 * The rules are deliberately shallow — exact match first, then containment in
 * either direction. No stemming and no fuzzy distance: a to-do list is short and
 * the user is looking at it, so the failure to avoid is a clever match on the
 * wrong row, not a missed match the user can fix by reading one off the screen.
 */
export type TaskMatch<T> =
  | { status: 'match'; task: T }
  | { status: 'ambiguous'; tasks: T[] }
  | { status: 'none' };

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

export function matchTaskByTitle<T extends { title: string }>(
  candidates: T[],
  query: string
): TaskMatch<T> {
  const needle = fold(query);
  if (!needle) return { status: 'none' };

  const exact = candidates.filter((t) => fold(t.title) === needle);
  if (exact.length === 1) return { status: 'match', task: exact[0] };
  if (exact.length > 1) return { status: 'ambiguous', tasks: exact };

  const partial = candidates.filter((t) => {
    const title = fold(t.title);
    return title.includes(needle) || needle.includes(title);
  });

  if (partial.length === 1) return { status: 'match', task: partial[0] };
  if (partial.length > 1) return { status: 'ambiguous', tasks: partial };

  return { status: 'none' };
}

export { addDays as addTaskDays };

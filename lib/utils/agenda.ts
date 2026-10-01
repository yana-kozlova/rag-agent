/**
 * Today, as one list: what is late, what the day holds, and what is close.
 *
 * The dashboard used to show the calendar and the task list side by side, and
 * a task committed to an hour appeared in both — `scheduleTask` writes a timed
 * task as an ordinary calendar event, so the "Today" card listed the event and
 * the tasks card listed the task, one commitment under two headings. Here the
 * two are merged on `googleEventId`: the event keeps its place in the day and
 * carries the task, so it can still be ticked off.
 *
 * An all-day task is written to Google as a transparent event, which the live
 * feed drops as a time block — so it never arrives here as an event and needs no
 * merging; it is listed as an untimed task.
 *
 * Dependency-free apart from `lib/tasks/tasks` (itself client-safe), because the
 * widget is a client component. Takes the day's bounds and "now" as arguments
 * rather than reading a clock, so tests do not depend on the machine's zone.
 */

import { WIDGET_HORIZON_DAYS, withinHorizon } from '@/lib/tasks/tasks';

export type AgendaEventInput = {
  id: string;
  title: string;
  /** ISO datetime for timed events, `YYYY-MM-DD` for all-day ones. */
  start: string;
  end: string;
  location?: string;
  meetingLink?: string;
  calendarId?: string;
};

export type AgendaTaskInput = {
  id: string;
  title: string;
  dueOn: string | null;
  scheduledFor: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  googleEventId?: string | null;
};

export type AgendaTaskBuckets = {
  overdue: AgendaTaskInput[];
  today: AgendaTaskInput[];
  upcoming: AgendaTaskInput[];
};

export type AgendaEntry = {
  key: string;
  title: string;
  /** Null for something that holds the day rather than an hour. */
  start: string | null;
  end: string | null;
  location?: string;
  meetingLink?: string;
  calendarId?: string;
  /** Present when the entry can be ticked off. */
  taskId?: string;
  /** Deadline passed — kept on the entry even when it also sits in the day. */
  overdue?: boolean;
  /** Timed and already over. Shown dimmed rather than hidden. */
  past?: boolean;
};

export type Agenda = {
  /** Late tasks that are not already part of the day below. */
  overdue: (AgendaEntry & { dueOn: string })[];
  /** All-day entries first, then the timed ones in order. */
  day: AgendaEntry[];
  /** Deadlines and plans within `WIDGET_HORIZON_DAYS`, not today. */
  soon: (AgendaEntry & { dueOn: string | null; scheduledFor: string | null })[];
};

const isDateOnly = (value: string) => !value.includes('T');

/** Whether an event touches the day `[dayStart, dayEnd)`. */
function onDay(event: AgendaEventInput, today: string, dayStart: Date, dayEnd: Date): boolean {
  // All-day: compare as calendar dates. Parsing `2026-09-28` through `Date` gives
  // UTC midnight, which is the previous evening west of Greenwich.
  if (isDateOnly(event.start)) {
    const end = isDateOnly(event.end) ? event.end : event.start;
    // Google's all-day end is exclusive; a malformed zero-length one still counts.
    return event.start <= today && (today < end || event.start === end);
  }
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  return start < dayEnd.getTime() && end > dayStart.getTime();
}

/**
 * The live feed prefixes each id with its calendar (`primary:abc`), while a task
 * stores Google's bare id — and a followed calendar may carry the same event
 * under the user's address instead of `primary`, so match on the suffix.
 */
function eventIdOf(event: AgendaEventInput): string {
  const colon = event.id.indexOf(':');
  return colon >= 0 ? event.id.slice(colon + 1) : event.id;
}

export function buildAgenda(params: {
  events: AgendaEventInput[];
  tasks: AgendaTaskBuckets;
  /** The user's local date, `YYYY-MM-DD`. */
  today: string;
  dayStart: Date;
  dayEnd: Date;
  now: Date;
  horizonDays?: number;
}): Agenda {
  const { events, tasks, today, dayStart, dayEnd, now } = params;
  const horizonDays = params.horizonDays ?? WIDGET_HORIZON_DAYS;

  const overdueIds = new Set(tasks.overdue.map((t) => t.id));
  const byEventId = new Map<string, AgendaTaskInput>();
  for (const task of [...tasks.overdue, ...tasks.today]) {
    if (task.googleEventId) byEventId.set(task.googleEventId, task);
  }

  const claimed = new Set<string>();
  const allDay: AgendaEntry[] = [];
  const timed: AgendaEntry[] = [];

  for (const event of events) {
    if (!onDay(event, today, dayStart, dayEnd)) continue;

    const task = byEventId.get(eventIdOf(event));
    if (task) claimed.add(task.id);

    const entry: AgendaEntry = {
      key: `event:${event.id}`,
      title: event.title,
      start: isDateOnly(event.start) ? null : event.start,
      end: isDateOnly(event.start) ? null : event.end,
      location: event.location,
      meetingLink: event.meetingLink,
      calendarId: event.calendarId,
      ...(task ? { taskId: task.id, overdue: overdueIds.has(task.id) } : {}),
    };

    if (entry.start) {
      entry.past = new Date(event.end).getTime() <= now.getTime();
      timed.push(entry);
    } else {
      allDay.push(entry);
    }
  }

  // Today's tasks the calendar did not already account for: all-day ones, and
  // timed ones whose event never got written or was not in the feed.
  for (const task of tasks.today) {
    if (claimed.has(task.id)) continue;
    const entry: AgendaEntry = {
      key: `task:${task.id}`,
      title: task.title,
      start: task.scheduledStart ?? null,
      end: task.scheduledEnd ?? null,
      taskId: task.id,
    };
    if (entry.start) {
      entry.past = new Date(entry.end ?? entry.start).getTime() <= now.getTime();
      timed.push(entry);
    } else {
      allDay.push(entry);
    }
  }

  timed.sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime());

  return {
    overdue: tasks.overdue
      .filter((t) => !claimed.has(t.id))
      .map((t) => ({
        key: `task:${t.id}`,
        title: t.title,
        start: null,
        end: null,
        taskId: t.id,
        overdue: true,
        dueOn: t.dueOn as string,
      })),
    day: [...allDay, ...timed],
    soon: withinHorizon(tasks.upcoming, today, horizonDays).map((t) => ({
      key: `task:${t.id}`,
      title: t.title,
      start: null,
      end: null,
      taskId: t.id,
      dueOn: t.dueOn,
      scheduledFor: t.scheduledFor,
    })),
  };
}

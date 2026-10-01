import { GoogleCalendarService } from '@/lib/services/calendar';
import { daysBetween, timelineKindIcon } from '@/lib/timeline/timeline';
import { copyFor, type NotificationCopy } from './copy';
import {
  type CalendarEvent,
  fetchEventsBetween,
  formatEventTime,
  localDayBounds,
} from './calendar-window';
import { addLocalDays, formatUtcOffset, getLocalDateKey } from './timezone';

export type BriefingEvent = CalendarEvent;

/** A saved date landing in the week ahead, as `upcomingTimeline` projects it. */
export type BriefingDate = {
  title: string;
  kind: string;
  daysAway: number;
  /** Years being completed. Null when the original year was never recorded. */
  years: number | null;
  /** The account holder's own birthday — greeted on the day rather than listed. */
  self?: boolean;
};

/** A calendar event on one of the days after today, as `aheadEvents` shapes it. */
export type BriefingAhead = {
  title: string;
  /** The local calendar day it starts on, `YYYY-MM-DD`. */
  day: string;
  /** Whole days from today. Never zero — today is the schedule's. */
  daysAway: number;
  /** `HH:MM` in the user's zone, or null for an all-day event. */
  time: string | null;
};

/** An outstanding task worth a line this morning, as `briefingTasks` groups them. */
export type BriefingTask = {
  id: string;
  title: string;
  /** Whole days past the deadline. Zero for one that has not passed. */
  daysLate: number;
  /** Whether the deadline is today or tomorrow, when it has not passed yet. */
  due: 'today' | 'tomorrow' | null;
  /**
   * A day of work the user committed to today, as opposed to a deadline.
   *
   * Carried only when the task is not already in the schedule above — see
   * `outstandingTasksForBriefing`. Disjoint from `daysLate` and `due` by
   * construction, since `bucketTasks` files an overdue task as overdue whatever
   * day it was committed to.
   */
  committed?: boolean;
};

/**
 * The two parts of the morning that are worth a number rather than a list.
 *
 * Both are piles that do not move day to day, so lines would be wallpaper
 * within a week while a count still says whether the pile is growing.
 */
export type BriefingCounts = {
  /** Open tasks with no deadline and no day of work. */
  someday?: number;
  /** Undecided needs the extractor found in notes. */
  fromNotes?: number;
};

export type Briefing = {
  title: string;
  body: string;
  eventCount: number;
};

/**
 * Why there is no schedule to print, when there is none.
 *
 * Only two answers, because only two of them change what the user should do.
 * `google-access` is the one they can repair, and the briefing is where they
 * will find out: it arrives every morning whether or not anyone opens the app,
 * which is precisely how a dead permission went unnoticed for five days. Every
 * other failure is `unreadable` — Google not answering is not something to send
 * someone through a consent screen over.
 */
export type CalendarProblem = 'unreadable' | 'google-access';

/** Everything on the user's calendars for their local today. */
export async function fetchTodayEvents(
  calendarService: GoogleCalendarService,
  userId: string,
  now: Date,
  tz: string
): Promise<BriefingEvent[]> {
  const { timeMin, timeMax } = localDayBounds(now, tz);
  return fetchEventsBetween(calendarService, userId, timeMin, timeMax, 25);
}

/**
 * How far past today the briefing looks at the calendar. The same week the
 * saved dates get, so the two blocks describe one stretch of time.
 */
export const AHEAD_HORIZON_DAYS = 7;

/** Everything on the user's calendars from tomorrow to the end of the horizon. */
export async function fetchAheadEvents(
  calendarService: GoogleCalendarService,
  userId: string,
  now: Date,
  tz: string
): Promise<BriefingEvent[]> {
  const offset = formatUtcOffset(now, tz);
  const timeMin = `${addLocalDays(now, tz, 1)}T00:00:00${offset}`;
  const timeMax = `${addLocalDays(now, tz, AHEAD_HORIZON_DAYS)}T23:59:59${offset}`;
  return fetchEventsBetween(calendarService, userId, timeMin, timeMax, 50);
}

const titleKey = (title: string) => title.trim().toLowerCase();

/**
 * The days after today, reduced to what is worth being told about in advance.
 *
 * A title is given one line, at its first occurrence, and none at all when it
 * is also on today's schedule. Without that the block is the calendar: a daily
 * stand-up is five of the lines, every morning, and the dentist on Thursday —
 * the reason to look ahead at all — falls off the end of the cap. A repeated
 * title is a routine, and a routine needs no notice. The cost is a genuinely
 * separate second meeting under the same name, which still appears on the
 * morning of its own day.
 *
 * The day is computed here and printed, never left to be derived from a
 * timestamp — the rule `weekdayOf` exists for.
 */
export function aheadEvents(
  ahead: BriefingEvent[],
  today: BriefingEvent[],
  now: Date,
  tz: string
): BriefingAhead[] {
  const todayKey = getLocalDateKey(now, tz);
  const seen = new Set(today.map((event) => titleKey(event.title)));
  const result: BriefingAhead[] = [];

  for (const event of ahead) {
    // An all-day start is already a calendar date; parsing it through `Date`
    // makes it UTC midnight, which west of Greenwich is the day before.
    const day = event.allDay
      ? event.start.slice(0, 10)
      : getLocalDateKey(new Date(event.start), tz);

    const daysAway = daysBetween(todayKey, day);
    // A multi-day event that began today or earlier overlaps the window too.
    if (daysAway < 1) continue;

    const key = titleKey(event.title);
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      title: event.title,
      day,
      daysAway,
      time: event.allDay ? null : formatEventTime(event, tz),
    });
  }

  return result.sort(
    (a, b) => a.day.localeCompare(b.day) || (a.time ?? '').localeCompare(b.time ?? '')
  );
}

/**
 * How many events get a line of their own before the rest collapse into a
 * count. Past this the briefing stops being scannable and becomes the calendar.
 */
const MAX_EVENT_LINES = 8;

/**
 * Ceiling on one event's title.
 *
 * Calendar titles are user data and can run to a thousand characters. Eight of
 * those overflow Telegram's 4096-character message, which `splitForTelegram`
 * then breaks in two — and since a keyboard can only ride on the last piece,
 * "Save" would file half a briefing and "Later" would postpone the other half.
 * Truncating is also simply what a scannable list needs.
 */
const MAX_TITLE = 80;

/**
 * The schedule itself — built here, and now the whole of the briefing.
 *
 * A model that is handed times and asked to repeat them will eventually repeat
 * one wrong, and a briefing that misstates when a meeting starts is worse than
 * no briefing. That reasoning used to stop at the list, with a generated
 * sentence above it; it now covers the sentence too — see `generateBriefing`.
 */
function scheduleLines(
  events: BriefingEvent[],
  tz: string,
  copy: NotificationCopy
): string {
  const shown = events.slice(0, MAX_EVENT_LINES);
  const lines = shown.map(
    (e) => `${formatEventTime(e, tz, copy.briefing.allDay)} ${truncate(e.title)}`
  );

  const hidden = events.length - shown.length;
  if (hidden > 0) lines.push(copy.briefing.more(hidden));

  return lines.join('\n');
}

/** Fewer than today gets: this block is notice, not a plan for the day. */
const MAX_AHEAD_LINES = 6;

/** What is on the calendar in the days after today, one line per event. */
function aheadLines(ahead: BriefingAhead[], copy: NotificationCopy): string {
  if (ahead.length === 0) return '';

  const dayFormat = new Intl.DateTimeFormat(copy.intlTag, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });

  const shown = ahead.slice(0, MAX_AHEAD_LINES);
  const lines = shown.map((event) => {
    const when =
      event.daysAway === 1
        ? copy.dates.tomorrow
        : dayFormat.format(new Date(`${event.day}T00:00:00Z`));

    return `${when} · ${event.time ?? copy.briefing.allDay} ${truncate(event.title)}`;
  });

  const hidden = ahead.length - shown.length;
  if (hidden > 0) lines.push(copy.briefing.more(hidden));

  return `${copy.ahead.header}:\n${lines.join('\n')}`;
}

/**
 * How many dates get a line. A week's horizon rarely produces more; the cap is
 * against the one week in a family's year that does.
 */
const MAX_DATE_LINES = 4;

/**
 * The week's saved dates, built the same way the schedule is and for the same
 * reason: a model told that a birthday is in three days will eventually say two.
 *
 * "виповнюється N" is printed only when `years` is set, which the projection
 * does only when the original year is known — a birthday recorded as a day and
 * month has no age to announce, and guessing one is worse than saying nothing.
 */
function dateLines(dates: BriefingDate[], copy: NotificationCopy): string {
  if (dates.length === 0) return '';

  const lines = dates.slice(0, MAX_DATE_LINES).map((date) => {
    const when =
      date.daysAway === 0
        ? copy.dates.today
        : date.daysAway === 1
          ? copy.dates.tomorrow
          : copy.dates.inDays(date.daysAway);

    const age = date.years && date.years > 0 ? `, ${copy.dates.turning(date.years)}` : '';

    return `${timelineKindIcon(date.kind)} ${truncate(date.title)} — ${when}${age}`;
  });

  return `${copy.dates.header}:\n${lines.join('\n')}`;
}

/**
 * How many tasks get a line before the rest collapse into a count. Lower than
 * the schedule's cap: a morning message listing ten outstanding things is a
 * morning message nobody finishes reading.
 */
const MAX_TASK_LINES = 5;

/**
 * What is outstanding, built the same way the schedule and the dates are.
 *
 * The lateness is computed by the application and printed, never handed to the
 * model to phrase — the rule this file already follows twice, and it matters
 * more here than anywhere: a briefing that says a deadline passed two days ago
 * when it passed five is worse than one that says nothing.
 *
 * A task committed to today is normally absent: it has a calendar event, so it
 * is already in the schedule above, and printing it again would make one
 * commitment appear twice under two headings. Normally — the caller decides,
 * because that reasoning holds only while there *is* a schedule to be in.
 */
function taskLines(
  tasks: BriefingTask[],
  /** Open tasks with no deadline and no day of work — a count, never lines. */
  someday: number,
  copy: NotificationCopy
): string {
  if (tasks.length === 0 && someday === 0) return '';

  const lines = tasks.slice(0, MAX_TASK_LINES).map((task) => {
    const when =
      task.daysLate > 0
        ? copy.tasks.late(task.daysLate)
        : task.committed
          ? copy.tasks.committedToday
          : task.due === 'today'
            ? copy.tasks.dueToday
            : task.due === 'tomorrow'
              ? copy.tasks.dueTomorrow
              : null;

    return `• ${truncate(task.title)}${when ? ` — ${when}` : ''}`;
  });

  const hidden = tasks.length - Math.min(tasks.length, MAX_TASK_LINES);
  if (hidden > 0) lines.push(copy.briefing.more(hidden));

  // A tail rather than lines of its own: nothing in it is due, so naming them
  // every morning would be a list that never changes and stops being read. The
  // number is there to say the pile exists and is growing.
  if (someday > 0) lines.push(copy.tasks.someday(someday));

  return `${copy.tasks.header}:\n${lines.join('\n')}`;
}

/**
 * Needs the extractor read out of notes that nobody has accepted or dismissed.
 *
 * A count and never the titles, deliberately. The number is a fact — that many
 * undecided readings exist, and `/tasks` will show exactly them — while *which*
 * of them is really a task is a model's guess, liberal by the same design that
 * puts a greeting in the entity graph. Everything else in this briefing is
 * assembled from facts, and printing "подати заяву до 17.08" beside
 * "хочу колись вивчити React" as though the two were alike would put a guess in
 * among them wearing the same clothes.
 *
 * Its own block rather than a tail of the task list, because it is not the task
 * list: these are notes, and the block still goes out on a morning when nothing
 * at all is due.
 */
function suggestionLine(count: number, copy: NotificationCopy): string {
  return count > 0 ? copy.tasks.fromNotes(count) : '';
}

function truncate(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > MAX_TITLE
    ? `${trimmed.slice(0, MAX_TITLE).trimEnd()}…`
    : trimmed;
}

/**
 * Build the morning briefing: today's schedule, the week's saved dates, and
 * what is outstanding. Nothing else, and nothing generated.
 *
 * There used to be a model-written sentence above the list, and it was narrowed
 * twice for inventing things. The first time it padded a one-event day with
 * atmosphere ("the day will be festive, which may get in the way of plans"), so
 * the prompt was told to state facts and never mood or consequence. The second
 * time it announced that "between the daily meeting and the maths class there
 * is only an hour" on a day where those two were six hours apart — the one-hour
 * gap in that day belonged to a different pair of events entirely.
 *
 * The second failure is why the sentence is gone rather than narrowed a third
 * time. The prompt asked the model to lead with "a clash, a tight gap, a long
 * unbroken stretch" while handing it nothing but a list of start times, so the
 * one thing it was commissioned to write was arithmetic over dates — precisely
 * what `weekdayOf`, `dateLines`, `taskLines` and `isSlotWithinHours` were each
 * fixed for by moving the calculation into the application. Here there was
 * nothing to move it to: a gap is only interesting if it is worth remarking on,
 * and nothing computes that. A ban on consequence also cannot survive a prompt
 * that names a tight schedule as the topic, because once that is the subject
 * the sentence has nowhere to end except a consequence.
 *
 * So the briefing is now assembled in full, costs no LLM call, and cannot say
 * anything untrue that the calendar did not already say.
 */
export async function generateBriefing(
  /**
   * The day's events, or `null` when the calendar could not be read at all.
   *
   * The distinction is the point: `[]` is a claim about the day, `null` is the
   * absence of one, and collapsing them is what let five days of unreadable
   * calendar go out as "nothing scheduled — your calendar is clear".
   */
  events: BriefingEvent[] | null,
  tz: string,
  locale?: string | null,
  /** Saved dates falling within the week. Empty on all but a few mornings a year. */
  dates: BriefingDate[] = [],
  /** Overdue tasks and deadlines landing today or tomorrow. */
  taskList: BriefingTask[] = [],
  /** Only consulted when `events` is null — why it is. */
  problem: CalendarProblem = 'unreadable',
  /** Two things worth a number and not a list. Absent means none. */
  counts: BriefingCounts = {},
  /** The calendar past today. Empty when it could not be read, like `events`. */
  ahead: BriefingAhead[] = []
): Promise<Briefing> {
  const copy = copyFor(locale);

  // The user's own birthday is said to them, not reported to them: "🎂 Яна —
  // сьогодні, виповнюється 34" is a reminder to congratulate somebody, and the
  // somebody is the reader. Only on the day — in the days before it stays an
  // ordinary line, since a greeting three days early is a miscount.
  const isOwnBirthday = (date: BriefingDate) => !!date.self && date.daysAway === 0;
  const greeting = dates.some(isOwnBirthday) ? copy.dates.happyBirthday : '';

  const datesBlock = dateLines(
    dates.filter((date) => !isOwnBirthday(date)),
    copy
  );
  const aheadBlock = aheadLines(ahead, copy);
  const tasksBlock = taskLines(taskList, counts.someday ?? 0, copy);
  const notesBlock = suggestionLine(counts.fromNotes ?? 0, copy);

  /** Blank-line-separated, skipping the blocks that had nothing to say. */
  const join = (...blocks: string[]) => blocks.filter(Boolean).join('\n\n');

  // Saved dates still go out: they come from the timeline, not from Google, and
  // a birthday is the one thing a broken calendar must not be allowed to eat.
  // Tasks go out under it for the same reason: they come from our own table,
  // not from Google, and a deadline that passed yesterday is precisely what a
  // broken calendar must not be allowed to swallow.
  if (events === null) {
    // The repairable failure says how to repair it and nothing else — printing
    // both lines would spend two sentences of a morning message on one fact.
    const why =
      problem === 'google-access'
        ? copy.briefing.googleAccessExpired
        : copy.briefing.calendarUnreadable;

    return {
      title: copy.briefing.morningTitle,
      body: join(greeting, why, datesBlock, tasksBlock, notesBlock),
      eventCount: 0,
    };
  }

  const eventCount = events.length;

  // An empty calendar is not an empty morning: a birthday tomorrow is the whole
  // reason to send anything at all on a day with nothing scheduled.
  if (eventCount === 0) {
    return {
      title: copy.briefing.morningTitle,
      body: join(greeting, copy.briefing.nothingScheduled, aheadBlock, datesBlock, tasksBlock, notesBlock),
      eventCount: 0,
    };
  }

  const schedule = join(
    greeting,
    scheduleLines(events, tz, copy),
    aheadBlock,
    datesBlock,
    tasksBlock,
    notesBlock
  );

  return { title: copy.briefing.thingsToday(eventCount), body: schedule, eventCount };
}

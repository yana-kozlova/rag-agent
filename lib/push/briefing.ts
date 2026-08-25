import { GoogleCalendarService } from '@/lib/services/calendar';
import { timelineKindIcon } from '@/lib/timeline/timeline';
import { copyFor, type NotificationCopy } from './copy';
import {
  type CalendarEvent,
  fetchEventsBetween,
  formatEventTime,
  localDayBounds,
} from './calendar-window';

export type BriefingEvent = CalendarEvent;

/** A saved date landing in the week ahead, as `upcomingTimeline` projects it. */
export type BriefingDate = {
  title: string;
  kind: string;
  daysAway: number;
  /** Years being completed. Null when the original year was never recorded. */
  years: number | null;
};

/** An outstanding task worth a line this morning, as `briefingTasks` groups them. */
export type BriefingTask = {
  id: string;
  title: string;
  /** Whole days past the deadline. Zero for one that has not passed. */
  daysLate: number;
  /** Whether the deadline is today or tomorrow, when it has not passed yet. */
  due: 'today' | 'tomorrow' | null;
};

export type Briefing = {
  title: string;
  body: string;
  eventCount: number;
};

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
 * A task already committed to today is deliberately absent. It has a calendar
 * event, so it is already in the schedule above, and printing it again would
 * make the same commitment appear twice under two different headings.
 */
function taskLines(tasks: BriefingTask[], copy: NotificationCopy): string {
  if (tasks.length === 0) return '';

  const lines = tasks.slice(0, MAX_TASK_LINES).map((task) => {
    const when =
      task.daysLate > 0
        ? copy.tasks.late(task.daysLate)
        : task.due === 'today'
          ? copy.tasks.dueToday
          : task.due === 'tomorrow'
            ? copy.tasks.dueTomorrow
            : null;

    return `• ${truncate(task.title)}${when ? ` — ${when}` : ''}`;
  });

  const hidden = tasks.length - Math.min(tasks.length, MAX_TASK_LINES);
  if (hidden > 0) lines.push(copy.briefing.more(hidden));

  return `${copy.tasks.header}:\n${lines.join('\n')}`;
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
  taskList: BriefingTask[] = []
): Promise<Briefing> {
  const copy = copyFor(locale);
  const datesBlock = dateLines(dates, copy);
  const tasksBlock = taskLines(taskList, copy);

  /** Blank-line-separated, skipping the blocks that had nothing to say. */
  const join = (...blocks: string[]) => blocks.filter(Boolean).join('\n\n');

  // Saved dates still go out: they come from the timeline, not from Google, and
  // a birthday is the one thing a broken calendar must not be allowed to eat.
  // Tasks go out under it for the same reason: they come from our own table,
  // not from Google, and a deadline that passed yesterday is precisely what a
  // broken calendar must not be allowed to swallow.
  if (events === null) {
    return {
      title: copy.briefing.morningTitle,
      body: join(copy.briefing.calendarUnreadable, datesBlock, tasksBlock),
      eventCount: 0,
    };
  }

  const eventCount = events.length;

  // An empty calendar is not an empty morning: a birthday tomorrow is the whole
  // reason to send anything at all on a day with nothing scheduled.
  if (eventCount === 0) {
    return {
      title: copy.briefing.morningTitle,
      body: join(copy.briefing.nothingScheduled, datesBlock, tasksBlock),
      eventCount: 0,
    };
  }

  const schedule = join(scheduleLines(events, tz, copy), datesBlock, tasksBlock);

  return { title: copy.briefing.thingsToday(eventCount), body: schedule, eventCount };
}

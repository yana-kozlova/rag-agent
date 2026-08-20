import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { env } from '@/lib/env.mjs';
import { logLlmUsage } from '@/lib/ai/telemetry';
import { GoogleCalendarService } from '@/lib/services/calendar';
import type { DayNote } from './day-notes';
import { timelineKindIcon } from '@/lib/timeline/timeline';
import { copyFor, type NotificationCopy } from './copy';
import { getLocalDateKey } from './timezone';
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
 * Ceiling on the model's lead paragraph.
 *
 * It used to be 180 characters for the whole notification, because a browser
 * notification shows two lines and truncates the rest. Telegram shows 4096, so
 * the constraint is now editorial rather than technical: long enough to name a
 * clash and work in a detail from a note, short enough that the schedule below
 * is still the first thing the eye lands on.
 *
 * A ceiling is not a target, and 400 was being read as one. A day with a single
 * all-day entry has one sentence in it; asked for a paragraph anyway, the model
 * padded to length with atmosphere — the day "will be festive", which "may get
 * in the way of plans". The prompt below now sets the length from the day and
 * this stays as what it always was, a guard against a runaway generation.
 */
const MAX_HEADLINE = 300;

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
 * The schedule itself — built here, never asked of the model.
 *
 * A model that is handed times and asked to repeat them will eventually repeat
 * one wrong, and a briefing that misstates when a meeting starts is worse than
 * no briefing. So the model writes the sentence about the day and this writes
 * the day.
 *
 * A briefing that always arrives matters more than a clever one, so this is
 * also what goes out on its own when there is no model to call.
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
 * The model's sentence, or nothing.
 *
 * It is told that a day with nothing to add gets no sentence, and a model asked
 * for an empty string rarely sends one — it sends a dash, a full stop, "N/A",
 * "(none)". Printed above the schedule each of those is a line of noise that
 * looks like a bug, so a reply carrying no letters is read as the silence it
 * was meant to be. Bracketed and quoted forms go the same way: "(none)" is not
 * a sentence about anyone's morning.
 */
export function cleanHeadline(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^["'“”«»(\[]+|["'“”«»)\]]+$/g, '')
    .trim();

  if (!/\p{L}/u.test(trimmed)) return '';
  if (/^(n\/?a|none|nothing|empty|null)\.?$/i.test(trimmed)) return '';

  return trimmed.slice(0, MAX_HEADLINE);
}

/**
 * Build the morning briefing: today's schedule, plus anything from the user's
 * saved notes that relates to it, condensed into notification-sized copy.
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
  /**
   * Notes already retrieved for this day. Passed in rather than fetched here so
   * the morning pass performs one retrieval total — see `fetchDayNotes`.
   */
  dayNotes: DayNote[] = [],
  locale?: string | null,
  /** Saved dates falling within the week. Empty on all but a few mornings a year. */
  dates: BriefingDate[] = [],
  /** Overdue tasks and deadlines landing today or tomorrow. */
  taskList: BriefingTask[] = [],
  /**
   * The instant the briefing is being built for. Only the model path uses it,
   * to date the day and the notes against each other — see `notes` below.
   */
  now: Date = new Date()
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

  const scheduleText = events
    .map(
      (e) =>
        `- ${formatEventTime(e, tz, copy.briefing.allDay)} ${e.title}${e.location ? ` (${e.location})` : ''}`
    )
    .join('\n');

  const today = getLocalDateKey(now, tz);

  // Every note carries the day it was written, and the prompt says what day it
  // is now — the two are only useful together. Undated, a note from Tuesday
  // reads as this morning, and the model repeated one back in the present
  // tense: the user's mood three days ago, reported as how they had woken up.
  // `fetchDayNotes` drops check-ins outright, so this guards the general case —
  // any note about a past day arriving as background for today.
  const notes = dayNotes
    .slice(0, 4)
    .map((n) => `- ${n.writtenOn ? `[written ${n.writtenOn}] ` : ''}${n.text.slice(0, 300)}`)
    .join('\n');

  if (!env.OPENAI_API_KEY) {
    return { title: copy.briefing.thingsToday(eventCount), body: schedule, eventCount };
  }

  const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
  const startedAt = Date.now();

  try {
    const { text, usage } = await generateText({
      model: openai(modelName),
      system: [
        'You write the opening line of a morning briefing.',
        'The schedule, the dates and the outstanding tasks are all listed underneath your text by the application, so never list, enumerate or restate them — one all-day event needs no summary, because the line below already says it.',
        // The old prompt asked for "two or three sentences" and named four
        // things to lead with, all of which presuppose a busy day. On a day
        // holding one entry the model had to invent a clash to have something
        // to lead with. Length is now a property of the day.
        'Say only what the list below does not: a clash, a tight gap between two places, a long unbroken stretch, an early start. One short sentence is the normal length. If the day holds nothing of that kind, say nothing at all and return an empty string — a briefing that is only the schedule is a good briefing.',
        `Never exceed ${MAX_HEADLINE} characters or three sentences. No greeting, no emoji, no markdown, no preamble, no sign-off.`,
        'Mention times as HH:mm, and only when the point needs one.',
        // What actually went wrong was not a fabricated event but fabricated
        // characterisation, which "never invent events" did not cover.
        'State facts, never mood, atmosphere or consequence. Do not predict how the day will feel or go, do not say an event will affect anything, and do not offer encouragement or advice.',
        'Saved notes are background, most of it about other days. Work in a detail only when it is concrete and bears on something scheduled today. Never repeat back how the user has been feeling.',
        copy.writeIn,
      ].join(' '),
      prompt: [
        `Today is ${today} (timezone ${tz}).`,
        "Today's schedule:",
        scheduleText,
        // Given as context, listed by the application: the same division as the
        // schedule. The sentence may lead with a birthday; the dates under it
        // are not the model's to restate.
        dates.length > 0
          ? `\nSaved dates this week:\n${dates
              .map((d) => `- ${d.title} (${d.daysAway === 0 ? 'today' : `in ${d.daysAway} days`})`)
              .join('\n')}`
          : '',
        // Context, listed by the application: the same division as the schedule.
        // The sentence may lead with a clash between a deadline and a full day;
        // the lines under it are not the model's to repeat.
        taskList.length > 0
          ? `\nOutstanding tasks:\n${taskList
              .map(
                (t) =>
                  `- ${t.title} (${t.daysLate > 0 ? `${t.daysLate} days late` : `due ${t.due ?? 'soon'}`})`
              )
              .join('\n')}`
          : '',
        notes
          ? `\nBackground from saved notes — written on the days shown, not necessarily about today:\n${notes}`
          : '',
      ].join('\n'),
    });

    logLlmUsage({
      op: 'generateText',
      model: modelName,
      caller: 'push/briefing',
      usage: usage
        ? {
            inputTokens: (usage as any).inputTokens ?? (usage as any).promptTokens,
            outputTokens: (usage as any).outputTokens ?? (usage as any).completionTokens,
            totalTokens: usage.totalTokens,
          }
        : undefined,
      durationMs: Date.now() - startedAt,
      note: `events=${eventCount}`,
    });

    const headline = cleanHeadline(text);

    return {
      title: copy.briefing.thingsToday(eventCount),
      // The schedule is the briefing; the headline is what to make of it. A
      // failed generation costs the sentence, never the list.
      body: headline ? `${headline}\n\n${schedule}` : schedule,
      eventCount,
    };
  } catch (error) {
    console.error('[push/briefing] Generation failed, using plain briefing:', error);
    return { title: copy.briefing.thingsToday(eventCount), body: schedule, eventCount };
  }
}

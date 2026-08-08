import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { env } from '@/lib/env.mjs';
import { logLlmUsage } from '@/lib/ai/telemetry';
import { GoogleCalendarService } from '@/lib/services/calendar';
import type { DayNote } from './day-notes';
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
 */
const MAX_HEADLINE = 400;

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

function truncate(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > MAX_TITLE
    ? `${trimmed.slice(0, MAX_TITLE).trimEnd()}…`
    : trimmed;
}

/**
 * Build the morning briefing: today's schedule, plus anything from the user's
 * saved notes that relates to it, condensed into notification-sized copy.
 */
export async function generateBriefing(
  events: BriefingEvent[],
  tz: string,
  /**
   * Notes already retrieved for this day. Passed in rather than fetched here so
   * the morning pass performs one retrieval total — see `fetchDayNotes`.
   */
  dayNotes: DayNote[] = [],
  locale?: string | null,
  /** Saved dates falling within the week. Empty on all but a few mornings a year. */
  dates: BriefingDate[] = []
): Promise<Briefing> {
  const copy = copyFor(locale);
  const eventCount = events.length;
  const datesBlock = dateLines(dates, copy);

  // An empty calendar is not an empty morning: a birthday tomorrow is the whole
  // reason to send anything at all on a day with nothing scheduled.
  if (eventCount === 0) {
    return {
      title: copy.briefing.morningTitle,
      body: datesBlock
        ? `${copy.briefing.nothingScheduled}\n\n${datesBlock}`
        : copy.briefing.nothingScheduled,
      eventCount: 0,
    };
  }

  const schedule = datesBlock
    ? `${scheduleLines(events, tz, copy)}\n\n${datesBlock}`
    : scheduleLines(events, tz, copy);

  const scheduleText = events
    .map(
      (e) =>
        `- ${formatEventTime(e, tz, copy.briefing.allDay)} ${e.title}${e.location ? ` (${e.location})` : ''}`
    )
    .join('\n');

  const notes = dayNotes
    .slice(0, 4)
    .map((n) => `- ${n.text.slice(0, 300)}`)
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
        'You write the opening paragraph of a morning briefing.',
        'The schedule is listed underneath your text by the application, so never list or enumerate the events yourself — say what the shape of the day is.',
        `Hard limit: ${MAX_HEADLINE} characters. Two or three sentences at most. No greeting, no emoji, no markdown, no preamble.`,
        'Lead with what matters most: a clash, a tight gap, a long unbroken stretch, or the one commitment the day turns on.',
        'Mention times as HH:mm, and only when the point needs one. If saved notes are relevant to a meeting, work in one concrete detail.',
        'Write plainly, like a competent assistant. Never invent events or details.',
        copy.writeIn,
      ].join(' '),
      prompt: [
        `Today's schedule (timezone ${tz}):`,
        scheduleText,
        // Given as context, listed by the application: the same division as the
        // schedule. The sentence may lead with a birthday; the dates under it
        // are not the model's to restate.
        dates.length > 0
          ? `\nSaved dates this week:\n${dates
              .map((d) => `- ${d.title} (${d.daysAway === 0 ? 'today' : `in ${d.daysAway} days`})`)
              .join('\n')}`
          : '',
        notes ? `\nSaved notes that may be relevant:\n${notes}` : '',
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

    const headline = text.trim().slice(0, MAX_HEADLINE);

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

import { z } from 'zod';
import { getSessionOrThrow } from '@/lib/utils/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { extractMeetingLink } from '@/lib/utils/meeting-link';
import type { ToolCalendarEvent } from '@/types/calendar';
import { isTimeBlock, isDeclined } from '@/lib/utils/calendars';
import { getCalendarIdsForUser } from '@/lib/utils/calendar-conflicts';
import { eventsToModelOutput, type GetEventsOutput } from './get-events-format';

export type { GetEventsOutput };

/**
 * Google would not answer for any of the user's calendars.
 *
 * Distinct from the generic tool failure so the model can say "I could not read
 * your calendar" rather than reporting nothing, which is the whole point: to
 * everything downstream "Google refused" and "your day is free" look identical
 * and mean opposite things.
 */
export class CalendarUnreadableError extends Error {}

/**
 * Compute UTC offset for a timezone at a given moment (handles DST).
 * Returns e.g. "+03:00", "-05:00".
 */
function getUtcOffset(date: Date, tz: string): string {
  const diffMs =
    new Date(date.toLocaleString('en-US', { timeZone: tz })).getTime() -
    new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const totalMin = Math.round(diffMs / 60000);
  const sign = totalMin >= 0 ? '+' : '-';
  const abs = Math.abs(totalMin);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** RFC 3339 timestamp for a date + time in the user's timezone. */
function dateToRfc3339(dateStr: string, time: string, tz: string): string {
  const ts = `${dateStr}T${time}`;
  return `${ts}${getUtcOffset(new Date(ts), tz)}`;
}

/** Today's YYYY-MM-DD in the given timezone. */
function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Build timeMin / timeMax for the preset ranges.
 * "day" uses calendar-day boundaries in the user's timezone.
 */
function getTimeRange(range: 'day' | 'week' | 'month' | 'upcoming', userTz?: string) {
  const now = new Date();

  if (range === 'day' && userTz) {
    const today = todayInTz(userTz);
    return {
      timeMin: dateToRfc3339(today, '00:00:00', userTz),
      timeMax: dateToRfc3339(today, '23:59:59', userTz),
    };
  }

  // Forward-looking ranges — UTC is fine
  const end = new Date(now);
  if (range === 'day')   end.setDate(now.getDate() + 1);
  if (range === 'week')  end.setDate(now.getDate() + 7);
  if (range === 'month') end.setMonth(now.getMonth() + 1);
  if (range === 'upcoming') end.setMonth(now.getMonth() + 3);

  return { timeMin: now.toISOString(), timeMax: end.toISOString() };
}

export const getEventsTool = {
  description: `Fetch Google Calendar events across primary and all followed calendars.
Use "range" for common presets OR "date" for a specific day.
  - "today" → range: "day"
  - "tomorrow" → date: tomorrow's YYYY-MM-DD
  - "this week" → range: "week"`,
  inputSchema: z.object({
    range: z.enum(['day', 'week', 'month', 'upcoming']).optional()
      .describe('Preset time range. "day" = today only.'),
    date: z.string().optional()
      .describe('Specific date (YYYY-MM-DD). Use for "tomorrow", "next Monday", etc.'),
  }),
  execute: async (input: { range?: 'day' | 'week' | 'month' | 'upcoming'; date?: string }) => {
    try {
      const session = await getSessionOrThrow();
      const calendarService = new GoogleCalendarService(
        session.user.accessToken as string,
        session.user.id as string,
      );

      // Fetch user timezone when we need exact day boundaries
      const needsTz = !!(input?.date) || input?.range === 'day';
      const userTz = needsTz ? await calendarService.getTimeZone() : undefined;

      let timeMin: string;
      let timeMax: string;

      if (input?.date) {
        const tz = userTz!;
        timeMin = dateToRfc3339(input.date, '00:00:00', tz);
        timeMax = dateToRfc3339(input.date, '23:59:59', tz);
      } else {
        const result = getTimeRange(input?.range ?? 'upcoming', userTz);
        timeMin = result.timeMin;
        timeMax = result.timeMax;
      }

      // The shared list rather than a hand-built one: it puts `primary` first,
      // drops a followed calendar that is the user's own address (Google answers
      // for it twice, once under each name) and de-duplicates the ids.
      const calendarIds = await getCalendarIdsForUser(session.user.id as string);

      const results = await Promise.allSettled(
        calendarIds.map((cid) =>
          calendarService.fetchEvents(cid, {
            timeMin, timeMax, maxResults: 50, singleEvents: true, orderBy: 'startTime',
          })
        )
      );

      // A calendar Google refused to answer for used to contribute nothing and
      // say so nowhere — no log, and no error even when every calendar failed,
      // so a dead refresh token reached the user as "you have nothing on". The
      // same fix `fetchEventsBetween` already carries: log each failure, and
      // throw only when there is no answer at all. One unreadable shared
      // calendar costs that calendar, not the question.
      const failed = results.flatMap((res, i) =>
        res.status === 'rejected' ? [{ calendarId: calendarIds[i]!, reason: res.reason }] : []
      );

      for (const f of failed) {
        console.error(`[getEvents] Could not read calendar ${f.calendarId}:`, f.reason);
      }

      if (failed.length > 0 && failed.length === results.length) {
        throw new CalendarUnreadableError(
          `Could not read any of the user's ${results.length} calendar(s): ${
            (failed[0].reason as any)?.message ?? failed[0].reason
          }`
        );
      }

      // Tag each merged event with the calendar it came from (results align
      // positionally with calendarIds), so the card can label followed calendars.
      const merged = results.flatMap((r: any, i: number) =>
        r.status === 'fulfilled'
          ? (r.value.items ?? []).map((item: any) => ({ item, calendarId: calendarIds[i]! }))
          : []
      );

      // One event shared between two followed calendars came back twice and was
      // listed twice. `calendarIds` leads with `primary`, so the surviving copy
      // is the user's own — the only one carrying their `responseStatus`, which
      // is what makes the next step correct.
      const seen = new Map<string, { item: any; calendarId: string }>();
      for (const entry of merged) {
        const id = entry.item?.id as string | undefined;
        if (id && !seen.has(id)) seen.set(id, entry);
      }

      // Declined after the de-duplication, never before: filtering per calendar
      // would drop the user's own copy — the one that knows they said no — and
      // let a shared calendar's status-free copy survive as the winner.
      const events: ToolCalendarEvent[] = [...seen.values()]
        .filter(({ item }) => !isDeclined(item))
        .map(({ item, calendarId }) => {
          const start = (item.start?.dateTime ?? item.start?.date) as string | undefined;
          const end = (item.end?.dateTime ?? item.end?.date) as string | undefined;
          const allDay = !!item.start?.date && !item.start?.dateTime;
          return {
            id: (item.id as string) ?? '',
            calendarId,
            title: item.summary || 'No Title',
            start,
            end,
            allDay,
            // Kept raw so the model line is unchanged; the card decides how to
            // show a URL vs a physical place.
            location: item.location || undefined,
            meetingLink: extractMeetingLink(item),
            description: item.description || undefined,
            htmlLink: item.htmlLink || undefined,
            timeBlock: isTimeBlock(item) || undefined,
          };
        });

      // Stable chronological order for display.
      events.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));

      return { events, count: events.length };
    } catch (error) {
      console.error('Error in getEventsTool:', error);
      // "Google would not answer" survives as itself. Collapsing it into the
      // generic message is how an unreadable calendar became indistinguishable
      // from an empty one in the first place.
      if (error instanceof CalendarUnreadableError) throw error;
      throw new Error('Failed to fetch or process calendar events');
    }
  },
  // The model keeps receiving the legacy JSON array of text lines; the rich
  // `events` payload above is for the UI only.
  toModelOutput: (output: GetEventsOutput) => eventsToModelOutput(output),
} as const;

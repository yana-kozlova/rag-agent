import { z } from 'zod';
import { getSessionOrThrow } from '@/lib/utils/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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

      const rows = await db.select().from(users).where(eq(users.id, session.user.id as string)).limit(1);
      const followed = Array.isArray(rows[0]?.followedCalendars) ? rows[0]!.followedCalendars as any[] : [];
      const calendarIds = ['primary', ...followed.map((c) => c.calendarId).filter(Boolean)];

      const results = await Promise.allSettled(
        calendarIds.map((cid) =>
          calendarService.fetchEvents(cid, {
            timeMin, timeMax, maxResults: 50, singleEvents: true, orderBy: 'startTime',
          })
        )
      );
      const merged = results.flatMap((r: any) =>
        r.status === 'fulfilled' ? r.value.items ?? [] : []
      );

      if (!merged.length) return [];

      return merged.map((event) => {
        const start = (event.start?.dateTime ?? event.start?.date) as string | undefined;
        const end = (event.end?.dateTime ?? event.end?.date) as string | undefined;
        const title = event.summary || 'No Title';
        return [
          `[Event] ${title}`,
          start && end ? `When: ${start} - ${end}` : undefined,
          event.location ? `Location: ${event.location}` : undefined,
          event.description ? `Description: ${event.description}` : undefined,
        ].filter(Boolean).join('. ');
      });
    } catch (error) {
      console.error('Error in getEventsTool:', error);
      throw new Error('Failed to fetch or process calendar events');
    }
  },
} as const;

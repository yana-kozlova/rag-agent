import { z } from 'zod';
import { getSessionOrThrow } from './utils';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Helper to get time range based on range type
const getTimeRange = (rangeType: 'day' | 'week' | 'month' | 'upcoming') => {
  const now = new Date();
  const timeMin = now.toISOString();
  let timeMax: string;

  switch (rangeType) {
    case 'day': {
      const end = new Date(now);
      end.setDate(now.getDate() + 1);
      timeMax = end.toISOString();
      break;
    }
    case 'week': {
      const end = new Date(now);
      end.setDate(now.getDate() + 7);
      timeMax = end.toISOString();
      break;
    }
    case 'month': {
      const end = new Date(now);
      end.setMonth(now.getMonth() + 1);
      timeMax = end.toISOString();
      break;
    }
    case 'upcoming': {
      const end = new Date(now);
      end.setMonth(now.getMonth() + 3); // Show events for next 3 months
      timeMax = end.toISOString();
      break;
    }
  }

  return { timeMin, timeMax };
};

export const getEventsTool = {
  description: `Fetch Google Calendar events across primary and all followed calendars for a specific time range (day, week, month, or upcoming).`,
  inputSchema: z.object({
    range: z.enum(['day', 'week', 'month', 'upcoming']).describe('Time range for events').default('upcoming'),
  }),
  execute: async (input: { range?: 'day' | 'week' | 'month' | 'upcoming' }) => {
    try {
      const session = await getSessionOrThrow();

      const calendarService = new GoogleCalendarService(session.user.accessToken as string, session.user.id as string);
      const range = input?.range ?? 'upcoming';

      // Get time range based on input
      const { timeMin, timeMax } = getTimeRange(range);

      const rows = await db.select().from(users).where(eq(users.id, session.user.id as string)).limit(1);
      const followed = Array.isArray(rows[0]?.followedCalendars) ? rows[0]!.followedCalendars as any[] : [];
      const calendarIds = ['primary', ...followed.map((c) => c.calendarId).filter(Boolean)];

      const results = await Promise.allSettled(
        calendarIds.map((cid) => calendarService.fetchEvents(cid, { timeMin, timeMax, maxResults: 50, singleEvents: true, orderBy: 'startTime' }))
      );
      const merged = results.flatMap((res: any) => (res.status === 'fulfilled' ? res.value.items ?? [] : []));

      if (!merged?.length) return [];

      return merged.map((event) => {
        const start = (event.start?.dateTime ?? event.start?.date) as string | undefined;
        const end = (event.end?.dateTime ?? event.end?.date) as string | undefined;
        const title = event.summary || 'No Title';
        const location = event.location;
        const description = event.description;
        const parts = [
          `[Event] ${title}`,
          start && end ? `When: ${start} - ${end}` : undefined,
          location ? `Location: ${location}` : undefined,
          description ? `Description: ${description}` : undefined,
        ].filter(Boolean);
        return parts.join('. ');
      });
    } catch (error) {
      console.error('Error in getEventsTool:', error);
      throw new Error('Failed to fetch or process calendar events');
    }
  },
} as const;
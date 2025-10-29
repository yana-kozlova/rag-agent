import { z } from 'zod';
import { auth } from '../auth/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';

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
  description: `Fetch Google Calendar events for a specific time range (day, week, month, or upcoming).`,
  inputSchema: z.object({
    calendarId: z.string().describe('Google Calendar ID (defaults to primary)').optional(),
    range: z.enum(['day', 'week', 'month', 'upcoming']).describe('Time range for events').default('upcoming'),
  }),
  execute: async (input: { calendarId?: string; range?: 'day' | 'week' | 'month' | 'upcoming' }) => {
    try {
      const session = await auth();
      if (!session?.user?.id || !session.user.accessToken) {
        throw new Error('Unauthorized: Missing user ID or access token');
      }

      const calendarService = new GoogleCalendarService(session.user.accessToken, session.user.id);
      const calendarId = input?.calendarId ?? 'primary';
      const range = input?.range ?? 'upcoming';

      // Get time range based on input
      const { timeMin, timeMax } = getTimeRange(range);

      // Fetch events for the specified time range
      const { items: events } = await calendarService.fetchEvents(calendarId, {
        timeMin,
        timeMax,
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime'
      });

      if (!events?.length) {
        return [];
      }

      // Format and return events
      return events.map((event) => {
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
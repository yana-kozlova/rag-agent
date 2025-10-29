import { z } from 'zod';
import { getSessionOrThrow, parseInputOrThrow } from './utils';
import { GoogleCalendarService } from '@/lib/services/calendar';

export const createEventTool = {
  description: `Create a new Google Calendar event with title, start, end, and optional details (location, description, attendees). Times should be ISO-8601 (preserve timezone, e.g. 2025-10-29T14:00:00+02:00).`,
  inputSchema: z.object({
    calendarId: z.string().describe('Google Calendar ID (defaults to primary)').optional(),
    title: z.string().min(1, 'Title is required'),
    start: z.string().min(1, 'Start datetime is required').describe('ISO-8601, e.g. 2025-10-29T14:00:00+02:00'),
    end: z.string().min(1, 'End datetime is required').describe('ISO-8601, e.g. 2025-10-29T15:00:00+02:00'),
    location: z.string().optional(),
    description: z.string().optional(),
    attendees: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
  }),
  execute: async (input: {
    calendarId?: string;
    title: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
    attendees?: Array<{ email: string; name?: string }>;
  }) => {
    // validate input and auth
    input = parseInputOrThrow(createEventTool.inputSchema, input);
    const session = await getSessionOrThrow();

    const calendarService = new GoogleCalendarService(session.user.accessToken as string, session.user.id as string);
    const calendarId = input.calendarId ?? 'primary';

    const created = await calendarService.createEvent(calendarId, {
      title: input.title,
      start: input.start,
      end: input.end,
      location: input.location,
      description: input.description,
      attendees: input.attendees,
    });

    // Compact summary for chat display
    const startStr = input.start;
    const endStr = input.end;
    const parts = [
      `[Created] ${input.title}`,
      `When: ${startStr} - ${endStr}`,
      input.location ? `Location: ${input.location}` : undefined,
    ].filter(Boolean);

    return {
      id: created.id,
      htmlLink: created.htmlLink,
      summary: parts.join('. '),
    };
  },
} as const;



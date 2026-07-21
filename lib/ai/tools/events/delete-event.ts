import { z } from 'zod';
import { getSessionOrThrow, parseInputOrThrow } from '@/lib/utils/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';

export const deleteEventTool = {
  description: `Delete a calendar event by eventId. Only for explicit delete requests. To reschedule, use scheduleEvent instead.`,
  inputSchema: z.object({
    calendarId: z.string().optional().describe('Google Calendar ID (defaults to primary)'),
    eventId: z.string().min(1, 'eventId is required').describe('Google Calendar eventId to delete'),
  }),
  execute: async (rawInput: { calendarId?: string; eventId: string }) => {
    const input = parseInputOrThrow(deleteEventTool.inputSchema, rawInput);
    const session = await getSessionOrThrow();
    const calendarService = new GoogleCalendarService(
      session.user.accessToken as string,
      session.user.id as string
    );

    const calendarId = input.calendarId ?? 'primary';
    await calendarService.deleteEvent(calendarId, input.eventId);

    return {
      success: true,
      deleted: { calendarId, eventId: input.eventId },
    };
  },
} as const;



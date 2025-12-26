import { z } from 'zod';
import { getSessionOrThrow, parseInputOrThrow } from '@/lib/utils/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';

export const deleteEventTool = {
  description: `Delete an event from Google Calendar by eventId.

🚨 CRITICAL RULES:
- ONLY use this tool when the user explicitly asks to DELETE/REMOVE/CANCEL an event permanently.
- NEVER delete an event before creating/moving a new one - this causes data loss if creation fails!
- If user wants to move/reschedule an event, ALWAYS use scheduleEvent tool (with moveIfExists=true) instead.
- If you delete an event and then fail to create a new one, the event is lost forever!`,
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



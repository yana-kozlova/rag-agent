import { z } from 'zod';
import { getSessionOrThrow, parseInputOrThrow } from '@/lib/utils/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { conflictsAndAlternatives, formatWhen } from '@/lib/utils/calendar-conflicts';

function normalizeTitle(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function addHours(d: Date, hours: number) {
  return new Date(d.getTime() + hours * 60 * 60_000);
}

/** How far either side of the wanted time to look for the event being moved. */
const MOVE_SEARCH_HOURS = 72;

/** Said to the model rather than left to be guessed, which is how `ignoreConflicts` came to be ignored. */
const ALSO_DURING_NOTE =
  'The "alsoDuring" list, when present, is what is happening at that time without occupying it (an all-day event, a block marked Free, a declined invitation). Mention it once as context — never as a reason to refuse or to re-ask.';

export const scheduleEventTool = {
  description: `Create or reschedule a calendar event. Patches existing event if same day+title match found. A busy time is reported back and nothing is written; call again with ignoreConflicts=true once the user has said to book it anyway. Times must use offset (e.g. +03:00), never "Z".`,
  inputSchema: z.object({
    calendarId: z.string().optional().describe('Google Calendar ID (defaults to primary)'),
    title: z.string().min(1, 'Title is required'),
    location: z.string().optional().describe('Where it happens — address or place name, if the user gave one'),
    start: z.string().min(1).refine(
      (val) => {
        const match = val.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2})$/);
        if (!match || val.endsWith('Z')) return false;
        // Reject +00:00 (UTC) - use explicit timezone offset instead
        return match[1] !== '+00:00';
      },
      { message: 'ISO-8601 datetime must include explicit timezone offset (e.g. +02:00, -05:00). Do NOT use +00:00 (UTC) or Z suffix.' }
    ).describe('ISO-8601 datetime with timezone offset (e.g. 2025-12-26T19:00:00+02:00). Do NOT use +00:00 or Z.'),
    end: z.string().min(1).refine(
      (val) => {
        const match = val.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2})$/);
        if (!match || val.endsWith('Z')) return false;
        // Reject +00:00 (UTC) - use explicit timezone offset instead
        return match[1] !== '+00:00';
      },
      { message: 'ISO-8601 datetime must include explicit timezone offset (e.g. +02:00, -05:00). Do NOT use +00:00 (UTC) or Z suffix.' }
    ).describe('ISO-8601 datetime with timezone offset (e.g. 2025-12-26T20:00:00+02:00). Do NOT use +00:00 or Z.'),
    includeFollowedCalendars: z.boolean().default(true).describe('Conflict check includes followed calendars too'),
    ignoreConflicts: z.boolean().default(false).describe('Set true when the user has been told the time is busy and wants it booked anyway, or when they repeat a time you already questioned. The event is written and the conflicts are still reported back.'),
    moveIfExists: z.boolean().default(true).describe('If true, will move an existing matching event instead of creating a duplicate'),
    matchQuery: z.string().optional().describe('Optional search query for matching existing events (defaults to title)'),
    dryRun: z.boolean().default(false).describe('If true, do not change calendar; only report what would happen'),
  }),
  execute: async (rawInput: {
    calendarId?: string;
    title: string;
    location?: string;
    start: string;
    end: string;
    includeFollowedCalendars?: boolean;
    ignoreConflicts?: boolean;
    moveIfExists?: boolean;
    matchQuery?: string;
    dryRun?: boolean;
  }) => {
    const input = parseInputOrThrow(scheduleEventTool.inputSchema, rawInput);
    const session = await getSessionOrThrow();
    const calendarService = new GoogleCalendarService(
      session.user.accessToken as string,
      session.user.id as string
    );

    const calendarId = input.calendarId ?? 'primary';
    
    const desiredStart = new Date(input.start);
    const desiredEnd = new Date(input.end);
    if (isNaN(desiredStart.getTime()) || isNaN(desiredEnd.getTime()) || desiredStart >= desiredEnd) {
      throw new Error('Invalid start/end time');
    }

    // If we are allowed to move existing events, try to find a matching event on the same day.
    let match: { eventId: string; currentStart?: string; currentEnd?: string; title: string } | null = null;
    if (input.moveIfExists !== false) {
      // Three days either side, not one: the event being moved is by definition
      // not where it is wanted, and a day's reach missed "no, today" about an
      // appointment sitting on Tuesday, writing a second copy. Not a week — a
      // weekly series puts one instance inside three days and two inside seven,
      // and a second candidate makes this refuse to move at all.
      const timeMin = addHours(desiredStart, -MOVE_SEARCH_HOURS).toISOString();
      const timeMax = addHours(desiredStart, MOVE_SEARCH_HOURS).toISOString();
      const q = input.matchQuery ?? input.title;
      const res = await calendarService.fetchEvents(calendarId, {
        timeMin,
        timeMax,
        q,
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const targetTitle = normalizeTitle(input.title);
      const candidates = (res.items ?? [])
        .filter((e) => e.status !== 'cancelled' && e.id)
        .map((e) => {
          const start = (e.start?.dateTime ?? e.start?.date) as string | undefined;
          const end = (e.end?.dateTime ?? e.end?.date) as string | undefined;
          return {
            eventId: e.id as string,
            title: e.summary || 'No Title',
            currentStart: start,
            currentEnd: end,
          };
        })
        .filter((c) => normalizeTitle(c.title).includes(targetTitle) || targetTitle.includes(normalizeTitle(c.title)));

      if (candidates.length === 1) {
        match = candidates[0]!;
      } else if (candidates.length > 1) {
        return {
          success: false,
          message: 'Multiple existing events match; refusing to move automatically.',
          candidates,
        };
      }
    }

    // Conflict check (exclude the matched event if we are moving it).
    const { conflicts, alternatives, alsoDuring } = await conflictsAndAlternatives({
      calendarService,
      userId: session.user.id as string,
      start: input.start,
      end: input.end,
      includeFollowedCalendars: input.includeFollowedCalendars !== false,
      exclude: match ? { calendarId, eventId: match.eventId } : undefined,
    });

    // Only block if conflicts exist AND ignoreConflicts is false
    if (conflicts.length > 0 && !input.ignoreConflicts) {
      return {
        success: false,
        message:
          'The requested time is busy, so nothing was written yet. Tell the user what it clashes with and ask whether to book it anyway or take one of the alternatives — if they confirm the original time, or simply repeat it, call this tool again with the same times and ignoreConflicts=true. Do not keep offering alternatives to someone who has already answered. ' +
          ALSO_DURING_NOTE,
        action: match ? 'would-move' : 'would-create',
        conflicts,
        alternatives,
        ...(alsoDuring.length > 0 && { alsoDuring }),
      };
    }

    if (input.dryRun) {
      return {
        success: true,
        dryRun: true,
        action: match ? 'would-move' : 'would-create',
        moveTarget: match ?? undefined,
        desired: { title: input.title, start: input.start, end: input.end, calendarId, location: input.location },
      };
    }

    if (match) {
      await calendarService.patchEvent(calendarId, match.eventId, {
        start: input.start,
        end: input.end,
        title: input.title,
        // Undefined leaves the stored value alone; a move never erases an address.
        location: input.location,
      });
      const { label } = formatWhen({ start: input.start, end: input.end });
      return {
        success: true,
        action: 'moved-existing',
        eventId: match.eventId,
        summary: `[Moved] ${input.title}. When: ${label}`,
        ...(alsoDuring.length > 0 && { alsoDuring, note: ALSO_DURING_NOTE }),
        ...(conflicts.length > 0 && {
          warning: 'Event moved despite conflicts',
          conflicts,
          alternatives,
        }),
      };
    }

    const created = await calendarService.createEvent(calendarId, {
      title: input.title,
      location: input.location,
      start: input.start,
      end: input.end,
    });

    const { label } = formatWhen({ start: input.start, end: input.end });
    return {
      success: true,
      action: 'created-new',
      eventId: created.id,
      htmlLink: created.htmlLink,
      summary: `[Created] ${input.title}. When: ${label}`,
      ...(input.location && { location: input.location }),
      ...(alsoDuring.length > 0 && { alsoDuring, note: ALSO_DURING_NOTE }),
      ...(conflicts.length > 0 && {
        warning: 'Event created despite conflicts',
        conflicts,
        alternatives,
      }),
    };
  },
} as const;



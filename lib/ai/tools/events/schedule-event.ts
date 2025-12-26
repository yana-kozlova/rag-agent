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

export const scheduleEventTool = {
  description: `Universal event scheduling tool: creates new events or moves existing ones. This is the ONLY tool for creating calendar events.

How it works:
- If a matching event already exists (same day, similar title), it will move it (patch time) - safe, no deletion.
- Otherwise it will create a new event.
- If conflicts exist, it will not change the calendar and will return alternative time options.

✅ USE THIS TOOL for ALL event creation and rescheduling - it safely patches existing events without deleting them. This is the SAFE way - no data loss risk.

TIMEZONE HANDLING:
- ALWAYS provide explicit timezone offset in start/end times (e.g. +02:00, -05:00).
- NEVER use "Z" (UTC) suffix or "+00:00" - both cause time shifts.
- Format: YYYY-MM-DDTHH:mm:ss±HH:mm (e.g. 2025-12-26T19:00:00+02:00).
- Use the user's local timezone offset (e.g. +02:00 for Kyiv, -05:00 for US Eastern).

CONFLICT HANDLING:
- By default, checks for conflicts and blocks creation/movement if conflicts are found.
- Set ignoreConflicts=true to create/move the event even if conflicts exist (conflicts will still be reported in the response).

IMPORTANT:
- DO NOT delete existing events automatically - only move them if moveIfExists=true.`,
  inputSchema: z.object({
    calendarId: z.string().optional().describe('Google Calendar ID (defaults to primary)'),
    title: z.string().min(1, 'Title is required'),
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
    ignoreConflicts: z.boolean().default(false).describe('If true, creates/moves event even if conflicts are detected (conflicts will still be reported)'),
    moveIfExists: z.boolean().default(true).describe('If true, will move an existing matching event instead of creating a duplicate'),
    matchQuery: z.string().optional().describe('Optional search query for matching existing events (defaults to title)'),
    dryRun: z.boolean().default(false).describe('If true, do not change calendar; only report what would happen'),
  }),
  execute: async (rawInput: {
    calendarId?: string;
    title: string;
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
      // Avoid server timezone day-boundaries: search within a safe window around the desired time.
      const timeMin = addHours(desiredStart, -24).toISOString();
      const timeMax = addHours(desiredStart, 24).toISOString();
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
    const { conflicts, alternatives } = await conflictsAndAlternatives({
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
        message: 'Conflicts detected; no calendar changes were made.',
        action: match ? 'would-move' : 'would-create',
        conflicts,
        alternatives,
      };
    }

    if (input.dryRun) {
      return {
        success: true,
        dryRun: true,
        action: match ? 'would-move' : 'would-create',
        moveTarget: match ?? undefined,
        desired: { title: input.title, start: input.start, end: input.end, calendarId },
      };
    }

    if (match) {
      await calendarService.patchEvent(calendarId, match.eventId, {
        start: input.start,
        end: input.end,
        title: input.title,
      });
      const { label } = formatWhen({ start: input.start, end: input.end });
      return {
        success: true,
        action: 'moved-existing',
        eventId: match.eventId,
        summary: `[Moved] ${input.title}. When: ${label}`,
        ...(conflicts.length > 0 && {
          warning: 'Event moved despite conflicts',
          conflicts,
          alternatives,
        }),
      };
    }

    const created = await calendarService.createEvent(calendarId, {
      title: input.title,
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
      ...(conflicts.length > 0 && {
        warning: 'Event created despite conflicts',
        conflicts,
        alternatives,
      }),
    };
  },
} as const;



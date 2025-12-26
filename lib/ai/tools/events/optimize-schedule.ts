import { z } from 'zod';
import { getSessionOrThrow, parseInputOrThrow } from '@/lib/utils/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { calendar_v3 } from 'googleapis';
import { findConflictsForTimeRange, suggestAlternativeSlots, SuggestedSlot } from '@/lib/utils/calendar-conflicts';

type NormalizedEvent = {
  calendarId: string;
  eventId: string;
  title: string;
  start: Date;
  end: Date;
  durationMin: number;
  allDay: boolean;
  recurringInstance: boolean;
  hasAttendees: boolean;
  organizerSelf: boolean;
  creatorSelf: boolean;
  fixed: boolean;
};

type Conflict = {
  a: NormalizedEvent;
  b: NormalizedEvent;
  overlapMinutes: number;
};

type MoveProposal = {
  event: Pick<NormalizedEvent, 'calendarId' | 'eventId' | 'title'> & {
    fromStart: string;
    fromEnd: string;
  };
  proposedStart: string;
  proposedEnd: string;
  reason: string;
  alternatives?: SuggestedSlot[];
  createdEventId?: string;
  applyStatus?: 'skipped' | 'moved' | 'failed';
  applyError?: string;
};

type BusyBlock = {
  calendarId: string;
  eventId: string;
  start: Date;
  end: Date;
};

function clampToMinuteGrid(date: Date, stepMinutes: number) {
  const d = new Date(date);
  const ms = stepMinutes * 60_000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function minutesBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function intersectMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  const s = new Date(Math.max(aStart.getTime(), bStart.getTime()));
  const e = new Date(Math.min(aEnd.getTime(), bEnd.getTime()));
  return Math.max(0, minutesBetween(s, e));
}

function isAllDayEvent(e: calendar_v3.Schema$Event) {
  const start = e.start?.date;
  const end = e.end?.date;
  return Boolean(start && end && !e.start?.dateTime && !e.end?.dateTime);
}

function parseEventDateTime(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeEvent(calendarId: string, e: calendar_v3.Schema$Event): NormalizedEvent | null {
  const eventId = e.id;
  if (!eventId) return null;

  // Skip cancelled events
  if (e.status === 'cancelled') return null;

  const title = e.summary || 'No Title';
  const allDay = isAllDayEvent(e);

  const startStr = (e.start?.dateTime ?? e.start?.date) as string | undefined;
  const endStr = (e.end?.dateTime ?? e.end?.date) as string | undefined;
  const start = parseEventDateTime(startStr);
  const end = parseEventDateTime(endStr);
  if (!start || !end) return null;

  const durationMin = minutesBetween(start, end);
  if (durationMin <= 0) return null;

  const recurringInstance = Boolean(e.recurringEventId || e.originalStartTime);
  const hasAttendees = Array.isArray(e.attendees) && e.attendees.length > 0;
  const organizerSelf = Boolean((e.organizer as any)?.self);
  const creatorSelf = Boolean((e.creator as any)?.self);

  // "Fixed" heuristic:
  // - all-day events are fixed
  // - instances of recurring series are fixed (typically routines / externally controlled)
  // - events with attendees are treated as fixed unless user explicitly opts into moving them
  const fixed = allDay || recurringInstance || hasAttendees;

  return {
    calendarId,
    eventId,
    title,
    start,
    end,
    durationMin,
    allDay,
    recurringInstance,
    hasAttendees,
    organizerSelf,
    creatorSelf,
    fixed,
  };
}

function computeDailyPatternFixed(events: NormalizedEvent[]) {
  // Additional "fixed" heuristic: if an event title appears at the same start time (HH:MM)
  // on >= 3 distinct days within the range, treat those as fixed.
  const key = (e: NormalizedEvent) => {
    const hh = e.start.getHours().toString().padStart(2, '0');
    const mm = e.start.getMinutes().toString().padStart(2, '0');
    return `${e.title}@@${hh}:${mm}@@${e.durationMin}`;
  };

  const daysByKey = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.allDay) continue;
    const day = e.start.toISOString().slice(0, 10);
    const k = key(e);
    if (!daysByKey.has(k)) daysByKey.set(k, new Set());
    daysByKey.get(k)!.add(day);
  }

  const fixedKeys = new Set<string>();
  for (const [k, days] of daysByKey.entries()) {
    if (days.size >= 3) fixedKeys.add(k);
  }

  return (e: NormalizedEvent) => fixedKeys.has(key(e));
}

function findConflicts(events: NormalizedEvent[]): Conflict[] {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const conflicts: Conflict[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.start >= a.end) break;
      if (overlaps(a.start, a.end, b.start, b.end)) {
        const overlapMinutes = intersectMinutes(a.start, a.end, b.start, b.end);
        if (overlapMinutes > 0) conflicts.push({ a, b, overlapMinutes });
      }
    }
  }
  return conflicts;
}

function withinWorkingHours(d: Date, workDayStartHour: number, workDayEndHour: number) {
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= workDayStartHour && h <= workDayEndHour;
}

function tryFindSlot(params: {
  weekStart: Date;
  weekEnd: Date;
  durationMin: number;
  busy: Array<{ start: Date; end: Date }>;
  stepMinutes: number;
  workDayStartHour?: number;
  workDayEndHour?: number;
}) {
  const {
    weekStart,
    weekEnd,
    durationMin,
    busy,
    stepMinutes,
    workDayStartHour,
    workDayEndHour,
  } = params;

  const busySorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  let cursor = clampToMinuteGrid(weekStart, stepMinutes);

  while (cursor.getTime() + durationMin * 60_000 <= weekEnd.getTime()) {
    const candidateStart = cursor;
    const candidateEnd = new Date(candidateStart.getTime() + durationMin * 60_000);

    if (workDayStartHour != null && workDayEndHour != null) {
      if (!withinWorkingHours(candidateStart, workDayStartHour, workDayEndHour)) {
        cursor = new Date(cursor.getTime() + stepMinutes * 60_000);
        continue;
      }
      if (!withinWorkingHours(candidateEnd, workDayStartHour, workDayEndHour)) {
        cursor = new Date(cursor.getTime() + stepMinutes * 60_000);
        continue;
      }
    }

    let conflict = false;
    for (const b of busySorted) {
      if (b.start >= candidateEnd) break;
      if (overlaps(candidateStart, candidateEnd, b.start, b.end)) {
        conflict = true;
        // Jump cursor forward near the end of this busy block for faster search.
        cursor = clampToMinuteGrid(b.end, stepMinutes);
        break;
      }
    }
    if (!conflict) {
      return { start: candidateStart, end: candidateEnd };
    }
  }

  return null;
}

function hasConflictWithBusy(candidateStart: Date, candidateEnd: Date, busy: Array<{ start: Date; end: Date }>) {
  for (const b of busy) {
    if (b.start >= candidateEnd) break;
    if (overlaps(candidateStart, candidateEnd, b.start, b.end)) return true;
  }
  return false;
}

export const optimizeScheduleTool = {
  description: `Analyze the user's calendar for the next 7 days, detect schedule conflicts (overlapping events), and propose (or optionally apply) rescheduling within the week.

Core behavior:
- Works within a 7-day window (default: now → now+7d, or custom weekStart ISO).
- Detects overlaps and reports them.
- Treats "fixed" events as non-movable (all-day events, recurring instances, and events with attendees; also detects daily routines repeated at the same time).
- For movable events, proposes moving them to the nearest available slot within the week without creating new conflicts.
- Optionally applies changes by moving events on the primary calendar (only when apply=true).`,
  inputSchema: z.object({
    weekStart: z
      .string()
      .optional()
      .describe('Optional ISO-8601 start datetime for analysis window. If omitted, uses now.'),
    days: z
      .number()
      .int()
      .min(1)
      .max(7)
      .default(7)
      .describe('Number of days in the analysis window (1-7).'),
    stepMinutes: z
      .number()
      .int()
      .min(5)
      .max(60)
      .default(15)
      .describe('Granularity for searching free slots.'),
    workDayStartHour: z
      .number()
      .min(0)
      .max(23)
      .optional()
      .describe('Optional working hours constraint (start hour in local time).'),
    workDayEndHour: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe('Optional working hours constraint (end hour in local time).'),
    allowMoveWithAttendees: z
      .boolean()
      .default(false)
      .describe('If true, events with attendees may be considered movable.'),
    apply: z
      .boolean()
      .default(false)
      .describe('If true, will attempt to apply suggested moves to primary calendar events.'),
    moveMode: z
      .enum(['patch', 'recreate'])
      .default('patch')
      .describe('How to apply a move: patch updates the same event; recreate creates a new event and deletes the original.'),
    maxMoves: z
      .number()
      .int()
      .min(0)
      .max(10)
      .default(3)
      .describe('Maximum number of events to move/apply in one run.'),
  }),
  execute: async (rawInput: {
    weekStart?: string;
    days?: number;
    stepMinutes?: number;
    workDayStartHour?: number;
    workDayEndHour?: number;
    allowMoveWithAttendees?: boolean;
    apply?: boolean;
    moveMode?: 'patch' | 'recreate';
    maxMoves?: number;
  }) => {
    const input = parseInputOrThrow(optimizeScheduleTool.inputSchema, rawInput);
    const session = await getSessionOrThrow();
    const calendarService = new GoogleCalendarService(
      session.user.accessToken as string,
      session.user.id as string
    );

    const weekStart = input.weekStart ? new Date(input.weekStart) : new Date();
    if (isNaN(weekStart.getTime())) throw new Error('Invalid weekStart: must be ISO-8601 datetime');
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + (input.days ?? 7));

    // Fetch events across primary + followed calendars (same approach as getEventsTool).
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id as string))
      .limit(1);
    const followed = Array.isArray(rows[0]?.followedCalendars)
      ? ((rows[0]!.followedCalendars as any[]) ?? [])
      : [];
    const calendarIds = ['primary', ...followed.map((c) => c.calendarId).filter(Boolean)];

    const timeMin = weekStart.toISOString();
    const timeMax = weekEnd.toISOString();

    const results = await Promise.allSettled(
      calendarIds.map((cid) =>
        calendarService.fetchEvents(cid, {
          timeMin,
          timeMax,
          maxResults: 250,
          singleEvents: true,
          orderBy: 'startTime',
        })
      )
    );

    const mergedWithCalendarId: Array<{ calendarId: string; event: calendar_v3.Schema$Event }> = [];
    results.forEach((res, idx) => {
      if (res.status !== 'fulfilled') return;
      const cid = calendarIds[idx]!;
      for (const ev of res.value.items ?? []) mergedWithCalendarId.push({ calendarId: cid, event: ev });
    });

    // Keep raw events for primary calendar to support recreate+delete move mode.
    const primaryEventById = new Map<string, calendar_v3.Schema$Event>();
    for (const { calendarId, event } of mergedWithCalendarId) {
      if (calendarId !== 'primary') continue;
      if (event?.id) primaryEventById.set(event.id, event);
    }

    const normalized: NormalizedEvent[] = mergedWithCalendarId
      .map(({ calendarId, event }) => normalizeEvent(calendarId, event))
      .filter(Boolean) as NormalizedEvent[];

    // Apply daily-pattern fixed detection on top of other fixed rules.
    const isPatternFixed = computeDailyPatternFixed(normalized);
    for (const e of normalized) {
      if (isPatternFixed(e)) e.fixed = true;
      if (input.allowMoveWithAttendees) {
        // If user opts in, allow attendee events to be movable unless other fixed conditions apply.
        if (e.hasAttendees && !e.allDay && !e.recurringInstance && !isPatternFixed(e)) {
          e.fixed = false;
        }
      }
    }

    const conflicts = findConflicts(normalized);
    const conflictSummaries = conflicts.slice(0, 25).map((c) => ({
      a: { title: c.a.title, start: c.a.start.toISOString(), end: c.a.end.toISOString(), calendarId: c.a.calendarId },
      b: { title: c.b.title, start: c.b.start.toISOString(), end: c.b.end.toISOString(), calendarId: c.b.calendarId },
      overlapMinutes: c.overlapMinutes,
    }));

    // If no conflicts, still return a lightweight "profile hints" based on weekly structure.
    const fixedCount = normalized.filter((e) => e.fixed).length;
    const movableCount = normalized.length - fixedCount;

    // Build a busy list for slot search from ALL events (primary + followed).
    // Even "movable" events still occupy time; we should never propose a move that overlaps anything.
    const busyBlocks: BusyBlock[] = normalized.map((e) => ({
      calendarId: e.calendarId,
      eventId: e.eventId,
      start: e.start,
      end: e.end,
    }));

    const proposals: MoveProposal[] = [];
    const toConsider = conflicts
      .flatMap((c) => [c.a, c.b])
      .filter((e, idx, arr) => arr.findIndex((x) => x.calendarId === e.calendarId && x.eventId === e.eventId) === idx);

    for (const e of toConsider) {
      if (proposals.length >= (input.maxMoves ?? 3)) break;

      // We only "move" events from primary calendar and only those not fixed.
      if (e.calendarId !== 'primary') continue;
      if (e.fixed) continue;

      // Safety: only move events the user likely controls.
      if (!(e.organizerSelf || e.creatorSelf)) continue;

      // Remove the event's own block from busy blocks for searching.
      const busyWithoutSelfBlocks = busyBlocks.filter(
        (b) => !(b.calendarId === e.calendarId && b.eventId === e.eventId)
      );
      const busyWithoutSelf = busyWithoutSelfBlocks
        .map((b) => ({ start: b.start, end: b.end }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      // Find a slot that fits NOW (considering previously proposed/applied moves in this run).
      const slot = tryFindSlot({
        weekStart,
        weekEnd,
        durationMin: e.durationMin,
        busy: busyWithoutSelf,
        stepMinutes: input.stepMinutes ?? 15,
        workDayStartHour: input.workDayStartHour,
        workDayEndHour: input.workDayEndHour,
      });

      if (!slot) {
        proposals.push({
          event: {
            calendarId: e.calendarId,
            eventId: e.eventId,
            title: e.title,
            fromStart: e.start.toISOString(),
            fromEnd: e.end.toISOString(),
          },
          proposedStart: e.start.toISOString(),
          proposedEnd: e.end.toISOString(),
          reason: 'No free slot found within the selected window',
          applyStatus: 'skipped',
        });
        continue;
      }

      // If the best slot is identical, skip.
      if (slot.start.getTime() === e.start.getTime() && slot.end.getTime() === e.end.getTime()) {
        continue;
      }

      const proposal: MoveProposal = {
        event: {
          calendarId: e.calendarId,
          eventId: e.eventId,
          title: e.title,
          fromStart: e.start.toISOString(),
          fromEnd: e.end.toISOString(),
        },
        proposedStart: slot.start.toISOString(),
        proposedEnd: slot.end.toISOString(),
        reason: 'Resolve overlaps by moving this movable event to the nearest free slot within the week',
      };

      // Final safety check right before applying: make sure no overlap exists.
      // (Should already be true from tryFindSlot, but this guards against logic regressions.)
      if (hasConflictWithBusy(slot.start, slot.end, busyWithoutSelf)) {
        proposal.applyStatus = 'skipped';
        proposal.applyError = 'Proposed slot conflicts with existing events (safety check)';
        proposals.push(proposal);
        continue;
      }

      if (input.apply) {
        try {
          if ((input.moveMode ?? 'patch') === 'recreate') {
            // Extra safety: live conflict check right before creating the new event.
            // This protects against changes since the initial fetch, and enforces conflict-check everywhere.
            const liveConflicts = await findConflictsForTimeRange({
              calendarService,
              userId: session.user.id as string,
              startISO: slot.start.toISOString(),
              endISO: slot.end.toISOString(),
              includeFollowedCalendars: true,
              exclude: { calendarId: 'primary', eventId: e.eventId },
            });
            if (liveConflicts.length > 0) {
              const alternatives = await suggestAlternativeSlots({
                calendarService,
                userId: session.user.id as string,
                desiredStartISO: slot.start.toISOString(),
                desiredEndISO: slot.end.toISOString(),
                includeFollowedCalendars: true,
                exclude: { calendarId: 'primary', eventId: e.eventId },
                searchDays: 7,
                stepMinutes: input.stepMinutes ?? 15,
                maxSuggestions: 5,
                minHour: 7, // Don't suggest before 7 AM
                maxHour: 22, // Don't suggest after 10 PM
              });
              proposal.applyStatus = 'skipped';
              proposal.applyError = 'Live conflict check failed; move was not applied.';
              proposal.alternatives = alternatives;
              proposals.push(proposal);
              continue;
            }

            const original = primaryEventById.get(e.eventId);
            const title = original?.summary || e.title;
            const location = original?.location || undefined;
            const description = original?.description || undefined;
            const attendees =
              Array.isArray(original?.attendees) && original!.attendees!.length > 0
                ? original!.attendees!
                    .map((a) => a?.email)
                    .filter(Boolean)
                    .map((email) => ({ email: email as string }))
                : undefined;

            const created = await calendarService.createEvent('primary', {
              title,
              start: slot.start.toISOString(),
              end: slot.end.toISOString(),
              location,
              description,
              attendees,
            });
            proposal.createdEventId = created?.id ?? undefined;

            try {
              // Only delete the old event after we have a successful new event created.
              await calendarService.deleteEvent('primary', e.eventId);
              proposal.applyStatus = 'moved';
            } catch (deleteErr) {
              // Rollback: if we failed to delete the old one, remove the newly created event
              // to avoid leaving duplicates.
              try {
                if (created?.id) {
                  await calendarService.deleteEvent('primary', created.id);
                }
              } catch (rollbackErr) {
                proposal.applyStatus = 'failed';
                proposal.applyError =
                  `Failed to delete old event after creating a new one. ` +
                  `Rollback also failed. ` +
                  `deleteError=${deleteErr instanceof Error ? deleteErr.message : 'Unknown error'}; ` +
                  `rollbackError=${rollbackErr instanceof Error ? rollbackErr.message : 'Unknown error'}`;
                proposals.push(proposal);
                continue;
              }

              proposal.applyStatus = 'failed';
              proposal.applyError =
                `Move aborted: old event was NOT deleted, so the new event was rolled back. ` +
                `deleteError=${deleteErr instanceof Error ? deleteErr.message : 'Unknown error'}`;
              proposals.push(proposal);
              continue;
            }
          } else {
            // Default: patch moves the same event (no deletion needed).
            // Extra safety: live conflict check right before patching.
            const liveConflicts = await findConflictsForTimeRange({
              calendarService,
              userId: session.user.id as string,
              startISO: slot.start.toISOString(),
              endISO: slot.end.toISOString(),
              includeFollowedCalendars: true,
              exclude: { calendarId: 'primary', eventId: e.eventId },
            });
            if (liveConflicts.length > 0) {
              const alternatives = await suggestAlternativeSlots({
                calendarService,
                userId: session.user.id as string,
                desiredStartISO: slot.start.toISOString(),
                desiredEndISO: slot.end.toISOString(),
                includeFollowedCalendars: true,
                exclude: { calendarId: 'primary', eventId: e.eventId },
                searchDays: 7,
                stepMinutes: input.stepMinutes ?? 15,
                maxSuggestions: 5,
                minHour: 7, // Don't suggest before 7 AM
                maxHour: 22, // Don't suggest after 10 PM
              });
              proposal.applyStatus = 'skipped';
              proposal.applyError = 'Live conflict check failed; move was not applied.';
              proposal.alternatives = alternatives;
              proposals.push(proposal);
              continue;
            }

            await calendarService.patchEvent('primary', e.eventId, {
              start: slot.start.toISOString(),
              end: slot.end.toISOString(),
            });
            proposal.applyStatus = 'moved';
          }
        } catch (err) {
          proposal.applyStatus = 'failed';
          proposal.applyError = err instanceof Error ? err.message : 'Unknown error';
        }
      }

      proposals.push(proposal);

      // Update busy blocks so subsequent proposals in the same run won't collide with this move.
      // We do this even when apply=false (recommendations should be internally consistent).
      // If apply failed, we keep original busy block unchanged.
      if (!proposal.applyStatus || proposal.applyStatus === 'moved') {
        // Remove original block (primary event).
        const idx = busyBlocks.findIndex((b) => b.calendarId === 'primary' && b.eventId === e.eventId);
        if (idx >= 0) busyBlocks.splice(idx, 1);
        // Add new block.
        busyBlocks.push({
          calendarId: 'primary',
          eventId: e.eventId,
          start: slot.start,
          end: slot.end,
        });
      }
    }

    // Lightweight "user profile" draft from weekly structure (non-sensitive, derived from schedule).
    const hours = normalized
      .filter((e) => !e.allDay)
      .map((e) => e.start.getHours());
    const avgStartHour = hours.length ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length) : null;

    return {
      window: { start: timeMin, end: timeMax, days: input.days ?? 7 },
      totals: { events: normalized.length, fixed: fixedCount, movable: movableCount, conflicts: conflicts.length },
      conflicts: conflictSummaries,
      proposals,
      userProfileDraft: {
        inferredActiveStartHour: avgStartHour,
        notes:
          'Draft only: derived from the next-week schedule. Fixed routines include all-day items, recurring instances, attendee meetings, and patterns repeating on 3+ days.',
      },
    };
  },
} as const;



import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { calendar_v3 } from 'googleapis';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { calendarIdsFor, type FollowedCalendar } from '@/lib/utils/calendars';
import { formatUtcOffset } from '@/lib/push/timezone';

export type CalendarConflict = {
  calendarId: string;
  eventId: string;
  title: string;
  start: string;
  end: string;
};

/** Why an event that covers the requested time is nevertheless not in the way. */
export type OverlapReason = 'all-day' | 'free' | 'declined' | 'working-location';

/** Something happening at the same time that is context, not an obstacle. */
export type CalendarOverlap = CalendarConflict & { reason: OverlapReason };

export type SuggestedSlot = {
  start: string;
  end: string;
};

/**
 * Overlapping in time and being in the way are different questions.
 *
 * An anniversary is an all-day event, so it spans midnight to midnight and
 * collided with every hour of the day it fell on — one birthday made a whole
 * day unbookable. The other three are Google's own answer to the same question
 * (`transparency: 'transparent'` is the "Free" toggle, which is how standing
 * working-hours blocks are usually kept) and were being overruled too.
 */
export function nonBlockingReason(e: calendar_v3.Schema$Event): OverlapReason | null {
  // All-day events carry `start.date`; a timed one carries `start.dateTime`.
  if (!e.start?.dateTime) return 'all-day';
  if (e.transparency === 'transparent') return 'free';
  if (e.eventType === 'workingLocation') return 'working-location';
  if ((e.attendees ?? []).some((a) => a.self === true && a.responseStatus === 'declined')) {
    return 'declined';
  }
  return null;
}

function parseEventDateTime(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function clampToMinuteGrid(date: Date, stepMinutes: number) {
  const ms = stepMinutes * 60_000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function normalizeEventTime(e: calendar_v3.Schema$Event) {
  const startText = (e.start?.dateTime ?? e.start?.date) as string | undefined;
  const endText = (e.end?.dateTime ?? e.end?.date) as string | undefined;
  const start = parseEventDateTime(startText);
  const end = parseEventDateTime(endText);
  if (!start || !end) return null;
  return { start, end, startText, endText };
}

/**
 * Which calendars to read for a user: their own, then the ones they follow.
 *
 * The email is selected because Google answers for the account's own calendar
 * both as `primary` and under that address, and a user who followed themselves
 * by typing their own email had it fetched twice on every read. Events dedupe by
 * id downstream so nothing looked wrong — it was one wasted round-trip per read,
 * on every path, forever. `calendarIdsFor` drops it; nothing here asks Google
 * which calendar is the primary, because these callers run on cron paths with no
 * session and no budget for a lookup.
 */
export async function getCalendarIdsForUser(userId: string) {
  const [row] = await db
    .select({ email: users.email, followedCalendars: users.followedCalendars })
    .from(users)
    .where(eq(users.id, userId as string))
    .limit(1);

  const followed = Array.isArray(row?.followedCalendars)
    ? (row.followedCalendars as FollowedCalendar[])
    : [];

  return calendarIdsFor(followed, row?.email);
}

/**
 * Everything overlapping the range, split by whether it is actually in the way.
 * The blocking half decides whether to stop; the rest is worth one mention
 * ("you have your anniversary that day") and nothing more.
 */
export async function findOverlapsForTimeRange(params: {
  calendarService: GoogleCalendarService;
  userId: string;
  startISO: string;
  endISO: string;
  includeFollowedCalendars?: boolean;
  exclude?: { calendarId: string; eventId: string };
}): Promise<{ blocking: CalendarConflict[]; nonBlocking: CalendarOverlap[] }> {
  const start = new Date(params.startISO);
  const end = new Date(params.endISO);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
    throw new Error('Invalid time range for conflict check');
  }

  const calendarIds = params.includeFollowedCalendars === false
    ? ['primary']
    : await getCalendarIdsForUser(params.userId);

  const results = await Promise.allSettled(
    calendarIds.map((cid) =>
      params.calendarService.fetchEvents(cid, {
        timeMin: params.startISO,
        timeMax: params.endISO,
        maxResults: 100,
        singleEvents: true,
        orderBy: 'startTime',
      })
    )
  );

  const blocking: CalendarConflict[] = [];
  const nonBlocking: CalendarOverlap[] = [];

  results.forEach((res, idx) => {
    if (res.status !== 'fulfilled') return;
    const calendarId = calendarIds[idx]!;
    for (const ev of res.value.items ?? []) {
      const eventId = ev.id;
      if (!eventId) continue;
      if (ev.status === 'cancelled') continue;
      if (params.exclude && params.exclude.calendarId === calendarId && params.exclude.eventId === eventId) continue;

      const t = normalizeEventTime(ev);
      if (!t) continue;
      if (!overlaps(start, end, t.start, t.end)) continue;

      const row = {
        calendarId,
        eventId,
        title: ev.summary || 'No Title',
        start: (t.startText ?? t.start.toISOString()) as string,
        end: (t.endText ?? t.end.toISOString()) as string,
      };

      const reason = nonBlockingReason(ev);
      if (reason) nonBlocking.push({ ...row, reason });
      else blocking.push(row);
    }
  });

  // Stable ordering for output
  blocking.sort((a, b) => a.start.localeCompare(b.start));
  nonBlocking.sort((a, b) => a.start.localeCompare(b.start));
  return { blocking, nonBlocking };
}

/**
 * The blocking half alone, for callers that only ask "is this time taken?".
 */
export async function findConflictsForTimeRange(params: {
  calendarService: GoogleCalendarService;
  userId: string;
  startISO: string;
  endISO: string;
  includeFollowedCalendars?: boolean;
  exclude?: { calendarId: string; eventId: string };
}) {
  const { blocking } = await findOverlapsForTimeRange(params);
  return blocking;
}

function extractTimezoneOffset(isoString: string): string {
  // Extract timezone offset from ISO string (e.g. "+02:00" or "-05:00" or "Z")
  const match = isoString.match(/([+-]\d{2}:\d{2}|Z)$/);
  if (match) {
    if (match[1] === 'Z') return '+00:00';
    return match[1];
  }
  // Fallback to +00:00 if no offset found
  return '+00:00';
}

function offsetMinutesOf(offset: string): number | null {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
}

function hourInOffset(date: Date, offsetMinutes: number): number {
  return new Date(date.getTime() + offsetMinutes * 60_000).getUTCHours();
}

/**
 * Whether a whole slot falls inside the hours worth proposing.
 *
 * This used to read `getHours()` — the server's zone, UTC on Vercel — so for a
 * Kyiv user the window it enforced ran 10:00 to 01:00. Exported because that
 * bug is visible or invisible depending on where the suite runs, which is no
 * way to keep it fixed. The end is measured a millisecond early because it is
 * exclusive: 21:30–22:00 finishes inside the day.
 */
export function isSlotWithinHours(params: {
  start: Date;
  end: Date;
  offsetMinutes: number;
  minHour: number;
  maxHour: number;
}): boolean {
  const inRange = (d: Date) => {
    const hour = hourInOffset(d, params.offsetMinutes);
    return hour >= params.minHour && hour < params.maxHour;
  };
  return inRange(params.start) && inRange(new Date(params.end.getTime() - 1));
}

function formatDateWithOffset(date: Date, offset: string): string {
  const offsetMinutes = offsetMinutesOf(offset);
  if (offsetMinutes === null) return date.toISOString();

  // Shift UTC time by the offset to get the local wall-clock time
  const local = new Date(date.getTime() + offsetMinutes * 60_000);

  const yyyy = local.getUTCFullYear();
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mi = String(local.getUTCMinutes()).padStart(2, '0');
  const ss = String(local.getUTCSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${offset}`;
}

export async function suggestAlternativeSlots(params: {
  calendarService: GoogleCalendarService;
  userId: string;
  desiredStartISO: string;
  desiredEndISO: string;
  searchDays?: number; // default 7
  stepMinutes?: number; // default 15
  maxSuggestions?: number; // default 5
  includeFollowedCalendars?: boolean; // default true
  exclude?: { calendarId: string; eventId: string }; // exclude current event when moving
  minHour?: number; // default 7 - don't suggest slots before this hour
  maxHour?: number; // default 22 - don't suggest slots after this hour
  /** IANA zone of the person being offered these times. See below. */
  timeZone?: string;
}) {
  const desiredStart = new Date(params.desiredStartISO);
  const desiredEnd = new Date(params.desiredEndISO);
  if (
    isNaN(desiredStart.getTime()) ||
    isNaN(desiredEnd.getTime()) ||
    desiredStart >= desiredEnd
  ) {
    throw new Error('Invalid desired time range for suggestions');
  }

  /*
   * Whose day the suggested times have to sit inside.
   *
   * `scheduleEvent` arrives with a real offset (its schema rejects `Z` and
   * `+00:00` so that it does). `optimizeSchedule` works in `Date`s and can only
   * pass `.toISOString()`, which always parses back as `+00:00` — reverting
   * every hour decision below to UTC — so it passes `timeZone`, which wins.
   * Held for the whole window, so a DST change inside it shifts the far end by
   * an hour: the same trade `localDayBounds` makes.
   */
  const timezoneOffset = params.timeZone
    ? formatUtcOffset(desiredStart, params.timeZone)
    : extractTimezoneOffset(params.desiredStartISO);

  const durationMs = desiredEnd.getTime() - desiredStart.getTime();
  const step = params.stepMinutes ?? 15;
  const days = params.searchDays ?? 7;
  const max = params.maxSuggestions ?? 5;
  const minHour = params.minHour ?? 7; // Don't suggest before 7 AM
  const maxHour = params.maxHour ?? 22; // Don't suggest after 10 PM

  const windowStart = desiredStart;
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + days);

  const calendarIds =
    params.includeFollowedCalendars === false
      ? ['primary']
      : await getCalendarIdsForUser(params.userId);

  // Fetch all busy events in the window once.
  const results = await Promise.allSettled(
    calendarIds.map((cid) =>
      params.calendarService.fetchEvents(cid, {
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
      })
    )
  );

  const busy: Array<{ start: Date; end: Date }> = [];
  results.forEach((res, idx) => {
    if (res.status !== 'fulfilled') return;
    const calendarId = calendarIds[idx]!;
    for (const ev of res.value.items ?? []) {
      const eventId = ev.id;
      if (!eventId) continue;
      if (ev.status === 'cancelled') continue;
      if (params.exclude && params.exclude.calendarId === calendarId && params.exclude.eventId === eventId) continue;
      // The same rule as the conflict check, or the two contradict each other
      // and the day has no conflict and still no free slot to offer.
      if (nonBlockingReason(ev)) continue;
      const t = normalizeEventTime(ev);
      if (!t) continue;
      busy.push({ start: t.start, end: t.end });
    }
  });
  busy.sort((a, b) => a.start.getTime() - b.start.getTime());

  const suggestions: SuggestedSlot[] = [];
  let cursor = clampToMinuteGrid(desiredStart, step);

  const overlapsBusy = (s: Date, e: Date) => {
    for (const b of busy) {
      if (b.start >= e) break;
      if (overlaps(s, e, b.start, b.end)) return true;
    }
    return false;
  };

  const tzMinutes = offsetMinutesOf(timezoneOffset) ?? 0;

  while (suggestions.length < max && cursor.getTime() + durationMs <= windowEnd.getTime()) {
    const candStart = cursor;
    const candEnd = new Date(candStart.getTime() + durationMs);
    
    // Skip if outside allowed hours (night time)
    if (!isSlotWithinHours({ start: candStart, end: candEnd, offsetMinutes: tzMinutes, minHour, maxHour })) {
      cursor = new Date(cursor.getTime() + step * 60_000);
      continue;
    }
    
    if (!overlapsBusy(candStart, candEnd)) {
      suggestions.push({
        start: formatDateWithOffset(candStart, timezoneOffset),
        end: formatDateWithOffset(candEnd, timezoneOffset),
      });
      // Mark as busy so next suggestions don't overlap the same slot.
      busy.push({ start: candStart, end: candEnd });
      busy.sort((a, b) => a.start.getTime() - b.start.getTime());
      cursor = new Date(candStart.getTime() + step * 60_000);
      continue;
    }
    cursor = new Date(cursor.getTime() + step * 60_000);
  }

  return suggestions;
}

export async function conflictsAndAlternatives(params: {
  calendarService: GoogleCalendarService;
  userId: string;
  start: string;
  end: string;
  includeFollowedCalendars: boolean;
  exclude?: { calendarId: string; eventId: string };
}) {
  const { blocking: conflicts, nonBlocking: alsoDuring } = await findOverlapsForTimeRange({
    calendarService: params.calendarService,
    userId: params.userId,
    startISO: params.start,
    endISO: params.end,
    includeFollowedCalendars: params.includeFollowedCalendars,
    exclude: params.exclude,
  });

  if (conflicts.length === 0) {
    return { conflicts, alternatives: [], alsoDuring };
  }

  const alternatives = await suggestAlternativeSlots({
    calendarService: params.calendarService,
    userId: params.userId,
    desiredStartISO: params.start,
    desiredEndISO: params.end,
    includeFollowedCalendars: params.includeFollowedCalendars,
    exclude: params.exclude,
    searchDays: 7,
    stepMinutes: 15,
    maxSuggestions: 5,
    minHour: 7, // Don't suggest before 7 AM
    maxHour: 22, // Don't suggest after 10 PM
  });

  return { conflicts, alternatives, alsoDuring };
}

export function formatWhen(params: { start: string; end: string }) {
  // Simple formatting - just show the times
  const startDate = new Date(params.start);
  const endDate = new Date(params.end);
  
  // Format as readable time if same day, otherwise show full dates
  if (startDate.toDateString() === endDate.toDateString()) {
    const startTime = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { label: `${dateStr}, ${startTime} - ${endTime}` };
  }
  
  return { label: `${params.start} - ${params.end}` };
}


import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { calendar_v3 } from 'googleapis';
import { GoogleCalendarService } from '@/lib/services/calendar';

export type CalendarConflict = {
  calendarId: string;
  eventId: string;
  title: string;
  start: string;
  end: string;
};

export type SuggestedSlot = {
  start: string;
  end: string;
};

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

export async function getCalendarIdsForUser(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId as string)).limit(1);
  const followed = Array.isArray(rows[0]?.followedCalendars) ? (rows[0]!.followedCalendars as any[]) : [];
  const calendarIds = ['primary', ...followed.map((c) => c.calendarId).filter(Boolean)];
  // De-dup while keeping order
  return [...new Set(calendarIds)];
}

export async function findConflictsForTimeRange(params: {
  calendarService: GoogleCalendarService;
  userId: string;
  startISO: string;
  endISO: string;
  includeFollowedCalendars?: boolean;
  exclude?: { calendarId: string; eventId: string };
}) {
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

  const conflicts: CalendarConflict[] = [];

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

      conflicts.push({
        calendarId,
        eventId,
        title: ev.summary || 'No Title',
        start: (t.startText ?? t.start.toISOString()) as string,
        end: (t.endText ?? t.end.toISOString()) as string,
      });
    }
  });

  // Stable ordering for output
  conflicts.sort((a, b) => a.start.localeCompare(b.start));
  return conflicts;
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

function formatDateWithOffset(date: Date, offset: string): string {
  // Parse the offset to get the shift in minutes
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return date.toISOString();

  const sign = match[1] === '+' ? 1 : -1;
  const offsetMinutes = sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));

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

  // Extract timezone offset from desired time to preserve it in alternatives
  const timezoneOffset = extractTimezoneOffset(params.desiredStartISO);

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

  const isWithinAllowedHours = (date: Date) => {
    const hour = date.getHours();
    return hour >= minHour && hour < maxHour;
  };

  while (suggestions.length < max && cursor.getTime() + durationMs <= windowEnd.getTime()) {
    const candStart = cursor;
    const candEnd = new Date(candStart.getTime() + durationMs);
    
    // Skip if outside allowed hours (night time)
    if (!isWithinAllowedHours(candStart) || !isWithinAllowedHours(candEnd)) {
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
  const conflicts = await findConflictsForTimeRange({
    calendarService: params.calendarService,
    userId: params.userId,
    startISO: params.start,
    endISO: params.end,
    includeFollowedCalendars: params.includeFollowedCalendars,
    exclude: params.exclude,
  });

  if (conflicts.length === 0) {
    return { conflicts, alternatives: [] };
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

  return { conflicts, alternatives };
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


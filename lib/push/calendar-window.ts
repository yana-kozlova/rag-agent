import { GoogleCalendarService } from '@/lib/services/calendar';
import { getCalendarIdsForUser } from '@/lib/utils/calendar-conflicts';
import { addLocalDays, formatUtcOffset, getLocalDateKey } from './timezone';

/**
 * Calendar reads shared by the scheduled-notification jobs.
 *
 * Both the morning briefing and the weekly retrospective need "everything on
 * the user's calendars between two local dates", differing only in the width of
 * the window — so the fan-out, de-duplication and ordering live here once.
 */

export type EventAttendee = {
  email?: string | null;
  displayName?: string | null;
  /** True on the entry representing the calendar's owner. */
  self?: boolean | null;
  organizer?: boolean | null;
  /** accepted | declined | tentative | needsAction */
  responseStatus?: string | null;
};

export type CalendarEvent = {
  id: string;
  /** Which of the user's calendars this copy came from. */
  calendarId: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
  attendees?: EventAttendee[];
};

/**
 * Start/end of a span of local calendar days, as RFC-3339 instants.
 *
 * The offset is taken at `now`, so a DST transition inside the window shifts
 * the far edge by an hour. That is harmless here: the bounds only bracket a
 * Google Calendar query, and an hour of slack at the boundary of a day that is
 * already fully inside the range changes nothing.
 */
export function localDayBounds(
  now: Date,
  tz: string,
  /** How many days back the window starts. 0 = today only. */
  daysBack = 0
): { timeMin: string; timeMax: string; startDay: string; endDay: string } {
  const offset = formatUtcOffset(now, tz);
  const endDay = getLocalDateKey(now, tz);
  const startDay = daysBack === 0 ? endDay : addLocalDays(now, tz, -daysBack);

  return {
    timeMin: `${startDay}T00:00:00${offset}`,
    timeMax: `${endDay}T23:59:59${offset}`,
    startDay,
    endDay,
  };
}

/**
 * An event the user said no to.
 *
 * Their own copy of a declined invitation stays on the calendar and Google
 * keeps returning it — `responseStatus` is the only thing that says they are
 * not going. The detectors in `insights.ts` have always known this; the
 * briefing did not, and printed a week of meetings the user had cancelled out
 * of as if they were the day's commitments.
 */
export function isDeclined(event: Pick<CalendarEvent, 'attendees'>): boolean {
  return (event.attendees ?? []).some(
    (a) => a.self === true && a.responseStatus === 'declined'
  );
}

/**
 * Everything on the user's followed calendars within the given instants.
 *
 * Throws when every calendar failed. An empty array is a claim — "nothing is
 * on" — and returning one for a calendar that could not be read is the same
 * mistake `listCalendars` was fixed for: to everything downstream "Google would
 * not answer" and "your day is free" look identical and mean opposite things.
 * The briefing spent five days cheerfully reporting an empty calendar while the
 * account's refresh token was dead, and said so nowhere. A partial failure
 * still returns what was read, and is logged rather than thrown: one
 * unreadable shared calendar should cost that calendar, not the morning.
 */
export async function fetchEventsBetween(
  calendarService: GoogleCalendarService,
  userId: string,
  timeMin: string,
  timeMax: string,
  maxResults = 25
): Promise<CalendarEvent[]> {
  const calendarIds = await getCalendarIdsForUser(userId);

  const results = await Promise.allSettled(
    calendarIds.map((cid) =>
      calendarService.fetchEvents(cid, {
        timeMin,
        timeMax,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      })
    )
  );

  const failed = results.flatMap((res, i) =>
    res.status === 'rejected' ? [{ calendarId: calendarIds[i]!, reason: res.reason }] : []
  );

  for (const f of failed) {
    console.error(`[push/calendar] Could not read calendar ${f.calendarId}:`, f.reason);
  }

  if (failed.length > 0 && failed.length === results.length) {
    throw new Error(
      `Could not read any of the user's ${results.length} calendar(s): ${
        (failed[0].reason as any)?.message ?? failed[0].reason
      }`
    );
  }

  const events = results.flatMap((res, i) => {
    if (res.status !== 'fulfilled') return [];
    // Index back into calendarIds: acting on an event later — cancelling it,
    // or moving it — has to target the calendar it actually lives on.
    const calendarId = calendarIds[i]!;
    return (res.value.items || []).map((event: any) => ({
      id: event.id as string,
      calendarId,
      title: (event.summary as string) || 'Untitled',
      start: (event.start?.dateTime || event.start?.date) as string,
      end: (event.end?.dateTime || event.end?.date) as string | undefined,
      allDay: !event.start?.dateTime,
      location: event.location as string | undefined,
      // Carried through unfiltered; deciding which attendees matter is the
      // caller's business, and dropping them here is what previously made
      // "who am I meeting" impossible to answer downstream.
      attendees: (event.attendees as EventAttendee[] | undefined) ?? undefined,
    }));
  });

  // Merge duplicates across followed calendars, then order by start time.
  // calendarIds puts "primary" first, so the copy that wins is the user's own —
  // the only one carrying their responseStatus.
  const seen = new Map<string, CalendarEvent>();
  for (const e of events) {
    if (e.start && !seen.has(e.id)) seen.set(e.id, e);
  }

  // Declined after the merge, never before: the copy carrying the user's
  // `responseStatus` is the one on their own calendar, and dropping per-list
  // would let a shared calendar's status-free copy of the same event survive as
  // the winner. Filtering here is what makes this true for every caller —
  // `scanDay` had its own guard and the briefing had none, which is the whole
  // bug: a rule that has to be remembered three times gets remembered twice.
  return [...seen.values()]
    .filter((e) => !isDeclined(e))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/**
 * Formats an event's start as HH:mm in the user's zone.
 *
 * The clock is `en-GB` in every language — 24-hour digits are digits, and a
 * locale that formats them differently would only make the briefing's aligned
 * column of times ragged. Only the all-day label is words, so only it is passed
 * in.
 */
export function formatEventTime(
  event: CalendarEvent,
  tz: string,
  allDayLabel = 'all day'
): string {
  if (event.allDay) return allDayLabel;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(event.start));
}

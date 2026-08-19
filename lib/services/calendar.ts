import { google, calendar_v3 } from 'googleapis';

import type { AccountCalendar } from '@/lib/utils/calendars';

// Attendee interface no longer needed in live-only flow

/**
 * One boundary of an event: an instant, or a whole day.
 *
 * `{ date }` is how Google spells an all-day event, and it is the shape a
 * scheduled task takes when the user committed to a day without naming an hour.
 * Note that Google's `end.date` is **exclusive** — a single day on 2026-08-18
 * ends on 2026-08-19 — which is the caller's business, not this module's.
 */
export type EventBoundary = string | Date | { date: string };

/**
 * Build Google's boundary shape, optionally clearing the variant not used.
 *
 * `clearOther` is what lets a patch convert an event between all-day and timed.
 * Google keeps whatever field the stored event already carries unless it is
 * explicitly overwritten, so patching a `dateTime` onto an all-day event leaves
 * `date` standing beside it and the write is rejected as ambiguous. Sending the
 * unused field as `null` is how the API is told "and not that one". On insert
 * there is nothing to clear, and a null there would just be noise.
 */
function toEventBoundary(
  value: EventBoundary,
  clearOther: boolean
): calendar_v3.Schema$EventDateTime {
  if (typeof value === 'object' && 'date' in value) {
    return clearOther ? { date: value.date, dateTime: null } : { date: value.date };
  }

  const dateTime = typeof value === 'string' ? value : value.toISOString();
  return clearOther ? { dateTime, date: null } : { dateTime };
}

/**
 * Whether a failed write means the event is not there — which, for a delete, is
 * the outcome that was wanted.
 *
 * Google answers 410 for an event already deleted and 404 for one that never
 * existed. Both used to throw out of `deleteEvent`, so a user who removed the
 * event on Google's side could never unschedule the task pointing at it: every
 * attempt failed and the row kept a dead id forever.
 *
 * The status arrives under a different key depending on which googleapis
 * version built the error, and `code` is sometimes a string like 'ENOTFOUND' —
 * comparing against numbers filters those out on its own.
 */
function isAlreadyGone(error: unknown): boolean {
  const e = error as { status?: number; code?: number; response?: { status?: number } };
  const status = e?.status ?? e?.code ?? e?.response?.status;
  return status === 404 || status === 410;
}

export class GoogleCalendarService {
  private calendar: calendar_v3.Calendar;
  private oauth2Client: any;
  private userId: string;

  constructor(accessToken: string, userId: string) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    this.oauth2Client.setCredentials({ access_token: accessToken });
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    this.userId = userId;
  }

  /**
   * Fetch events from Google Calendar with optional filters. This does not write to the DB.
   */
  async fetchEvents(calendarId: string = 'primary', opts: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    q?: string;
    singleEvents?: boolean;
    orderBy?: 'startTime' | 'updated';
    pageToken?: string;
    timeZone?: string;
  } = {}) {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      maxResults: opts.maxResults ?? 100,
      singleEvents: opts.singleEvents ?? true,
      orderBy: opts.orderBy ?? 'startTime',
      q: opts.q,
      pageToken: opts.pageToken,
      timeZone: opts.timeZone,
    };
    const res = await this.calendar.events.list(params as any, { timeout: 15000 });
    return {
      items: (res.data.items ?? []) as calendar_v3.Schema$Event[],
      nextPageToken: res.data.nextPageToken as string | undefined,
    };
  }

  async createEvent(calendarId: string, eventData: {
    title: string;
    description?: string;
    location?: string;
    start: EventBoundary;
    end: EventBoundary;
    attendees?: Array<{ email: string; name?: string }>;
    /**
     * Google's "Free" toggle. `transparent` is what a whole-day intention needs:
     * it holds no hour, so it must not count as a conflict and must not appear
     * in the briefing's schedule — `isTimeBlock` reads exactly this field.
     * Omitted means Google's default, `opaque`, which is right for anything
     * that really does take the time.
     */
    transparency?: 'transparent' | 'opaque';
  }) {
    try {
      const event = await this.calendar.events.insert({
        calendarId,
        requestBody: {
          summary: eventData.title,
          description: eventData.description,
          location: eventData.location,
          start: toEventBoundary(eventData.start, false),
          end: toEventBoundary(eventData.end, false),
          transparency: eventData.transparency,
          attendees: eventData.attendees?.map(attendee => ({
            email: attendee.email,
            displayName: attendee.name,
          })),
        },
      });

      return event.data;
    } catch (error) {
      console.error('Error creating calendar event:', error);
      throw error;
    }
  }

  /**
   * Update (patch) an existing event's fields, typically used to move/reschedule an event.
   * Note: Works only if the authenticated user has write access to the calendar/event.
   */
  async patchEvent(calendarId: string, eventId: string, patch: {
    title?: string;
    description?: string;
    location?: string;
    start?: EventBoundary;
    end?: EventBoundary;
    transparency?: 'transparent' | 'opaque';
  }) {
    try {
      const requestBody: calendar_v3.Schema$Event = {
        summary: patch.title,
        description: patch.description,
        location: patch.location,
        // `true` here is what makes moving a task between "some time on Tuesday"
        // and "Tuesday at 09:00" a patch rather than a delete-and-recreate —
        // which matters because recreating changes the event id, and the task
        // row holds that id.
        start: patch.start ? toEventBoundary(patch.start, true) : undefined,
        end: patch.end ? toEventBoundary(patch.end, true) : undefined,
        transparency: patch.transparency,
      };

      const res = await this.calendar.events.patch({
        calendarId,
        eventId,
        requestBody,
      } as any);

      return res.data;
    } catch (error) {
      console.error('Error patching calendar event:', error);
      throw error;
    }
  }

  /**
   * Every calendar on the account, as Google lists them.
   *
   * This is what makes following a calendar a choice rather than a lookup. The
   * settings panel used to take a typed id, which meant a calendar was reachable
   * only if the user knew its address — so the two most useful ones on any
   * personal account, Birthdays
   * (`addressbook#contacts@group.v.calendar.google.com`) and the holiday
   * calendar, were effectively unreachable, and a typo was stored silently and
   * produced nothing forever.
   *
   * Throws rather than returning an empty list: to a picker, "Google would not
   * answer" and "you have no calendars" look identical and mean opposite things.
   */
  async listCalendars(): Promise<Omit<AccountCalendar, 'followed'>[]> {
    const res = await this.calendar.calendarList.list({ maxResults: 250, showHidden: false });

    return (res.data.items || [])
      // A calendar removed from the account is still returned, flagged.
      .filter((item) => item.id && !item.deleted)
      .map((item) => ({
        id: item.id as string,
        // `summaryOverride` is the name the *user* gave it; `summary` is the
        // owner's. Showing the owner's would rename a calendar out from under
        // someone who deliberately relabelled it in Google.
        summary: item.summaryOverride || item.summary || (item.id as string),
        description: item.description ?? null,
        primary: item.primary === true,
        accessRole: item.accessRole ?? 'reader',
        color: item.backgroundColor ?? null,
      }));
  }

  /**
   * One calendar by id, for following something not on the account.
   *
   * `calendarList` only has what the user has subscribed to, so a shared or
   * public calendar they know the address of would be unfollowable without this.
   * Returns null when it cannot be read — which is the answer the caller needs,
   * since that is exactly the case the old typed-id form stored as if it worked.
   */
  async getCalendar(calendarId: string): Promise<{ id: string; summary: string } | null> {
    try {
      const res = await this.calendar.calendars.get({ calendarId });
      if (!res.data.id) return null;
      return { id: res.data.id, summary: res.data.summary || res.data.id };
    } catch {
      return null;
    }
  }

  /**
   * Get the user's calendar timezone (e.g. "Europe/Kyiv").
   * Falls back to server local timezone on error.
   */
  async getTimeZone(): Promise<string> {
    try {
      const res = await this.calendar.settings.get({ setting: 'timezone' });
      return (res.data.value as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }

  /**
   * Delete an event from a calendar.
   *
   * An event that is already gone counts as success, and says so via
   * `alreadyGone`. A delete asks for a state, not for an action, and that state
   * already holds — throwing instead is what left an unscheduled task unable to
   * ever let go of its dead event id, and what made "delete this" report an
   * opaque failure for an event the user had removed in Google themselves.
   * Every other failure — no write access, network, quota — still throws.
   */
  async deleteEvent(calendarId: string, eventId: string) {
    try {
      await this.calendar.events.delete({
        calendarId,
        eventId,
      } as any);
      return { success: true as const, alreadyGone: false };
    } catch (error) {
      if (isAlreadyGone(error)) {
        return { success: true as const, alreadyGone: true };
      }
      console.error('Error deleting calendar event:', error);
      throw error;
    }
  }
}

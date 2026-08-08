import { google, calendar_v3 } from 'googleapis';

import type { AccountCalendar } from '@/lib/utils/calendars';

// Attendee interface no longer needed in live-only flow

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
    start: string | Date;
    end: string | Date;
    attendees?: Array<{ email: string; name?: string }>;
  }) {
    try {
      const event = await this.calendar.events.insert({
        calendarId,
        requestBody: {
          summary: eventData.title,
          description: eventData.description,
          location: eventData.location,
          start: {
            dateTime: typeof eventData.start === 'string' ? eventData.start : eventData.start.toISOString(),
          },
          end: {
            dateTime: typeof eventData.end === 'string' ? eventData.end : eventData.end.toISOString(),
          },
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
    start?: string | Date;
    end?: string | Date;
  }) {
    try {
      const requestBody: calendar_v3.Schema$Event = {
        summary: patch.title,
        description: patch.description,
        location: patch.location,
        start: patch.start
          ? { dateTime: typeof patch.start === 'string' ? patch.start : patch.start.toISOString() }
          : undefined,
        end: patch.end
          ? { dateTime: typeof patch.end === 'string' ? patch.end : patch.end.toISOString() }
          : undefined,
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
   */
  async deleteEvent(calendarId: string, eventId: string) {
    try {
      await this.calendar.events.delete({
        calendarId,
        eventId,
      } as any);
      return { success: true as const };
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      throw error;
    }
  }
}

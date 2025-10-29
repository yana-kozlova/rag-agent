import { google, calendar_v3 } from 'googleapis';

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
}

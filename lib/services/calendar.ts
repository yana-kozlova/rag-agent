import { google, calendar_v3 } from 'googleapis';
import { db } from '../db';
import { calendarEvents } from '../db/schema/calendar';

interface Attendee {
  email: string;
  name?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

export class GoogleCalendarService {
  private calendar: calendar_v3.Calendar;
  private oauth2Client: any;

  constructor(accessToken: string) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    this.oauth2Client.setCredentials({ access_token: accessToken });
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  async syncEvents(calendarId: string = 'primary') {
    try {
      const items: calendar_v3.Schema$Event[] = [];
      let pageToken: string | undefined = undefined;
      // Compute current week range: Monday 00:00 to next Monday 00:00 (local time)
      const now = new Date();
      const dow = (now.getDay() + 6) % 7; // 0 = Monday
      const startOfWeek = new Date(now);
      startOfWeek.setHours(0, 0, 0, 0);
      startOfWeek.setDate(now.getDate() - dow);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      const timeMin = startOfWeek.toISOString();
      const timeMax = endOfWeek.toISOString();
      const maxPages = 2; // tighter safety cap for weekly window
      let pageCount = 0;

      do {
        const params = {
          calendarId,
          timeMin,
          timeMax,
          maxResults: 100,
          singleEvents: true,
          orderBy: 'startTime',
          pageToken,
        } as const;
        const res: any = await this.calendar.events.list(params as any, { timeout: 15000 });

        if (res.data.items) items.push(...res.data.items);
        pageToken = res.data.nextPageToken ?? undefined;
        pageCount += 1;
        if (pageCount >= maxPages && pageToken) {
          console.warn(`Reached page limit while fetching events. Stopping at ${pageCount} pages.`);
          break;
        }
      } while (pageToken);

      if (items.length === 0) return [];
      console.log(`Fetched ${items.length} events from Google Calendar (${pageCount} page(s)).`);

      const savedEvents = await Promise.all(
        items.map(async (event) => {
          if (!event.id) return null;
          
          const startStr = event.start?.dateTime || event.start?.date;
          const endStr = event.end?.dateTime || event.end?.date;

          const eventData = {
            googleEventId: event.id,
            calendarId,
            title: event.summary || 'No Title',
            description: event.description || '',
            location: event.location || '',
            start: startStr ? new Date(startStr) : new Date(),
            end: endStr ? new Date(endStr) : new Date(),
            allDay: !!event.start?.date,
            attendees: (event.attendees || []).map(attendee => ({
              email: attendee.email || '',
              name: attendee.displayName,
              responseStatus: attendee.responseStatus as Attendee['responseStatus'],
            })),
            recurrence: event.recurrence ? JSON.stringify(event.recurrence) : null,
            syncStatus: 'synced' as const,
            lastSynced: new Date(),
          };

          // Upsert event
          const [savedEvent] = await db
            .insert(calendarEvents)
            .values(eventData)
            .onConflictDoUpdate({
              target: calendarEvents.googleEventId,
              set: { ...eventData, updatedAt: new Date() },
            })
            .returning();

          return savedEvent;
        })
      );

      return savedEvents.filter(Boolean);
    } catch (error) {
      console.error('Error syncing calendar events:', error);
      throw error;
    }
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
            timeZone: 'UTC',
          },
          end: {
            dateTime: typeof eventData.end === 'string' ? eventData.end : eventData.end.toISOString(),
            timeZone: 'UTC',
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

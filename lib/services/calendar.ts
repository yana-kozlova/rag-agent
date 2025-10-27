import { google, calendar_v3 } from 'googleapis';
import { db } from '../db';
import { embeddings as embeddingsTable } from '../db/schema/embeddings';
import { generateEmbeddings } from '../ai/embedding';
import { and, eq } from 'drizzle-orm';
import { resources } from '../db/schema/resources';

interface Attendee {
  email: string;
  name?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
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

      await Promise.all(
        items.map(async (event) => {
          if (!event.id) return null;

          const startStr = event.start?.dateTime || event.start?.date;
          const endStr = event.end?.dateTime || event.end?.date;
          const title = event.summary || 'No Title';
          const description = event.description || '';
          const location = event.location || '';
          const start = startStr ? new Date(startStr) : new Date();
          const end = endStr ? new Date(endStr) : new Date();
          const allDay = !!event.start?.date;
          const attendees = (event.attendees || []).map(attendee => ({
            email: attendee.email || '',
            name: attendee.displayName,
            responseStatus: attendee.responseStatus as Attendee['responseStatus'],
          }));

          const humanStart = start.toISOString();
          const humanEnd = end.toISOString();
          const attendeeText = attendees
            .map(a => `${a.name ?? ''}`.trim())
            .filter(Boolean)
            .join(', ');
          const parts = [
            `[Event] ${title}`,
            description ? `${description}` : '',
            location ? `Location: ${location}` : '',
            `When: ${humanStart} - ${humanEnd}`,
            attendeeText ? `Attendees: ${attendeeText}` : '',
          ].filter(Boolean);
          const summary = parts.join('. ');

          // Upsert resource for this calendar event
          const [existing] = await db
            .select({ id: resources.id })
            .from(resources)
            .where(and(eq(resources.source, 'calendar'), eq(resources.googleEventId, event.id), eq(resources.userId, this.userId)));

          const resourceValues = {
            content: summary,
            source: 'calendar' as const,
            googleEventId: event.id as string,
            userId: this.userId,
            metadata: {
              calendarId,
              title,
              description,
              location,
              start: start.toISOString(),
              end: end.toISOString(),
              allDay,
              attendees,
            } as any,
          };

          let resourceId: string;
          if (existing?.id) {
            const [updated] = await db
              .update(resources)
              .set(resourceValues)
              .where(eq(resources.id, existing.id))
              .returning({ id: resources.id });
            resourceId = updated.id;
          } else {
            const [inserted] = await db
              .insert(resources)
              .values(resourceValues)
              .returning({ id: resources.id });
            resourceId = inserted.id;
          }

          // Rebuild embeddings for this resource
          await db.delete(embeddingsTable).where(eq(embeddingsTable.resourceId, resourceId));
          const chunks = await generateEmbeddings(summary);
          if (chunks.length > 0) {
            await db.insert(embeddingsTable).values(
              chunks.map(e => ({
                resourceId,
                source: 'calendar' as const,
                content: e.content,
                embedding: e.embedding,
              }))
            );
          }

          return null;
        })
      );

      return items.length;
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

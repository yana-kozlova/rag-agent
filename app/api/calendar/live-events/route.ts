import { NextResponse } from 'next/server';
import { auth } from '../../auth/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    const accessToken = session?.user?.accessToken as string | undefined;
    if (!userId || !accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const calendarService = new GoogleCalendarService(accessToken, userId);
    const now = new Date();
    const timeMin = new Date(now);
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + 30); // include next 30 days

    const { items } = await calendarService.fetchEvents('primary', {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = (items || []).map((event) => {
      const start = event.start?.dateTime || event.start?.date || undefined;
      const end = event.end?.dateTime || event.end?.date || undefined;
      const title = event.summary || 'No Title';
      const location = event.location || undefined;
      return { id: event.id!, title, start, end, location };
    }).filter(e => e.id && e.start && e.end);

    // Return all fetched events; count is total returned
    const count = events.length;
    return NextResponse.json({ weeklyCount: count, events });
  } catch (error) {
    console.error('Live events API error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}



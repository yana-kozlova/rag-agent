import { NextResponse } from 'next/server';
import { auth } from '../../auth/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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

    // load followed calendars from user profile
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const followed = Array.isArray(rows[0]?.followedCalendars) ? rows[0]!.followedCalendars as any[] : [];
    const calendarIds = ['primary', ...followed.map((c: any) => c.calendarId).filter(Boolean)];

    const opts = {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime' as const,
    };

    const results = await Promise.allSettled(
      calendarIds.map((cid) => calendarService.fetchEvents(cid, opts).then(r => ({ cid, items: r.items || [] })))
    );

    const merged = results.flatMap((res) => {
      if (res.status !== 'fulfilled') return [] as any[];
      return res.value.items.map((event: any) => ({ cid: res.value.cid, event }));
    });

    const labelMap = new Map<string, string>();
    labelMap.set('primary', 'primary');
    for (const c of followed) {
      if (c?.calendarId) labelMap.set(c.calendarId, c.summary || c.calendarId);
    }

    const events = merged.map(({ cid, event }) => {
      const start = event.start?.dateTime || event.start?.date || undefined;
      const end = event.end?.dateTime || event.end?.date || undefined;
      const title = event.summary || 'No Title';
      const location = event.location || undefined;
      return { id: `${cid}:${event.id!}`, title, start, end, location, calendarId: cid, calendarLabel: labelMap.get(cid) };
    }).filter(e => e.id && e.start && e.end);

    // Return all fetched events; count is total returned
    const count = events.length;
    return NextResponse.json({ weeklyCount: count, events });
  } catch (error) {
    console.error('Live events API error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}



import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { users } from '@/lib/db/schema';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const rows = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
    const user = rows[0];
    const arr = Array.isArray(user?.followedCalendars) ? user.followedCalendars : [];
    const calendars = arr.map((c: any) => ({ id: c.calendarId, calendarId: c.calendarId, summary: c.summary ?? null }));
    return NextResponse.json({ calendars });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to fetch calendars', details: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const calendarId = String(body.calendarId || '').trim();
    const summary = typeof body.summary === 'string' ? body.summary.trim() : null;
    if (!calendarId) return NextResponse.json({ error: 'calendarId required' }, { status: 400 });

    const rows = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
    const user = rows[0];
    const arr: any[] = Array.isArray(user?.followedCalendars) ? [...user.followedCalendars] : [];
    if (arr.some((c) => c?.calendarId === calendarId)) {
      return NextResponse.json({ calendar: { id: calendarId, calendarId, summary }, created: false });
    }
    arr.push({ calendarId, summary });
    await db.update(users).set({ followedCalendars: arr as any }).where(eq(users.id, session.user.id));
    return NextResponse.json({ calendar: { id: calendarId, calendarId, summary }, created: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to add calendar', details: String(err?.message || err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const calendarId = searchParams.get('calendarId');
    if (!calendarId) return NextResponse.json({ error: 'calendarId required' }, { status: 400 });

    const rows = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
    const user = rows[0];
    const arr: any[] = Array.isArray(user?.followedCalendars) ? [...user.followedCalendars] : [];
    const next = arr.filter((c) => c?.calendarId !== calendarId);
    await db.update(users).set({ followedCalendars: next as any }).where(eq(users.id, session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to remove calendar', details: String(err?.message || err) }, { status: 500 });
  }
}



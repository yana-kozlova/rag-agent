import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { GoogleCalendarService } from '@/lib/services/calendar';
import {
  isOwnPrimary,
  mergeCalendarState,
  type FollowedCalendar,
} from '@/lib/utils/calendars';

export const runtime = 'nodejs';

async function currentUser(userId: string) {
  const [row] = await db
    .select({ email: users.email, followedCalendars: users.followedCalendars })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const followed: FollowedCalendar[] = Array.isArray(row?.followedCalendars)
    ? (row.followedCalendars as FollowedCalendar[])
    : [];

  return { email: row?.email ?? null, followed };
}

/**
 * The account's calendars, with what this deployment reads marked on them.
 *
 * Following used to mean typing an id, which made a calendar reachable only if
 * you already knew its address — so Birthdays and the holiday calendar, the two
 * that matter most on a personal account, were effectively unreachable. Google
 * already knows what you have; this asks it.
 *
 * `?stored=1` skips Google entirely and answers from the database. That is for
 * callers that only need the list of ids and must not fail because a token
 * expired.
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { email, followed } = await currentUser(userId);

  if (new URL(req.url).searchParams.get('stored') === '1') {
    return NextResponse.json({
      calendars: followed.map((c) => ({
        id: c.calendarId,
        calendarId: c.calendarId,
        summary: c.summary ?? null,
      })),
    });
  }

  const accessToken = session?.user?.accessToken as string | undefined;
  if (!accessToken) {
    return NextResponse.json(
      { error: 'no-google-access', message: 'Sign in with Google again to list your calendars.' },
      { status: 403 }
    );
  }

  try {
    const available = await new GoogleCalendarService(accessToken, userId).listCalendars();
    return NextResponse.json({ calendars: mergeCalendarState(available, followed, email) });
  } catch (error) {
    // Reported, never swallowed into an empty list: a picker that shows nothing
    // says "you have no calendars", which is the opposite of what happened.
    console.error('[api/calendars] listing failed:', error);
    return NextResponse.json(
      { error: 'google-unreachable', message: 'Could not read your calendars from Google.' },
      { status: 502 }
    );
  }
}

/**
 * Follow a calendar.
 *
 * The id is checked against Google before anything is stored, and the name comes
 * back from Google rather than from a field the user typed. The old form took
 * both on trust: an unreachable id was saved happily and then produced no events
 * forever, because `fetchEventsBetween` drops failed calendars silently — so the
 * failure was invisible at the only moment anyone was looking.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const calendarId = String((body as any)?.calendarId ?? '').trim();
  if (!calendarId) {
    return NextResponse.json({ error: 'calendarId required' }, { status: 400 });
  }

  const { email, followed } = await currentUser(userId);

  // The account's own calendar is always read. Storing it too had it fetched
  // twice on every request — once as `primary`, once by address.
  if (calendarId === 'primary' || isOwnPrimary(calendarId, email)) {
    return NextResponse.json(
      { error: 'primary', message: 'Your own calendar is always read.' },
      { status: 400 }
    );
  }

  if (followed.some((c) => c.calendarId === calendarId)) {
    return NextResponse.json({ created: false, calendar: { calendarId } });
  }

  const accessToken = session?.user?.accessToken as string | undefined;
  if (!accessToken) {
    return NextResponse.json(
      { error: 'no-google-access', message: 'Sign in with Google again to add a calendar.' },
      { status: 403 }
    );
  }

  const calendar = await new GoogleCalendarService(accessToken, userId).getCalendar(calendarId);
  if (!calendar) {
    return NextResponse.json(
      {
        error: 'not-readable',
        message: 'No calendar with that address, or this account cannot read it.',
      },
      { status: 404 }
    );
  }

  const next = [...followed, { calendarId: calendar.id, summary: calendar.summary }];
  await db.update(users).set({ followedCalendars: next as any }).where(eq(users.id, userId));

  return NextResponse.json({ created: true, calendar });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const calendarId = new URL(req.url).searchParams.get('calendarId');
  if (!calendarId) return NextResponse.json({ error: 'calendarId required' }, { status: 400 });

  const { followed } = await currentUser(userId);
  const next = followed.filter((c) => c?.calendarId !== calendarId);

  await db.update(users).set({ followedCalendars: next as any }).where(eq(users.id, userId));

  return NextResponse.json({ ok: true });
}

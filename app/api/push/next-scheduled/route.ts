import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { getAccessTokenForUser, resolveUserTimezone } from '@/lib/push/google-token';
import { getNextLocalHour, formatInTimezone } from '@/lib/push/timezone';

export const runtime = 'nodejs';

/**
 * When the signed-in user's next briefing will actually arrive.
 *
 * Previously this built the time with setHours() in the server's zone (UTC on
 * Vercel) and then labelled it as local, so the UI confidently displayed "09:00"
 * for a notification that landed at 12:00 Kyiv — masking the real bug. It now
 * resolves the user's own zone and reports the true instant.
 */
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await db
      .select({
        briefingHour: users.briefingHour,
        briefingEnabled: users.briefingEnabled,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const prefs = rows[0];
    if (!prefs?.briefingEnabled) {
      return NextResponse.json({ ok: true, enabled: false, nextScheduled: null });
    }

    const accessToken = await getAccessTokenForUser(userId);
    const tz = await resolveUserTimezone(userId, accessToken);

    const now = new Date();
    const next = getNextLocalHour(now, tz, prefs.briefingHour);
    const minutesUntil = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60000));

    return NextResponse.json({
      ok: true,
      enabled: true,
      timezone: tz,
      briefingHour: prefs.briefingHour,
      nextScheduled: next.toISOString(),
      nextScheduledLocal: formatInTimezone(next, tz),
      minutesUntil,
      hoursUntil: Math.round(minutesUntil / 60),
    });
  } catch (error: any) {
    console.error('[push/next-scheduled] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

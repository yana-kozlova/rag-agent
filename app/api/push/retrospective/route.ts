import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { sendToSubscriptions, validateCronSecret } from '@/lib/push/utils';
import { getAccessTokenForUser, resolveUserTimezone } from '@/lib/push/google-token';
import { getLocalHour, getLocalDateKey, getLocalDayOfWeek } from '@/lib/push/timezone';
import { claimNotification } from '@/lib/push/dedupe';
import {
  fetchWeekEvents,
  fetchWeekNotes,
  generateRetrospective,
  weekStartInstant,
} from '@/lib/push/retrospective';
import { GoogleCalendarService } from '@/lib/services/calendar';

export const runtime = 'nodejs';
// A week of calendars across several sources, plus an LLM call per user.
export const maxDuration = 60;

/** Sunday, in the 0 = Sunday numbering `getLocalDayOfWeek` returns. */
const SUNDAY = 0;

/**
 * Weekly retrospective dispatcher.
 *
 * Same shape as the daily briefing — an hourly cron that decides per user
 * whether it is currently their moment — with one extra filter for the local
 * day of week. The cron must wake on Saturday, Sunday *and* Monday in UTC:
 * somebody's local Sunday starts as early as Saturday 10:00 UTC (UTC+14) and
 * ends as late as Monday 12:00 UTC (UTC-12), so a Sunday-only UTC schedule
 * would silently skip users on both edges of the map.
 */
export async function GET(req: Request) {
  try {
    if (!validateCronSecret(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    const candidates = await db
      .selectDistinct({
        userId: users.id,
        timezone: users.timezone,
        retroHour: users.retroHour,
        retroEnabled: users.retroEnabled,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId));

    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, message: 'No subscriptions found', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const candidate of candidates) {
      try {
        if (!candidate.retroEnabled) {
          skipped++;
          continue;
        }

        const accessToken = await getAccessTokenForUser(candidate.userId);
        const tz = await resolveUserTimezone(
          candidate.userId,
          accessToken,
          candidate.timezone
        );

        // Quiet hours are deliberately not consulted, for the same reason as the
        // briefing: the retro hour is itself an explicit choice by the user.
        if (
          getLocalDayOfWeek(now, tz) !== SUNDAY ||
          getLocalHour(now, tz) !== candidate.retroHour
        ) {
          skipped++;
          continue;
        }

        // Keyed on the local Sunday, so retries and double-fires collapse into
        // the one send — and next Sunday is a different key.
        const dedupeKey = `retro:${getLocalDateKey(now, tz)}`;
        if (!(await claimNotification(candidate.userId, dedupeKey, 'weekly-retro'))) {
          skipped++;
          continue;
        }

        const events = accessToken
          ? await fetchWeekEvents(
              new GoogleCalendarService(accessToken, candidate.userId),
              candidate.userId,
              now,
              tz
            )
          : [];

        const notes = await fetchWeekNotes(
          candidate.userId,
          weekStartInstant(now, tz)
        );

        const retro = await generateRetrospective(candidate.userId, events, notes, tz);

        const subs = await db
          .select({ endpoint: pushSubscriptions.endpoint, keys: pushSubscriptions.keys })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, candidate.userId));

        const { successCount } = await sendToSubscriptions(
          subs.map((s) => ({ endpoint: s.endpoint, keys: s.keys })),
          {
            title: retro.title,
            body: retro.body,
            data: {
              url: '/',
              type: 'weekly-retro',
              weekEnding: getLocalDateKey(now, tz),
              stats: retro.stats,
              snoozeMinutes: 120,
            },
            icon: '/avatars/bot.svg',
            badge: '/avatars/bot.svg',
            tag: 'weekly-retro',
            actions: [
              { action: 'snooze', title: 'Later' },
              { action: 'save-note', title: 'Save' },
            ],
          },
          'push/retrospective'
        );

        sent += successCount;
      } catch (error: any) {
        console.error(`[push/retrospective] Error for user ${candidate.userId}:`, error);
        errors.push(candidate.userId);
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      skipped,
      candidates: candidates.length,
      errors: errors.length,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[push/retrospective] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

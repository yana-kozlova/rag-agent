import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/auth';
import { isNotNull } from 'drizzle-orm';
import { validateCronSecret } from '@/lib/push/utils';
import { deliverToUser } from '@/lib/push/deliver';
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

    // Reachability is a linked Telegram chat, same as the daily briefing.
    const candidates = await db
      .select({
        userId: users.id,
        timezone: users.timezone,
        retroHour: users.retroHour,
        retroEnabled: users.retroEnabled,
        locale: users.locale,
      })
      .from(users)
      .where(isNotNull(users.telegramChatId));

    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, message: 'No linked chats found', sent: 0 });
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

        const retro = await generateRetrospective(
          candidate.userId,
          events,
          notes,
          tz,
          candidate.locale
        );

        const delivered = await deliverToUser(
          candidate.userId,
          {
            title: retro.title,
            body: retro.body,
            actions: ['snooze', 'save'],
            snoozeMinutes: 120,
            data: {
              type: 'weekly-retro',
              weekEnding: getLocalDateKey(now, tz),
              stats: retro.stats,
            },
          },
          'push/retrospective'
        );

        if (delivered === 'sent') sent++;
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

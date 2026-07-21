import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { sendToSubscriptions, validateCronSecret } from '@/lib/push/utils';
import { getAccessTokenForUser, resolveUserTimezone } from '@/lib/push/google-token';
import { getLocalHour, getLocalDateKey } from '@/lib/push/timezone';
import { claimNotification, pruneNotificationLedger } from '@/lib/push/dedupe';
import { generateBriefing, fetchTodayEvents } from '@/lib/push/briefing';
import { fetchDayNotes } from '@/lib/push/day-notes';
import { scanDay } from '@/lib/push/insight-scan';
import { enqueueNotification } from '@/lib/push/queue';
import { GoogleCalendarService } from '@/lib/services/calendar';

export const runtime = 'nodejs';
// Briefing generation fans out over calendars plus an LLM call per user.
export const maxDuration = 60;

/**
 * Daily briefing dispatcher.
 *
 * Invoked hourly by cron. Vercel evaluates cron expressions in UTC and that is
 * not configurable, so the *schedule* does not decide when a user hears from us:
 * the job wakes every hour and sends only to users for whom it is currently
 * their local briefing hour. This is what fixes briefings landing hours late.
 */
export async function GET(req: Request) {
  try {
    if (!validateCronSecret(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // Users who can actually receive a push, with their scheduling preferences.
    const candidates = await db
      .selectDistinct({
        userId: users.id,
        timezone: users.timezone,
        briefingHour: users.briefingHour,
        briefingEnabled: users.briefingEnabled,
        proactiveEnabled: users.proactiveEnabled,
        quietHoursStart: users.quietHoursStart,
        quietHoursEnd: users.quietHoursEnd,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId));

    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, message: 'No subscriptions found', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;
    let queued = 0;
    const errors: string[] = [];

    for (const candidate of candidates) {
      try {
        if (!candidate.briefingEnabled) {
          skipped++;
          continue;
        }

        const accessToken = await getAccessTokenForUser(candidate.userId);
        const tz = await resolveUserTimezone(
          candidate.userId,
          accessToken,
          candidate.timezone
        );

        // Quiet hours are not consulted here on purpose: the briefing hour is
        // itself an explicit choice, so a user who picks one inside their quiet
        // window means it. Silencing it would just look broken.
        //
        // The whole point: compare against the user's wall clock, not the server's.
        if (getLocalHour(now, tz) !== candidate.briefingHour) {
          skipped++;
          continue;
        }

        // One briefing per local day, even if cron double-fires or retries.
        const dedupeKey = `briefing:${getLocalDateKey(now, tz)}`;
        if (!(await claimNotification(candidate.userId, dedupeKey, 'daily-briefing'))) {
          skipped++;
          continue;
        }

        const events = accessToken
          ? await fetchTodayEvents(
              new GoogleCalendarService(accessToken, candidate.userId),
              candidate.userId,
              now,
              tz
            )
          : [];

        // One retrieval, two consumers: the briefing works it into its
        // sentence, the scan matches it against who the user is meeting.
        const notes = await fetchDayNotes(candidate.userId, events);

        const briefing = await generateBriefing(events, tz, notes);

        const subs = await db
          .select({ endpoint: pushSubscriptions.endpoint, keys: pushSubscriptions.keys })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, candidate.userId));

        const { successCount } = await sendToSubscriptions(
          subs.map((s) => ({ endpoint: s.endpoint, keys: s.keys })),
          {
            title: briefing.title,
            body: briefing.body,
            data: {
              url: '/',
              type: 'daily-briefing',
              date: getLocalDateKey(now, tz),
              snoozeMinutes: 60,
            },
            icon: '/avatars/bot.svg',
            badge: '/avatars/bot.svg',
            tag: 'daily-briefing',
            actions: [
              { action: 'snooze', title: 'Later' },
              { action: 'save-note', title: 'Save' },
            ],
          },
          'push/scheduled'
        );

        sent += successCount;

        // Proactive insights ride the same pass: the events and notes are
        // already in hand, so the scan itself costs no further calls. Each one
        // is queued for its own moment rather than sent now — a "no break for
        // four hours" warning is useful ten minutes before, not at breakfast.
        if (candidate.proactiveEnabled) {
          const insights = scanDay({
            events,
            notes,
            now,
            tz,
            quietHours: {
              quietHoursStart: candidate.quietHoursStart,
              quietHoursEnd: candidate.quietHoursEnd,
            },
          });

          for (const insight of insights) {
            // Claimed at scan time, so a re-run of this hour cannot queue the
            // same nudge twice even though nothing has been delivered yet.
            if (!(await claimNotification(candidate.userId, insight.dedupeKey, insight.kind))) {
              continue;
            }

            await enqueueNotification({
              userId: candidate.userId,
              notifyAt: insight.notifyAt,
              payload: insight.payload,
              kind: insight.kind,
            });

            queued++;
          }
        }
      } catch (error: any) {
        console.error(`[push/scheduled] Error for user ${candidate.userId}:`, error);
        errors.push(candidate.userId);
      }
    }

    // Cheap housekeeping so the dedupe ledger stays small.
    await pruneNotificationLedger();

    return NextResponse.json({
      ok: true,
      sent,
      queued,
      skipped,
      candidates: candidates.length,
      errors: errors.length,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[push/scheduled] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

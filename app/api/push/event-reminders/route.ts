import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { users } from '@/lib/db/schema/auth';
import { eq } from 'drizzle-orm';
import { sendToSubscriptions, validateCronSecret } from '@/lib/push/utils';
import { getAccessTokenForUser, resolveUserTimezone } from '@/lib/push/google-token';
import { isQuietNow } from '@/lib/push/quiet-hours';
import { getCalendarIdsForUser } from '@/lib/utils/calendar-conflicts';
import { claimNotification } from '@/lib/push/dedupe';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** How far ahead of an event we want the reminder to land. */
const LEAD_TIME_MS = 15 * 60 * 1000;

/**
 * Width of the "due now" band. Must be at least the cron interval, otherwise
 * events falling between two runs are never picked up. Cron runs hourly, so a
 * 60-minute band means every event gets exactly one chance to match.
 */
const BAND_MS = 60 * 60 * 1000;

/**
 * Remind users about calendar events starting soon.
 *
 * The previous version could never fire: it fetched events in [now+10m, now+20m]
 * but then kept only events starting within 5 minutes — two windows that cannot
 * overlap, so the result was always empty. Fetch range and match range are now
 * derived from the same constants.
 */
export async function GET(req: Request) {
  try {
    if (!validateCronSecret(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // An event is "due" when its start falls in this band ahead of now.
    const dueFrom = now.getTime() + LEAD_TIME_MS - BAND_MS / 2;
    const dueTo = now.getTime() + LEAD_TIME_MS + BAND_MS / 2;

    const subscriptionRows = await db
      .select({
        userId: pushSubscriptions.userId,
        endpoint: pushSubscriptions.endpoint,
        keys: pushSubscriptions.keys,
        timezone: users.timezone,
        remindersEnabled: users.eventRemindersEnabled,
        quietHoursStart: users.quietHoursStart,
        quietHoursEnd: users.quietHoursEnd,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId));

    if (subscriptionRows.length === 0) {
      return NextResponse.json({ ok: true, message: 'No subscriptions found', sent: 0 });
    }

    const subscriptionsByUser = new Map<string, typeof subscriptionRows>();
    for (const sub of subscriptionRows) {
      const list = subscriptionsByUser.get(sub.userId) ?? [];
      list.push(sub);
      subscriptionsByUser.set(sub.userId, list);
    }

    let totalSent = 0;
    let matched = 0;
    let skipped = 0;

    for (const [userId, subscriptions] of subscriptionsByUser) {
      try {
        const prefs = subscriptions[0];

        if (!prefs.remindersEnabled) {
          skipped++;
          continue;
        }

        const accessToken = await getAccessTokenForUser(userId);
        if (!accessToken) {
          console.log(`[push/event-reminders] No access token for user ${userId}, skipping`);
          continue;
        }

        const tz = await resolveUserTimezone(userId, accessToken, prefs.timezone);
        if (isQuietNow(now, tz, prefs)) {
          skipped++;
          continue;
        }

        const calendarService = new GoogleCalendarService(accessToken, userId);
        const calendarIds = await getCalendarIdsForUser(userId);

        const results = await Promise.allSettled(
          calendarIds.map((cid) =>
            calendarService.fetchEvents(cid, {
              timeMin: new Date(dueFrom).toISOString(),
              timeMax: new Date(dueTo).toISOString(),
              maxResults: 20,
              singleEvents: true,
              orderBy: 'startTime',
            })
          )
        );

        const events = results.flatMap((res, i) => {
          if (res.status !== 'fulfilled') return [];
          // Index back into calendarIds: the "Cancel event" action needs to know
          // which calendar the event lives on, or the delete hits the wrong one.
          const calendarId = calendarIds[i];
          return (res.value.items || [])
            .map((event: any) => ({
              id: event.id as string,
              calendarId,
              title: (event.summary as string) || 'Untitled',
              start: (event.start?.dateTime || event.start?.date) as string | undefined,
              // All-day events have no meaningful "starts in N minutes".
              allDay: !event.start?.dateTime,
              location: event.location as string | undefined,
            }))
            .filter((e: any) => e.start && !e.allDay);
        });

        const due = events.filter((event) => {
          const startMs = new Date(event.start!).getTime();
          return startMs >= dueFrom && startMs <= dueTo;
        });

        for (const event of due) {
          matched++;

          // Keyed on start time so a rescheduled event legitimately re-notifies.
          const dedupeKey = `event:${event.id}:${event.start}`;
          if (!(await claimNotification(userId, dedupeKey, 'event-reminder'))) continue;

          const minutesUntil = Math.max(
            0,
            Math.round((new Date(event.start!).getTime() - now.getTime()) / 60000)
          );

          const { successCount } = await sendToSubscriptions(
            subscriptions.map((sub) => ({ endpoint: sub.endpoint, keys: sub.keys })),
            {
              title: '📅 Starting soon',
              body: `${event.title} in ${minutesUntil} min${event.location ? ` · ${event.location}` : ''}`,
              data: {
                url: '/',
                type: 'event-reminder',
                eventId: event.id,
                calendarId: event.calendarId,
                snoozeMinutes: 5,
              },
              icon: '/avatars/bot.svg',
              badge: '/avatars/bot.svg',
              tag: `event-${event.id}`,
              actions: [
                { action: 'snooze', title: 'Snooze 5m' },
                { action: 'delete-event', title: 'Cancel event' },
              ],
            },
            'push/event-reminders'
          );

          totalSent += successCount;
        }
      } catch (error: any) {
        console.error(`[push/event-reminders] Error for user ${userId}:`, error);
      }
    }

    return NextResponse.json({
      ok: true,
      sent: totalSent,
      matched,
      skipped,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[push/event-reminders] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema/push-subscriptions';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { users, accounts } from '@/lib/db/schema/auth';
import { eq, and } from 'drizzle-orm';
import { sendToSubscriptions } from '@/lib/push/utils';
import { OAuth2Client } from 'google-auth-library';

export const runtime = 'nodejs';

/**
 * Get access token for a user, refreshing if needed
 */
async function getAccessTokenForUser(userId: string): Promise<string | null> {
  try {
    // Get user's OAuth account (Google)
    const accountRows = await db
      .select()
      .from(accounts)
      .where(and(
        eq(accounts.userId, userId as any),
        eq(accounts.provider, 'google')
      ))
      .limit(1);

    const account = accountRows[0];
    if (!account || !account.refresh_token) {
      return null;
    }

    // Check if access token is still valid (with 5 minute buffer)
    const now = Math.floor(Date.now() / 1000);
    if (account.access_token && account.expires_at && account.expires_at > now + 300) {
      return account.access_token;
    }

    // Refresh the access token
    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'postmessage'
    );

    oauth2Client.setCredentials({
      refresh_token: account.refresh_token,
    });

    const tokenResponse = await oauth2Client.getAccessToken();
    if (!tokenResponse.token) {
      return null;
    }

    // Update the access token in database
    const expiresAt = tokenResponse.res?.data?.expires_in
      ? now + tokenResponse.res.data.expires_in
      : now + 3600;

    await db
      .update(accounts)
      .set({
        access_token: tokenResponse.token,
        expires_at: expiresAt,
      })
      .where(and(
        eq(accounts.userId, userId as any),
        eq(accounts.provider, 'google')
      ));

    return tokenResponse.token;
  } catch (error) {
    console.error(`[getAccessTokenForUser] Error for user ${userId}:`, error);
    return null;
  }
}

/**
 * Send reminders for upcoming calendar events (15 minutes before start)
 * This should be called by a cron job every 5-10 minutes
 */
export async function GET(req: Request) {
  try {
    // Validate cron secret if configured
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.get('authorization');
      const providedSecret = authHeader?.replace('Bearer ', '') || 
                           new URL(req.url).searchParams.get('secret');
      if (providedSecret !== cronSecret) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      }
    }

    const now = new Date();
    const reminderTime = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes from now
    const timeWindow = 5 * 60 * 1000; // 5 minute window

    // Get all users with push subscriptions
    const allSubscriptions = await db
      .select({
        userId: pushSubscriptions.userId,
        endpoint: pushSubscriptions.endpoint,
        keys: pushSubscriptions.keys,
      })
      .from(pushSubscriptions);

    if (allSubscriptions.length === 0) {
      return NextResponse.json({ ok: true, message: 'No subscriptions found', sent: 0 });
    }

    // Group subscriptions by user
    const subscriptionsByUser = new Map<string, typeof allSubscriptions>();
    for (const sub of allSubscriptions) {
      const userId = sub.userId as string;
      if (!subscriptionsByUser.has(userId)) {
        subscriptionsByUser.set(userId, []);
      }
      subscriptionsByUser.get(userId)!.push(sub);
    }

    let totalSent = 0;

    // Check events for each user
    for (const [userId, subscriptions] of subscriptionsByUser) {
      try {
        // Get user's access token (with automatic refresh if needed)
        const accessToken = await getAccessTokenForUser(userId);
        if (!accessToken) {
          console.log(`[push/event-reminders] No access token for user ${userId}, skipping`);
          continue;
        }

        const userRows = await db.select().from(users).where(eq(users.id, userId as any)).limit(1);
        const user = userRows[0];
        if (!user) continue;

        // Fetch calendar events
        const calendarService = new GoogleCalendarService(accessToken, userId);
        const followed = Array.isArray(user.followedCalendars) ? user.followedCalendars as any[] : [];
        const calendarIds = ['primary', ...followed.map((c: any) => c.calendarId).filter(Boolean)];

        const timeMin = new Date(reminderTime.getTime() - timeWindow).toISOString();
        const timeMax = new Date(reminderTime.getTime() + timeWindow).toISOString();

        const results = await Promise.allSettled(
          calendarIds.map((cid) => 
            calendarService.fetchEvents(cid, {
              timeMin,
              timeMax,
              maxResults: 10,
              singleEvents: true,
              orderBy: 'startTime',
            })
          )
        );

        const events = results.flatMap((res) => {
          if (res.status !== 'fulfilled') return [];
          return (res.value.items || []).map((event: any) => ({
            id: event.id,
            title: event.summary || 'No Title',
            start: event.start?.dateTime || event.start?.date,
            location: event.location,
          }));
        });

        // Filter events that start within the reminder window
        const upcomingEvents = events.filter((event) => {
          const eventStart = new Date(event.start);
          const diff = eventStart.getTime() - now.getTime();
          return diff >= 0 && diff <= timeWindow;
        });

        // Send notification for each upcoming event
        for (const event of upcomingEvents) {
          const eventStart = new Date(event.start);
          const minutesUntil = Math.round((eventStart.getTime() - now.getTime()) / (60 * 1000));
          
          await sendToSubscriptions(
            subscriptions.map((sub) => ({ endpoint: sub.endpoint, keys: sub.keys })),
            {
              title: `📅 Event starting soon`,
              body: `${event.title} in ${minutesUntil} minutes${event.location ? ` at ${event.location}` : ''}`,
              data: { url: '/', type: 'event-reminder', eventId: event.id },
              icon: '/avatars/bot.svg',
              badge: '/avatars/bot.svg',
              tag: `event-${event.id}`,
            },
            'push/event-reminders'
          );
          totalSent++;
        }
      } catch (error: any) {
        console.error(`[push/event-reminders] Error for user ${userId}:`, error);
      }
    }

    return NextResponse.json({
      ok: true,
      sent: totalSent,
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


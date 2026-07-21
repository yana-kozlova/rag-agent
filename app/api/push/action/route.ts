import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/app/api/auth/auth';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { getAccessTokenForUser } from '@/lib/push/google-token';
import { enqueueNotification } from '@/lib/push/queue';
import { createResource } from '@/lib/actions/resources';

export const runtime = 'nodejs';

const actionSchema = z.object({
  action: z.enum(['snooze', 'delete-event', 'save-note', 'dismiss']),
  eventId: z.string().min(1).optional(),
  calendarId: z.string().min(1).optional(),
  title: z.string().max(500).optional(),
  body: z.string().max(2000).optional(),
  /** Snooze delay in minutes; bounded so a crafted payload can't park a job for a year. */
  minutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
});

/**
 * Executes a button pressed on a notification.
 *
 * Called by the service worker, which may be running with no page open. The
 * session cookie still rides along on a same-origin fetch with credentials,
 * so this authenticates exactly like any other route — the action id is never
 * trusted to identify the user.
 */
export async function POST(req: Request) {
  try {
    // The SW posts same-origin; anything else is a cross-site attempt at these
    // side effects, since no legitimate third party calls this.
    const origin = req.headers.get('origin');
    if (origin) {
      const expected = new URL(req.url).origin;
      if (origin !== expected) {
        return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = actionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid action payload' },
        { status: 400 }
      );
    }

    const input = parsed.data;

    switch (input.action) {
      case 'dismiss':
        return NextResponse.json({ ok: true, action: 'dismiss' });

      case 'snooze': {
        const minutes = input.minutes ?? 10;
        const notifyAt = new Date(Date.now() + minutes * 60 * 1000);

        const id = await enqueueNotification({
          userId,
          notifyAt,
          kind: 'snoozed',
          payload: {
            title: input.title || '⏰ Snoozed reminder',
            body: input.body || 'Here it is again.',
            data: {
              url: '/',
              type: 'snoozed',
              eventId: input.eventId,
              calendarId: input.calendarId,
            },
            icon: '/avatars/bot.svg',
            badge: '/avatars/bot.svg',
            tag: input.eventId ? `event-${input.eventId}` : 'snoozed',
          },
        });

        if (!id) {
          return NextResponse.json(
            { ok: false, error: 'Could not schedule snooze' },
            { status: 500 }
          );
        }

        return NextResponse.json({ ok: true, action: 'snooze', notifyAt: notifyAt.toISOString() });
      }

      case 'delete-event': {
        if (!input.eventId) {
          return NextResponse.json(
            { ok: false, error: 'eventId is required' },
            { status: 400 }
          );
        }

        // Background-capable token: the session JWT may be stale by the time a
        // notification is actually tapped, which can be hours after delivery.
        const accessToken = await getAccessTokenForUser(userId);
        if (!accessToken) {
          return NextResponse.json(
            { ok: false, error: 'Calendar access unavailable' },
            { status: 502 }
          );
        }

        const calendarService = new GoogleCalendarService(accessToken, userId);
        await calendarService.deleteEvent(input.calendarId ?? 'primary', input.eventId);

        return NextResponse.json({ ok: true, action: 'delete-event' });
      }

      case 'save-note': {
        const content = input.body?.trim();
        if (!content) {
          return NextResponse.json(
            { ok: false, error: 'body is required' },
            { status: 400 }
          );
        }

        const result = await createResource({
          content,
          title: input.title?.trim() || undefined,
          userId,
        } as any);

        return NextResponse.json({ ok: Boolean(result?.success), action: 'save-note' });
      }
    }
  } catch (error: any) {
    console.error('[push/action] Error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

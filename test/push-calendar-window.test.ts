import { describe, it, expect, vi, beforeEach } from 'vitest';

const getCalendarIdsForUser = vi.fn();

vi.mock('@/lib/utils/calendar-conflicts', () => ({
  getCalendarIdsForUser: (...args: unknown[]) => getCalendarIdsForUser(...args),
}));

import { fetchEventsBetween } from '@/lib/push/calendar-window';
import type { GoogleCalendarService } from '@/lib/services/calendar';

/** A Google Calendar API item, in the shape the mapper actually receives. */
function apiEvent(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    summary: 'Standup',
    start: { dateTime: '2026-07-21T09:00:00+03:00' },
    end: { dateTime: '2026-07-21T09:15:00+03:00' },
    ...over,
  };
}

/** Stubs one fetchEvents result per calendar, in calendar order. */
function serviceReturning(...perCalendar: Array<{ items?: unknown[] } | Error>) {
  let call = 0;
  return {
    fetchEvents: vi.fn(async () => {
      const result = perCalendar[call++];
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as GoogleCalendarService;
}

const WINDOW = ['2026-07-21T00:00:00+03:00', '2026-07-21T23:59:59+03:00'] as const;

beforeEach(() => {
  vi.clearAllMocks();
  getCalendarIdsForUser.mockResolvedValue(['primary', 'team@example.com']);
});

describe('fetchEventsBetween', () => {
  it('tags each event with the calendar it came from', async () => {
    const service = serviceReturning(
      { items: [apiEvent({ id: 'mine' })] },
      { items: [apiEvent({ id: 'theirs' })] }
    );

    const events = await fetchEventsBetween(service, 'user-1', ...WINDOW);

    expect(events.map((e) => [e.id, e.calendarId])).toEqual([
      ['mine', 'primary'],
      ['theirs', 'team@example.com'],
    ]);
  });

  it('keeps calendars aligned when an earlier one fails', async () => {
    // Promise.allSettled holds the rejected slot, so the index must still line
    // up — otherwise a failing primary silently relabels everyone else's events.
    const service = serviceReturning(new Error('403'), {
      items: [apiEvent({ id: 'theirs' })],
    });

    const events = await fetchEventsBetween(service, 'user-1', ...WINDOW);

    expect(events).toHaveLength(1);
    expect(events[0].calendarId).toBe('team@example.com');
  });

  it('carries attendees through', async () => {
    const service = serviceReturning(
      {
        items: [
          apiEvent({
            attendees: [
              { email: 'me@example.com', self: true, responseStatus: 'accepted' },
              { email: 'olena@example.com', displayName: 'Olena' },
            ],
          }),
        ],
      },
      { items: [] }
    );

    const [event] = await fetchEventsBetween(service, 'user-1', ...WINDOW);

    expect(event.attendees).toHaveLength(2);
    expect(event.attendees?.[1]).toMatchObject({ displayName: 'Olena' });
  });

  it('leaves attendees undefined when the event has none', async () => {
    const service = serviceReturning({ items: [apiEvent()] }, { items: [] });

    const [event] = await fetchEventsBetween(service, 'user-1', ...WINDOW);

    expect(event.attendees).toBeUndefined();
  });

  /**
   * The marker is `tentative` rather than `declined` because a declined event
   * is now dropped outright — see `push-calendar-declined.test.ts`, which
   * covers that the drop survives exactly this shape, a status-free copy of the
   * same event sitting on a shared calendar.
   */
  it('prefers the primary copy of an event shared across calendars', async () => {
    // Only the user's own copy carries their responseStatus, so it must win.
    const service = serviceReturning(
      {
        items: [
          apiEvent({ attendees: [{ self: true, responseStatus: 'tentative' }] }),
        ],
      },
      { items: [apiEvent({ attendees: [] })] }
    );

    const events = await fetchEventsBetween(service, 'user-1', ...WINDOW);

    expect(events).toHaveLength(1);
    expect(events[0].calendarId).toBe('primary');
    expect(events[0].attendees?.[0]?.responseStatus).toBe('tentative');
  });

  it('marks all-day events and orders the day by start', async () => {
    const service = serviceReturning(
      {
        items: [
          apiEvent({ id: 'late', start: { dateTime: '2026-07-21T16:00:00+03:00' } }),
          apiEvent({ id: 'holiday', start: { date: '2026-07-21' }, end: { date: '2026-07-22' } }),
        ],
      },
      { items: [] }
    );

    const events = await fetchEventsBetween(service, 'user-1', ...WINDOW);

    expect(events.map((e) => e.id)).toEqual(['holiday', 'late']);
    expect(events[0].allDay).toBe(true);
    expect(events[1].allDay).toBe(false);
  });
});

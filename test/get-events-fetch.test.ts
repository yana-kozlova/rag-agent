import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Three ways the chat's calendar read lied, all of them already fixed once on
 * the notification path and never carried across.
 *
 * A declined invitation stays on the user's calendar and Google keeps returning
 * it, so it was listed as one of the day's commitments. An event shared between
 * two followed calendars came back once per calendar and was listed twice. And
 * a calendar Google refused to answer for contributed nothing, logged nothing
 * and threw nothing — even when every calendar failed, which reached the user
 * as "you have nothing on".
 */

const getCalendarIdsForUser = vi.hoisted(() => vi.fn());
const getSessionOrThrow = vi.hoisted(() => vi.fn());
const fetchEvents = vi.hoisted(() => vi.fn());
const getTimeZone = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/calendar-conflicts', () => ({ getCalendarIdsForUser }));
vi.mock('@/lib/utils/auth', () => ({ getSessionOrThrow }));
vi.mock('@/lib/services/calendar', () => ({
  GoogleCalendarService: class {
    fetchEvents = fetchEvents;
    getTimeZone = getTimeZone;
  },
}));

import { getEventsTool, CalendarUnreadableError } from '@/lib/ai/tools/events/get-events';

/** One item as Google's events.list returns it. */
function item(id: string, hour: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    summary: id,
    start: { dateTime: `2026-08-21T${hour}:00+03:00` },
    end: { dateTime: `2026-08-21T${hour}:00+03:00` },
    ...extra,
  };
}

/** Scripts an answer per calendar id; an Error value is thrown instead. */
function answering(byCalendar: Record<string, unknown>) {
  fetchEvents.mockImplementation(async (cid: string) => {
    const answer = byCalendar[cid];
    if (answer instanceof Error) throw answer;
    return { items: answer ?? [] };
  });
}

const run = () => getEventsTool.execute({ date: '2026-08-21' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  getSessionOrThrow.mockResolvedValue({ user: { id: 'user-1', accessToken: 'tok' } });
  getTimeZone.mockResolvedValue('Europe/Kyiv');
  getCalendarIdsForUser.mockResolvedValue(['primary']);
});

describe('an invitation the user declined', () => {
  it("is not one of the day's events", async () => {
    answering({
      primary: [
        item('standup', '12'),
        item('skipped', '15', { attendees: [{ self: true, responseStatus: 'declined' }] }),
      ],
    });

    const { events } = await run();

    expect(events.map((e) => e.id)).toEqual(['standup']);
  });

  it('stays when it is somebody else who declined', async () => {
    answering({
      primary: [item('review', '12', { attendees: [{ self: false, responseStatus: 'declined' }] })],
    });

    expect((await run()).events).toHaveLength(1);
  });

  /*
   * The reason the filter runs after the de-duplication. Only the copy on the
   * user's own calendar carries their response, so a per-calendar filter drops
   * that one and keeps the shared calendar's status-free twin.
   */
  it('does not survive as the copy from a shared calendar', async () => {
    getCalendarIdsForUser.mockResolvedValue(['primary', 'team@group.calendar.google.com']);
    answering({
      primary: [item('offsite', '14', { attendees: [{ self: true, responseStatus: 'declined' }] })],
      'team@group.calendar.google.com': [item('offsite', '14')],
    });

    expect((await run()).events).toEqual([]);
  });
});

describe('an event on two calendars', () => {
  it("is listed once, as the copy from the user's own calendar", async () => {
    getCalendarIdsForUser.mockResolvedValue(['primary', 'family@group.calendar.google.com']);
    answering({
      primary: [item('birthday', '18')],
      'family@group.calendar.google.com': [item('birthday', '18')],
    });

    const { events, count } = await run();

    expect(count).toBe(1);
    expect(events[0].calendarId).toBe('primary');
  });
});

describe('a calendar Google will not answer for', () => {
  it('costs that calendar and not the question', async () => {
    getCalendarIdsForUser.mockResolvedValue(['primary', 'broken@group.calendar.google.com']);
    answering({
      primary: [item('standup', '12')],
      'broken@group.calendar.google.com': new Error('404'),
    });

    const { events } = await run();

    expect(events.map((e) => e.id)).toEqual(['standup']);
    expect(console.error).toHaveBeenCalled();
  });

  it('throws rather than reporting an empty day when every calendar fails', async () => {
    getCalendarIdsForUser.mockResolvedValue(['primary', 'other@group.calendar.google.com']);
    answering({
      primary: new Error('invalid_grant'),
      'other@group.calendar.google.com': new Error('invalid_grant'),
    });

    await expect(run()).rejects.toBeInstanceOf(CalendarUnreadableError);
  });

  /* An empty calendar is still an answer, and must not be mistaken for one. */
  it('reports an empty day as empty', async () => {
    answering({ primary: [] });

    await expect(run()).resolves.toEqual({ events: [], count: 0 });
  });
});

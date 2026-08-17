import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Two ways the calendar read lied to the briefing.
 *
 * An event the user had declined stayed on their calendar and was printed as a
 * commitment, for a week. And a calendar Google refused to answer for came back
 * as an empty array, which the briefing then reported as "nothing scheduled —
 * your calendar is clear" every morning for five days while the account's
 * refresh token was dead.
 */

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);

vi.mock('@/lib/env.mjs', () => ({
  get env() {
    return envMock;
  },
}));

const getCalendarIdsForUser = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/calendar-conflicts', () => ({ getCalendarIdsForUser }));

import { fetchEventsBetween, isDeclined } from '@/lib/push/calendar-window';

const USER = 'user-1';
const MIN = '2026-08-17T00:00:00+03:00';
const MAX = '2026-08-17T23:59:59+03:00';

/** One item as Google's events.list returns it. */
function item(id: string, hour: string, attendees?: any[]) {
  return {
    id,
    summary: id,
    start: { dateTime: `2026-08-17T${hour}:00+03:00` },
    end: { dateTime: `2026-08-17T${hour}:00+03:00` },
    location: undefined,
    attendees,
  };
}

/** A calendar service whose per-calendar answers are scripted. */
function service(byCalendar: Record<string, any>) {
  return {
    fetchEvents: vi.fn(async (cid: string) => {
      const answer = byCalendar[cid];
      if (answer instanceof Error) throw answer;
      return { items: answer ?? [] };
    }),
  } as any;
}

beforeEach(() => {
  getCalendarIdsForUser.mockReset();
  getCalendarIdsForUser.mockResolvedValue(['primary']);
});

describe('an event the user declined', () => {
  const declined = [{ self: true, responseStatus: 'declined' }];
  const accepted = [{ self: true, responseStatus: 'accepted' }];

  it('is recognised only on the user’s own attendee entry', () => {
    expect(isDeclined({ attendees: declined })).toBe(true);
    expect(isDeclined({ attendees: accepted })).toBe(false);
    // Somebody else declining is not the user declining.
    expect(isDeclined({ attendees: [{ self: false, responseStatus: 'declined' }] })).toBe(false);
    expect(isDeclined({ attendees: undefined })).toBe(false);
  });

  it('never reaches the briefing', async () => {
    const svc = service({
      primary: [item('Standup', '09'), item('Cancelled thing', '11', declined)],
    });

    const events = await fetchEventsBetween(svc, USER, MIN, MAX);

    expect(events.map((e) => e.title)).toEqual(['Standup']);
  });

  /**
   * The copy carrying `responseStatus` is the one on the user's own calendar,
   * so the filter has to run after the merge — dropping per-list would let a
   * shared calendar's status-free copy of the same event survive as the winner.
   */
  it('stays dropped when a shared calendar holds a status-free copy of it', async () => {
    getCalendarIdsForUser.mockResolvedValue(['primary', 'team@group.calendar.google.com']);

    const svc = service({
      primary: [item('Retro', '15', declined)],
      'team@group.calendar.google.com': [item('Retro', '15')],
    });

    expect(await fetchEventsBetween(svc, USER, MIN, MAX)).toEqual([]);
  });
});

describe('a calendar Google will not answer for', () => {
  it('throws rather than reporting an empty day', async () => {
    const svc = service({ primary: new Error('invalid_grant') });

    await expect(fetchEventsBetween(svc, USER, MIN, MAX)).rejects.toThrow(/could not read any/i);
  });

  it('costs only itself when another calendar answered', async () => {
    getCalendarIdsForUser.mockResolvedValue(['primary', 'broken@group.calendar.google.com']);

    const svc = service({
      primary: [item('Standup', '09')],
      'broken@group.calendar.google.com': new Error('404'),
    });

    const events = await fetchEventsBetween(svc, USER, MIN, MAX);

    expect(events.map((e) => e.title)).toEqual(['Standup']);
  });

  it('is not confused with a calendar that answered with nothing', async () => {
    const svc = service({ primary: [] });

    await expect(fetchEventsBetween(svc, USER, MIN, MAX)).resolves.toEqual([]);
  });
});

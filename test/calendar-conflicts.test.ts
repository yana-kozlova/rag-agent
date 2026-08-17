import { describe, it, expect, vi } from 'vitest';

/**
 * Why a whole day became unbookable: an all-day anniversary and a working-hours
 * block marked Free were both read as walls, so 14:30 clashed and every
 * alternative landed on the following evening.
 */

// Every case passes `includeFollowedCalendars: false`, so the db is stubbed
// only to satisfy the import and is never called.
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/db/schema', () => ({ users: {} }));

import {
  findOverlapsForTimeRange,
  isSlotWithinHours,
  suggestAlternativeSlots,
  nonBlockingReason,
} from '@/lib/utils/calendar-conflicts';

const USER = 'user-1';

/** A calendar service that answers with a fixed list, whatever is asked. */
function serviceWith(items: any[]) {
  return {
    fetchEvents: vi.fn().mockResolvedValue({ items }),
  } as any;
}

const timed = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id,
  summary: id,
  status: 'confirmed',
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

const allDay = (id: string, date: string, next: string) => ({
  id,
  summary: id,
  status: 'confirmed',
  start: { date },
  end: { date: next },
});

const WANT_START = '2026-08-17T14:30:00+03:00';
const WANT_END = '2026-08-17T15:00:00+03:00';

describe('nonBlockingReason', () => {
  it('excuses an all-day event', () => {
    expect(nonBlockingReason(allDay('Річниця', '2026-08-17', '2026-08-18') as any)).toBe('all-day');
  });

  it('excuses an event the user marked Free', () => {
    const e = timed('Робочі години', '2026-08-17T08:30:00+03:00', '2026-08-17T18:00:00+03:00', {
      transparency: 'transparent',
    });
    expect(nonBlockingReason(e as any)).toBe('free');
  });

  it('excuses an invitation the user declined', () => {
    const e = timed('Standup', '2026-08-17T14:00:00+03:00', '2026-08-17T15:00:00+03:00', {
      attendees: [{ self: true, responseStatus: 'declined' }],
    });
    expect(nonBlockingReason(e as any)).toBe('declined');
  });

  it('excuses a working-location marker', () => {
    const e = timed('Home', '2026-08-17T00:00:00+03:00', '2026-08-17T23:59:00+03:00', {
      eventType: 'workingLocation',
    });
    expect(nonBlockingReason(e as any)).toBe('working-location');
  });

  it('still blocks an ordinary busy meeting', () => {
    expect(
      nonBlockingReason(timed('Дзвінок', '2026-08-17T14:00:00+03:00', '2026-08-17T15:00:00+03:00') as any)
    ).toBeNull();
  });

  /** Someone else declining says nothing about whether the user is free. */
  it('does not excuse an event another attendee declined', () => {
    const e = timed('Огляд', '2026-08-17T14:00:00+03:00', '2026-08-17T15:00:00+03:00', {
      attendees: [{ self: false, responseStatus: 'declined' }, { self: true, responseStatus: 'accepted' }],
    });
    expect(nonBlockingReason(e as any)).toBeNull();
  });
});

describe('findOverlapsForTimeRange', () => {
  it('reports an anniversary and a Free block as context, not as conflicts', async () => {
    const calendarService = serviceWith([
      allDay('Річниця Андрія та Яни', '2026-08-17', '2026-08-18'),
      timed('Робочі години', '2026-08-17T08:30:00+03:00', '2026-08-17T18:00:00+03:00', {
        transparency: 'transparent',
      }),
    ]);

    const { blocking, nonBlocking } = await findOverlapsForTimeRange({
      calendarService,
      userId: USER,
      startISO: WANT_START,
      endISO: WANT_END,
      includeFollowedCalendars: false,
    });

    expect(blocking).toEqual([]);
    expect(nonBlocking.map((o) => o.reason).sort()).toEqual(['all-day', 'free']);
  });

  it('still reports a real overlapping meeting', async () => {
    const calendarService = serviceWith([
      allDay('Річниця', '2026-08-17', '2026-08-18'),
      timed('Дзвінок з клієнтом', '2026-08-17T14:00:00+03:00', '2026-08-17T15:00:00+03:00'),
    ]);

    const { blocking } = await findOverlapsForTimeRange({
      calendarService,
      userId: USER,
      startISO: WANT_START,
      endISO: WANT_END,
      includeFollowedCalendars: false,
    });

    expect(blocking.map((c) => c.title)).toEqual(['Дзвінок з клієнтом']);
  });
});

describe('suggestAlternativeSlots', () => {
  /** The half that would have survived the other fix: no free minute today. */
  it('offers times on the requested day despite an all-day event', async () => {
    const calendarService = serviceWith([allDay('Річниця', '2026-08-17', '2026-08-18')]);

    const slots = await suggestAlternativeSlots({
      calendarService,
      userId: USER,
      desiredStartISO: WANT_START,
      desiredEndISO: WANT_END,
      includeFollowedCalendars: false,
      maxSuggestions: 3,
    });

    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.start.startsWith('2026-08-17')).toBe(true);
  });

  /**
   * +10:00 so the case survives the host: 09:00 there is 23:00 in UTC and
   * 02:00 in Kyiv, so the old `getHours()` rejected it on CI and on this
   * laptop alike. With +03:00 it would pass locally and fail only in CI.
   */
  it('measures the night in the user offset, not the server one', async () => {
    const calendarService = serviceWith([]);

    const slots = await suggestAlternativeSlots({
      calendarService,
      userId: USER,
      desiredStartISO: '2026-08-17T09:00:00+10:00',
      desiredEndISO: '2026-08-17T09:30:00+10:00',
      includeFollowedCalendars: false,
      maxSuggestions: 1,
      minHour: 7,
      maxHour: 22,
    });

    expect(slots[0]?.start).toBe('2026-08-17T09:00:00+10:00');
  });

  /**
   * `optimizeSchedule` can only pass `.toISOString()`, so the offset read off
   * the string is always `+00:00`. Both 08:00 UTC and 11:00 Kyiv sit inside
   * 7–22, so this passes only if the returned offset is the zone's.
   */
  it('lets an explicit timeZone win over the offset in the string', async () => {
    const calendarService = serviceWith([]);

    const slots = await suggestAlternativeSlots({
      calendarService,
      userId: USER,
      desiredStartISO: '2026-08-17T08:00:00.000Z',
      desiredEndISO: '2026-08-17T08:30:00.000Z',
      includeFollowedCalendars: false,
      maxSuggestions: 1,
      timeZone: 'Europe/Kyiv',
    });

    expect(slots[0]?.start).toBe('2026-08-17T11:00:00+03:00');
  });

  /** The same instant without the zone, to show the difference is the parameter. */
  it('falls back to the string offset when no zone is given', async () => {
    const calendarService = serviceWith([]);

    const slots = await suggestAlternativeSlots({
      calendarService,
      userId: USER,
      desiredStartISO: '2026-08-17T08:00:00.000Z',
      desiredEndISO: '2026-08-17T08:30:00.000Z',
      includeFollowedCalendars: false,
      maxSuggestions: 1,
    });

    expect(slots[0]?.start).toBe('2026-08-17T08:00:00+00:00');
  });
});

/** The hour rule on its own, with no host clock anywhere near it. */
describe('isSlotWithinHours', () => {
  const KYIV = 180;
  const at = (iso: string) => new Date(iso);

  it('accepts a slot inside the day', () => {
    expect(
      isSlotWithinHours({
        start: at('2026-08-17T14:30:00+03:00'),
        end: at('2026-08-17T15:00:00+03:00'),
        offsetMinutes: KYIV,
        minHour: 7,
        maxHour: 22,
      })
    ).toBe(true);
  });

  /** The end is exclusive: finishing at 22:00 is finishing inside the day. */
  it('accepts a slot ending exactly on the cutoff', () => {
    expect(
      isSlotWithinHours({
        start: at('2026-08-17T21:30:00+03:00'),
        end: at('2026-08-17T22:00:00+03:00'),
        offsetMinutes: KYIV,
        minHour: 7,
        maxHour: 22,
      })
    ).toBe(true);
  });

  it('rejects a slot running past the cutoff', () => {
    expect(
      isSlotWithinHours({
        start: at('2026-08-17T21:45:00+03:00'),
        end: at('2026-08-17T22:15:00+03:00'),
        offsetMinutes: KYIV,
        minHour: 7,
        maxHour: 22,
      })
    ).toBe(false);
  });

  it('rejects a slot starting before the morning', () => {
    expect(
      isSlotWithinHours({
        start: at('2026-08-17T06:30:00+03:00'),
        end: at('2026-08-17T07:00:00+03:00'),
        offsetMinutes: KYIV,
        minHour: 7,
        maxHour: 22,
      })
    ).toBe(false);
  });
});

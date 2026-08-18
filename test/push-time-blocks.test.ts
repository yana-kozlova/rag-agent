import { describe, it, expect, vi } from 'vitest';

/**
 * "Working hours 08:30–18:00" is a desired shape for the day, not a commitment.
 * Counted as one it was listed among the day's four tasks and reported as a
 * clash against every meeting inside it — three overlap alerts in one morning,
 * each saying that working during working hours is a problem.
 */

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('@/lib/env.mjs', () => ({ get env() { return envMock; } }));

const getCalendarIdsForUser = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/calendar-conflicts', () => ({ getCalendarIdsForUser }));

import { isTimeBlock } from '@/lib/utils/calendars';
import { fetchEventsBetween } from '@/lib/push/calendar-window';
import { findConflicts } from '@/lib/push/insights';

const USER = 'user-1';
const MIN = '2026-08-18T00:00:00+03:00';
const MAX = '2026-08-18T23:59:59+03:00';

function item(id: string, from: string, to: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    summary: id,
    start: { dateTime: `2026-08-18T${from}:00+03:00` },
    end: { dateTime: `2026-08-18T${to}:00+03:00` },
    ...extra,
  };
}

describe('isTimeBlock', () => {
  it('recognises a block the user marked Free', () => {
    expect(isTimeBlock({ transparency: 'transparent' })).toBe(true);
  });

  it('recognises a working-location marker', () => {
    expect(isTimeBlock({ eventType: 'workingLocation' })).toBe(true);
  });

  it('leaves an ordinary meeting alone', () => {
    expect(isTimeBlock({ transparency: 'opaque', eventType: 'default' })).toBe(false);
    expect(isTimeBlock({})).toBe(false);
  });

  /** Focus time and out-of-office do hold the time; only Free says otherwise. */
  it('does not excuse focus time or out-of-office', () => {
    expect(isTimeBlock({ eventType: 'focusTime' })).toBe(false);
    expect(isTimeBlock({ eventType: 'outOfOffice' })).toBe(false);
  });
});

describe('fetchEventsBetween', () => {
  it('drops the working-hours block and keeps the meetings', async () => {
    getCalendarIdsForUser.mockResolvedValue(['primary']);
    const calendarService = {
      fetchEvents: vi.fn().mockResolvedValue({
        items: [
          item('Working hours', '08:30', '18:00', { transparency: 'transparent' }),
          item('Tribal1 team meeting', '10:00', '10:15'),
          item('Urtime daily meeting', '12:00', '12:30'),
        ],
      }),
    } as any;

    const events = await fetchEventsBetween(calendarService, USER, MIN, MAX);

    expect(events.map((e) => e.title)).toEqual([
      'Tribal1 team meeting',
      'Urtime daily meeting',
    ]);
  });
});

describe('findConflicts', () => {
  const now = new Date('2026-08-18T07:00:00+03:00');

  const asEvent = (id: string, from: string, to: string, extra = {}) => ({
    id,
    calendarId: 'primary',
    title: id,
    start: `2026-08-18T${from}:00+03:00`,
    end: `2026-08-18T${to}:00+03:00`,
    allDay: false,
    ...extra,
  });

  /** The exact morning that produced three alerts. */
  it('raises nothing when meetings merely sit inside working hours', () => {
    const events = [
      asEvent('Working hours', '08:30', '18:00', { transparency: 'transparent' }),
      asEvent('Tribal1 team meeting', '10:00', '10:15'),
      asEvent('Urtime daily meeting', '12:00', '12:30'),
      asEvent('Artem: Justschool', '17:00', '18:00'),
    ];

    expect(findConflicts(events as any, now, 'Europe/Kyiv')).toEqual([]);
  });

  /** Two real meetings on top of each other still have to be reported. */
  it('still raises a genuine double-booking', () => {
    const events = [
      asEvent('Working hours', '08:30', '18:00', { transparency: 'transparent' }),
      asEvent('Tribal1 team meeting', '10:00', '10:30'),
      asEvent('Dentist', '10:15', '11:00'),
    ];

    const conflicts = findConflicts(events as any, now, 'Europe/Kyiv');
    expect(conflicts).toHaveLength(1);
    expect([conflicts[0]!.a.title, conflicts[0]!.b.title].sort()).toEqual([
      'Dentist',
      'Tribal1 team meeting',
    ]);
  });
});

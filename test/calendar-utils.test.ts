import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { groupEventsByDay, isInRange } from '@/app/components/utils/calendar-utils';
import type { CalendarEvent } from '@/types/calendar';

const ev = (id: string, start: string, end: string): CalendarEvent => ({ id, title: id, start, end });

describe('groupEventsByDay', () => {
  it('groups by YYYY-MM-DD key', () => {
    const events = [
      ev('a', '2025-10-29T08:00:00+02:00', '2025-10-29T09:00:00+02:00'),
      ev('b', '2025-10-29T10:00:00+02:00', '2025-10-29T11:00:00+02:00'),
      ev('c', '2025-10-30T08:00:00+02:00', '2025-10-30T09:00:00+02:00'),
    ];
    const grouped = groupEventsByDay(events);
    expect(Object.keys(grouped)).toContain('2025-10-29');
    expect(Object.keys(grouped)).toContain('2025-10-30');
    expect(grouped['2025-10-29']?.map(e => e.id)).toEqual(['a','b']);
    expect(grouped['2025-10-30']?.map(e => e.id)).toEqual(['c']);
  });
});

/**
 * The clock is frozen at midday.
 *
 * `isInRange` compares against `now`, and these cases were built relative to the
 * real one — "today, 00:00 to 23:00" is in range at breakfast and out of it at
 * 23:03, so the suite failed for the last hour of every day and passed for the
 * other twenty-three. A test that depends on when it is run reports the hour,
 * not the code.
 */
describe('isInRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('includes events happening today for range=day', () => {
    const now = new Date();
    const start = new Date(now); start.setHours(0,0,0,0);
    const end = new Date(now); end.setHours(23,0,0,0);
    const e = ev('x', start.toISOString(), end.toISOString());
    expect(isInRange(e, 'day')).toBe(true);
  });

  /** The other edge of the same window: over by now, so out of range. */
  it('excludes an event that has already ended today', () => {
    const start = new Date(); start.setHours(8,0,0,0);
    const end = new Date(); end.setHours(9,0,0,0);
    const e = ev('done', start.toISOString(), end.toISOString());
    expect(isInRange(e, 'day')).toBe(false);
  });

  it('excludes past events outside today for range=day', () => {
    const start = new Date(); start.setDate(start.getDate() - 2);
    const end = new Date(); end.setDate(end.getDate() - 2); end.setHours(1,0,0,0);
    const e = ev('p', start.toISOString(), end.toISOString());
    expect(isInRange(e, 'day')).toBe(false);
  });

  it('includes events within next 7 days for range=week', () => {
    const start = new Date(); start.setDate(start.getDate() + 2);
    const end = new Date(start); end.setHours(start.getHours() + 1);
    const e = ev('w', start.toISOString(), end.toISOString());
    expect(isInRange(e, 'week')).toBe(true);
  });
});



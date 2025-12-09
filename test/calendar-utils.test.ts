import { describe, it, expect } from 'vitest';
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

describe('isInRange', () => {
  it('includes events happening today for range=day', () => {
    const now = new Date();
    const start = new Date(now); start.setHours(0,0,0,0);
    const end = new Date(now); end.setHours(23,0,0,0);
    const e = ev('x', start.toISOString(), end.toISOString());
    expect(isInRange(e, 'day')).toBe(true);
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



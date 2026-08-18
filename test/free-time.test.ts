import { describe, it, expect } from 'vitest';
import { freeTimeByDay, formatDuration } from '@/lib/utils/free-time';

/**
 * "Скільки в мене завтра вільного часу" had no tool behind it — the model was
 * handed a list and left to subtract five pairs of times and sum the rest. The
 * weekday, derived the same way, came back two days out.
 */

const ev = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
  start: `2026-08-19T${from}:00+03:00`,
  end: `2026-08-19T${to}:00+03:00`,
  allDay: false,
  ...extra,
});

describe('freeTimeByDay', () => {
  it('finds the gaps between commitments', () => {
    const [day] = freeTimeByDay([ev('10:00', '10:15'), ev('12:00', '12:30')]);

    expect(day.date).toBe('2026-08-19');
    expect(day.windows.map((w) => `${w.from}-${w.to}`)).toEqual([
      '08:00-10:00',
      '10:15-12:00',
      '12:30-22:00',
    ]);
    expect(day.totalMinutes).toBe(120 + 105 + 570);
  });

  /** The reported day: a working-hours block must not swallow it. */
  it('ignores a block marked Free', () => {
    const [day] = freeTimeByDay([
      ev('08:30', '18:00', { transparency: 'transparent' }),
      ev('12:00', '12:30'),
    ]);

    expect(day.totalMinutes).toBe(14 * 60 - 30);
  });

  it('ignores all-day events and declined invitations', () => {
    const [day] = freeTimeByDay([
      { start: '2026-08-19', end: '2026-08-20', allDay: true },
      ev('10:00', '11:00', { attendees: [{ self: true, responseStatus: 'declined' }] }),
    ]);

    expect(day.windows).toEqual([{ from: '08:00', to: '22:00', minutes: 840 }]);
  });

  /** Two meetings sharing a minute must not manufacture a window. */
  it('merges overlapping and touching events', () => {
    const [day] = freeTimeByDay([
      ev('10:00', '11:00'),
      ev('10:30', '12:00'),
      ev('12:00', '13:00'),
    ]);

    expect(day.windows.map((w) => `${w.from}-${w.to}`)).toEqual(['08:00-10:00', '13:00-22:00']);
  });

  /** A turnaround between two things is not a gap worth naming. */
  it('drops windows under a quarter of an hour', () => {
    const [day] = freeTimeByDay([ev('10:00', '11:00'), ev('11:10', '12:00')]);

    expect(day.windows.some((w) => w.from === '11:00')).toBe(false);
  });

  it('clips to waking hours', () => {
    const [day] = freeTimeByDay([ev('06:00', '07:00'), ev('23:00', '23:30')]);

    expect(day.windows).toEqual([{ from: '08:00', to: '22:00', minutes: 840 }]);
  });

  it('keeps days apart and in order', () => {
    const days = freeTimeByDay([
      { start: '2026-08-20T10:00:00+03:00', end: '2026-08-20T11:00:00+03:00', allDay: false },
      { start: '2026-08-19T10:00:00+03:00', end: '2026-08-19T11:00:00+03:00', allDay: false },
    ]);

    expect(days.map((d) => d.date)).toEqual(['2026-08-19', '2026-08-20']);
  });

  /**
   * The times are read out of the offset the event carries, never through
   * `Date` — which answers in the server's zone and would shift every window.
   */
  it('reads the clock from the event offset', () => {
    const [day] = freeTimeByDay([
      { start: '2026-08-19T10:00:00-05:00', end: '2026-08-19T11:00:00-05:00', allDay: false },
    ]);

    expect(day.windows[0]).toEqual({ from: '08:00', to: '10:00', minutes: 120 });
  });

  it('says nothing about a day with no events', () => {
    expect(freeTimeByDay([])).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('writes the duration the way the reply says it', () => {
    expect(formatDuration(45)).toBe('45 хв');
    expect(formatDuration(120)).toBe('2 год');
    expect(formatDuration(105)).toBe('1 год 45 хв');
  });
});

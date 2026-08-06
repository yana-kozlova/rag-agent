import { describe, it, expect } from 'vitest';
import { isQuietHour, isQuietNow } from '@/lib/push/quiet-hours';

describe('isQuietHour', () => {
  it('is inactive when either bound is missing', () => {
    expect(isQuietHour(23, null, 8)).toBe(false);
    expect(isQuietHour(23, 22, null)).toBe(false);
    expect(isQuietHour(23, null, null)).toBe(false);
    expect(isQuietHour(23, undefined, undefined)).toBe(false);
  });

  describe('window that does not cross midnight (9 → 17)', () => {
    it('includes the start hour', () => {
      expect(isQuietHour(9, 9, 17)).toBe(true);
    });

    it('excludes the end hour', () => {
      expect(isQuietHour(17, 9, 17)).toBe(false);
    });

    it('covers the middle', () => {
      expect(isQuietHour(13, 9, 17)).toBe(true);
    });

    it('excludes hours outside', () => {
      expect(isQuietHour(8, 9, 17)).toBe(false);
      expect(isQuietHour(22, 9, 17)).toBe(false);
      expect(isQuietHour(0, 9, 17)).toBe(false);
    });
  });

  describe('window crossing midnight (22 → 8)', () => {
    it('covers late evening', () => {
      expect(isQuietHour(22, 22, 8)).toBe(true);
      expect(isQuietHour(23, 22, 8)).toBe(true);
    });

    it('covers past midnight', () => {
      expect(isQuietHour(0, 22, 8)).toBe(true);
      expect(isQuietHour(3, 22, 8)).toBe(true);
      expect(isQuietHour(7, 22, 8)).toBe(true);
    });

    it('excludes the end hour, so an 08:00 briefing still arrives', () => {
      expect(isQuietHour(8, 22, 8)).toBe(false);
    });

    it('excludes daytime', () => {
      expect(isQuietHour(9, 22, 8)).toBe(false);
      expect(isQuietHour(15, 22, 8)).toBe(false);
      expect(isQuietHour(21, 22, 8)).toBe(false);
    });
  });

  it('treats start === end as no window rather than silencing all day', () => {
    for (let h = 0; h < 24; h++) {
      expect(isQuietHour(h, 10, 10)).toBe(false);
    }
  });

  it('covers exactly the expected number of hours', () => {
    const count = (start: number, end: number) =>
      Array.from({ length: 24 }, (_, h) => h).filter((h) => isQuietHour(h, start, end)).length;

    expect(count(22, 8)).toBe(10);
    expect(count(9, 17)).toBe(8);
    expect(count(0, 1)).toBe(1);
    expect(count(23, 0)).toBe(1);
  });
});

describe('isQuietNow', () => {
  const prefs = { quietHoursStart: 22, quietHoursEnd: 8 };

  it('resolves against the user zone, not the server zone', () => {
    // One instant, three verdicts — this is the whole reason quiet hours are
    // evaluated per user rather than off the server clock.
    // 04:00 UTC = 07:00 Kyiv (quiet), 21:00 the previous day in Los Angeles
    // (not yet quiet), 13:00 in Tokyo (not quiet).
    const instant = new Date('2026-07-21T04:00:00Z');

    expect(isQuietNow(instant, 'Europe/Kyiv', prefs)).toBe(true);
    expect(isQuietNow(instant, 'America/Los_Angeles', prefs)).toBe(false);
    expect(isQuietNow(instant, 'Asia/Tokyo', prefs)).toBe(false);
  });

  it('silences a zone west of UTC once its own night begins', () => {
    // 06:00 UTC = 23:00 the previous day in Los Angeles (quiet), while Kyiv
    // is already at 09:00 and past its window.
    const instant = new Date('2026-07-21T06:00:00Z');

    expect(isQuietNow(instant, 'America/Los_Angeles', prefs)).toBe(true);
    expect(isQuietNow(instant, 'Europe/Kyiv', prefs)).toBe(false);
  });

  it('lets a notification through once local time leaves the window', () => {
    // 06:00 UTC is 09:00 Kyiv, past the 08:00 end.
    expect(isQuietNow(new Date('2026-07-21T06:00:00Z'), 'Europe/Kyiv', prefs)).toBe(false);
  });

  it('is never quiet when the user has no window configured', () => {
    const none = { quietHoursStart: null, quietHoursEnd: null };
    for (let h = 0; h < 24; h++) {
      const instant = new Date(Date.UTC(2026, 6, 21, h));
      expect(isQuietNow(instant, 'Europe/Kyiv', none)).toBe(false);
    }
  });
});

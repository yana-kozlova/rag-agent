import { describe, it, expect } from 'vitest';
import {
  getLocalHour,
  getLocalDateKey,
  getLocalDayOfWeek,
  getLocalParts,
  getUtcOffsetMinutes,
  getNextLocalHour,
  addLocalDays,
  isValidTimezone,
  DEFAULT_TIMEZONE,
} from '@/lib/push/timezone';

describe('isValidTimezone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimezone('Europe/Kyiv')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('rejects junk and empty values', () => {
    expect(isValidTimezone('Not/AZone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });
});

describe('getLocalHour', () => {
  // These are the cases that produced the original bug: the server sees one
  // hour, the user sees another, and the code used the server's.
  it('reports the user hour, not the UTC hour, during EEST (+03:00)', () => {
    const instant = new Date('2026-07-21T09:00:00Z');
    expect(instant.getUTCHours()).toBe(9);
    expect(getLocalHour(instant, 'Europe/Kyiv')).toBe(12);
  });

  it('reports the user hour during EET (+02:00)', () => {
    const instant = new Date('2026-01-21T09:00:00Z');
    expect(getLocalHour(instant, 'Europe/Kyiv')).toBe(11);
  });

  it('maps 06:00 UTC to 09:00 Kyiv in summer', () => {
    expect(getLocalHour(new Date('2026-07-21T06:00:00Z'), 'Europe/Kyiv')).toBe(9);
  });

  it('handles zones behind UTC', () => {
    expect(getLocalHour(new Date('2026-07-21T12:00:00Z'), 'America/New_York')).toBe(8);
  });

  it('handles half-hour offset zones', () => {
    expect(getLocalHour(new Date('2026-07-21T06:00:00Z'), 'Asia/Kolkata')).toBe(11);
  });

  it('uses a 24-hour clock rather than wrapping at noon', () => {
    expect(getLocalHour(new Date('2026-07-21T21:00:00Z'), 'UTC')).toBe(21);
    expect(getLocalHour(new Date('2026-07-21T00:00:00Z'), 'UTC')).toBe(0);
  });
});

describe('getLocalDateKey', () => {
  it('rolls to the next local day when UTC is still on the previous one', () => {
    // 22:30 UTC is already 01:30 the next day in Kyiv.
    const instant = new Date('2026-07-21T22:30:00Z');
    expect(getLocalDateKey(instant, 'UTC')).toBe('2026-07-21');
    expect(getLocalDateKey(instant, 'Europe/Kyiv')).toBe('2026-07-22');
  });

  it('stays on the previous local day for zones behind UTC', () => {
    const instant = new Date('2026-07-21T02:00:00Z');
    expect(getLocalDateKey(instant, 'America/New_York')).toBe('2026-07-20');
  });

  it('zero-pads month and day', () => {
    expect(getLocalDateKey(new Date('2026-01-05T12:00:00Z'), 'UTC')).toBe('2026-01-05');
  });
});

describe('getUtcOffsetMinutes', () => {
  it('tracks DST for Kyiv', () => {
    expect(getUtcOffsetMinutes(new Date('2026-07-21T12:00:00Z'), 'Europe/Kyiv')).toBe(180);
    expect(getUtcOffsetMinutes(new Date('2026-01-21T12:00:00Z'), 'Europe/Kyiv')).toBe(120);
  });

  it('returns negative offsets west of Greenwich', () => {
    expect(getUtcOffsetMinutes(new Date('2026-07-21T12:00:00Z'), 'America/New_York')).toBe(-240);
  });

  it('returns zero for UTC', () => {
    expect(getUtcOffsetMinutes(new Date('2026-07-21T12:00:00Z'), 'UTC')).toBe(0);
  });
});

describe('getNextLocalHour', () => {
  it('finds the next occurrence of the target local hour', () => {
    const now = new Date('2026-07-21T05:00:00Z'); // 08:00 Kyiv
    const next = getNextLocalHour(now, 'Europe/Kyiv', 9);
    expect(getLocalHour(next, 'Europe/Kyiv')).toBe(9);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('rolls to tomorrow when the hour already passed today', () => {
    const now = new Date('2026-07-21T12:00:00Z'); // 15:00 Kyiv
    const next = getNextLocalHour(now, 'Europe/Kyiv', 9);
    expect(getLocalHour(next, 'Europe/Kyiv')).toBe(9);
    expect(getLocalDateKey(next, 'Europe/Kyiv')).toBe('2026-07-22');
  });

  it('lands on the top of the hour', () => {
    const now = new Date('2026-07-21T05:37:00Z');
    const next = getNextLocalHour(now, 'Europe/Kyiv', 9);
    expect(getLocalParts(next, 'Europe/Kyiv').minute).toBe(0);
  });

  it('always returns a future instant within 48 hours', () => {
    const now = new Date('2026-07-21T05:00:00Z');
    for (let hour = 0; hour < 24; hour++) {
      const next = getNextLocalHour(now, 'Europe/Kyiv', hour);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(48 * 3600 * 1000);
      expect(getLocalHour(next, 'Europe/Kyiv')).toBe(hour);
    }
  });
});

describe('briefing dispatch window', () => {
  // The regression guard for the original report: with an hourly cron and a
  // per-user local-hour check, a Kyiv user with briefingHour=9 must be sent to
  // exactly once per day, at 06:00 UTC in summer — not at 09:00 UTC.
  it('fires exactly once per day, at the user local hour', () => {
    const tz = 'Europe/Kyiv';
    const briefingHour = 9;
    const firedAt: string[] = [];

    for (let h = 0; h < 24; h++) {
      const tick = new Date(Date.UTC(2026, 6, 21, h, 0, 0));
      if (getLocalHour(tick, tz) === briefingHour) {
        firedAt.push(tick.toISOString());
      }
    }

    expect(firedAt).toEqual(['2026-07-21T06:00:00.000Z']);
  });

  it('shifts with DST without any code change', () => {
    const tz = 'Europe/Kyiv';
    const firedAt: string[] = [];

    for (let h = 0; h < 24; h++) {
      const tick = new Date(Date.UTC(2026, 0, 21, h, 0, 0));
      if (getLocalHour(tick, tz) === 9) firedAt.push(tick.toISOString());
    }

    // Winter: 09:00 Kyiv is 07:00 UTC, one hour later than in summer.
    expect(firedAt).toEqual(['2026-01-21T07:00:00.000Z']);
  });

  it('sends to each zone at its own local 9am', () => {
    const zones = ['Europe/Kyiv', 'America/New_York', 'Asia/Tokyo'];
    const fired = new Map<string, number>();

    for (let h = 0; h < 24; h++) {
      const tick = new Date(Date.UTC(2026, 6, 21, h, 0, 0));
      for (const tz of zones) {
        if (getLocalHour(tick, tz) === 9) {
          fired.set(tz, (fired.get(tz) ?? 0) + 1);
        }
      }
    }

    for (const tz of zones) {
      expect(fired.get(tz)).toBe(1);
    }
  });
});

describe('getLocalDayOfWeek', () => {
  it('uses Sunday = 0 numbering', () => {
    // 2026-07-19 is a Sunday.
    expect(getLocalDayOfWeek(new Date('2026-07-19T12:00:00Z'), 'UTC')).toBe(0);
    expect(getLocalDayOfWeek(new Date('2026-07-20T12:00:00Z'), 'UTC')).toBe(1);
    expect(getLocalDayOfWeek(new Date('2026-07-25T12:00:00Z'), 'UTC')).toBe(6);
  });

  it('reports the user day, not the UTC day, across the date line', () => {
    // Still Saturday in UTC, already Sunday in Auckland.
    const instant = new Date('2026-07-18T20:00:00Z');
    expect(getLocalDayOfWeek(instant, 'UTC')).toBe(6);
    expect(getLocalDayOfWeek(instant, 'Pacific/Auckland')).toBe(0);
  });

  it('reports the previous day for zones behind UTC', () => {
    // Monday in UTC, still Sunday in Honolulu.
    const instant = new Date('2026-07-20T05:00:00Z');
    expect(getLocalDayOfWeek(instant, 'UTC')).toBe(1);
    expect(getLocalDayOfWeek(instant, 'Pacific/Honolulu')).toBe(0);
  });
});

describe('addLocalDays', () => {
  it('walks back a week to the same weekday', () => {
    expect(addLocalDays(new Date('2026-07-19T18:00:00Z'), 'UTC', -6)).toBe('2026-07-13');
  });

  it('crosses month and year boundaries', () => {
    expect(addLocalDays(new Date('2026-01-03T12:00:00Z'), 'UTC', -6)).toBe('2025-12-28');
    expect(addLocalDays(new Date('2026-03-02T12:00:00Z'), 'UTC', -6)).toBe('2026-02-24');
  });

  it('counts calendar days, not 24-hour spans, across a DST change', () => {
    // Kyiv springs forward on 2026-03-29. Six calendar days before Sunday the
    // 29th is Monday the 23rd, even though 6x24h lands an hour short.
    const sundayEvening = new Date('2026-03-29T16:00:00Z'); // 19:00 Kyiv
    expect(getLocalDayOfWeek(sundayEvening, 'Europe/Kyiv')).toBe(0);
    expect(addLocalDays(sundayEvening, 'Europe/Kyiv', -6)).toBe('2026-03-23');
  });

  it('stays on the local date for zones where UTC has already rolled over', () => {
    // 23:00 in New York, already the next day in UTC.
    const instant = new Date('2026-07-20T03:00:00Z');
    expect(addLocalDays(instant, 'America/New_York', 0)).toBe('2026-07-19');
    expect(addLocalDays(instant, 'UTC', 0)).toBe('2026-07-20');
  });
});

describe('weekly retrospective dispatch window', () => {
  const tz = 'Europe/Kyiv';
  const retroHour = 19;

  const isRetroTick = (tick: Date, zone: string, hour: number) =>
    getLocalDayOfWeek(tick, zone) === 0 && getLocalHour(tick, zone) === hour;

  it('fires exactly once a week, on the user local Sunday evening', () => {
    const fired: string[] = [];

    // A full week of hourly ticks, Saturday through Monday and beyond.
    for (let h = 0; h < 24 * 7; h++) {
      const tick = new Date(Date.UTC(2026, 6, 18, h, 0, 0));
      if (isRetroTick(tick, tz, retroHour)) fired.push(tick.toISOString());
    }

    // 19:00 Kyiv on Sunday 2026-07-19 is 16:00 UTC in summer.
    expect(fired).toEqual(['2026-07-19T16:00:00.000Z']);
  });

  it('reaches zones whose local Sunday falls outside UTC Sunday', () => {
    // The regression guard for the cron schedule: Auckland's Sunday evening is
    // Sunday morning UTC, Honolulu's is Monday UTC. A Sunday-only UTC cron
    // would deliver to neither on time.
    const zones = ['Pacific/Auckland', 'Pacific/Honolulu', 'America/New_York', 'Asia/Tokyo'];
    const firedOn = new Map<string, string[]>();

    // Ticks across Saturday, Sunday and Monday UTC — what the cron actually runs.
    for (let h = 0; h < 24 * 3; h++) {
      const tick = new Date(Date.UTC(2026, 6, 18, h, 0, 0));
      const utcDay = getLocalDayOfWeek(tick, 'UTC');
      if (![6, 0, 1].includes(utcDay)) continue;

      for (const zone of zones) {
        if (isRetroTick(tick, zone, retroHour)) {
          firedOn.set(zone, [...(firedOn.get(zone) ?? []), tick.toISOString()]);
        }
      }
    }

    for (const zone of zones) {
      expect(firedOn.get(zone)).toHaveLength(1);
    }

    // And specifically: the two edge zones land on non-Sunday UTC days.
    expect(getLocalDayOfWeek(new Date(firedOn.get('Pacific/Honolulu')![0]), 'UTC')).toBe(1);
  });

  it('does not fire on any other weekday', () => {
    for (let h = 0; h < 24 * 7; h++) {
      const tick = new Date(Date.UTC(2026, 6, 20, h, 0, 0)); // starts Monday
      if (getLocalDayOfWeek(tick, tz) !== 0) {
        expect(isRetroTick(tick, tz, retroHour)).toBe(false);
      }
    }
  });

  it('produces one dedupe key per local week', () => {
    const keys = new Set<string>();

    for (let week = 0; week < 4; week++) {
      const sunday = new Date(Date.UTC(2026, 6, 19 + week * 7, 16, 0, 0));
      keys.add(`retro:${getLocalDateKey(sunday, tz)}`);
    }

    expect(keys.size).toBe(4);
  });
});

describe('DEFAULT_TIMEZONE', () => {
  it('is a zone this runtime understands', () => {
    expect(isValidTimezone(DEFAULT_TIMEZONE)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';

import { localDateTimeToIso } from '@/lib/push/timezone';

describe('localDateTimeToIso', () => {
  it('carries the zone offset, not the server default', () => {
    expect(localDateTimeToIso('2026-08-18', '09:00', 'Europe/Kyiv')).toBe(
      '2026-08-18T09:00:00+03:00'
    );
  });

  it('uses the offset in force on that date, not today', () => {
    // Kyiv is +02:00 in January and +03:00 in July. A helper that took the
    // offset at `new Date()` would file one of these an hour out.
    expect(localDateTimeToIso('2026-01-15', '09:00', 'Europe/Kyiv')).toBe(
      '2026-01-15T09:00:00+02:00'
    );
    expect(localDateTimeToIso('2026-07-15', '09:00', 'Europe/Kyiv')).toBe(
      '2026-07-15T09:00:00+03:00'
    );
  });

  it('handles zones west of Greenwich', () => {
    expect(localDateTimeToIso('2026-08-18', '09:00', 'America/New_York')).toBe(
      '2026-08-18T09:00:00-04:00'
    );
  });

  it('handles a half-hour zone', () => {
    expect(localDateTimeToIso('2026-08-18', '09:00', 'Asia/Kolkata')).toBe(
      '2026-08-18T09:00:00+05:30'
    );
  });

  it('handles UTC itself without inventing an offset', () => {
    expect(localDateTimeToIso('2026-08-18', '09:00', 'UTC')).toBe('2026-08-18T09:00:00+00:00');
  });

  // The fixpoint pass earns its keep on exactly these two days a year: the
  // first guess is taken at the same wall time in UTC, which on a transition
  // day can land on the far side of the boundary and report the wrong offset.
  describe('around a DST transition', () => {
    it('is correct late on the evening before spring-forward', () => {
      // Kyiv springs forward 2026-03-29 at 03:00 local, +02:00 → +03:00.
      expect(localDateTimeToIso('2026-03-28', '23:30', 'Europe/Kyiv')).toBe(
        '2026-03-28T23:30:00+02:00'
      );
    });

    it('is correct after the jump on the transition day', () => {
      expect(localDateTimeToIso('2026-03-29', '10:00', 'Europe/Kyiv')).toBe(
        '2026-03-29T10:00:00+03:00'
      );
    });

    it('is correct before the jump on the transition day', () => {
      expect(localDateTimeToIso('2026-03-29', '01:00', 'Europe/Kyiv')).toBe(
        '2026-03-29T01:00:00+02:00'
      );
    });

    it('is correct after fall-back', () => {
      // Kyiv falls back 2026-10-25 at 04:00 local, +03:00 → +02:00.
      expect(localDateTimeToIso('2026-10-25', '10:00', 'Europe/Kyiv')).toBe(
        '2026-10-25T10:00:00+02:00'
      );
    });
  });

  it('accepts a time that already carries seconds', () => {
    expect(localDateTimeToIso('2026-08-18', '09:00:30', 'Europe/Kyiv')).toBe(
      '2026-08-18T09:00:30+03:00'
    );
  });

  it('produces a string Date parses back to the intended instant', () => {
    const iso = localDateTimeToIso('2026-08-18', '09:00', 'Europe/Kyiv');
    expect(new Date(iso).toISOString()).toBe('2026-08-18T06:00:00.000Z');
  });

  it('never returns +00:00 for a real zone, which scheduleEvent rejects', () => {
    for (const day of ['2026-01-15', '2026-07-15']) {
      expect(localDateTimeToIso(day, '09:00', 'Europe/Kyiv')).not.toContain('+00:00');
    }
  });
});

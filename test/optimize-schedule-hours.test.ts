import { describe, it, expect, vi } from 'vitest';

/**
 * Whose working day the optimizer is rearranging. `workDayStartHour`/`EndHour`
 * are the *user's* hours, and the check read the server's clock — so
 * "inside 09:00–18:00" was enforced three hours behind them.
 */

vi.mock('@/lib/utils/auth', () => ({ getSessionOrThrow: vi.fn(), parseInputOrThrow: vi.fn() }));
vi.mock('@/lib/services/calendar', () => ({ GoogleCalendarService: class {} }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/db/schema', () => ({ users: {} }));

import { withinWorkingHours } from '@/lib/ai/tools/events/optimize-schedule';

const KYIV = 'Europe/Kyiv';

describe('withinWorkingHours', () => {
  it('accepts an hour inside the user working day', () => {
    // 11:00 in Kyiv.
    expect(withinWorkingHours(new Date('2026-08-17T08:00:00Z'), 9, 18, KYIV)).toBe(true);
  });

  /** 06:00 UTC is 09:00 in Kyiv — inside the day for the user, outside for the server. */
  it('accepts the start of the user day even when the server is still before it', () => {
    expect(withinWorkingHours(new Date('2026-08-17T06:00:00Z'), 9, 18, KYIV)).toBe(true);
  });

  /** 16:00 UTC is 19:00 in Kyiv — the server would have called this 16:00 and allowed it. */
  it('rejects an hour past the end of the user day', () => {
    expect(withinWorkingHours(new Date('2026-08-17T16:00:00Z'), 9, 18, KYIV)).toBe(false);
  });

  it('counts minutes, not only whole hours', () => {
    // 18:30 Kyiv, past an 18:00 close.
    expect(withinWorkingHours(new Date('2026-08-17T15:30:00Z'), 9, 18, KYIV)).toBe(false);
    // 18:00 Kyiv exactly, which the inclusive end admits.
    expect(withinWorkingHours(new Date('2026-08-17T15:00:00Z'), 9, 18, KYIV)).toBe(true);
  });

  /** Kyiv is +02:00 in January and +03:00 in August; fixed-offset arithmetic gets one wrong. */
  it('follows the zone across a DST change', () => {
    // 16:00 UTC is 18:00 in Kyiv in January and 19:00 in August.
    expect(withinWorkingHours(new Date('2026-01-17T16:00:00Z'), 9, 18, KYIV)).toBe(true);
    expect(withinWorkingHours(new Date('2026-08-17T16:00:00Z'), 9, 18, KYIV)).toBe(false);
  });
});

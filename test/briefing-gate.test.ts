import { describe, it, expect } from 'vitest';
import { isBriefingDue } from '@/lib/push/briefing-gate';

// 09:00 in Kyiv (UTC+3 in July) is 06:00 UTC.
const NINE_AM_KYIV = new Date('2026-07-22T06:00:00Z');

describe('isBriefingDue', () => {
  it('is due when the stored local hour matches', () => {
    expect(isBriefingDue({ timezone: 'Europe/Kyiv', briefingHour: 9, briefingEnabled: true }, NINE_AM_KYIV)).toBe(true);
  });

  it('is not due an hour off', () => {
    expect(isBriefingDue({ timezone: 'Europe/Kyiv', briefingHour: 10, briefingEnabled: true }, NINE_AM_KYIV)).toBe(false);
  });

  it('respects each timezone at the same instant', () => {
    // At 06:00 UTC it is 07:00 in London (BST), not 09:00 — the same run serves
    // Kyiv's 09:00 and London's 07:00 without a second schedule.
    expect(isBriefingDue({ timezone: 'Europe/London', briefingHour: 9, briefingEnabled: true }, NINE_AM_KYIV)).toBe(false);
    expect(isBriefingDue({ timezone: 'Europe/London', briefingHour: 7, briefingEnabled: true }, NINE_AM_KYIV)).toBe(true);
  });

  it('is never due when disabled, whatever the hour', () => {
    expect(isBriefingDue({ timezone: 'Europe/Kyiv', briefingHour: 9, briefingEnabled: false }, NINE_AM_KYIV)).toBe(false);
  });

  it('defers unknown-timezone users to the worker (treated as due)', () => {
    expect(isBriefingDue({ timezone: null, briefingHour: 9, briefingEnabled: true }, NINE_AM_KYIV)).toBe(true);
    expect(isBriefingDue({ timezone: 'Not/AZone', briefingHour: 9, briefingEnabled: true }, NINE_AM_KYIV)).toBe(true);
  });
});

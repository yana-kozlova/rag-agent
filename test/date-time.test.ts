import { describe, it, expect } from 'vitest';
import { getLocalDateKey, normalizeTimesToLocal } from '@/app/components/utils/date-time';

describe('getLocalDateKey', () => {
  it('returns YYYY-MM-DD for a given date', () => {
    const d = new Date('2025-03-05T12:34:00Z');
    const key = getLocalDateKey(d);
    // Only assert shape; timezone can alter exact day if using local time
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pads month and day with leading zeros', () => {
    const d = new Date(2025, 0, 9); // Jan (0), 09
    const key = getLocalDateKey(d);
    expect(key.endsWith('-01-09')).toBe(true);
  });
});

describe('normalizeTimesToLocal', () => {
  it('returns input if not a string', () => {
    // @ts-expect-error testing runtime behavior
    expect(normalizeTimesToLocal(undefined)).toBeUndefined();
  });

  it('leaves text without ISO timestamps unchanged', () => {
    const txt = 'No dates here';
    expect(normalizeTimesToLocal(txt)).toBe(txt);
  });

  it('replaces ISO timestamps with localized strings', () => {
    const txt = 'Start 2025-10-29T08:00:00+02:00 end 2025-10-29T09:30:00+02:00';
    const out = normalizeTimesToLocal(txt);
    expect(out).not.toContain('2025-10-29T08:00:00+02:00');
    expect(out).not.toContain('2025-10-29T09:30:00+02:00');
    // Should contain a localized month/day with time and possibly TZ name
    expect(out).toMatch(/\d{2}\/.+|\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}/);
  });

  it('skips invalid dates', () => {
    const txt = 'Broken 2025-13-40T99:99:99Z date';
    const out = normalizeTimesToLocal(txt);
    expect(out).toBe(txt);
  });
});



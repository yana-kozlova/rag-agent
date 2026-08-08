import { describe, it, expect } from 'vitest';

import {
  calendarIdsFor,
  isOwnPrimary,
  mergeCalendarState,
  type AccountCalendar,
} from '@/lib/utils/calendars';

const cal = (
  id: string,
  summary: string,
  extra: Partial<Omit<AccountCalendar, 'followed'>> = {}
): Omit<AccountCalendar, 'followed'> => ({
  id,
  summary,
  description: null,
  primary: false,
  accessRole: 'reader',
  color: null,
  ...extra,
});

/**
 * Choosing a calendar from the account instead of typing its address.
 *
 * The rules that matter here are about the account's own calendar: Google
 * answers for it twice, as `primary` and under the user's email, and nothing
 * downstream could tell those apart.
 */
describe('the account’s own calendar', () => {
  it('is recognised by the account email, whatever the casing', () => {
    expect(isOwnPrimary('me@example.com', 'me@example.com')).toBe(true);
    expect(isOwnPrimary('  ME@Example.com ', 'me@example.com')).toBe(true);
    expect(isOwnPrimary('work@example.com', 'me@example.com')).toBe(false);
  });

  /** No email means no claim — guessing would drop a real subscription. */
  it('claims nothing when the account has no email', () => {
    expect(isOwnPrimary('me@example.com', null)).toBe(false);
  });

  /**
   * The regression: this pair used to produce ['primary', 'me@example.com'],
   * so every read asked Google for the same calendar twice.
   */
  it('is read once, not twice, when the user also followed it by address', () => {
    expect(
      calendarIdsFor(
        [{ calendarId: 'me@example.com', summary: null }, { calendarId: 'work@example.com', summary: 'Work' }],
        'me@example.com'
      )
    ).toEqual(['primary', 'work@example.com']);
  });

  it('leads with primary, because the copy carrying the user’s reply wins ties', () => {
    expect(calendarIdsFor([{ calendarId: 'a@example.com', summary: null }], 'me@example.com')).toEqual([
      'primary',
      'a@example.com',
    ]);
  });

  it('drops blanks and repeats', () => {
    expect(
      calendarIdsFor(
        [
          { calendarId: '  ', summary: null },
          { calendarId: 'a@example.com', summary: null },
          { calendarId: 'a@example.com', summary: null },
        ],
        null
      )
    ).toEqual(['primary', 'a@example.com']);
  });
});

describe('folding what is followed into what the account has', () => {
  const available = [
    cal('me@example.com', 'Me', { primary: true, accessRole: 'owner' }),
    cal('holidays', 'Holidays'),
    cal('addressbook#contacts@group.v.calendar.google.com', 'Birthdays'),
  ];

  it('marks the followed ones and leaves the rest off', () => {
    const rows = mergeCalendarState(
      available,
      [{ calendarId: 'holidays', summary: 'Holidays' }],
      'me@example.com'
    );

    expect(rows.find((r) => r.id === 'holidays')?.followed).toBe(true);
    expect(rows.find((r) => r.summary === 'Birthdays')?.followed).toBe(false);
  });

  /** It is read regardless, so showing it as switchable would misstate what the assistant sees. */
  it('always reports the primary as followed', () => {
    const rows = mergeCalendarState(available, [], 'me@example.com');
    expect(rows[0].primary).toBe(true);
    expect(rows[0].followed).toBe(true);
  });

  it('orders yours first, then followed, then the rest by name', () => {
    const rows = mergeCalendarState(
      available,
      [{ calendarId: 'holidays', summary: 'Holidays' }],
      'me@example.com'
    );

    expect(rows.map((r) => r.summary)).toEqual(['Me', 'Holidays', 'Birthdays']);
  });

  /**
   * Unsubscribed in Google, access revoked, calendar deleted — all reach here
   * the same way. Silently dropping it would undo a choice the user made
   * without saying so; it is shown, flagged, and left for them to remove.
   */
  it('keeps a followed calendar that is no longer on the account, and flags it', () => {
    const rows = mergeCalendarState(
      available,
      [{ calendarId: 'gone@example.com', summary: 'Old team' }],
      'me@example.com'
    );

    const orphan = rows.find((r) => r.id === 'gone@example.com');
    expect(orphan).toMatchObject({ summary: 'Old team', followed: true, accessRole: 'unknown' });
  });

  it('does not resurrect the user’s own calendar as an orphan row', () => {
    const rows = mergeCalendarState(
      available,
      [{ calendarId: 'me@example.com', summary: null }],
      'me@example.com'
    );

    expect(rows.filter((r) => r.id === 'me@example.com')).toHaveLength(1);
  });
});

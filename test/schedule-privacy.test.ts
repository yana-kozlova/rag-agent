import { describe, it, expect } from 'vitest';
import { looksLikeCalendarCommandOrScheduleOperation as isCalendarCommand } from '@/lib/privacy/schedule-privacy';

/**
 * The rule that keeps calendar operations out of long-term memory.
 *
 * Every Ukrainian case here returned false before the boundaries were rewritten:
 * `\b` is ASCII-only in JavaScript, so no pattern ending in a Cyrillic letter
 * ever matched. The rule existed and did nothing for the language the bot
 * actually speaks.
 */
describe('calendar commands are refused', () => {
  it.each([
    'додай подію Андрій 04.12.1985',
    'перенеси зустріч на вівторок',
    'створи зустріч завтра о 15:00',
    'видали урок з логопедом',
    'прибери подію 12.04',
  ])('refuses %j', (text) => {
    expect(isCalendarCommand(text)).toBe(true);
  });

  it('still refuses the English it always refused', () => {
    expect(isCalendarCommand('move the meeting to Tuesday')).toBe(true);
    expect(isCalendarCommand('delete the event tomorrow')).toBe(true);
  });
});

describe('facts are not refused', () => {
  /** The message that started this: a birthday is a fact, not an operation. */
  it('keeps a personal fact that merely contains a date', () => {
    expect(isCalendarCommand('Андрій — чоловік Яни День народження: 04.12.1985')).toBe(false);
  });

  it.each([
    'Артем любить програмування',
    'User likes pears',
    'Яна працює в Urtime',
    'зустріч пройшла добре, Андрій був задоволений',
  ])('keeps %j', (text) => {
    expect(isCalendarCommand(text)).toBe(false);
  });
});

describe('word boundaries hold in both scripts', () => {
  /**
   * The old pattern matched "календарx" — a Latin letter after Cyrillic made a
   * boundary appear where there is no word break — while missing "календар ".
   */
  it('does not fire on a longer word that merely starts the same', () => {
    expect(isCalendarCommand('додай календарний план на рік')).toBe(false);
    expect(isCalendarCommand('створи подіумну зйомку')).toBe(false);
  });

  it('accepts the apostrophe in whichever form the keyboard produced', () => {
    expect(isCalendarCommand("перенеси зустріч на п'ятницю")).toBe(true);
    expect(isCalendarCommand('перенеси зустріч на п’ятницю')).toBe(true);
  });
});

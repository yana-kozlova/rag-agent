import { describe, it, expect } from 'vitest';
import {
  copyFor,
  isNotificationLocale,
  resolveLocale,
  DEFAULT_LOCALE,
} from '@/lib/push/copy';

describe('resolving a stored locale', () => {
  it('accepts the languages it knows', () => {
    expect(resolveLocale('uk')).toBe('uk');
    expect(resolveLocale('en')).toBe('en');
  });

  /**
   * A locale arrives from a database column, so it can be anything a past
   * schema or a bad write left behind. Falling back beats throwing inside a
   * cron run that has already spent an LLM call.
   */
  it('falls back on anything else', () => {
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('uk-UA')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('fr')).toBe(DEFAULT_LOCALE);
  });

  it('guards narrowly', () => {
    expect(isNotificationLocale('uk')).toBe(true);
    expect(isNotificationLocale('UK')).toBe(false);
    expect(isNotificationLocale(7)).toBe(false);
  });
});

describe('Ukrainian plurals', () => {
  const uk = copyFor('uk');

  /** 1, 21, 101 take the singular; 11 does not, which is the usual mistake. */
  it('uses the singular form only where Ukrainian does', () => {
    expect(uk.briefing.thingsToday(1)).toContain('1 справа');
    expect(uk.briefing.thingsToday(21)).toContain('21 справа');
    expect(uk.briefing.thingsToday(11)).toContain('11 справ');
    expect(uk.briefing.thingsToday(111)).toContain('111 справ');
  });

  it('uses the few-form for 2 to 4, except in the teens', () => {
    expect(uk.briefing.thingsToday(2)).toContain('2 справи');
    expect(uk.briefing.thingsToday(4)).toContain('4 справи');
    expect(uk.briefing.thingsToday(22)).toContain('22 справи');
    expect(uk.briefing.thingsToday(12)).toContain('12 справ');
    expect(uk.briefing.thingsToday(14)).toContain('14 справ');
  });

  it('uses the many-form from 5 up', () => {
    expect(uk.briefing.thingsToday(5)).toContain('5 справ');
    expect(uk.briefing.thingsToday(0)).toContain('0 справ');
  });

  it('declines events, notes and meetings too', () => {
    expect(uk.retro.events(1)).toBe('1 подія');
    expect(uk.retro.events(3)).toBe('3 події');
    expect(uk.retro.events(8)).toBe('8 подій');
    expect(uk.retro.notesSaved(1)).toBe('1 нотатка');
    expect(uk.retro.notesSaved(5)).toBe('5 нотаток');
    expect(uk.insight.noBreakBody('4 год', '14:00', 3)).toContain('3 зустрічі');
    expect(uk.insight.noBreakBody('4 год', '14:00', 5)).toContain('5 зустрічей');
  });
});

describe('durations', () => {
  it('reads as a person would say them, in each language', () => {
    const uk = copyFor('uk');
    const en = copyFor('en');

    expect(uk.duration(45)).toBe('45 хв');
    expect(uk.duration(60)).toBe('1 год');
    expect(uk.duration(210)).toBe('3 год 30 хв');

    expect(en.duration(45)).toBe('45m');
    expect(en.duration(60)).toBe('1h');
    expect(en.duration(210)).toBe('3h 30m');
  });
});

describe('English copy', () => {
  const en = copyFor('en');

  it('keeps its own plurals', () => {
    expect(en.briefing.thingsToday(1)).toContain('1 thing today');
    expect(en.briefing.thingsToday(3)).toContain('3 things today');
    expect(en.retro.notesSaved(1)).toBe('1 note saved');
    expect(en.retro.notesSaved(2)).toBe('2 notes saved');
  });
});

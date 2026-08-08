import { describe, it, expect } from 'vitest';

import {
  MAX_DATES_PER_NOTE,
  PLACEHOLDER_YEAR,
  daysBetween,
  formatTimelineDate,
  groupByYear,
  isSameStoredDate,
  nextAnnualOccurrence,
  parseDateSpec,
  timelineKindIcon,
  toTimelineCandidates,
  upcomingOccurrences,
} from '@/lib/timeline/timeline';

/**
 * What a date on the timeline is allowed to claim.
 *
 * Every rule here is about not saying more than was said. A note that gives a
 * year must not come back out as the first of January, a birthday with no year
 * must not acquire one, and a date the model garbled must not be stored at all —
 * once it is on the axis it looks exactly as trustworthy as the rest.
 */

describe('parsing a date only as precisely as it was given', () => {
  it('keeps a full date as a day', () => {
    expect(parseDateSpec('2019-03-12')).toEqual({ occurredOn: '2019-03-12', precision: 'day' });
  });

  it('widens a year-month to the first, and says so', () => {
    // The stored value has to be a real date; `precision` is what stops the
    // renderer printing the day it invented to get one.
    expect(parseDateSpec('2022-06')).toEqual({ occurredOn: '2022-06-01', precision: 'month' });
  });

  it('keeps a bare year as a year', () => {
    expect(parseDateSpec('1985')).toEqual({ occurredOn: '1985-01-01', precision: 'year' });
  });

  it('takes a birthday with no year', () => {
    expect(parseDateSpec('--03-14')).toEqual({
      occurredOn: `${PLACEHOLDER_YEAR}-03-14`,
      precision: 'day-month',
    });
  });

  it('stores 29 February, which is why the placeholder year is a leap year', () => {
    expect(parseDateSpec('--02-29')).toEqual({
      occurredOn: `${PLACEHOLDER_YEAR}-02-29`,
      precision: 'day-month',
    });
  });

  it('refuses days that do not exist rather than rounding them', () => {
    expect(parseDateSpec('2023-02-30')).toBeNull();
    expect(parseDateSpec('2023-02-29')).toBeNull();
    expect(parseDateSpec('2023-13-01')).toBeNull();
  });

  it('refuses what a model answers when it has nothing', () => {
    expect(parseDateSpec('0000')).toBeNull();
    expect(parseDateSpec('9999-01-01')).toBeNull();
    expect(parseDateSpec('next Tuesday')).toBeNull();
    expect(parseDateSpec('')).toBeNull();
  });
});

describe('printing only the components that are real', () => {
  it('prints a year alone as a year', () => {
    expect(formatTimelineDate('2022-01-01', 'year')).toBe('2022');
  });

  it('prints a month without its invented day', () => {
    expect(formatTimelineDate('2022-06-01', 'month')).toBe('June 2022');
  });

  it('prints a yearless birthday without a year', () => {
    expect(formatTimelineDate(`${PLACEHOLDER_YEAR}-03-14`, 'day-month')).toBe('14 Mar');
  });

  /**
   * The regression this guards. A calendar date parsed as an instant is UTC
   * midnight, and formatting that anywhere west of Greenwich prints the day
   * before — a birthday off by one, in the one place a user checks first.
   */
  it('does not slip a day when the runtime is not on UTC', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatTimelineDate('2019-03-12', 'day')).toBe('12 Mar 2019');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('when a date next comes round', () => {
  it('counts today as the occurrence, not the one a year out', () => {
    expect(nextAnnualOccurrence('1990-03-14', '2026-03-14')).toBe('2026-03-14');
  });

  it('moves to next year once the day has passed', () => {
    expect(nextAnnualOccurrence('1990-03-14', '2026-03-15')).toBe('2027-03-14');
  });

  /**
   * 29 February falls back to the 28th rather than forward into March: an
   * anniversary belongs to the month it was named in, and three years in four a
   * March reminder for a February date reads as a bug.
   */
  it('keeps a leap-day date inside February', () => {
    expect(nextAnnualOccurrence('2000-02-29', '2027-01-01')).toBe('2027-02-28');
    expect(nextAnnualOccurrence('2000-02-29', '2028-01-01')).toBe('2028-02-29');
  });

  it('measures whole days across a month boundary', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3);
    expect(daysBetween('2026-09-02', '2026-08-30')).toBe(-3);
  });
});

describe('what is coming up', () => {
  const birthday = {
    occurredOn: '2019-03-12',
    precision: 'day' as const,
    recurrence: 'annual' as const,
  };
  const yearlessBirthday = {
    occurredOn: `${PLACEHOLDER_YEAR}-03-14`,
    precision: 'day-month' as const,
    recurrence: 'annual' as const,
  };
  const move = {
    occurredOn: '2022-06-01',
    precision: 'month' as const,
    recurrence: 'none' as const,
  };

  it('projects an annual date forward and counts the years', () => {
    const [next] = upcomingOccurrences([birthday], '2026-03-01', 30);
    expect(next.date).toBe('2026-03-12');
    expect(next.daysAway).toBe(11);
    expect(next.years).toBe(7);
  });

  /** "Turns 7" is a claim about a year nobody recorded. It must not be made. */
  it('counts no years for a birthday whose year was never given', () => {
    const [next] = upcomingOccurrences([yearlessBirthday], '2026-03-01', 30);
    expect(next.date).toBe('2026-03-14');
    expect(next.years).toBeNull();
  });

  it('leaves past one-off dates off the list entirely', () => {
    expect(upcomingOccurrences([move], '2026-03-01', 365)).toEqual([]);
  });

  it('respects the horizon', () => {
    expect(upcomingOccurrences([birthday], '2026-03-01', 5)).toEqual([]);
  });

  it('orders by the day it lands on, not by the day it started', () => {
    const dates = upcomingOccurrences([yearlessBirthday, birthday], '2026-03-01', 60);
    expect(dates.map((d) => d.date)).toEqual(['2026-03-12', '2026-03-14']);
  });
});

describe('the historical axis', () => {
  it('groups by year, most recent first', () => {
    const groups = groupByYear([
      { occurredOn: '2019-03-12', precision: 'day' as const },
      { occurredOn: '2022-06-01', precision: 'month' as const },
      { occurredOn: '2022-11-04', precision: 'day' as const },
    ]);

    expect(groups.map((g) => g.year)).toEqual(['2022', '2019']);
    expect(groups[0].items.map((i) => i.occurredOn)).toEqual(['2022-11-04', '2022-06-01']);
  });

  /**
   * A yearless birthday has a placeholder year. Placing it would file every one
   * of them under 2000, next to whatever really happened then.
   */
  it('leaves yearless dates off the axis', () => {
    const groups = groupByYear([
      { occurredOn: `${PLACEHOLDER_YEAR}-03-14`, precision: 'day-month' as const },
    ]);
    expect(groups).toEqual([]);
  });
});

describe('turning what extraction returned into rows', () => {
  it('drops a date it cannot parse rather than guessing one', () => {
    const candidates = toTimelineCandidates([
      { date: 'sometime last summer', title: 'поїздка' },
      { date: '2024-07-15', title: 'поїздка в Карпати' },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].occurredOn).toBe('2024-07-15');
  });

  it('drops a date with nothing to call it', () => {
    expect(toTimelineCandidates([{ date: '2024-07-15', title: '   ' }])).toEqual([]);
  });

  /**
   * The database says the same thing as a CHECK constraint. Disagreeing here
   * would not produce a wrong row, it would produce a failed insert on the save
   * path — which is worse, because the note goes down with it.
   */
  it('forces a yearless date to recur, whatever the model said', () => {
    const [candidate] = toTimelineCandidates([
      { date: '--03-14', title: 'день народження Андрія', recurring: false },
    ]);
    expect(candidate.recurrence).toBe('annual');
  });

  it('leaves a dated one-off alone', () => {
    const [candidate] = toTimelineCandidates([{ date: '2022-06', title: 'переїзд' }]);
    expect(candidate.recurrence).toBe('none');
    expect(candidate.precision).toBe('month');
  });

  it('collapses the same date said twice in one note', () => {
    const candidates = toTimelineCandidates([
      { date: '2019-03-12', title: 'Артем народився', subject: 'Артем' },
      { date: '2019-03-12', title: 'артем народився', subject: 'артем' },
    ]);
    expect(candidates).toHaveLength(1);
  });

  it('keeps two different things that happened on one day', () => {
    const candidates = toTimelineCandidates([
      { date: '2022-06-01', title: 'переїзд', kind: 'move' },
      { date: '2022-06-01', title: 'новий проєкт', kind: 'work' },
    ]);
    expect(candidates).toHaveLength(2);
  });

  it('caps what one note can contribute', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      date: `20${String(i + 10).padStart(2, '0')}-01-01`,
      title: `подія ${i}`,
    }));
    expect(toTimelineCandidates(many)).toHaveLength(MAX_DATES_PER_NOTE);
  });

  it('folds the subject the same way the identity index does', () => {
    const [candidate] = toTimelineCandidates([
      { date: '2019-03-12', title: 'народження', subject: '  Артем  ' },
    ]);
    expect(candidate.subject).toBe('Артем');
    expect(candidate.subjectKey).toBe('артем');
  });
});

describe('kind glyphs', () => {
  it('falls back rather than rendering nothing for a kind it has not met', () => {
    expect(timelineKindIcon('birth')).toBe('🎂');
    expect(timelineKindIcon('something-new')).toBe(timelineKindIcon('other'));
  });
});

/**
 * Deleting a date has to survive the note being edited afterwards.
 *
 * The row is a projection of `metadata.dates`, and anything that re-syncs the
 * note rebuilds it from that list — so the delete removes the entry from the
 * note too, and this is the rule that decides which entry to remove.
 */
describe('matching a deleted row back to the note that produced it', () => {
  const target = { occurredOn: '1985-01-01', title: 'Андрій народився' };

  it('matches a year written as a year against a row stored as a date', () => {
    expect(isSameStoredDate({ date: '1985', title: 'Андрій народився' }, target)).toBe(true);
  });

  it('ignores case and surrounding space in the title', () => {
    expect(isSameStoredDate({ date: '1985', title: '  андрій НАРОДИВСЯ ' }, target)).toBe(true);
  });

  it('leaves a different date on the same note alone', () => {
    expect(isSameStoredDate({ date: '1985-06-02', title: 'Андрій народився' }, target)).toBe(false);
  });

  it('leaves a different event on the same day alone', () => {
    expect(isSameStoredDate({ date: '1985', title: 'переїзд' }, target)).toBe(false);
  });

  /** It was never on the axis, so deleting a row cannot be a reason to edit it out. */
  it('keeps an entry whose date never parsed', () => {
    expect(isSameStoredDate({ date: 'колись', title: 'Андрій народився' }, target)).toBe(false);
  });
});

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
  resolveRecurrence,
  splitDateSpec,
  timelineKindIcon,
  toDateSpec,
  toTimelineCandidates,
  upcomingOccurrences,
  type DatePrecision,
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

  it('does not project a row already saved as annual on a year-only date', () => {
    // The read side has to hold this line too: rows written before the rule
    // existed are still in the database, and projecting one puts a wedding on
    // 1 January every year with no migration able to guess what was meant.
    const legacy = {
      occurredOn: '2015-01-01',
      precision: 'year' as const,
      recurrence: 'annual' as const,
    };

    expect(upcomingOccurrences([legacy], '2025-12-20', 60)).toEqual([]);
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

  it('refuses to recur a date with no day to recur on, whatever the model said', () => {
    // "Ми одружились у 2015" is stored as 2015-01-01 because the column is a
    // `date`. Honouring `recurring` there announces an anniversary on New
    // Year's Day and prints an age beside it — a day nobody said, stated as
    // confidently as one they did.
    const [year] = toTimelineCandidates([
      { date: '2015', title: 'весілля', kind: 'anniversary', recurring: true },
    ]);
    expect(year.recurrence).toBe('none');

    const [month] = toTimelineCandidates([
      { date: '2015-06', title: 'весілля', kind: 'anniversary', recurring: true },
    ]);
    expect(month.recurrence).toBe('none');
  });

  it('still recurs a date that has a day and a month', () => {
    const [full] = toTimelineCandidates([
      { date: '2015-06-20', title: 'весілля', kind: 'anniversary', recurring: true },
    ]);
    expect(full.recurrence).toBe('annual');
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

/**
 * The three fields a person types, and the row they open again as.
 *
 * These exist because there are now two forms — adding a date and correcting
 * one — and the second is the dangerous one: it starts from a row where the
 * unreal components have already been padded in, so an inverse that reads the
 * stored date instead of `precision` hands the user a 1 January nobody said and
 * then saves it back as though they had.
 */
describe('typing a date into three fields', () => {
  it('takes all three as a day', () => {
    expect(toDateSpec('2019', '3', '12')).toBe('2019-03-12');
  });

  it('pads what the form left unpadded', () => {
    // The month arrives as the `<select>` option value, which is a bare number.
    expect(toDateSpec('2019', '3', '5')).toBe('2019-03-05');
  });

  it('takes a year and a month without inventing a day', () => {
    expect(toDateSpec('2022', '6', '')).toBe('2022-06');
  });

  it('takes a year alone', () => {
    expect(toDateSpec('1985', '', '')).toBe('1985');
  });

  it('reads a day and month with no year as a birthday', () => {
    expect(toDateSpec('', '3', '14')).toBe('--03-14');
  });

  it('refuses a day with no month, which means nothing', () => {
    expect(toDateSpec('', '', '14')).toBeNull();
  });

  it('refuses a month with no year and no day', () => {
    expect(toDateSpec('', '3', '')).toBeNull();
  });

  it('refuses an empty form', () => {
    expect(toDateSpec('', '', '')).toBeNull();
  });
});

describe('opening a stored row back up as fields', () => {
  it('leaves the padding out of a year-only date', () => {
    // The row holds 1985-01-01. Handing "1" and "1" back to the form is how
    // saving an untouched year silently promotes it to New Year's Day.
    expect(splitDateSpec('1985-01-01', 'year')).toEqual({ year: '1985', month: '', day: '' });
  });

  it('leaves the padding out of a month date', () => {
    expect(splitDateSpec('2022-06-01', 'month')).toEqual({ year: '2022', month: '6', day: '' });
  });

  it('leaves the placeholder year out of a yearless birthday', () => {
    expect(splitDateSpec(`${PLACEHOLDER_YEAR}-03-14`, 'day-month')).toEqual({
      year: '',
      month: '3',
      day: '14',
    });
  });

  it('gives every component of a full date', () => {
    expect(splitDateSpec('2019-03-12', 'day')).toEqual({ year: '2019', month: '3', day: '12' });
  });

  it('round-trips every precision back to the row it came from', () => {
    const rows: Array<{ occurredOn: string; precision: DatePrecision }> = [
      { occurredOn: '2019-03-12', precision: 'day' },
      { occurredOn: '2022-06-01', precision: 'month' },
      { occurredOn: '1985-01-01', precision: 'year' },
      { occurredOn: `${PLACEHOLDER_YEAR}-03-14`, precision: 'day-month' },
    ];

    for (const row of rows) {
      const { year, month, day } = splitDateSpec(row.occurredOn, row.precision);
      const spec = toDateSpec(year, month, day);
      expect(spec).not.toBeNull();
      // Opening the edit form and saving without touching anything must leave
      // the row exactly as it was — the date and how much of it is real.
      expect(parseDateSpec(spec as string)).toEqual(row);
    }
  });
});

describe('one rule for what may recur', () => {
  it('honours a request on a full date', () => {
    expect(resolveRecurrence('day', true)).toBe('annual');
  });

  it('leaves a full date alone when nothing was asked for', () => {
    expect(resolveRecurrence('day', false)).toBe('none');
  });

  it('forces a yearless date to recur, since it can mean nothing else', () => {
    expect(resolveRecurrence('day-month', false)).toBe('annual');
  });

  it('refuses a year-only date, which has no day to come round on', () => {
    // Honoured, this is an anniversary announced every New Year's Day, and the
    // database check constraint would not even catch it.
    expect(resolveRecurrence('year', true)).toBe('none');
  });

  it('refuses a month-precision date for the same reason', () => {
    expect(resolveRecurrence('month', true)).toBe('none');
  });
});

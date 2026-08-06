import { describe, expect, it } from 'vitest';

import {
  buildDailySeries,
  enumerateDates,
  sleepMoodSplit,
  summarizeRange,
  symptomDayCounts,
  type EntryLike,
} from '@/lib/wellbeing/aggregate';
import { formatSleep, hoursToMinutes, normalizeSymptoms } from '@/lib/wellbeing/scale';

function entry(partial: Partial<EntryLike> & { localDate: string }): EntryLike {
  return {
    recordedAt: `${partial.localDate}T09:00:00.000Z`,
    mood: null,
    energy: null,
    sleepMinutes: null,
    symptoms: [],
    ...partial,
  };
}

describe('enumerateDates', () => {
  it('is inclusive at both ends', () => {
    expect(enumerateDates('2026-08-01', '2026-08-04')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('crosses a month boundary', () => {
    expect(enumerateDates('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });

  it('returns nothing for an inverted range', () => {
    expect(enumerateDates('2026-08-04', '2026-08-01')).toEqual([]);
  });
});

describe('buildDailySeries', () => {
  it('averages several check-ins in one day', () => {
    const days = buildDailySeries(
      [
        entry({ localDate: '2026-08-01', recordedAt: '2026-08-01T06:00:00Z', mood: 4, energy: 4 }),
        entry({ localDate: '2026-08-01', recordedAt: '2026-08-01T18:00:00Z', mood: 2, energy: 1 }),
      ],
      '2026-08-01',
      '2026-08-01'
    );

    expect(days[0].mood).toBe(3);
    expect(days[0].energy).toBe(2.5);
    expect(days[0].entryCount).toBe(2);
  });

  it('takes the last reported sleep for a day rather than averaging corrections', () => {
    const days = buildDailySeries(
      [
        entry({ localDate: '2026-08-01', recordedAt: '2026-08-01T07:00:00Z', sleepMinutes: 360 }),
        entry({ localDate: '2026-08-01', recordedAt: '2026-08-01T12:00:00Z', sleepMinutes: 390 }),
      ],
      '2026-08-01',
      '2026-08-01'
    );

    expect(days[0].sleepMinutes).toBe(390);
  });

  it('orders by recordedAt, not by input order, when picking the last sleep value', () => {
    const days = buildDailySeries(
      [
        entry({ localDate: '2026-08-01', recordedAt: '2026-08-01T12:00:00Z', sleepMinutes: 390 }),
        entry({ localDate: '2026-08-01', recordedAt: '2026-08-01T07:00:00Z', sleepMinutes: 360 }),
      ],
      '2026-08-01',
      '2026-08-01'
    );

    expect(days[0].sleepMinutes).toBe(390);
  });

  it('keeps unlogged days present but empty, so a chart can break the line', () => {
    const days = buildDailySeries(
      [entry({ localDate: '2026-08-01', mood: 4 }), entry({ localDate: '2026-08-04', mood: 2 })],
      '2026-08-01',
      '2026-08-04'
    );

    expect(days).toHaveLength(4);
    expect(days.map((d) => d.mood)).toEqual([4, null, null, 2]);
    expect(days[1].entryCount).toBe(0);
  });

  it('ignores entries outside the range', () => {
    const days = buildDailySeries(
      [entry({ localDate: '2026-07-30', mood: 5 }), entry({ localDate: '2026-08-01', mood: 3 })],
      '2026-08-01',
      '2026-08-02'
    );

    expect(days.map((d) => d.mood)).toEqual([3, null]);
  });

  it('normalises and de-duplicates a day\'s symptoms', () => {
    const days = buildDailySeries(
      [
        entry({ localDate: '2026-08-01', symptoms: ['Головний біль'] }),
        entry({ localDate: '2026-08-01', symptoms: ['головний  біль.', 'нудота'] }),
      ],
      '2026-08-01',
      '2026-08-01'
    );

    expect(days[0].symptoms).toEqual(['головний біль', 'нудота']);
  });
});

describe('symptomDayCounts', () => {
  it('counts days, not mentions', () => {
    const days = buildDailySeries(
      [
        entry({ localDate: '2026-08-01', symptoms: ['головний біль'] }),
        entry({ localDate: '2026-08-01', symptoms: ['головний біль'] }),
        entry({ localDate: '2026-08-01', symptoms: ['головний біль'] }),
        entry({ localDate: '2026-08-02', symptoms: ['нудота'] }),
        entry({ localDate: '2026-08-03', symptoms: ['нудота'] }),
      ],
      '2026-08-01',
      '2026-08-03'
    );

    expect(symptomDayCounts(days)).toEqual([
      { symptom: 'нудота', days: 2 },
      { symptom: 'головний біль', days: 1 },
    ]);
  });
});

describe('summarizeRange', () => {
  it('averages over logged days only, treating gaps as absent rather than zero', () => {
    const days = buildDailySeries(
      [entry({ localDate: '2026-08-01', mood: 4 }), entry({ localDate: '2026-08-05', mood: 2 })],
      '2026-08-01',
      '2026-08-05'
    );

    const summary = summarizeRange(days);
    expect(summary.avgMood).toBe(3);
    expect(summary.daysLogged).toBe(2);
    expect(summary.entryCount).toBe(2);
    expect(summary.bestDay?.date).toBe('2026-08-01');
    expect(summary.worstDay?.date).toBe('2026-08-05');
  });

  it('reports nulls rather than NaN for an empty range', () => {
    const summary = summarizeRange(buildDailySeries([], '2026-08-01', '2026-08-03'));
    expect(summary.avgMood).toBeNull();
    expect(summary.avgSleepMinutes).toBeNull();
    expect(summary.daysLogged).toBe(0);
  });
});

describe('sleepMoodSplit', () => {
  const build = (specs: Array<{ date: string; sleep: number; mood: number }>) =>
    buildDailySeries(
      specs.map((s) => entry({ localDate: s.date, sleepMinutes: s.sleep, mood: s.mood })),
      specs[0].date,
      specs[specs.length - 1].date
    );

  it('stays silent until both buckets hold enough days', () => {
    const days = build([
      { date: '2026-08-01', sleep: 300, mood: 2 },
      { date: '2026-08-02', sleep: 480, mood: 4 },
      { date: '2026-08-03', sleep: 300, mood: 2 },
      { date: '2026-08-04', sleep: 480, mood: 5 },
    ]);

    expect(sleepMoodSplit(days)).toBeNull();
  });

  it('splits on the threshold once there is enough on both sides', () => {
    const specs: Array<{ date: string; sleep: number; mood: number }> = [];
    for (let i = 1; i <= 5; i++) {
      specs.push({ date: `2026-08-0${i}`, sleep: 300, mood: 2 });
    }
    for (let i = 6; i <= 9; i++) {
      specs.push({ date: `2026-08-0${i}`, sleep: 480, mood: 4 });
    }
    specs.push({ date: '2026-08-10', sleep: 480, mood: 5 });

    const split = sleepMoodSplit(build(specs));

    expect(split).not.toBeNull();
    expect(split!.shortNights).toEqual({ days: 5, avgMood: 2 });
    expect(split!.longNights).toEqual({ days: 5, avgMood: 4.2 });
  });
});

describe('scale helpers', () => {
  it('normalises case, inner whitespace and trailing punctuation', () => {
    expect(normalizeSymptoms(['  Головний   БІЛЬ.', 'головний біль'])).toEqual(['головний біль']);
  });

  it('leaves distinct symptoms distinct', () => {
    expect(normalizeSymptoms(['втома', 'виснаження'])).toEqual(['втома', 'виснаження']);
  });

  it('converts spoken hours to stored minutes', () => {
    expect(hoursToMinutes(6.5)).toBe(390);
    expect(hoursToMinutes(7)).toBe(420);
  });

  it('formats minutes back into something readable', () => {
    expect(formatSleep(420)).toBe('7h');
    expect(formatSleep(440)).toBe('7h 20m');
  });
});

import { describe, it, expect } from 'vitest';

import { detectRepeatingRow, type ScannedRow } from '@/lib/quick-actions/detect';
import type { ColumnLike } from '@/lib/utils/table-columns';

/**
 * The repetition was always visible in the table — the same row, every day, for
 * a fortnight — and nothing looked at it. These pin what "looking" means: the
 * values that never change become the template, the day becomes a stamp, and
 * the number that differs every time stays a question.
 */

const columns: ColumnLike[] = [
  { id: 'day', name: 'Дата', type: 'date' },
  { id: 'pet', name: 'Хто', type: 'text' },
  { id: 'what', name: 'Що', type: 'text' },
  { id: 'dose', name: 'Доза', type: 'text' },
  { id: 'note', name: 'Примітка', type: 'text' },
];

/** `n` days ago, at midday, so no test sits on a timezone boundary. */
function daysAgo(n: number): Date {
  const date = new Date('2026-08-26T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - n);
  return date;
}

function dose(n: number, extra: Record<string, unknown> = {}): ScannedRow {
  const createdAt = daysAgo(n);
  return {
    createdAt,
    rowData: {
      day: createdAt.toISOString().slice(0, 10),
      pet: 'Арчі',
      what: 'ліки',
      dose: '10 мг',
      ...extra,
    },
  };
}

describe('a routine written every day', () => {
  const detected = detectRepeatingRow(columns, [dose(0), dose(1), dose(2), dose(3)]);

  it('is noticed at all', () => {
    expect(detected).not.toBeNull();
    expect(detected!.occurrences).toBe(4);
    expect(detected!.days).toBe(4);
  });

  it('keeps the repeating values as literals, so the button asks nothing', () => {
    expect(detected!.fields).toEqual([
      { columnId: 'day', kind: 'today' },
      { columnId: 'pet', kind: 'fixed', value: 'Арчі' },
      { columnId: 'what', kind: 'fixed', value: 'ліки' },
      { columnId: 'dose', kind: 'fixed', value: '10 мг' },
    ]);
  });

  it('names itself from what repeats', () => {
    expect(detected!.label).toBe('Арчі — ліки — 10 мг');
  });

  // An always-blank column is not part of the routine; asking for it every
  // press would invent work the user never did.
  it('leaves out a column the routine never fills', () => {
    expect(detected!.fields.some((f) => f.columnId === 'note')).toBe(false);
  });
});

describe('what does not count as a routine', () => {
  it('two entries are a coincidence', () => {
    expect(detectRepeatingRow(columns, [dose(0), dose(1)])).toBeNull();
  });

  it('three entries on one day are one event recorded three times', () => {
    const sameDay = [dose(1), dose(1), dose(1)];
    expect(detectRepeatingRow(columns, sameDay)).toBeNull();
  });

  it('different rows every day are not a template', () => {
    const rows = [
      dose(0, { pet: 'Арчі', what: 'ліки' }),
      dose(1, { pet: 'Яна', what: 'вітаміни' }),
      dose(2, { pet: 'Артем', what: 'сироп' }),
      dose(3, { pet: 'Арчі', what: 'шампунь' }),
    ];
    expect(detectRepeatingRow(columns, rows)).toBeNull();
  });
});

describe('a fortnight filled in at one sitting', () => {
  /**
   * "Я всі ці дні давала Арчі ліки, заповни таблицю" writes every row this
   * afternoon. Counting the days from `created_at` would read that as one
   * event and decline to notice the routine it plainly is — so the days come
   * from the dates the user actually stated.
   */
  it('is still a routine, counted by the dates in the rows', () => {
    const written = new Date('2026-08-26T15:00:00Z');
    const rows: ScannedRow[] = ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'].map(
      (day) => ({
        createdAt: written,
        rowData: { day, pet: 'Арчі', what: 'ліки', dose: '10 мг' },
      })
    );

    const detected = detectRepeatingRow(columns, rows);

    expect(detected).not.toBeNull();
    expect(detected!.days).toBe(4);
    expect(detected!.fields[0]).toEqual({ columnId: 'day', kind: 'today' });
  });
});

describe('a column that genuinely differs each time', () => {
  const tempColumns: ColumnLike[] = [
    { id: 'day', name: 'Дата', type: 'date' },
    { id: 'who', name: 'Хто', type: 'text' },
    { id: 'temp', name: 'Температура', type: 'number' },
  ];

  it('stays a question, while the rest is remembered', () => {
    const rows: ScannedRow[] = [36.6, 37.2, 36.9, 37.8].map((temp, i) => {
      const createdAt = daysAgo(i);
      return {
        createdAt,
        rowData: { day: createdAt.toISOString().slice(0, 10), who: 'Артем', temp },
      };
    });

    const detected = detectRepeatingRow(tempColumns, rows);

    expect(detected!.fields).toEqual([
      { columnId: 'day', kind: 'today' },
      { columnId: 'who', kind: 'fixed', value: 'Артем' },
      { columnId: 'temp', kind: 'ask', prompt: 'Температура' },
    ]);
  });
});

describe('two routines in one table', () => {
  it('offers the one written most often, leaving the other for next time', () => {
    const rows = [
      dose(0),
      dose(1),
      dose(2),
      dose(3, { pet: 'Яна', what: 'вітаміни', dose: '1 таб' }),
      dose(4, { pet: 'Яна', what: 'вітаміни', dose: '1 таб' }),
    ];

    const detected = detectRepeatingRow(columns, rows);

    expect(detected!.values).toEqual(['Арчі', 'ліки', '10 мг']);
    expect(detected!.occurrences).toBe(3);
  });
});

describe('a date column that is not a stamp', () => {
  const expiryColumns: ColumnLike[] = [
    { id: 'what', name: 'Що', type: 'text' },
    { id: 'expires', name: 'Придатне до', type: 'date' },
  ];

  /**
   * Stamping today's date into an expiry column would be wrong on every press
   * and in a way nobody would think to check, so a date only becomes `today`
   * when the rows show it tracking the day they were written.
   */
  it('is left alone rather than stamped with today', () => {
    const rows: ScannedRow[] = [0, 1, 2, 3].map((n) => ({
      createdAt: daysAgo(n),
      rowData: { what: 'молоко', expires: '2027-01-01' },
    }));

    const detected = detectRepeatingRow(expiryColumns, rows);

    expect(detected!.fields).toEqual([{ columnId: 'what', kind: 'fixed', value: 'молоко' }]);
  });
});

describe('the signature', () => {
  it('is stable for the same habit and different when its values change', () => {
    const a = detectRepeatingRow(columns, [dose(0), dose(1), dose(2)]);
    const b = detectRepeatingRow(columns, [dose(3), dose(4), dose(5)]);
    const changed = detectRepeatingRow(columns, [
      dose(0, { dose: '20 мг' }),
      dose(1, { dose: '20 мг' }),
      dose(2, { dose: '20 мг' }),
    ]);

    expect(a!.signature).toBe(b!.signature);
    expect(changed!.signature).not.toBe(a!.signature);
  });
});

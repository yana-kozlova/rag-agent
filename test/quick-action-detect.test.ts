import { describe, it, expect } from 'vitest';

import { covers, detectRepeatingRow, labelFor, type ScannedRow } from '@/lib/quick-actions/detect';
import { MAX_LABEL_LENGTH } from '@/lib/quick-actions/quick-actions';
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
  const vitamins = { pet: 'Яна', what: 'вітаміни', dose: '1 таб' };
  const rows = [
    dose(0),
    dose(1),
    dose(2),
    dose(3, vitamins),
    dose(4, vitamins),
    dose(5, vitamins),
  ];

  it('offers the one written most often first', () => {
    const detected = detectRepeatingRow(columns, rows);

    expect(detected!.values).toEqual(['Арчі', 'ліки', '10 мг']);
    expect(detected!.occurrences).toBe(3);
  });

  /**
   * The busiest group is the busiest group tomorrow too, so answering with it
   * and letting the caller discard it as already-covered was one button per
   * table forever — the second routine went on being written by hand with
   * nothing ever offering it a button.
   */
  it('moves on to the second once the first has a button', () => {
    const first = detectRepeatingRow(columns, rows)!;
    const second = detectRepeatingRow(columns, rows, [first.fields]);

    expect(second!.values).toEqual(['Яна', 'вітаміни', '1 таб']);
  });

  it('goes quiet when both have buttons', () => {
    const first = detectRepeatingRow(columns, rows)!;
    const second = detectRepeatingRow(columns, rows, [first.fields])!;

    expect(detectRepeatingRow(columns, rows, [first.fields, second.fields])).toBeNull();
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

/**
 * The offer is editable before it is accepted, so the button that comes back is
 * not always the template that was offered — a column dropped, a value reworded
 * to something shorter. Compared field for field, none of those would count as
 * covering the routine they came from, and the page would go on offering a
 * habit that has had a button on it since Tuesday.
 */
describe('what an accepted button covers', () => {
  const rows = [dose(0), dose(1), dose(2), dose(3)];
  const offered = detectRepeatingRow(columns, rows)!;

  it('covers the routine it was made from', () => {
    expect(detectRepeatingRow(columns, rows, [offered.fields])).toBeNull();
  });

  it('covers it still when the user dropped a column from the offer', () => {
    const trimmed = offered.fields.filter((f) => f.columnId !== 'dose');

    expect(detectRepeatingRow(columns, rows, [trimmed])).toBeNull();
  });

  it('covers it still when the user reworded one of its values', () => {
    const reworded = offered.fields.map((f) =>
      f.columnId === 'what' ? { ...f, value: 'ліки (апоквель)' } : f
    );

    expect(detectRepeatingRow(columns, rows, [reworded])).toBeNull();
  });

  it('covers nothing when the button has no value of its own', () => {
    expect(covers([{ columnId: 'day', kind: 'today' }], offered.fields)).toBe(false);
  });

  it('does not cover a routine that differs in a value', () => {
    const evening = offered.fields.map((f) =>
      f.columnId === 'what' ? { ...f, value: 'вітаміни' } : f
    );

    expect(covers(evening, offered.fields)).toBe(false);
  });
});

/**
 * The face is the first thing about the button anyone sees, and it was a
 * `slice`: three repeating values joined and cut at forty characters, which
 * produced "вранці — апоквель — у відповідності з пр" — a name for nothing.
 */
describe('the name on the button', () => {
  it('is built from the values that read as names, not the prose beside them', () => {
    expect(labelFor(['вранці', 'апоквель', 'у відповідності з призначенням'])).toBe(
      'вранці — апоквель'
    );
  });

  it('keeps short values as they are', () => {
    expect(labelFor(['Арчі', 'ліки', '10 мг'])).toBe('Арчі — ліки — 10 мг');
  });

  it('carries three of them at most, however many repeat', () => {
    expect(labelFor(['Арчі', 'ліки', '10 мг', 'вранці'])).toBe('Арчі — ліки — 10 мг');
  });

  it('cuts where a word ends when there is nothing shorter to use', () => {
    const label = labelFor(['у відповідності з призначенням лікаря щоранку натще']);

    expect(label.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    expect(label).toBe('у відповідності з призначенням лікаря…');
  });
});

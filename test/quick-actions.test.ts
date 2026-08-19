import { describe, it, expect } from 'vitest';

import {
  MAX_ANSWER_LENGTH,
  askFields,
  describeRow,
  promptFor,
  resolveQuickActionRow,
  sanitizeLabel,
  usedToday,
  type QuickField,
} from '@/lib/quick-actions/quick-actions';
import { flattenMarkdownLinks, stripMarkdown } from '@/lib/telegram/api';
import { coerceValue } from '@/lib/utils/table-columns';
import {
  encodeCallbackData,
  encodeQuickActionCallback,
  encodeQuickUndoCallback,
  parseCallbackData,
  parseQuickActionCallback,
  parseQuickUndoCallback,
} from '@/lib/telegram/callback-data';
import {
  buildPromptText,
  labelFromPrompt,
  splitAnswers,
} from '@/lib/telegram/quick-action-prompt';

const columns = [
  { id: 'pet', name: 'Хто', type: 'text' as const },
  { id: 'what', name: 'Що', type: 'text' as const },
  { id: 'day', name: 'Дата', type: 'date' as const },
  { id: 'temp', name: 'Температура', type: 'number' as const },
  { id: 'done', name: 'Зроблено', type: 'boolean' as const },
];

describe('resolveQuickActionRow', () => {
  const now = new Date('2026-08-18T22:30:00Z'); // 01:30 on the 19th in Kyiv

  it('writes fixed values through the column type', () => {
    const fields: QuickField[] = [
      { columnId: 'pet', kind: 'fixed', value: 'Арчі' },
      { columnId: 'temp', kind: 'fixed', value: '37,2' },
      { columnId: 'done', kind: 'fixed', value: 'так' },
    ];

    const { rowData, missing } = resolveQuickActionRow(fields, {
      now,
      timeZone: 'Europe/Kyiv',
      columns,
    });

    expect(missing).toEqual([]);
    // The comma is a decimal separator here, not a thousands separator.
    expect(rowData).toEqual({ pet: 'Арчі', temp: 37.2, done: true });
  });

  // The bug this guards is the one the whole codebase keeps re-fixing: a date
  // taken from the server's clock. At 01:30 in Kyiv the server is still on the
  // previous day, and a medication log filed a day early is never noticed.
  it('stamps the day in the user zone, not the server one', () => {
    const fields: QuickField[] = [{ columnId: 'day', kind: 'today' }];

    expect(
      resolveQuickActionRow(fields, { now, timeZone: 'Europe/Kyiv', columns }).rowData.day
    ).toBe('2026-08-19');
    expect(resolveQuickActionRow(fields, { now, timeZone: 'UTC', columns }).rowData.day).toBe(
      '2026-08-18'
    );
  });

  it('keeps a stamped day a bare calendar date, never an instant', () => {
    const { rowData } = resolveQuickActionRow([{ columnId: 'day', kind: 'today' }], {
      now,
      timeZone: 'Europe/Kyiv',
      columns,
    });

    // An ISO instant here renders as the previous day west of Greenwich and
    // makes `<input type="date">` show nothing.
    expect(rowData.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stamps `now` as the local wall clock, to the minute', () => {
    const { rowData } = resolveQuickActionRow([{ columnId: 'what', kind: 'now' }], {
      now,
      timeZone: 'Europe/Kyiv',
      columns,
    });

    expect(rowData.what).toBe('2026-08-19 01:30');
  });

  it('reports an unanswered question instead of writing a blank', () => {
    const fields: QuickField[] = [
      { columnId: 'pet', kind: 'fixed', value: 'Артем' },
      { columnId: 'temp', kind: 'ask', prompt: 'Температура' },
    ];

    const { rowData, missing } = resolveQuickActionRow(fields, {
      now,
      timeZone: 'Europe/Kyiv',
      columns,
      answers: { temp: '   ' },
    });

    expect(missing).toEqual(['Температура']);
    // An empty column would read as "measured and found nothing".
    expect(rowData).not.toHaveProperty('temp');
  });

  it('reads an answer into the column type', () => {
    const { rowData, missing } = resolveQuickActionRow(
      [{ columnId: 'temp', kind: 'ask', prompt: 'Температура' }],
      { now, timeZone: 'Europe/Kyiv', columns, answers: { temp: '37,4' } }
    );

    expect(missing).toEqual([]);
    expect(rowData.temp).toBe(37.4);
  });

  it('caps what one answer can carry', () => {
    const { rowData } = resolveQuickActionRow([{ columnId: 'what', kind: 'ask' }], {
      now,
      timeZone: 'Europe/Kyiv',
      columns,
      answers: { what: 'я'.repeat(MAX_ANSWER_LENGTH + 50) },
    });

    expect(String(rowData.what)).toHaveLength(MAX_ANSWER_LENGTH);
  });

  // Columns can be renamed and deleted from the table editor while a button
  // still points at them. Writing under a dead key produces a row whose data
  // is invisible in every view of it.
  it('skips a field whose column no longer exists', () => {
    const { rowData, missing } = resolveQuickActionRow(
      [
        { columnId: 'pet', kind: 'fixed', value: 'Арчі' },
        { columnId: 'deleted_column', kind: 'fixed', value: 'x' },
      ],
      { now, timeZone: 'Europe/Kyiv', columns }
    );

    expect(rowData).toEqual({ pet: 'Арчі' });
    expect(missing).toEqual([]);
  });

  it('does not treat a deleted ask column as an unanswered question', () => {
    const { missing } = resolveQuickActionRow(
      [{ columnId: 'gone', kind: 'ask', prompt: 'Доза' }],
      { now, timeZone: 'Europe/Kyiv', columns }
    );

    expect(missing).toEqual([]);
  });
});

describe('askFields / promptFor', () => {
  it('falls back to the column name when no prompt was saved', () => {
    const field: QuickField = { columnId: 'temp', kind: 'ask' };
    expect(promptFor(field, columns)).toBe('Температура');
  });

  it('prefers the saved prompt', () => {
    expect(promptFor({ columnId: 'temp', kind: 'ask', prompt: 'Скільки?' }, columns)).toBe(
      'Скільки?'
    );
  });

  it('keeps ask fields in the order they were saved', () => {
    const fields: QuickField[] = [
      { columnId: 'temp', kind: 'ask' },
      { columnId: 'day', kind: 'today' },
      { columnId: 'what', kind: 'ask' },
    ];
    expect(askFields(fields).map((f) => f.columnId)).toEqual(['temp', 'what']);
  });
});

describe('usedToday', () => {
  const now = new Date('2026-08-18T22:30:00Z'); // 19 August, 01:30 in Kyiv

  it('answers in the user zone', () => {
    const pressed = new Date('2026-08-18T21:00:00Z'); // 19 August, 00:00 in Kyiv
    expect(usedToday(pressed, now, 'Europe/Kyiv')).toBe(true);
    expect(usedToday(pressed, now, 'UTC')).toBe(true);

    const earlier = new Date('2026-08-18T12:00:00Z'); // 18 August in both
    expect(usedToday(earlier, now, 'Europe/Kyiv')).toBe(false);
    expect(usedToday(earlier, now, 'UTC')).toBe(true);
  });

  it('is false for a button never pressed', () => {
    expect(usedToday(null, now, 'Europe/Kyiv')).toBe(false);
    expect(usedToday('not a date', now, 'Europe/Kyiv')).toBe(false);
  });
});

describe('describeRow', () => {
  it('names the values back, in column order, skipping empties', () => {
    const summary = describeRow({ what: 'ліки', pet: 'Арчі', temp: null }, columns);
    expect(summary).toBe('Хто: Арчі · Що: ліки');
  });

  it('says a boolean in words', () => {
    expect(describeRow({ done: false }, columns)).toBe('Зроблено: ні');
  });
});

describe('coerceValue', () => {
  // The timeline's rule, applied here: a calendar date parsed as an instant is
  // UTC midnight and prints as the day before west of Greenwich.
  it('leaves a bare calendar date alone', () => {
    expect(coerceValue('2026-08-19', 'date')).toBe('2026-08-19');
  });

  it('still normalises a full timestamp', () => {
    expect(coerceValue('2026-08-19T10:00:00Z', 'date')).toBe('2026-08-19T10:00:00.000Z');
  });

  it('reads Ukrainian yes/no', () => {
    expect(coerceValue('так', 'boolean')).toBe(true);
    expect(coerceValue('ні', 'boolean')).toBe(false);
    expect(coerceValue('можливо', 'boolean')).toBe(null);
  });

  it('reads a comma decimal', () => {
    expect(coerceValue('37,2', 'number')).toBe(37.2);
    expect(coerceValue('не число', 'number')).toBe(null);
  });
});

describe('telegram callback namespaces', () => {
  it('round-trips a quick action press', () => {
    const data = encodeQuickActionCallback('abc123');
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseQuickActionCallback(data)).toBe('abc123');
  });

  it('round-trips an undo inside Telegram’s 64-byte budget', () => {
    const actionId = 'a'.repeat(21);
    const rowId = 'b'.repeat(21);
    const data = encodeQuickUndoCallback(actionId, rowId);

    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
    expect(parseQuickUndoCallback(data)).toEqual({ actionId, rowId });
  });

  // The namespaces exist so a press can never be read by the wrong handler —
  // a notification's "save" arriving as a quick action would write a row.
  it('keeps the three namespaces apart', () => {
    const notification = encodeCallbackData('save');
    const quick = encodeQuickActionCallback('abc123');
    const undo = encodeQuickUndoCallback('abc123', 'row456');

    expect(parseQuickActionCallback(notification)).toBeNull();
    expect(parseQuickUndoCallback(notification)).toBeNull();
    expect(parseCallbackData(quick)).toBeNull();
    expect(parseQuickUndoCallback(quick)).toBeNull();
    expect(parseCallbackData(undo)).toBeNull();
    expect(parseQuickActionCallback(undo)).toBeNull();
  });

  it('rejects junk', () => {
    expect(parseQuickActionCallback('')).toBeNull();
    expect(parseQuickActionCallback('q:')).toBeNull();
    expect(parseQuickUndoCallback('qu:only-one-id')).toBeNull();
  });
});

describe('sanitizeLabel', () => {
  // The round-trip this protects: the prompt goes out through `stripMarkdown`,
  // and the reply is matched on the label quoted inside it. A label carrying
  // Markdown would arrive as something else and match nothing.
  it('takes the Markdown out of a label', () => {
    expect(sanitizeLabel('Арчі *ліки*')).toBe('Арчі ліки');
    expect(sanitizeLabel('  Артем   —  температура ')).toBe('Артем — температура');
  });

  it('leaves an ordinary label alone', () => {
    expect(sanitizeLabel('Арчі — ліки')).toBe('Арчі — ліки');
    expect(sanitizeLabel('Вага 💪')).toBe('Вага 💪');
  });

  // Only what a stripper would actually change. The label is printed mid-line,
  // so nothing line-anchored can reach it — taking these out cost real labels
  // their punctuation for nothing.
  it('keeps punctuation that survives the trip as itself', () => {
    expect(sanitizeLabel('Арчі — ліки (вечір)')).toBe('Арчі — ліки (вечір)');
    expect(sanitizeLabel('Вага #2')).toBe('Вага #2');
    expect(sanitizeLabel('Тиск 120/80 > норма')).toBe('Тиск 120/80 > норма');
  });

  it('breaks the link form without touching the round brackets', () => {
    // `flattenMarkdownLinks` needs `](` — losing the square half is enough.
    expect(sanitizeLabel('Ліки [ранок](x)')).toBe('Ліки ранок(x)');
  });
});

describe('labelFromPrompt', () => {
  it('reads the label back out of a prompt the bot sent', () => {
    const prompt = '«Артем — температура»\nНадішли у відповідь: Температура';
    expect(labelFromPrompt(prompt)).toBe('Артем — температура');
  });

  // The whole chain, as it actually runs: build the prompt, send it (which
  // strips Markdown and flattens links), read the label back. Every sanitised
  // label survives it — that is the property the sanitiser exists for, so it
  // is checked over the awkward ones rather than over one.
  it.each([
    'Арчі *ліки*',
    'Арчі — ліки (вечір)',
    'Ліки _ранок_',
    'Вага #2',
    'Ліки [ранок](https://x.test)',
    'Тиск 120/80 > норма',
    '`Цукор`',
  ])('survives the trip through sendMessage’s stripping: %s', (raw) => {
    const label = sanitizeLabel(raw);
    const sent = stripMarkdown(flattenMarkdownLinks(buildPromptText(label, ['Доза'])));
    expect(labelFromPrompt(sent)).toBe(label);
  });

  it('ignores a reply to anything else', () => {
    expect(labelFromPrompt('Що в мене завтра?')).toBeNull();
    expect(labelFromPrompt(undefined)).toBeNull();
    expect(labelFromPrompt('«»')).toBeNull();
  });
});

describe('splitAnswers', () => {
  it('does not split when only one value was asked for', () => {
    // The single field is usually free text, and a note with a comma in it is
    // still one note.
    expect(splitAnswers('37.2, після сну', 1)).toEqual(['37.2, після сну']);
  });

  it('splits on commas up to the number of questions', () => {
    expect(splitAnswers('37.2, після сну', 2)).toEqual(['37.2', 'після сну']);
  });

  it('gives the trailing commas to the last field', () => {
    expect(splitAnswers('37.2, погано спав, знову', 2)).toEqual(['37.2', 'погано спав, знову']);
  });

  it('reports fewer values than asked, rather than shifting them', () => {
    expect(splitAnswers('37.2', 2)).toEqual(['37.2']);
  });
});

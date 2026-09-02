import { describe, expect, it } from 'vitest';

import {
  coerceValue,
  formatCellValue,
  fromDateInput,
  toDateInput,
} from '@/lib/utils/table-columns';

/**
 * A date column holds three shapes on purpose, and editing a cell must not
 * quietly flatten them into one. The stamp `now` writes is a wall clock with no
 * zone — deliberately, so a Kyiv user reading back when they took a pill is not
 * shown three hours of confusion — and reading it through a plain date picker
 * is how the hour disappears with nothing anywhere saying it was there.
 */
describe('toDateInput', () => {
  it('reads a bare calendar date as a date picker', () => {
    expect(toDateInput('2026-09-03')).toEqual({ type: 'date', value: '2026-09-03' });
  });

  it('reads the wall-clock stamp a quick action writes, keeping the hour', () => {
    expect(toDateInput('2026-09-03 07:15')).toEqual({
      type: 'datetime-local',
      value: '2026-09-03T07:15',
    });
  });

  it('marks a zoned instant so it is written back as one', () => {
    const read = toDateInput('2026-09-03T07:15:00.000Z');
    expect(read.type).toBe('datetime-local');
    expect(read.zoned).toBe(true);
  });

  it('falls back to text rather than an empty picker for a value it cannot read', () => {
    // An empty date picker beside a non-empty cell is one committed keystroke
    // away from erasing whatever was actually written there.
    expect(toDateInput('колись навесні')).toEqual({ type: 'text', value: 'колись навесні' });
  });

  it('reads nothing as nothing', () => {
    expect(toDateInput(null)).toEqual({ type: 'date', value: '' });
    expect(toDateInput('')).toEqual({ type: 'date', value: '' });
  });
});

describe('fromDateInput', () => {
  it('writes a bare date back bare', () => {
    // Never through `Date`: that makes it UTC midnight, which prints as the day
    // before anywhere west of Greenwich.
    expect(fromDateInput('date', '2026-09-03')).toBe('2026-09-03');
  });

  it('writes a wall-clock stamp back in the shape a quick action writes', () => {
    expect(fromDateInput('datetime-local', '2026-09-03T07:15')).toBe('2026-09-03 07:15');
  });

  it('writes a zoned instant back as an instant', () => {
    const written = fromDateInput('datetime-local', '2026-09-03T07:15', true);
    expect(String(written)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('reads a cleared cell as empty rather than as a date', () => {
    expect(fromDateInput('date', '')).toBeNull();
    expect(fromDateInput('datetime-local', '   ')).toBeNull();
  });

  it('round-trips every shape a date column actually holds', () => {
    for (const stored of ['2026-09-03', '2026-09-03 07:15']) {
      const read = toDateInput(stored);
      expect(fromDateInput(read.type, read.value, read.zoned)).toBe(stored);
    }
  });
});

describe('formatCellValue', () => {
  it('separates "no" from "nobody said"', () => {
    // The three states are why the boolean editor is a select and not a
    // checkbox: a checkbox renders "not recorded" as "no" with no way back.
    expect(formatCellValue(false, 'boolean')).toBe('No');
    expect(formatCellValue(true, 'boolean')).toBe('Yes');
    expect(formatCellValue(null, 'boolean')).toBe('');
  });

  it('shows a stored date as it is stored', () => {
    expect(formatCellValue('2026-09-03', 'date')).toBe('2026-09-03');
    expect(formatCellValue('2026-09-03 07:15', 'date')).toBe('2026-09-03 07:15');
  });

  it('leaves an unreadable date visible instead of blanking it', () => {
    expect(formatCellValue('колись навесні', 'date')).toBe('колись навесні');
  });

  it('reports an empty cell as empty so the caller can give it a target', () => {
    expect(formatCellValue(null, 'text')).toBe('');
    expect(formatCellValue('', 'number')).toBe('');
  });

  it('shows a number as itself', () => {
    expect(formatCellValue(coerceValue('37,2', 'number'), 'number')).toBe('37.2');
  });
});

/**
 * A file cell holds a resource, and only ever a resource.
 *
 * Every other write path in this app arrives as text — the model through
 * `addTableRows`, a quick-action press, the add-row form — and a string here
 * would render as a link to a resource that does not exist. That is what makes
 * a `file` column safe to offer to `createTable`: the model can create one and
 * cannot forge a value for it.
 */
describe('file cells', () => {
  const attached = { resourceId: 'res-1', name: 'аналіз крові.pdf' };

  it('keeps an attachment', () => {
    expect(coerceValue(attached, 'file')).toEqual(attached);
  });

  it('drops anything a model or a form could type into one', () => {
    expect(coerceValue('аналіз крові.pdf', 'file')).toBeNull();
    expect(coerceValue({ name: 'no id' }, 'file')).toBeNull();
    expect(coerceValue({ resourceId: '', name: 'empty id' }, 'file')).toBeNull();
    expect(coerceValue(42, 'file')).toBeNull();
  });

  it('keeps only the two fields the cell is, whatever else was sent', () => {
    expect(coerceValue({ ...attached, secret: 'x' }, 'file')).toEqual(attached);
  });

  // What `convertRowToText` embeds. An id in the vectors and the file name
  // nowhere is the row failing to be findable by the one word it is about.
  it('reads back as the file name, which is what gets embedded', () => {
    expect(formatCellValue(attached, 'file')).toBe('аналіз крові.pdf');
    expect(formatCellValue(null, 'file')).toBe('');
    expect(formatCellValue('not a file', 'file')).toBe('');
  });
});

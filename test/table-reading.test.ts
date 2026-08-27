import { describe, it, expect, vi } from 'vitest';

/**
 * Telling a sample from the data.
 *
 * The knowledge base could be written and could be searched, and nothing could
 * read a table. So "скільки разів Арчі прийняв апоквель" was answered from a
 * relevance search capped at five, over a table holding twenty-one such rows,
 * and the answer was "5" — the cap, reported as a count. The same silence read
 * an empty search as an empty table and told the user that twenty-three rows
 * were no records at all.
 *
 * These pin the two halves of the repair: a reader that states an exact total
 * and says out loud when it is handing over a page, and a search that says out
 * loud that it is a sample and that finding nothing is not finding emptiness.
 */

vi.mock('@/lib/env.mjs', () => ({ env: {} }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}));
vi.mock('ai', () => ({ embedMany: vi.fn(), embed: vi.fn(), generateObject: vi.fn() }));
vi.mock('@/lib/utils/auth', () => ({ getSessionOrNull: vi.fn() }));

import { __test as tableTest } from '@/lib/ai/tools/tables/get-table-rows';
import { __test as searchTest } from '@/lib/ai/tools/information/get-information';
import { __test as writeTest } from '@/lib/ai/tools/tables/add-table-rows';
import type { TableColumn } from '@/lib/db/schema';

const { toReadableRow, buildMessage } = tableTest;
const { answer, searchFailed, MAX_RESULTS } = searchTest;
const { rowKey } = writeTest;

const columns = [
  { id: 'дата', name: 'Дата', type: 'date' },
  { id: 'час', name: 'Час', type: 'text' },
  { id: 'назва_таблетки', name: 'Назва таблетки', type: 'text' },
  { id: 'питомість', name: 'Питомість', type: 'text' },
] as TableColumn[];

describe('reading a table', () => {
  it('says the whole table is present when it is, so a count is safe', () => {
    const message = buildMessage('Таблетки Арчі', 21, 21, 0, false);

    expect(message).toContain('exactly 21');
    expect(message).toContain('complete set');
  });

  /**
   * The regression, one layer up: a page read as the whole table is how five
   * results became "5 разів".
   */
  it('says a page is a page, and where the next one starts', () => {
    const message = buildMessage('Таблетки Арчі', 300, 50, 0, true);

    expect(message).toContain('exactly 300');
    expect(message).toContain('PAGE');
    expect(message).toContain('offset 50');
  });

  it('reports an empty table as checked, not as searched', () => {
    expect(buildMessage('Прийом ліків', 0, 0, 0, false)).toContain('no rows at all');
  });

  it('reports an empty filter as none of that thing, not as an empty table', () => {
    const message = buildMessage('Таблетки Арчі', 0, 0, 0, false, 'апоквель');

    expect(message).toContain('апоквель');
    expect(message).toContain('the whole table checked');
  });

  it('keys a row by column name, since that is what gets read back to the user', () => {
    const row = toReadableRow(
      { дата: '2026-08-20', час: 'вранці', назва_таблетки: 'апоквель', питомість: '' },
      columns
    );

    expect(row).toEqual({ Дата: '2026-08-20', Час: 'вранці', 'Назва таблетки': 'апоквель' });
    // An empty column is not a measurement, and a wall of nulls is unreadable.
    expect('Питомість' in row).toBe(false);
  });
});

describe('what a search result says it is', () => {
  const hits = Array.from({ length: MAX_RESULTS }, (_, i) => ({ content: `chunk ${i}` }));

  it('admits the cap when it hits it', () => {
    const result = answer(hits, 'скільки разів');

    expect(result.capped).toBe(true);
    expect(result.message).toContain('likely more');
    expect(result.message).toContain('do not count from it');
  });

  it('still refuses to be counted when it is under the cap', () => {
    const result = answer(hits.slice(0, 2), 'апоквель');

    expect(result.capped).toBe(false);
    expect(result.message).toContain('never the complete set');
  });

  /** "Нічого не знайшлось" is not "у тебе нічого немає". */
  it('reads an empty result as nothing matched, never as nothing exists', () => {
    const result = answer([], 'таблетки Арчі');

    expect(result.returned).toBe(0);
    expect(result.message).toContain('not a census');
    expect(result.message).toContain('getTableRows');
  });

  /** The calendar rule one layer down: a refusal is not an empty day. */
  it('reads a failure as a failure, not as an empty knowledge base', () => {
    const result = searchFailed('embedding request timed out');

    expect(result.message).toContain('did not run');
    expect(result.message).toContain('never tell the user they have nothing saved');
  });
});

describe('a row that repeats one already in the table', () => {
  it('matches through case and padding, which are not two different medicines', () => {
    expect(rowKey({ назва_таблетки: 'Апоквель', час: ' вранці ' })).toBe(
      rowKey({ час: 'вранці', назва_таблетки: 'апоквель' })
    );
  });

  it('treats an empty column and an absent one as the same row', () => {
    expect(rowKey({ час: 'вранці', питомість: '' })).toBe(rowKey({ час: 'вранці' }));
  });

  it('keeps two genuinely different rows apart', () => {
    expect(rowKey({ час: 'вранці' })).not.toBe(rowKey({ час: 'ввечері' }));
  });
});

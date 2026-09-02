/**
 * Which table was touched last, and by which hand.
 *
 * The bug behind this: the tables page counted rows with a correlated subquery
 * written as a `sql` template, and drizzle renders the outer `userTables.id`
 * *unqualified* inside a single-table select — so the condition reached
 * Postgres as `WHERE user_table_id = "id"`, where a bare `id` binds to
 * `user_tables_data` itself. Every table counted the rows whose foreign key
 * equalled their own primary key: zero, silently, with no error and no empty
 * result to notice. The page said "No rows yet" over a table filled that
 * morning and `listTables` told the model the whole account was empty.
 *
 * The counting moved to a grouped query built from column objects, where
 * qualification is not something a template has to get right. What is left to
 * test is the ordering it feeds, which is the part that is genuinely a
 * judgement: two dates, either of which can be missing.
 */
import { describe, expect, it } from 'vitest';

import { byActivity, lastActivityOf } from '@/lib/utils/table-activity';

const table = (updatedAt: string, lastEntryAt: string | null) => ({ updatedAt, lastEntryAt });

describe('lastActivityOf', () => {
  it('takes the row when rows are newer than the definition', () => {
    const t = table('2026-08-18T12:00:00Z', '2026-09-03T07:00:00Z');
    expect(lastActivityOf(t)).toBe(new Date('2026-09-03T07:00:00Z').getTime());
  });

  it('takes the definition for a table just created and never filled', () => {
    const t = table('2026-09-03T09:00:00Z', null);
    expect(lastActivityOf(t)).toBe(new Date('2026-09-03T09:00:00Z').getTime());
  });

  it('takes the definition when it is the newer of the two', () => {
    const t = table('2026-09-03T09:00:00Z', '2026-08-01T09:00:00Z');
    expect(lastActivityOf(t)).toBe(new Date('2026-09-03T09:00:00Z').getTime());
  });

  it('falls back rather than sorting an unparseable date to the bottom', () => {
    expect(lastActivityOf(table('nonsense', '2026-09-03T07:00:00Z'))).toBe(
      new Date('2026-09-03T07:00:00Z').getTime()
    );
    expect(lastActivityOf(table('nonsense', null))).toBe(0);
  });
});

describe('byActivity', () => {
  it('puts a table written to this morning above one renamed in April', () => {
    const written = table('2026-04-11T01:17:00Z', '2026-09-03T07:00:00Z');
    const renamed = table('2026-08-27T10:06:00Z', null);

    expect([renamed, written].sort(byActivity)).toEqual([written, renamed]);
  });

  it('keeps a table created moments ago on top of an old one still in use', () => {
    const fresh = table('2026-09-03T10:00:00Z', null);
    const inUse = table('2026-01-01T00:00:00Z', '2026-09-03T08:00:00Z');

    expect([inUse, fresh].sort(byActivity)).toEqual([fresh, inUse]);
  });
});

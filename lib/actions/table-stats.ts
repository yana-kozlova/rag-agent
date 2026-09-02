import { inArray } from 'drizzle-orm';
import { count, max } from 'drizzle-orm';

import { db } from '@/lib/db';
import { userTablesData } from '@/lib/db/schema';

/**
 * How many rows a table holds and when the newest was written.
 *
 * One grouped query rather than a correlated subquery per table, and that is a
 * correctness fix rather than a preference. Written as
 * `(SELECT COUNT(*) FROM user_tables_data WHERE user_table_id = ${userTables.id})`
 * drizzle renders the outer reference **unqualified** — the `sql` template drops
 * the table prefix on a single-table select, so the condition reaches Postgres
 * as `WHERE user_table_id = "id"`, and inside the subquery a bare `id` resolves
 * against `user_tables_data` itself. Every table therefore counted the rows
 * whose `user_table_id` equalled their own primary key: always zero, always
 * `NULL` for the date, and never an error. The tables page reported "No rows
 * yet" over a table filled that morning, and `listTables` had been telling the
 * model that every table on the account was empty.
 *
 * Aggregating with drizzle's own `count()`/`max()` removes the possibility: the
 * grouping column is a column object, so the qualification is not something a
 * template has to get right.
 */
export type TableStats = {
  rowCount: number;
  lastEntryAt: Date | null;
};

export async function tableRowStats(tableIds: string[]): Promise<Map<string, TableStats>> {
  const stats = new Map<string, TableStats>();
  // `inArray` with nothing in it is not a query worth sending, and drizzle
  // builds `in ()` for it, which Postgres rejects outright.
  if (tableIds.length === 0) return stats;

  const rows = await db
    .select({
      tableId: userTablesData.userTableId,
      rowCount: count(),
      lastEntryAt: max(userTablesData.createdAt),
    })
    .from(userTablesData)
    .where(inArray(userTablesData.userTableId, tableIds))
    .groupBy(userTablesData.userTableId);

  for (const row of rows) {
    stats.set(row.tableId, {
      rowCount: Number(row.rowCount) || 0,
      lastEntryAt: row.lastEntryAt ? new Date(row.lastEntryAt) : null,
    });
  }

  // A table nobody has written to contributes no group, which is the absence
  // the caller reads as zero rather than as "not looked up".
  return stats;
}

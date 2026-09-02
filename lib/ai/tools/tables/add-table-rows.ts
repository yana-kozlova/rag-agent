import { z } from 'zod';
import { getSessionOrNull } from '@/lib/utils/auth';
import { detectRepeatingRow } from '@/lib/quick-actions/detect';
import { quickActions } from '@/lib/db/schema';
import type { QuickField } from '@/lib/quick-actions/quick-actions';
import { db } from '@/lib/db';
import { userTables, userTablesData, type TableColumn } from '@/lib/db/schema';
import { eq, and, desc, ilike } from 'drizzle-orm';
import { createTableRowsBulk } from '@/lib/actions/user-tables';

function coerceValue(value: any, type: TableColumn['type']): any {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = String(value).toLowerCase().trim();
      if (['true', 'yes', 'y', '1', 'так', 'да'].includes(s)) return true;
      if (['false', 'no', 'n', '0', 'ні', 'нет'].includes(s)) return false;
      return null;
    }
    case 'date': {
      if (value instanceof Date) return value.toISOString();
      const d = new Date(String(value));
      return isNaN(d.getTime()) ? String(value) : d.toISOString();
    }
    default:
      return String(value);
  }
}

function mapRowToColumnIds(
  row: Record<string, any>,
  columns: TableColumn[]
): Record<string, any> {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const byNameLower = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(row)) {
    let column: TableColumn | undefined;
    if (byId.has(key)) {
      column = byId.get(key);
    } else if (byNameLower.has(key.toLowerCase())) {
      column = byNameLower.get(key.toLowerCase());
    }
    if (column) {
      result[column.id] = coerceValue(value, column.type);
    }
  }
  return result;
}

export const addTableRowsTool = {
  description: `Add rows to a user table (by tableId or tableTitle). Keys can be column names or IDs. Pass sourceResourceIdsPerRow to link rows back to source notes.

    THIS ONLY APPENDS. There is no editing and no deleting from here: a row that came out wrong is repaired by the user on /tables/<id>, and writing a corrected copy leaves BOTH in the table. So if your last write was wrong, say so and point them at the page — never "fix" it with another call.

    Where the values come from matters. Copying rows out of another table means reading it with getTableRows first; never retype rows out of a getInformation result or out of the conversation. A search returns whatever is semantically near the question — that is how a note about the user's own headache pill was written into the dog's medication table as a row that had never existed.

    The result reports rows that repeat one the table already had. Pass that on rather than reporting a clean save.`,
  inputSchema: z.object({
    tableId: z.string().optional().describe('The ID of the target table (preferred if known)'),
    tableTitle: z.string().optional().describe('The title of the target table (used if tableId not provided)'),
    rows: z
      .array(z.record(z.string(), z.any()))
      .min(1)
      .describe('Array of row objects. Each key should match a column name or ID.'),
    sourceResourceIdsPerRow: z
      .array(z.array(z.string()))
      .optional()
      .describe(
        'Optional parallel array: sourceResourceIdsPerRow[i] is the list of resource IDs that row[i] was derived from. Use this when populating a table from existing notes so back-links are created.'
      ),
  }),
  execute: async ({
    tableId,
    tableTitle,
    rows,
    sourceResourceIdsPerRow,
  }: {
    tableId?: string;
    tableTitle?: string;
    rows: Array<Record<string, any>>;
    sourceResourceIdsPerRow?: Array<string[]>;
  }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    if (!tableId && !tableTitle) {
      return { success: false, message: 'Either tableId or tableTitle must be provided.' };
    }

    let table: typeof userTables.$inferSelect | undefined;

    if (tableId) {
      const [found] = await db
        .select()
        .from(userTables)
        .where(and(eq(userTables.id, tableId), eq(userTables.userId, session.user.id as string)))
        .limit(1);
      table = found;
    }

    if (!table && tableTitle) {
      const matches = await db
        .select()
        .from(userTables)
        .where(
          and(
            eq(userTables.userId, session.user.id as string),
            ilike(userTables.title, `%${tableTitle.trim()}%`)
          )
        )
        .limit(5);

      // Prefer exact match
      const lower = tableTitle.trim().toLowerCase();
      table =
        matches.find((m) => m.title.toLowerCase() === lower) ??
        matches.find((m) => m.title.toLowerCase().startsWith(lower)) ??
        matches[0];
    }

    if (!table) {
      return {
        success: false,
        message: `Table not found. ${tableTitle ? `Searched for: "${tableTitle}".` : `ID: "${tableId}".`} Use listTables to see available tables.`,
      };
    }

    const columns = table.columns as TableColumn[];
    const mappedRows = rows.map((r) => mapRowToColumnIds(r, columns));

    // Drop rows where nothing mapped (would be empty), preserving source-link alignment
    const nonEmptyRows: Record<string, any>[] = [];
    const nonEmptySourceIds: Array<string[] | undefined> = [];
    mappedRows.forEach((r, i) => {
      if (Object.keys(r).length > 0) {
        nonEmptyRows.push(r);
        nonEmptySourceIds.push(sourceResourceIdsPerRow?.[i]);
      }
    });

    if (nonEmptyRows.length === 0) {
      return {
        success: false,
        message: `None of the provided row keys matched columns in "${table.title}". Available columns: ${columns
          .map((c) => `${c.name} (${c.type})`)
          .join(', ')}.`,
      };
    }

    // Asked before writing, so it can only ever match a row that was already
    // there. See `findDuplicates`.
    const duplicates = await findDuplicates(table.id, nonEmptyRows, columns);

    const result = await createTableRowsBulk({
      userTableId: table.id,
      rows: nonEmptyRows,
      sourceResourceIdsPerRow: nonEmptySourceIds.some((s) => s && s.length > 0)
        ? nonEmptySourceIds
        : undefined,
    });

    if (!result.success) {
      return { success: false, message: result.message };
    }

    // Having written the row, look at whether it is the same row as last time,
    // and the time before. The repetition is in the table — this is the moment
    // it is worth acting on, because the user is here and has just done the
    // thing by hand again.
    const routine = await detectRoutine(table.id, columns);

    const named = duplicates
      .slice(0, MAX_REPORTED_DUPLICATES)
      .map((d) => `"${d}"`)
      .join(', ');

    const warning = duplicates.length
      ? ` WARNING: ${duplicates.length} of them repeat a row this table already had, character for character` +
        ` (${named}). They were written anyway. Say so plainly rather than reporting a clean save — if this` +
        ` was another attempt at a row that came out wrong, the earlier one is still there, and the repair is` +
        ` on /tables/${table.id}, not another write.`
      : '';

    return {
      success: true,
      message: routine
        ? `Added ${result.count} row(s) to "${table.title}".${warning} NOTICED: this same row has been written ${routine.occurrences} times on ${routine.days} different days (${routine.values.join(' · ')}). Offer the user a one-tap button for it — say what it would write, and on a yes call createQuickAction with label "${routine.label}" and exactly these fields: ${JSON.stringify(routine.fields)}. Do not re-derive them and do not add questions.`
        : `Added ${result.count} row(s) to "${table.title}".${warning}`,
      tableId: table.id,
      tableTitle: table.title,
      addedCount: result.count,
      skipped: rows.length - nonEmptyRows.length,
      duplicatedCount: duplicates.length,
      ...(routine ? { routine } : {}),
    };
  },
} as const;

/**
 * The routine this table is already recording, if it has one and no button
 * covers it yet.
 *
 * Two queries on a path that has just written rows, and both are bounded and
 * indexed. Never fatal: the row is saved either way, and a failure here costs
 * an offer rather than the user's data.
 */
async function detectRoutine(tableId: string, columns: TableColumn[]) {
  try {
    const [recent, existing] = await Promise.all([
      db
        .select({ rowData: userTablesData.rowData, createdAt: userTablesData.createdAt })
        .from(userTablesData)
        .where(eq(userTablesData.userTableId, tableId))
        .orderBy(desc(userTablesData.createdAt))
        .limit(60),
      // Already offered and accepted: those routines are not news. Handed to
      // the detector rather than checked against its answer, so a table with a
      // morning routine and an evening one can still offer the second.
      db
        .select({ fields: quickActions.fields })
        .from(quickActions)
        .where(eq(quickActions.tableId, tableId)),
    ]);

    return detectRepeatingRow(
      columns,
      recent.map((r) => ({
        rowData: (r.rowData ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt ?? new Date(),
      })),
      existing.map((row) => (row.fields ?? []) as QuickField[])
    );
  } catch (error) {
    console.error('[addTableRows] routine detection failed (non-fatal):', error);
    return null;
  }
}

/** How many of the repeated rows to name in the result before it is a wall. */
const MAX_REPORTED_DUPLICATES = 3;

/** How far back to look for a repeat. A row from March is not this mistake. */
const MAX_ROWS_COMPARED = 200;

/**
 * Rows that already exist in this table, word for word.
 *
 * Reported, and written anyway. The precedent is the tasks index, which refuses
 * a duplicate but only on an identity narrow enough to be sure — here there is
 * no identity at all, and two genuinely identical rows can be genuinely
 * meant (two coffees, two doses, a table with no date column). Silently
 * swallowing the second is unrecoverable, since nobody knows it was asked for;
 * a visible duplicate is one click from gone.
 *
 * What it does end is the silence. Asked to transfer rows between two tables —
 * an operation with no tool, so improvised out of a five-result search — the
 * assistant went round five times, each round appending more nearly-right rows
 * and reporting "готово, тепер коректно". Every one of those rounds rewrote
 * rows already present. The write it cannot prevent, it can at least refuse to
 * call a clean save.
 *
 * Matching is on the coerced values, trimmed and case-folded: `addTableRows`
 * has already run each value through `coerceValue`, so "19.08.26" and
 * "2026-08-19" arrive as the same string, while "Апоквель" and "апоквель" are
 * the same word twice and not two medicines.
 */
async function findDuplicates(
  tableId: string,
  incoming: Record<string, any>[],
  columns: TableColumn[]
): Promise<string[]> {
  if (incoming.length === 0) return [];

  try {
    const existing = await db
      .select({ rowData: userTablesData.rowData })
      .from(userTablesData)
      .where(eq(userTablesData.userTableId, tableId))
      .orderBy(desc(userTablesData.createdAt))
      .limit(MAX_ROWS_COMPARED);

    const seen = new Set(existing.map((r) => rowKey((r.rowData ?? {}) as Record<string, any>)));
    const repeated: string[] = [];

    for (const row of incoming) {
      const key = rowKey(row);
      if (!seen.has(key)) {
        // Two identical rows in one call are one mistake, not two: the second
        // is counted against the first rather than reported all over again.
        seen.add(key);
        continue;
      }
      repeated.push(describeRow(row, columns));
    }

    return repeated;
  } catch (error) {
    // A save is not worth losing over a warning that could not be computed.
    console.error('[addTableRows] duplicate check failed (non-fatal):', error);
    return [];
  }
}

/** A row as one comparable string. Empty columns are absent, never null. */
function rowKey(rowData: Record<string, any>): string {
  const entries = Object.entries(rowData)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => [k, String(v).trim().toLowerCase()] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

/** The row in words, for naming it back in the warning. */
function describeRow(rowData: Record<string, any>, columns: TableColumn[]): string {
  return columns
    .filter((c) => rowData[c.id] !== null && rowData[c.id] !== undefined && rowData[c.id] !== '')
    .map((c) => String(rowData[c.id]))
    .join(' · ');
}

export const __test = { rowKey, describeRow };

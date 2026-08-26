import { z } from 'zod';
import { getSessionOrNull } from '@/lib/utils/auth';
import { detectRepeatingRow, signatureOf } from '@/lib/quick-actions/detect';
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
  description: `Add rows to a user table (by tableId or tableTitle). Keys can be column names or IDs. Pass sourceResourceIdsPerRow to link rows back to source notes.`,
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

    return {
      success: true,
      message: routine
        ? `Added ${result.count} row(s) to "${table.title}". NOTICED: this same row has been written ${routine.occurrences} times on ${routine.days} different days (${routine.values.join(' · ')}). Offer the user a one-tap button for it — say what it would write, and on a yes call createQuickAction with label "${routine.label}" and exactly these fields: ${JSON.stringify(routine.fields)}. Do not re-derive them and do not add questions.`
        : `Added ${result.count} row(s) to "${table.title}".`,
      tableId: table.id,
      tableTitle: table.title,
      addedCount: result.count,
      skipped: rows.length - nonEmptyRows.length,
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
    const recent = await db
      .select({ rowData: userTablesData.rowData, createdAt: userTablesData.createdAt })
      .from(userTablesData)
      .where(eq(userTablesData.userTableId, tableId))
      .orderBy(desc(userTablesData.createdAt))
      .limit(60);

    const found = detectRepeatingRow(
      columns,
      recent.map((r) => ({
        rowData: (r.rowData ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt ?? new Date(),
      }))
    );
    if (!found) return null;

    // Already offered and accepted: the button exists, so this is not news.
    const existing = await db
      .select({ fields: quickActions.fields })
      .from(quickActions)
      .where(eq(quickActions.tableId, tableId));

    const taken = new Set(
      existing.map((row) => signatureOf((row.fields ?? []) as QuickField[]))
    );

    return taken.has(found.signature) ? null : found;
  } catch (error) {
    console.error('[addTableRows] routine detection failed (non-fatal):', error);
    return null;
  }
}

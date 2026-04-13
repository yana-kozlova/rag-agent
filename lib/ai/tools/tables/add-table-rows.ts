import { z } from 'zod';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables, type TableColumn } from '@/lib/db/schema';
import { eq, and, ilike } from 'drizzle-orm';
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
  description: `Add one or more rows to an existing user table.
    Use this to populate a table the user asked you to fill, or to add entries the user mentions in conversation.
    You can reference the table by its ID (from createTable or listTables) or by its title.
    Row data keys can be either column IDs or column names — the tool will match them case-insensitively.
    If unsure which table to use, call listTables first.

    **Second-brain pattern:** when a row is derived from one or more of the user's notes/resources
    (for example via getInformation or extractToTable), pass the originating resource IDs in
    sourceResourceIdsPerRow. This creates a bi-directional link so the note knows which row it
    produced and the row knows which notes it came from.`,
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
    const session = await auth();
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

    return {
      success: true,
      message: `Added ${result.count} row(s) to "${table.title}".`,
      tableId: table.id,
      tableTitle: table.title,
      addedCount: result.count,
      skipped: rows.length - nonEmptyRows.length,
    };
  },
} as const;

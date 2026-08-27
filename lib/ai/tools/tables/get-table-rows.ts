import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { userTables, userTablesData, type TableColumn } from '@/lib/db/schema';
import { getSessionOrNull } from '@/lib/utils/auth';

/**
 * Read a table.
 *
 * Everything else in this group writes. Until this existed the only way to a
 * table's contents was `getInformation`, which is a top-k semantic search with
 * a hard cap of five results — so "скільки разів Арчі прийняв апоквель" was
 * answered "5" over a table holding twenty-one such rows, and the five were
 * simply the size of the cap. `listTables` was no help either: it reports a row
 * *count* and no rows, which is why an assistant asked to show a table either
 * recited whatever the search happened to match or announced that a table of
 * twenty-three rows was empty.
 *
 * The distinction this restores is between a *sample* and *the data*. Retrieval
 * answers "what is relevant to this question", which is a fine answer to a
 * question and a terrible answer to "how many" or "show me all of it". This
 * answers those: an exact `total`, the rows themselves, and an explicit
 * `hasMore` so a page boundary can never be read as the end of the table.
 *
 * Deliberately no writing here — not a correction, not a deletion. A wrong row
 * is repaired on the table page, on the precedent that closes a task from chat
 * and deletes it from a route: the failure this comes out of was five rounds of
 * the assistant "fixing" a transfer by appending five more wrong rows.
 */

/** Rows per call. Enough to read a habit off; short of filling the context. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Cell text handed to the model. Longer than this and it is a document. */
const MAX_CELL_LENGTH = 300;

export const getTableRowsTool = {
  description: `Read the actual rows of one of the user's tables, with an exact total.

    USE THIS, NOT getInformation, whenever the question is about a table's contents: "скільки разів...", "покажи всі записи", "що вже є в таблиці", "перенеси дані з таблиці X". getInformation is a relevance search with a hard cap — counting from it, or presenting it as the whole table, is always wrong.

    Returns "total" (every row matching the query, exact) alongside at most ${DEFAULT_LIMIT} rows. When "hasMore" is true you have a page, not the table: page on with "offset", or narrow with "contains" — never report the rows you were given as if they were all of them.

    To copy rows between tables: read the source here, then write them with addTableRows. Never retype rows out of a search result or out of the conversation — that is how a note about the user's own headache pill ended up as a row in the dog's medication table.

    An empty result means this table has no such rows. It is not a reason to say the user has nothing recorded elsewhere.`,
  inputSchema: z.object({
    tableId: z.string().optional().describe('The table ID (preferred if known)'),
    tableTitle: z
      .string()
      .optional()
      .describe('The table title, if the ID is not known. Matched loosely.'),
    contains: z
      .string()
      .optional()
      .describe(
        'Optional: keep only rows containing this text in any column, case-insensitive. Use it to count one thing in a mixed table ("апоквель").'
      ),
    limit: z
      .number()
      .optional()
      .describe(`Rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). "total" is exact regardless.`),
    offset: z.number().optional().describe('Rows to skip, for paging through a long table.'),
    order: z
      .enum(['newest', 'oldest'])
      .optional()
      .describe('By when the row was written. Default "newest".'),
  }),
  execute: async ({
    tableId,
    tableTitle,
    contains,
    limit,
    offset,
    order,
  }: {
    tableId?: string;
    tableTitle?: string;
    contains?: string;
    limit?: number;
    offset?: number;
    order?: 'newest' | 'oldest';
  }) => {
    const session = await getSessionOrNull();
    const userId = session?.user?.id;
    if (!userId) throw new Error('Unauthorized');

    if (!tableId && !tableTitle) {
      return { success: false, message: 'Either tableId or tableTitle must be provided.' };
    }

    const table = await findTable(userId, tableId, tableTitle);
    if (!table) {
      return {
        success: false,
        message: `Table not found. ${
          tableTitle ? `Searched for: "${tableTitle}".` : `ID: "${tableId}".`
        } Use listTables to see what exists.`,
      };
    }

    const columns = (table.columns as TableColumn[]) ?? [];
    const term = contains?.trim();

    // Substring over the stored JSON rather than per column: the model asking
    // "апоквель" does not know or care which column holds it, and a filter that
    // needed the column named would be a filter nobody could use.
    const where = and(
      eq(userTablesData.userTableId, table.id),
      ...(term ? [sql`${userTablesData.rowData}::text ILIKE ${`%${term}%`}`] : [])
    );

    const take = Math.min(Math.max(1, Math.trunc(limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
    const skip = Math.max(0, Math.trunc(offset ?? 0));

    const [[{ total }], rows] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(userTablesData).where(where),
      db
        .select({
          id: userTablesData.id,
          rowData: userTablesData.rowData,
          createdAt: userTablesData.createdAt,
        })
        .from(userTablesData)
        .where(where)
        .orderBy(order === 'oldest' ? asc(userTablesData.createdAt) : desc(userTablesData.createdAt))
        .limit(take)
        .offset(skip),
    ]);

    const hasMore = skip + rows.length < total;

    return {
      success: true,
      tableId: table.id,
      tableTitle: table.title,
      tableUrl: `/tables/${table.id}`,
      columns: columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      // The number that answers "how many". Exact, and never the length of the
      // array beside it — reading a count off a page is the whole bug this tool
      // exists to end.
      total,
      returned: rows.length,
      offset: skip,
      hasMore,
      rows: rows.map((r) => toReadableRow(r.rowData, columns)),
      message: buildMessage(table.title, total, rows.length, skip, hasMore, term),
    };
  },
} as const;

/**
 * A row keyed by column *name*, which is what the model and the user both say.
 *
 * Keyed by id it reads as `{"назва_таблетки": "апоквель"}` — legible enough to
 * be repeated back to the user with the underscores in it, which has happened.
 * Columns the row leaves empty are omitted rather than sent as null: an empty
 * column is not a measurement, and a wall of nulls is what makes a long result
 * unreadable.
 */
function toReadableRow(
  rowData: unknown,
  columns: TableColumn[]
): Record<string, string | number | boolean> {
  const data = (rowData ?? {}) as Record<string, unknown>;
  const readable: Record<string, string | number | boolean> = {};

  for (const column of columns) {
    const value = data[column.id];
    if (value === null || value === undefined || value === '') continue;
    readable[column.name] =
      typeof value === 'number' || typeof value === 'boolean'
        ? value
        : String(value).slice(0, MAX_CELL_LENGTH);
  }

  return readable;
}

/**
 * The count in words, because the number alone gets restated as the array length.
 *
 * The AI SDK feeds a tool result back as text, and a model reading `total: 21`
 * beside twenty-one objects will say "21" — but reading `total: 21` beside a
 * page of 50 out of 300 has no such prompt. Saying which is which in the
 * sentence is the same rule the briefing follows for weekdays and lateness:
 * anything derived from the numbers is the application's job.
 */
function buildMessage(
  title: string,
  total: number,
  returned: number,
  offset: number,
  hasMore: boolean,
  term?: string
): string {
  const scope = term ? `rows containing "${term}"` : 'rows';

  if (total === 0) {
    return term
      ? `"${title}" has no ${scope}. That is the whole table checked, not a search — the answer is none.`
      : `"${title}" is empty — it has no rows at all.`;
  }

  if (!hasMore && offset === 0) {
    return `"${title}" has exactly ${total} ${scope}, and all ${total} are below. This is the complete set: count from it freely.`;
  }

  return `"${title}" has exactly ${total} ${scope}. Showing ${returned} of them, starting at ${offset}. The rows below are a PAGE — use "total" for any count, and offset ${
    offset + returned
  } for the next page.`;
}

async function findTable(userId: string, tableId?: string, tableTitle?: string) {
  if (tableId) {
    const [found] = await db
      .select({ id: userTables.id, title: userTables.title, columns: userTables.columns })
      .from(userTables)
      .where(and(eq(userTables.id, tableId), eq(userTables.userId, userId)))
      .limit(1);
    if (found) return found;
  }

  if (!tableTitle) return undefined;

  const matches = await db
    .select({ id: userTables.id, title: userTables.title, columns: userTables.columns })
    .from(userTables)
    .where(
      and(
        eq(userTables.userId, userId),
        sql`${userTables.title} ILIKE ${`%${tableTitle.trim()}%`}`
      )
    )
    .limit(5);

  const lower = tableTitle.trim().toLowerCase();
  return (
    matches.find((m) => m.title.toLowerCase() === lower) ??
    matches.find((m) => m.title.toLowerCase().startsWith(lower)) ??
    matches[0]
  );
}

export const __test = { toReadableRow, buildMessage, DEFAULT_LIMIT, MAX_LIMIT };

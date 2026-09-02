import { z } from 'zod';
import { getSessionOrNull } from '@/lib/utils/auth';
import { db } from '@/lib/db';
import { userTables, quickActions, type TableColumn } from '@/lib/db/schema';
import { tableRowStats } from '@/lib/actions/table-stats';
import { eq, and, ilike, sql, desc, inArray, asc } from 'drizzle-orm';

export const listTablesTool = {
  description: `List the user's existing data tables with their columns, row counts and existing quick-action buttons.
    Use this to find an existing table before adding rows to it, or when the user asks what tables they have.
    The quickActions on each table are the one-tap buttons already saved for it — check them before calling createQuickAction so you don't create a second button for a routine that already has one.
    Optionally filter by a search term matching title or description.`,
  inputSchema: z.object({
    search: z.string().optional().describe('Optional search term to filter tables by title or description'),
  }),
  execute: async ({ search }: { search?: string }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const conditions = [eq(userTables.userId, session.user.id as string)];
    if (search && search.trim()) {
      const pattern = `%${search.trim()}%`;
      conditions.push(
        sql`(${userTables.title} ILIKE ${pattern} OR COALESCE(${userTables.description}, '') ILIKE ${pattern})`
      );
    }

    const rows = await db
      .select({
        id: userTables.id,
        title: userTables.title,
        description: userTables.description,
        columns: userTables.columns,
        updatedAt: userTables.updatedAt,
      })
      .from(userTables)
      .where(and(...conditions))
      .orderBy(desc(userTables.updatedAt))
      .limit(20);

    if (rows.length === 0) {
      return {
        success: true,
        message: search ? `No tables matching "${search}".` : 'No tables yet.',
        tables: [],
      };
    }

    // The count used to be a correlated subquery in the select above, and it
    // answered 0 for every table on the account — `sql` renders the outer
    // `userTables.id` unqualified, so inside the subquery it bound to
    // `user_tables_data.id` instead. The model was told the user had nothing
    // saved anywhere, which is the exact claim `getTableRows` exists to stop it
    // making. See `tableRowStats`.
    const stats = await tableRowStats(rows.map((r) => r.id));

    // One extra query rather than a join: a table usually has no buttons, and
    // joining would multiply every table row by them for a field that is
    // empty most of the time.
    const buttons = await db
      .select({
        tableId: quickActions.tableId,
        label: quickActions.label,
        useCount: quickActions.useCount,
      })
      .from(quickActions)
      .where(
        and(
          eq(quickActions.userId, session.user.id as string),
          inArray(
            quickActions.tableId,
            rows.map((r) => r.id)
          )
        )
      )
      .orderBy(asc(quickActions.createdAt));

    const buttonsByTable = new Map<string, Array<{ label: string; useCount: number }>>();
    for (const b of buttons) {
      const list = buttonsByTable.get(b.tableId) ?? [];
      list.push({ label: b.label, useCount: b.useCount });
      buttonsByTable.set(b.tableId, list);
    }

    return {
      success: true,
      message: `Found ${rows.length} table(s).`,
      tables: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        rowCount: stats.get(r.id)?.rowCount ?? 0,
        columns: (r.columns as TableColumn[]).map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
        })),
        quickActions: buttonsByTable.get(r.id) ?? [],
      })),
    };
  },
} as const;

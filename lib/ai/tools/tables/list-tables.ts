import { z } from 'zod';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables, userTablesData, type TableColumn } from '@/lib/db/schema';
import { eq, and, ilike, sql, desc } from 'drizzle-orm';

export const listTablesTool = {
  description: `List the user's existing data tables with their columns and row counts.
    Use this to find an existing table before adding rows to it, or when the user asks what tables they have.
    Optionally filter by a search term matching title or description.`,
  inputSchema: z.object({
    search: z.string().optional().describe('Optional search term to filter tables by title or description'),
  }),
  execute: async ({ search }: { search?: string }) => {
    const session = await auth();
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
        rowCount: sql<number>`(SELECT COUNT(*)::int FROM ${userTablesData} WHERE ${userTablesData.userTableId} = ${userTables.id})`,
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

    return {
      success: true,
      message: `Found ${rows.length} table(s).`,
      tables: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        rowCount: r.rowCount,
        columns: (r.columns as TableColumn[]).map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
        })),
      })),
    };
  },
} as const;

import { redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables, userTablesData } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import TablesListClient, { type UserTable } from './TablesListClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TablesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/api/auth/signin');

  const rows = await db
    .select({
      id: userTables.id,
      title: userTables.title,
      description: userTables.description,
      columns: userTables.columns,
      settings: userTables.settings,
      createdAt: userTables.createdAt,
      updatedAt: userTables.updatedAt,
      // What the card is actually read for. `userTables.updatedAt` is the last
      // time the *definition* changed — a title edit, a column added — so a
      // table written to every morning went on showing the day it was built,
      // which is the one date that cannot say whether it is still in use. Both
      // are correlated subqueries for the reason `listTables` uses one: a join
      // and a group-by over every row to put two numbers on a card is work that
      // grows with the data it is summarising.
      rowCount: sql<number>`(SELECT COUNT(*)::int FROM ${userTablesData} WHERE ${userTablesData.userTableId} = ${userTables.id})`,
      lastEntryAt: sql<Date | null>`(SELECT MAX(${userTablesData.createdAt}) FROM ${userTablesData} WHERE ${userTablesData.userTableId} = ${userTables.id})`,
    })
    .from(userTables)
    .where(eq(userTables.userId, userId))
    // Most recently *touched*, by either hand. Ordering on `updatedAt` alone
    // sorted the list by when each table was last redefined, so the one being
    // written to daily sank under one whose title was edited in April. A table
    // just created and still empty stays on top, since its own `updatedAt` is
    // the newer of the two.
    .orderBy(
      sql`GREATEST(${userTables.updatedAt}, COALESCE((SELECT MAX(${userTablesData.createdAt}) FROM ${userTablesData} WHERE ${userTablesData.userTableId} = ${userTables.id}), ${userTables.updatedAt})) DESC`
    );

  const initialTables: UserTable[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    columns: (r.columns as any) || [],
    settings: r.settings,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    rowCount: r.rowCount ?? 0,
    lastEntryAt: r.lastEntryAt ? new Date(r.lastEntryAt).toISOString() : null,
  }));

  return <TablesListClient initialTables={initialTables} />;
}

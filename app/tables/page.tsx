import { redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { tableRowStats } from '@/lib/actions/table-stats';
import { byActivity } from '@/lib/utils/table-activity';
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
    })
    .from(userTables)
    .where(eq(userTables.userId, userId))
    .orderBy(desc(userTables.updatedAt));

  // What the card is actually read for. `userTables.updatedAt` is the last time
  // the *definition* changed — a title edit, a column added — so a table
  // written to every morning went on showing the day it was built, which is the
  // one date that cannot say whether it is still in use.
  const stats = await tableRowStats(rows.map((r) => r.id));

  const initialTables: UserTable[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    columns: (r.columns as any) || [],
    settings: r.settings,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    rowCount: stats.get(r.id)?.rowCount ?? 0,
    lastEntryAt: stats.get(r.id)?.lastEntryAt?.toISOString() ?? null,
  }));

  // Ordered on what the card shows: a table filled this morning outranks one
  // whose title was edited in April, and one created five minutes ago with no
  // rows in it still sits at the top. The SQL order above only decides what
  // happens between two tables nothing has ever been written to.
  initialTables.sort(byActivity);

  return <TablesListClient initialTables={initialTables} />;
}

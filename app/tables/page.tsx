import { redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
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

  const initialTables: UserTable[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    columns: (r.columns as any) || [],
    settings: r.settings,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return <TablesListClient initialTables={initialTables} />;
}

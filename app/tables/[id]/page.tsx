import { notFound, redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables, userTablesData, quickActions } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { detectRepeatingRow, signatureOf } from '@/lib/quick-actions/detect';
import type { QuickField } from '@/lib/quick-actions/quick-actions';
import EditTableClient, { type UserTable } from './EditTableClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function EditTablePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/api/auth/signin');

  const tableId = params.id;

  // Fetch table metadata and rows in parallel, directly from the DB —
  // no API roundtrips, no client-side waterfall.
  const [tableRows, dataRows] = await Promise.all([
    db
      .select()
      .from(userTables)
      .where(eq(userTables.id, tableId))
      .limit(1),
    db
      .select({
        id: userTablesData.id,
        rowData: userTablesData.rowData,
        createdAt: userTablesData.createdAt,
      })
      .from(userTablesData)
      .where(eq(userTablesData.userTableId, tableId))
      .orderBy(desc(userTablesData.createdAt))
      .limit(500),
  ]);

  const table = tableRows[0];
  if (!table) notFound();
  if (table.userId !== userId) notFound();

  const data = dataRows.map((r, index) => {
    const rowData = r.rowData && typeof r.rowData === 'object' ? (r.rowData as Record<string, any>) : {};
    return {
      ...rowData,
      _id: r.id || `temp-${index}`,
    };
  });

  const initialTable: UserTable = {
    id: table.id,
    title: table.title,
    description: table.description,
    columns: (table.columns as any) || [],
    settings: table.settings,
    data,
  };

  // What this table is already recording, day after day. The rows are in hand,
  // so the only cost is one query for the buttons that exist — a routine that
  // already has one is not news.
  const routine = detectRepeatingRow(
    initialTable.columns,
    dataRows.map((r) => ({
      rowData: (r.rowData ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt ?? new Date(),
    }))
  );

  const existing = routine
    ? await db
        .select({ fields: quickActions.fields })
        .from(quickActions)
        .where(eq(quickActions.tableId, tableId))
    : [];

  const covered = existing.some(
    (row) => signatureOf((row.fields ?? []) as QuickField[]) === routine?.signature
  );

  return (
    <EditTableClient
      tableId={tableId}
      initialTable={initialTable}
      routine={routine && !covered ? routine : null}
    />
  );
}

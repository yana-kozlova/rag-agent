import { notFound, redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables, userTablesData, quickActions } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { detectRepeatingRow } from '@/lib/quick-actions/detect';
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
  const [tableRows, dataRows, buttons] = await Promise.all([
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
    db
      .select({ fields: quickActions.fields })
      .from(quickActions)
      .where(eq(quickActions.tableId, tableId)),
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

  // What this table is already recording, day after day — minus what already
  // has a button, which is not news. The buttons are handed to the detector
  // rather than used to filter its answer, so a table with two routines offers
  // the second one once the first is accepted.
  const routine = detectRepeatingRow(
    initialTable.columns,
    dataRows.map((r) => ({
      rowData: (r.rowData ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt ?? new Date(),
    })),
    buttons.map((row) => (row.fields ?? []) as QuickField[])
  );

  return (
    <EditTableClient tableId={tableId} initialTable={initialTable} routine={routine} />
  );
}

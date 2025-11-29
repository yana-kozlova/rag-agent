import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables, userTablesData } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

// Get all rows for a table
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Verify table belongs to user
    const [table] = await db
      .select()
      .from(userTables)
      .where(eq(userTables.id, params.id))
      .limit(1);

    if (!table) {
      return NextResponse.json({ ok: false, message: 'Table not found' }, { status: 404 });
    }

    if (table.userId !== userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 403 });
    }

    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 1000) : 100;
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

    const rows = await db
      .select({
        id: userTablesData.id,
        rowData: userTablesData.rowData,
        metadata: userTablesData.metadata,
        createdAt: userTablesData.createdAt,
        updatedAt: userTablesData.updatedAt,
      })
      .from(userTablesData)
      .where(eq(userTablesData.userTableId, params.id))
      .orderBy(desc(userTablesData.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userTablesData)
      .where(eq(userTablesData.userTableId, params.id));

    return NextResponse.json({
      ok: true,
      rows: rows.map(r => {
        const rowData = r.rowData && typeof r.rowData === 'object' ? r.rowData : {};
        return {
          ...rowData,
          _id: r.id, // Include row ID for client-side operations
        };
      }),
      pagination: {
        limit,
        offset,
        total: Number(totalCount),
        hasMore: offset + rows.length < Number(totalCount),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

// Create a new row
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { createTableRow } = await import('@/lib/actions/user-tables');
    const result = await createTableRow({
      userTableId: params.id,
      rowData: body.rowData,
      metadata: body.metadata,
    });

    if (result.success) {
      return NextResponse.json({ ok: true, id: result.id, message: result.message });
    } else {
      return NextResponse.json({ ok: false, error: result.message }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}


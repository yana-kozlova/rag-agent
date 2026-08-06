import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

// Get list of user tables
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 100) : 20;
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

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
      .where(eq(userTables.userId, userId as string))
      .orderBy(desc(userTables.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userTables)
      .where(eq(userTables.userId, userId as string));

    return NextResponse.json({
      ok: true,
      tables: rows,
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

// Create a new table
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { createUserTable } = await import('@/lib/actions/user-tables');
    const result = await createUserTable(body);

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


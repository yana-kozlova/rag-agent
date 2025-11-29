import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

// Get a single table
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

    return NextResponse.json({ ok: true, table });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

// Update a table
export async function PATCH(
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
    const { updateUserTable } = await import('@/lib/actions/user-tables');
    const result = await updateUserTable(params.id, body);

    if (result.success) {
      return NextResponse.json({ ok: true, table: result.table, message: result.message });
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

// Delete a table
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { deleteUserTable } = await import('@/lib/actions/user-tables');
    const result = await deleteUserTable(params.id);

    if (result.success) {
      return NextResponse.json({ ok: true, message: result.message });
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


import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables, userTablesData } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

// Update a row
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; rowId: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { updateTableRow } = await import('@/lib/actions/user-tables');
    const result = await updateTableRow(params.rowId, body);

    if (result.success) {
      return NextResponse.json({ ok: true, row: result.row, message: result.message });
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

// Delete a row
export async function DELETE(
  req: Request,
  { params }: { params: { id: string; rowId: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { deleteTableRow } = await import('@/lib/actions/user-tables');
    const result = await deleteTableRow(params.rowId);

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


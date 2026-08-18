import { NextResponse } from 'next/server';

import { deleteQuickAction } from '@/lib/actions/quick-actions';
import { auth } from '@/app/api/auth/auth';

export const runtime = 'nodejs';

/**
 * Forget a button.
 *
 * Nothing it wrote is touched — the rows are the record and stay in the table,
 * exactly as burying an entity leaves the notes that mention it alone. There is
 * no tombstone either, and none is needed: unlike an entity, nothing recreates
 * a quick action behind the user's back.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await deleteQuickAction(params.id);
    return result.ok
      ? NextResponse.json({ ok: true, label: result.label })
      : NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  } catch (error) {
    console.error('[quick-actions] delete failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not delete it.' }, { status: 500 });
  }
}

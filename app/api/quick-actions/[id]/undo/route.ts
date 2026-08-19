import { NextResponse } from 'next/server';

import { undoQuickActionRun } from '@/lib/actions/quick-actions';
import { auth } from '@/app/api/auth/auth';

export const runtime = 'nodejs';

/**
 * Take back the last press.
 *
 * Why this exists instead of a confirmation step: the button's value is that
 * one tap ends it, and a modal asking "are you sure" doubles the interaction
 * on the ninety-nine presses that were right to save a click on the one that
 * was not. An undo pays that cost only when it is actually owed.
 *
 * It deletes only a row this button wrote — see `undoQuickActionRun` — so a
 * guessed row id cannot be laundered through here.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rowId = typeof body?.rowId === 'string' ? body.rowId : '';
    if (!rowId) {
      return NextResponse.json({ ok: false, error: 'rowId is required.' }, { status: 400 });
    }

    const result = await undoQuickActionRun(params.id, rowId);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[quick-actions] undo failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not undo.' }, { status: 500 });
  }
}

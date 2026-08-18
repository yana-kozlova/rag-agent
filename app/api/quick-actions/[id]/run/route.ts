import { NextResponse } from 'next/server';

import { runQuickAction } from '@/lib/actions/quick-actions';
import { auth } from '@/app/api/auth/auth';

export const runtime = 'nodejs';

/**
 * A press.
 *
 * The whole feature is this route being short: session, resolve, insert. No
 * agent, no tool loop, no completion — that is the token and the four seconds
 * the user asked to stop spending on a row that never varies.
 *
 * `missing` comes back as its own field rather than folded into the message so
 * the client can reopen the form on the fields that were left blank instead of
 * making the user re-read a sentence to find out which one it meant.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const answers =
      body && typeof body.answers === 'object' && body.answers !== null ? body.answers : {};

    const result = await runQuickAction(params.id, answers);

    return result.ok
      ? NextResponse.json({
          ok: true,
          rowId: result.rowId,
          tableId: result.tableId,
          tableTitle: result.tableTitle,
          label: result.label,
          summary: result.summary,
        })
      : NextResponse.json(
          { ok: false, error: result.error, missing: result.missing },
          { status: 400 }
        );
  } catch (error) {
    console.error('[quick-actions] run failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not add the row.' }, { status: 500 });
  }
}

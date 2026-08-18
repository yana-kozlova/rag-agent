import { NextResponse } from 'next/server';

import { createQuickAction, listQuickActions } from '@/lib/actions/quick-actions';
import { auth } from '@/app/api/auth/auth';

export const runtime = 'nodejs';

/** Every button this user has, with the columns its form needs. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, quickActions: await listQuickActions() });
  } catch (error) {
    console.error('[quick-actions] list failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not load quick actions.' }, { status: 500 });
  }
}

/**
 * Save one by hand.
 *
 * The chat is the intended way in — describing the routine is faster than
 * filling a form — but a button you cannot create without asking a model is a
 * button you cannot fix when the model is what got it wrong.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await createQuickAction(await req.json());
    return result.ok
      ? NextResponse.json({ ok: true, id: result.id })
      : NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[quick-actions] create failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not save the quick action.' }, { status: 500 });
  }
}

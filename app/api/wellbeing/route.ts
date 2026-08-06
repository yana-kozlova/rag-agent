import { NextResponse } from 'next/server';

import { auth } from '@/app/api/auth/auth';
import { deleteWellbeingEntry, getWellbeingReport } from '@/lib/actions/wellbeing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const daysParam = Number.parseInt(new URL(req.url).searchParams.get('days') ?? '', 10);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : 30;

  const report = await getWellbeingReport(session.user.id, days);

  return NextResponse.json(report);
}

/**
 * Removing a check-in.
 *
 * Deliberately here and not a tool: a mislogged number is corrected by looking
 * at the row, and a model deciding on its own which measurement to drop is a
 * failure mode this data cannot afford.
 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const deleted = await deleteWellbeingEntry(session.user.id, id);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

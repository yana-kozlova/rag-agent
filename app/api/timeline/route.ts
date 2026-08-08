import { NextResponse } from 'next/server';

import { auth } from '@/app/api/auth/auth';
import {
  deleteTimelineEvent,
  getTimelineView,
  recordTimelineEvent,
  upcomingTimeline,
} from '@/lib/actions/timeline';
import { timelineEventInputSchema } from '@/lib/db/schema/timeline';
import { UPCOMING_HORIZON_DAYS } from '@/lib/timeline/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The timeline, read two ways: the whole axis for the page, or just what is
 * coming for the dashboard widget. The widget asks for the narrow one because
 * projecting a lifetime of dates to render four of them is work it does on every
 * paint.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const parsed = Number.parseInt(params.get('days') ?? '', 10);
  const days = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 365)
    : UPCOMING_HORIZON_DAYS;

  if (params.get('view') === 'upcoming') {
    return NextResponse.json(await upcomingTimeline(session.user.id, days));
  }

  return NextResponse.json(await getTimelineView(session.user.id, days));
}

/** Adding a date by hand, from the form on the page. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const input = timelineEventInputSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json(
      { error: input.error.issues[0]?.message ?? 'Invalid date' },
      { status: 400 }
    );
  }

  const result = await recordTimelineEvent({
    userId: session.user.id,
    input: input.data,
    source: 'manual',
  });

  if (!result.success) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, event: result.event, duplicate: result.duplicate });
}

/**
 * Removing a date. An API route rather than a tool, on the wellbeing precedent:
 * a wrong date is corrected by looking at the row, and a model choosing which
 * one to drop from a list it cannot address by id is a failure nobody notices.
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

  const deleted = await deleteTimelineEvent(session.user.id, id);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

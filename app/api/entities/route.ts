import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { listEntities } from '@/lib/actions/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const type = params.get('type') ?? undefined;
  const q = params.get('q') ?? undefined;
  const limitParam = Number.parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : undefined;

  const entities = await listEntities(session.user.id, { type, q, limit });

  return NextResponse.json({ entities });
}

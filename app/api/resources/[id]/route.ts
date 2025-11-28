import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { updateResource, deleteResource } from '@/lib/actions/resources';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq, and } from 'drizzle-orm';

export const runtime = 'nodejs';

// Get single resource
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

    const [resource] = await db
      .select()
      .from(resources)
      .where(and(
        eq(resources.id, params.id),
        eq(resources.userId, userId as any)
      ))
      .limit(1);

    if (!resource) {
      return NextResponse.json(
        { ok: false, message: 'Resource not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, resource });
  } catch (err: any) {
    console.error('GET /api/resources/[id] error', err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

// Update resource
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
    const result = await updateResource(params.id, body);

    if (!result.success) {
      return NextResponse.json(
        { ok: false, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('PATCH /api/resources/[id] error', err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

// Delete resource
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

    const result = await deleteResource(params.id);

    if (!result.success) {
      return NextResponse.json(
        { ok: false, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('DELETE /api/resources/[id] error', err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}


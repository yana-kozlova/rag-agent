import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { embeddings as embeddingsTable } from '@/lib/db/schema/embeddings';
import { eq, inArray, and } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function DELETE() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

    const resourceRows = await db
      .select({ id: resources.id })
      .from(resources)
      .where(eq(resources.userId, userId as any));

    const ids = resourceRows.map(r => r.id);
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, deletedResources: 0, deletedEmbeddings: 0 });
    }

    // count embeddings first (for reporting)
    // Filter by sourceId matching resource IDs and source type 'resource'
    const embRows = await db
      .select({ id: embeddingsTable.id })
      .from(embeddingsTable)
      .where(
        and(
          inArray(embeddingsTable.sourceId, ids),
          eq(embeddingsTable.source, 'resource')
        )
      );

    await db.delete(embeddingsTable).where(
      and(
        inArray(embeddingsTable.sourceId, ids),
        eq(embeddingsTable.source, 'resource')
      )
    );
    await db.delete(resources).where(eq(resources.userId, userId as any));

    return NextResponse.json({ ok: true, deletedResources: ids.length, deletedEmbeddings: embRows.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}



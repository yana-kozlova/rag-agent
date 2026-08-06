import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { embeddings as embeddingsTable } from '@/lib/db/schema/embeddings';
import { eq, inArray, and } from 'drizzle-orm';
import { deleteStoredImage } from '@/lib/storage/images';

export const runtime = 'nodejs';

export async function DELETE() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

    const resourceRows = await db
      .select({ id: resources.id, metadata: resources.metadata })
      .from(resources)
      .where(eq(resources.userId, userId as string));

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
    await db.delete(resources).where(eq(resources.userId, userId as string));

    // Wiping the knowledge base has to wipe the pictures too, or "clear
    // everything" quietly leaves them on public URLs.
    //
    // Concurrent, and after the rows are gone. Sequentially this was one
    // round-trip per image inside a single invocation, so a large library could
    // hit the function timeout and report failure for a delete that had already
    // committed. `allSettled` because a blob that refuses to go is an orphan
    // worth logging, not a reason to fail the request — `deleteStoredImage`
    // already swallows and logs its own errors.
    const imageUrls = resourceRows
      .map((row) => (row.metadata as { imageUrl?: string } | null)?.imageUrl)
      .filter((url): url is string => Boolean(url));

    await Promise.allSettled(imageUrls.map(deleteStoredImage));

    return NextResponse.json({ ok: true, deletedResources: ids.length, deletedEmbeddings: embRows.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}



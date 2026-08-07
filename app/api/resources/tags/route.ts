import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { collectFacets } from '@/lib/utils/resource-facets';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

// Get the values the Knowledge Base filters can offer: tags, categories and
// the types this user actually has. Shares `collectFacets` with the page's
// first paint so a refresh after an edit cannot disagree with it.
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const userResources = await db
      .select({
        metadata: resources.metadata,
      })
      .from(resources)
      .where(eq(resources.userId, userId as string));

    const { tags, categories, types } = collectFacets(userResources);

    return NextResponse.json({ ok: true, tags, categories, types });
  } catch (err: any) {
    console.error('GET /api/resources/tags error', err);
    return NextResponse.json(
      { ok: false, message: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

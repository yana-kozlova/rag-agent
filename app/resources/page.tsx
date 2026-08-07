import { redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq, desc, sql } from 'drizzle-orm';
import { collectFacets } from '@/lib/utils/resource-facets';
import ResourcesClient, { type Resource } from './ResourcesClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cards are square and laid out up to four across, so a page is 6 full rows.
// Divisible by 2, 3 and 4 — no ragged last row at any breakpoint.
const PAGE_SIZE = 24;

export default async function ResourcesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/api/auth/signin');

  // Fetch first page, total count, and tags/categories in parallel,
  // directly from the DB — no /api/* waterfall on first paint.
  const [rows, countResult, tagRows] = await Promise.all([
    db
      .select({
        id: resources.id,
        title: resources.title,
        content: resources.content,
        metadata: resources.metadata,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
      })
      .from(resources)
      .where(eq(resources.userId, userId))
      .orderBy(desc(resources.createdAt))
      .limit(PAGE_SIZE)
      .offset(0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(resources)
      .where(eq(resources.userId, userId)),
    db
      .select({ metadata: resources.metadata })
      .from(resources)
      .where(eq(resources.userId, userId)),
  ]);

  const totalCount = countResult[0]?.count ?? 0;

  const initialResources: Resource[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  // What the filters can offer, derived from the rows themselves rather than
  // from a hand-written list that drifts away from them.
  const facets = collectFacets(tagRows);

  return (
    <ResourcesClient
      initialResources={initialResources}
      initialTotalCount={totalCount}
      initialTags={facets.tags}
      initialCategories={facets.categories}
      initialTypes={facets.types}
      pageSize={PAGE_SIZE}
    />
  );
}

import { redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq, desc, sql } from 'drizzle-orm';
import ResourcesClient, { type Resource } from './ResourcesClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

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

  // Derive unique tags and categories from metadata
  const tagSet = new Set<string>();
  const categorySet = new Set<string>();
  for (const row of tagRows) {
    const meta = row.metadata as any;
    if (meta?.tags && Array.isArray(meta.tags)) {
      for (const tag of meta.tags) {
        if (tag && typeof tag === 'string') tagSet.add(tag.trim());
      }
    }
    if (meta?.category && typeof meta.category === 'string') {
      categorySet.add(meta.category.trim());
    }
  }

  return (
    <ResourcesClient
      initialResources={initialResources}
      initialTotalCount={totalCount}
      initialTags={Array.from(tagSet).sort()}
      initialCategories={Array.from(categorySet).sort()}
      pageSize={PAGE_SIZE}
    />
  );
}

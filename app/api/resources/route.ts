import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq, desc, and, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

// Get list of resources with pagination
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const typeParam = url.searchParams.get('type'); // Filter by metadata type
    const tagParams = url.searchParams.getAll('tag'); // Filter by tags (multiple)
    const categoryParam = url.searchParams.get('category'); // Filter by category
    
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 100) : 20;
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

    // Build where conditions — filter in SQL including JSONB fields
    const conditions: any[] = [eq(resources.userId, userId as string)];

    if (typeParam) {
      conditions.push(sql`${resources.metadata}->>'type' = ${typeParam}`);
    }
    if (categoryParam) {
      conditions.push(sql`${resources.metadata}->>'category' = ${categoryParam}`);
    }
    if (tagParams.length > 0) {
      // @> checks that the tags array contains all specified tags
      conditions.push(sql`${resources.metadata}->'tags' @> ${JSON.stringify(tagParams)}::jsonb`);
    }

    // Count total matching rows for pagination
    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(resources)
      .where(and(...conditions));

    const rows = await db
      .select({
        id: resources.id,
        title: resources.title,
        content: resources.content,
        source: resources.source,
        metadata: resources.metadata,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
      })
      .from(resources)
      .where(and(...conditions))
      .orderBy(desc(resources.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      ok: true,
      resources: rows,
      pagination: {
        limit,
        offset,
        total: totalCount,
        hasMore: offset + rows.length < totalCount,
      },
    });
  } catch (err: any) {
    console.error('GET /api/resources error', err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}


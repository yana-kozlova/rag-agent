import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq, desc, and } from 'drizzle-orm';

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

    // Build where conditions
    const conditions = [eq(resources.userId, userId as any)];

    // Get all resources for the user first, then filter by type/tag/category if needed
    // This avoids issues with JSONB parameterization in Drizzle
    let rows = await db
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
      .orderBy(desc(resources.createdAt));

    // Filter by type, tags, or category in JavaScript
    if (typeParam || tagParams.length > 0 || categoryParam) {
      rows = rows.filter(row => {
        const meta = row.metadata as any;
        
        // Filter by type
        if (typeParam && meta?.type !== typeParam) {
          return false;
        }
        
        // Filter by tags (multiple tags - resource must have ALL selected tags)
        if (tagParams.length > 0) {
          const tags = meta?.tags || [];
          if (!Array.isArray(tags)) {
            return false;
          }
          // Resource must have all selected tags (exact match)
          const hasAllTags = tagParams.every(tagParam => 
            tags.some((tag: string) => typeof tag === 'string' && tag === tagParam)
          );
          if (!hasAllTags) {
            return false;
          }
        }
        
        // Filter by category
        if (categoryParam && meta?.category !== categoryParam) {
          return false;
        }
        
        return true;
      });
    }

    // Apply pagination after filtering
    const paginatedRows = rows.slice(offset, offset + limit);
    const totalCount = rows.length;

    return NextResponse.json({
      ok: true,
      resources: paginatedRows,
      pagination: {
        limit,
        offset,
        total: totalCount,
        hasMore: offset + paginatedRows.length < totalCount,
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


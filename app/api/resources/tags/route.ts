import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

// Get all unique tags for the user
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Get all resources for the user
    const userResources = await db
      .select({
        metadata: resources.metadata,
      })
      .from(resources)
      .where(eq(resources.userId, userId as any));

    // Extract all unique tags
    const allTags = new Set<string>();
    const allCategories = new Set<string>();

    userResources.forEach(resource => {
      const meta = resource.metadata as any;
      if (meta?.tags && Array.isArray(meta.tags)) {
        meta.tags.forEach((tag: string) => {
          if (tag && typeof tag === 'string') {
            allTags.add(tag.trim());
          }
        });
      }
      if (meta?.category && typeof meta.category === 'string') {
        allCategories.add(meta.category.trim());
      }
    });

    return NextResponse.json({
      ok: true,
      tags: Array.from(allTags).sort(),
      categories: Array.from(allCategories).sort(),
    });
  } catch (err: any) {
    console.error('GET /api/resources/tags error', err);
    return NextResponse.json(
      { ok: false, message: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}


import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/auth';
import { findRelevantContent } from '@/lib/ai/embedding';

export const runtime = 'nodejs';

/**
 * Search endpoint to retrieve relevant information from user's knowledge base
 * GET /api/resources/search?q=query&limit=5
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const query = url.searchParams.get('q');
    const limitParam = url.searchParams.get('limit');
    
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Query parameter "q" is required' 
      }, { status: 400 });
    }

    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 8, 1), 20) : 8;
    
    const results = await findRelevantContent(query, userId);
    
    // Limit results if needed (findRelevantContent already limits, but we respect the param)
    const limitedResults = results.slice(0, limit);

    return NextResponse.json({ 
      ok: true, 
      query,
      results: limitedResults.map(r => ({
        content: r.content,
        similarity: typeof r.similarity === 'number' ? r.similarity : null,
        source: r.source,
        metadata: r.metadata,
      })),
      count: limitedResults.length
    });
  } catch (error: any) {
    console.error('GET /api/resources/search error', error);
    return NextResponse.json({ 
      ok: false, 
      error: error?.message ?? 'Unknown error' 
    }, { status: 500 });
  }
}


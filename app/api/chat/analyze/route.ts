import { NextResponse } from 'next/server';
import { saveUserMessage } from '@/lib/middleware/save-user-message';

export const runtime = 'nodejs';

type AnalyzeBody = {
  content?: string;
  messageId?: string;
};

/**
 * Legacy endpoint for manually saving messages to RAG
 * Now the saving is handled automatically by middleware in /api/chat route
 * This endpoint is kept for backward compatibility and manual saves
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as AnalyzeBody;
    const content = (body.content || '').toString();
    
    if (!content || content.trim().length === 0) {
      return NextResponse.json({ ok: false, error: 'empty content' }, { status: 400 });
    }

    const result = await saveUserMessage(content);
    
    return NextResponse.json({ 
      ok: true, 
      saved: result.saved ? 1 : 0, 
      skipped: !result.saved,
      reason: result.reason 
    });
  } catch (error: any) {
    console.error('POST /api/chat/analyze error', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'unknown' }, { status: 500 });
  }
}



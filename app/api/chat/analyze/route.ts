import { NextResponse } from 'next/server';
import { auth } from '../../auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { embeddings as embeddingsTable } from '@/lib/db/schema/embeddings';
import { generateEmbeddings } from '@/lib/ai/embedding';

export const runtime = 'nodejs';

type AnalyzeBody = {
  content?: string;
  messageId?: string;
};

// Very simple heuristic extractor for schedules; can be later replaced with LLM
function extractScheduleItems(text: string) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const items: Array<{ title: string; time?: string }> = [];
  const timeRe = /(\d{1,2}:\d{2}\s?(AM|PM)?)|(\d{1,2}[.:]\d{2})/i;
  for (const l of lines) {
    if (/^(\d+\.|[-*])/.test(l) || /event|schedule|meeting|call|class/i.test(l)) {
      const time = l.match(timeRe)?.[0];
      const title = l.replace(/^\d+\.|^[-*]\s?/, '').trim();
      if (title) items.push({ title, time: time ?? undefined });
    }
  }
  return items;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({})) as AnalyzeBody;
    const content = (body.content || '').toString();
    const messageId = body.messageId;
    if (!content || content.trim().length === 0) {
      return NextResponse.json({ ok: false, error: 'empty content' }, { status: 400 });
    }

    const items = extractScheduleItems(content);
    // Save into resources with metadata and create embeddings
    const [resRow] = await db.insert(resources).values({
      content,
      userId: userId as any,
      source: 'resource',
      metadata: items.length > 0 ? { type: 'schedule', items } : { type: 'note' },
    }).returning({ id: resources.id });

    const chunks = await generateEmbeddings(content);
    if (chunks.length > 0) {
      await db.insert(embeddingsTable).values(
        chunks.map(e => ({
          resourceId: resRow.id,
          source: 'resource' as const,
          content: e.content,
          embedding: e.embedding,
        }))
      );
    }
    return NextResponse.json({ ok: true, saved: 1, resourceId: resRow.id, items: items.length > 0 ? items : undefined });
  } catch (error: any) {
    console.error('POST /api/chat/analyze error', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'unknown' }, { status: 500 });
  }
}



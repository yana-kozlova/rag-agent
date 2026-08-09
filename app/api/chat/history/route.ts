import { NextResponse } from 'next/server';
import { auth } from '../../auth/auth';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema/chat';
import { getOrCreateConversation } from '@/lib/chat/conversation';
import { and, desc, eq, lt } from 'drizzle-orm';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;

export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ messages: [] });

    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const beforeParam = url.searchParams.get('before');
    const limit = Math.min(Math.max(parseInt(limitParam || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Read-only: a GET must not create the row a POST would. Ordered so that a
    // database still holding two conversations (pre-migration) answers this
    // consistently with what the writers pick.
    const convo = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(conversations.createdAt, conversations.id)
      .limit(1);

    if (convo.length === 0) return NextResponse.json({ messages: [] });

    // Paged on `seq` rather than `created_at`. A turn's question and answer are
    // written in one statement and therefore share a timestamp: ordering by it
    // is undefined within the pair, and a `created_at < before` cursor drops
    // whichever of the two the previous page ended on — a message that silently
    // never appears, at a boundary that moves as the thread grows.
    const before = beforeParam ? Number(beforeParam) : null;
    const hasCursor = before !== null && Number.isFinite(before);

    const rows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        seq: messages.seq,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        hasCursor
          ? and(eq(messages.conversationId, convo[0].id), lt(messages.seq, before as number))
          : eq(messages.conversationId, convo[0].id)
      )
      .orderBy(desc(messages.seq))
      .limit(limit);

    return NextResponse.json({ messages: rows.reverse() });
  } catch (error: any) {
    console.error('GET /api/chat/history error', error);
    return NextResponse.json({ messages: [], error: error?.message ?? 'unknown' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { role, content } = body as { role?: 'user' | 'assistant' | 'system'; content?: string };
    if (!role || !content || content.trim().length === 0) return NextResponse.json({ ok: false, error: 'Missing role/content' }, { status: 400 });

    const convoId = await getOrCreateConversation(userId);

    const insertedMsg = await db.insert(messages).values({ conversationId: convoId, role, content }).returning({ id: messages.id });
    return NextResponse.json({ ok: true, id: insertedMsg[0]?.id });
  } catch (error: any) {
    console.error('POST /api/chat/history error', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'unknown' }, { status: 500 });
  }
}

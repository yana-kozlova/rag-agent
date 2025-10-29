import { NextResponse } from 'next/server';
import { auth } from '../../auth/auth';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema/chat';
import { and, desc, eq, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ messages: [] });

    const convo = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, userId as any))
      .limit(1);

    if (convo.length === 0) return NextResponse.json({ messages: [] });

    const rows = await db
      .select({ id: messages.id, role: messages.role, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, convo[0].id))
      .orderBy(desc(messages.createdAt))
      .limit(50);

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

    let convoId: string | null = null;
    const existing = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, userId as any))
      .limit(1);
    if (existing.length > 0) {
      convoId = existing[0].id;
    } else {
      const inserted = await db.insert(conversations).values({ userId: userId as any }).returning({ id: conversations.id });
      convoId = inserted[0].id;
    }

    const insertedMsg = await db.insert(messages).values({ conversationId: convoId, role, content }).returning({ id: messages.id });
    return NextResponse.json({ ok: true, id: insertedMsg[0]?.id });
  } catch (error: any) {
    console.error('POST /api/chat/history error', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'unknown' }, { status: 500 });
  }
}



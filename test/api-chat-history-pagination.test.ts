import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/app/api/auth/auth', () => ({ auth: vi.fn() }));
vi.mock('drizzle-orm', () => ({ eq: (..._a:any[]) => ({}), and: (..._a:any[]) => ({}), desc: (..._a:any[]) => ({}), lt: (..._a:any[]) => ({}) }));

type Row = { id: string; role: 'user'|'assistant'|'system'; content: string; seq: number; createdAt: Date };
let memConvo: { id: string; userId: string } | null;
let memMessages: Row[];
/** The `before` cursor the route was given, read back out of the request URL. */
let cursor: number | null = null;

function selectFrom(table: any) {
  const rows = () => {
    if (table.__name === 'conversations') return memConvo ? [{ id: memConvo.id }] : [];
    const kept = cursor === null ? memMessages : memMessages.filter((r) => r.seq < cursor);
    // Newest first, as `orderBy(desc(seq))` would.
    return [...kept].sort((a, b) => b.seq - a.seq);
  };

  const terminal: any = {
    orderBy: () => terminal,
    limit: async (n: number) => rows().slice(0, n),
  };

  return { where: () => terminal, orderBy: () => terminal, limit: terminal.limit };
}

vi.mock('@/lib/db', () => ({
  db: { select: () => ({ from: (tbl: any) => selectFrom(tbl) }) },
}));

vi.mock('@/lib/db/schema/chat', () => ({
  conversations: { __name: 'conversations', id: Symbol('id'), userId: Symbol('userId'), createdAt: Symbol('createdAt') },
  messages: { __name: 'messages', id: Symbol('id'), conversationId: Symbol('conversationId'), role: Symbol('role'), content: Symbol('content'), seq: Symbol('seq'), createdAt: Symbol('createdAt') },
}));

import { auth } from '@/app/api/auth/auth';
import { GET } from '@/app/api/chat/history/route';

/** Drives GET the way the client does, threading the cursor through. */
async function page(limit: number, before?: number) {
  cursor = before ?? null;
  const q = before === undefined ? `limit=${limit}` : `limit=${limit}&before=${before}`;
  const res = await GET(new Request(`http://localhost/api/chat/history?${q}`));
  return (await res.json()).messages as Array<{ id: string; seq: number }>;
}

describe('/api/chat/history pagination', () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    memConvo = { id: 'c1', userId: 'u1' };
    cursor = null;
    // A turn's question and answer are inserted in one statement, so they share
    // a timestamp. `seq` is what separates them.
    const t1 = new Date('2025-01-01T10:00:00Z');
    const t2 = new Date('2025-01-01T11:00:00Z');
    memMessages = [
      { id: 'm1', role: 'user', content: '1', seq: 1, createdAt: t1 },
      { id: 'm2', role: 'assistant', content: '2', seq: 2, createdAt: t1 },
      { id: 'm3', role: 'user', content: '3', seq: 3, createdAt: t2 },
      { id: 'm4', role: 'assistant', content: '4', seq: 4, createdAt: t2 },
    ];
  });

  it('returns the last N messages, oldest first, when there is no cursor', async () => {
    expect((await page(2)).map((m) => m.id)).toEqual(['m3', 'm4']);
  });

  it('pages backwards from the cursor', async () => {
    expect((await page(2, 3)).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('does not drop the sibling that shares the boundary timestamp', async () => {
    // The regression this cursor exists for: paging on `created_at` made the
    // second page ask for `created_at < t2`, which skipped m3 — the message the
    // first page ended on shares its timestamp with m4. Walking the whole thread
    // in pages must yield every message exactly once.
    const seen: string[] = [];
    let before: number | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const rows = await page(2, before);
      if (rows.length === 0) break;
      seen.unshift(...rows.map((r) => r.id));
      before = rows[0]!.seq;
    }
    expect(seen).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('ignores a non-numeric cursor rather than returning nothing', async () => {
    const res = await GET(new Request('http://localhost/api/chat/history?limit=2&before=not-a-number'));
    const json = await res.json();
    expect(json.messages.map((m: any) => m.id)).toEqual(['m3', 'm4']);
  });
});

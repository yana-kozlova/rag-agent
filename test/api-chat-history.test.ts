import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/app/api/auth/auth', () => ({ auth: vi.fn() }));
vi.mock('drizzle-orm', () => ({ eq: (..._a: any[]) => ({}), and: (..._a: any[]) => ({}), desc: (..._a: any[]) => ({}), lt: (..._a:any[]) => ({}) }));

type Row = { id: string; role: 'user'|'assistant'|'system'; content: string; seq: number; createdAt: Date };
let memConvo: { id: string; userId: string } | null;
let memMessages: Row[];
/** Set when the conversation insert should lose the unique-index race. */
let conversationInsertConflicts = false;

// The query builder is chainable in whatever order the route happens to use, so
// the mock resolves on `limit` regardless of whether `orderBy` was called.
function selectFrom(table: any) {
  const rows = () =>
    table.__name === 'conversations'
      ? memConvo
        ? [{ id: memConvo.id }]
        : []
      : memMessages.map(({ id, role, content, seq, createdAt }) => ({ id, role, content, seq, createdAt }));

  const terminal: any = {
    orderBy: () => terminal,
    limit: async (n: number) => rows().slice(0, n),
  };

  return { where: () => terminal, orderBy: () => terminal, limit: terminal.limit };
}

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: (tbl: any) => selectFrom(tbl) }),
    insert: (tbl: any) => {
      const run = async () => {
        if (tbl.__name === 'conversations') {
          if (conversationInsertConflicts) return [];
          memConvo = { id: 'c1', userId: 'u1' };
          return [{ id: memConvo.id }];
        }
        return [{ id: 'x' }];
      };
      return {
        values: (vals: any) => ({
          onConflictDoNothing: () => ({ returning: run }),
          returning: async () => {
            if (tbl.__name === 'messages') {
              const row: Row = {
                id: `m${memMessages.length + 1}`,
                role: vals.role,
                content: vals.content,
                seq: memMessages.length + 1,
                createdAt: new Date(),
              };
              memMessages.push(row);
              return [{ id: row.id }];
            }
            return run();
          },
        }),
      };
    },
  },
}));

vi.mock('@/lib/db/schema/chat', () => ({
  conversations: { __name: 'conversations', id: Symbol('id'), userId: Symbol('userId'), createdAt: Symbol('createdAt') },
  messages: { __name: 'messages', id: Symbol('id'), conversationId: Symbol('conversationId'), role: Symbol('role'), content: Symbol('content'), seq: Symbol('seq'), createdAt: Symbol('createdAt') },
}));

import { auth } from '@/app/api/auth/auth';
import { GET, POST } from '@/app/api/chat/history/route';

describe('/api/chat/history', () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    memConvo = { id: 'c1', userId: 'u1' };
    memMessages = [];
    conversationInsertConflicts = false;
  });

  it('GET returns empty when no conversation', async () => {
    memConvo = null;
    const res = await GET(new Request('http://localhost/api/chat/history?limit=2'));
    const json = await res.json();
    expect(json.messages).toEqual([]);
  });

  it('GET does not create a conversation', async () => {
    memConvo = null;
    await GET(new Request('http://localhost/api/chat/history?limit=2'));
    expect(memConvo).toBeNull();
  });

  it('POST creates conversation if missing and inserts message', async () => {
    memConvo = null;
    const req = new Request('http://localhost/api/chat/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'hello' }) });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(memConvo).not.toBeNull();
    expect(memMessages).toHaveLength(1);
    expect(memMessages[0].content).toBe('hello');
  });

  it('POST recovers when another writer wins the conversation insert', async () => {
    // The unique index turns the old duplicate-row race into a conflict; losing
    // it must resolve to the winner's row, not throw and not insert a second.
    memConvo = null;
    conversationInsertConflicts = true;
    const req = new Request('http://localhost/api/chat/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'hello' }) });

    // The winner's row appears between our select and our insert.
    memConvo = { id: 'c-winner', userId: 'u1' };

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(memMessages).toHaveLength(1);
  });

  it('POST returns 400 when missing content', async () => {
    const req = new Request('http://localhost/api/chat/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: '' }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('GET returns [] when unauthorized (no user)', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost/api/chat/history?limit=2'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.messages).toEqual([]);
  });
});

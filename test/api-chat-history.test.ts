import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/app/api/auth/auth', () => ({ auth: vi.fn() }));
vi.mock('drizzle-orm', () => ({ eq: (..._a: any[]) => ({}), and: (..._a: any[]) => ({}), desc: (..._a: any[]) => ({}), lt: (..._a:any[]) => ({}) }));

type Row = { id: string; role: 'user'|'assistant'|'system'; content: string; createdAt: Date };
let memConvo: { id: string; userId: string } | null;
let memMessages: Row[];

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: (_tbl: any) => ({
        where: (_expr: any) => ({
          limit: async (_n: number) => (memConvo ? [{ id: memConvo.id }] : []),
        }),
        orderBy: (_o: any) => ({ limit: async (_n: number) => memMessages.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt })) }),
      }),
    }),
    insert: (tbl: any) => ({
      values: (vals: any) => ({
        returning: async (_sel?: any) => {
          if (tbl.__name === 'conversations') {
            memConvo = { id: 'c1', userId: vals.userId };
            return [{ id: memConvo.id }];
          }
          if (tbl.__name === 'messages') {
            const row: Row = { id: `m${memMessages.length+1}`, role: vals.role, content: vals.content, createdAt: new Date() };
            memMessages.push(row);
            return [{ id: row.id }];
          }
          return [{ id: 'x' }];
        },
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema/chat', () => ({ conversations: { __name: 'conversations', id: Symbol('id'), userId: Symbol('userId') }, messages: { __name: 'messages', id: Symbol('id'), conversationId: Symbol('conversationId'), role: Symbol('role'), content: Symbol('content'), createdAt: Symbol('createdAt') } }));

import { auth } from '@/app/api/auth/auth';
import { GET, POST } from '@/app/api/chat/history/route';

describe('/api/chat/history', () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    memConvo = { id: 'c1', userId: 'u1' };
    memMessages = [];
  });

  it('GET returns empty when no conversation', async () => {
    memConvo = null;
    const res = await GET(new Request('http://localhost/api/chat/history?limit=2'));
    const json = await res.json();
    expect(json.messages).toEqual([]);
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



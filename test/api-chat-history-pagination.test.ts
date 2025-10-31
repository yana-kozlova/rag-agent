import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/app/api/auth/auth', () => ({ auth: vi.fn() }));
vi.mock('drizzle-orm', () => ({ eq: (..._a:any[]) => ({}), and: (..._a:any[]) => ({}), desc: (..._a:any[]) => ({}), lt: (..._a:any[]) => ({}) }));

type Row = { id: string; role: 'user'|'assistant'|'system'; content: string; createdAt: Date };
let memConvo: { id: string; userId: string } | null;
let memMessages: Row[];
let testBeforeDate: Date | null = null;

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: (_tbl: any) => ({
        where: (_expr: any) => ({
          orderBy: (_o:any) => ({ limit: async (n:number) => {
            const arr = testBeforeDate ? memMessages.filter(r => r.createdAt < testBeforeDate!) : memMessages;
            return arr.slice(-n).reverse().map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }));
          } }),
          limit: async (_n:number) => (memConvo ? [{ id: memConvo.id }] : []),
        }),
        orderBy: (_o:any) => ({ limit: async (n:number) => memMessages.slice(-n).reverse().map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt })) }),
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema/chat', () => ({ conversations: { __name: 'conversations', id: Symbol('id'), userId: Symbol('userId') }, messages: { __name: 'messages', id: Symbol('id'), conversationId: Symbol('conversationId'), role: Symbol('role'), content: Symbol('content'), createdAt: Symbol('createdAt') } }));

import { auth } from '@/app/api/auth/auth';
import { GET } from '@/app/api/chat/history/route';

describe('/api/chat/history pagination', () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    memConvo = { id: 'c1', userId: 'u1' };
    // create 3 messages with increasing createdAt
    memMessages = [
      { id: 'm1', role: 'user', content: '1', createdAt: new Date('2025-01-01T10:00:00Z') },
      { id: 'm2', role: 'assistant', content: '2', createdAt: new Date('2025-01-01T11:00:00Z') },
      { id: 'm3', role: 'user', content: '3', createdAt: new Date('2025-01-01T12:00:00Z') },
    ];
    testBeforeDate = null;
  });

  it('returns last N messages when no before', async () => {
    const res = await GET(new Request('http://localhost/api/chat/history?limit=2'));
    const json = await res.json();
    expect(json.messages.map((m:any)=>m.id)).toEqual(['m2','m3']);
  });

  it('respects before param', async () => {
    testBeforeDate = new Date('2025-01-01T12:00:00Z');
    const res = await GET(new Request('http://localhost/api/chat/history?limit=2&before=2025-01-01T12:00:00Z'));
    const json = await res.json();
    expect(json.messages.map((m:any)=>m.id)).toEqual(['m1','m2']);
  });
});



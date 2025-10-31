import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/app/api/auth/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/ai/embedding', () => ({ generateEmbeddings: vi.fn(async (content: string) => [{ content, embedding: new Float32Array(4) }]) }));
vi.mock('drizzle-orm', () => ({ sql: (_s:TemplateStringsArray, ..._v:any[]) => ({}) }));

let lastInsertedResourceId = 'r1';

vi.mock('@/lib/db', () => ({
  db: {
    insert: (tbl: any) => ({
      values: (vals: any) => ({
        returning: async (_sel?: any) => {
          if (tbl.__name === 'resources') return [{ id: lastInsertedResourceId }];
          if (tbl.__name === 'embeddings') return [{}];
          return [{}];
        },
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema/resources', () => ({ resources: { __name: 'resources', id: Symbol('id') } }));
vi.mock('@/lib/db/schema/embeddings', () => ({ embeddings: { __name: 'embeddings' } }));

import { auth } from '@/app/api/auth/auth';
import { POST } from '@/app/api/chat/analyze/route';
import { generateEmbeddings } from '@/lib/ai/embedding';

describe('/api/chat/analyze', () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    lastInsertedResourceId = 'r1';
  });

  it('returns 401 without session', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(new Request('http://localhost/api/chat/analyze', { method: 'POST', body: JSON.stringify({ content: 'x' }) }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on empty content', async () => {
    const res = await POST(new Request('http://localhost/api/chat/analyze', { method: 'POST', body: JSON.stringify({ content: '' }) }));
    expect(res.status).toBe(400);
  });

  it('saves resource and embeddings, returns items if schedule-like', async () => {
    const body = '1. Meeting at 10:00\n- call 15:30';
    const res = await POST(new Request('http://localhost/api/chat/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: body }) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.resourceId).toBe('r1');
    expect(Array.isArray(json.items)).toBe(true);
    expect((generateEmbeddings as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('returns 500 when embedding generation fails', async () => {
    (generateEmbeddings as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const res = await POST(new Request('http://localhost/api/chat/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'note' }) }));
    expect(res.status).toBe(500);
  });
});



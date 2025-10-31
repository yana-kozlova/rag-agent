import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';

vi.mock('@/app/api/auth/auth', () => ({
  auth: vi.fn(),
}));

import { auth } from '@/app/api/auth/auth';
import { getSessionOrThrow, parseInputOrThrow } from '@/lib/ai/tools/utils';

afterEach(() => {
  vi.resetAllMocks();
});

describe('parseInputOrThrow', () => {
  it('returns parsed value on success', () => {
    const schema = z.object({ id: z.string().min(1) });
    const result = parseInputOrThrow(schema, { id: 'abc' });
    expect(result).toEqual({ id: 'abc' });
  });

  it('throws with zod error message on failure', () => {
    const schema = z.object({ id: z.string().min(2) });
    expect(() => parseInputOrThrow(schema, { id: 'a' })).toThrowError();
  });
});

describe('getSessionOrThrow', () => {
  it('returns session when user id and accessToken exist', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', accessToken: 'tok' },
    });
    const session = await getSessionOrThrow();
    expect(session.user.id).toBe('u1');
    expect(session.user.accessToken).toBe('tok');
  });

  it('throws when session missing id or access token', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1' } });
    await expect(getSessionOrThrow()).rejects.toThrowError(/Unauthorized/i);
  });
});



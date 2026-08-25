import { describe, expect, it, vi, beforeEach } from 'vitest';

const authMock = vi.fn();

vi.mock('@/app/api/auth/auth', () => ({ auth: () => authMock() }));

import { getCalendarUserOrThrow, getUser, runWithUser } from '@/lib/auth/context';
import { GoogleAccessError } from '@/lib/auth/google-access';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue(null);
});

describe('request context', () => {
  it('falls back to the NextAuth session when nothing was pushed', async () => {
    authMock.mockResolvedValue({
      user: { id: 'web-user', name: 'Yana', email: 'y@example.com', accessToken: 'from-session' },
    });

    await expect(getUser()).resolves.toMatchObject({ id: 'web-user', accessToken: 'from-session' });
  });

  it('returns null when nobody is signed in and nothing was pushed', async () => {
    await expect(getUser()).resolves.toBeNull();
  });

  it('prefers a pushed context over the session, without consulting auth()', async () => {
    authMock.mockResolvedValue({ user: { id: 'web-user' } });

    const seen = await runWithUser({ id: 'telegram-user' }, async () => (await getUser())?.id);

    expect(seen).toBe('telegram-user');
    expect(authMock).not.toHaveBeenCalled();
  });

  // The linchpin: tools resolve the user several awaits deep inside the agent
  // loop, not at the call site.
  it('survives nested awaits', async () => {
    const deep = async () => {
      await tick();
      await Promise.all([tick(), tick()]);
      return (await getUser())?.id;
    };

    await expect(runWithUser({ id: 'telegram-user' }, deep)).resolves.toBe('telegram-user');
  });

  it('keeps concurrent runs isolated', async () => {
    const read = async (delay: number) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return (await getUser())?.id;
    };

    const [first, second] = await Promise.all([
      runWithUser({ id: 'user-a' }, () => read(10)),
      runWithUser({ id: 'user-b' }, () => read(1)),
    ]);

    expect(first).toBe('user-a');
    expect(second).toBe('user-b');
  });

  it('mints a Google token lazily and only once per run', async () => {
    const resolveAccessToken = vi.fn().mockResolvedValue('minted');

    const tokens = await runWithUser({ id: 'telegram-user', resolveAccessToken }, async () => [
      (await getCalendarUserOrThrow()).accessToken,
      (await getCalendarUserOrThrow()).accessToken,
    ]);

    expect(tokens).toEqual(['minted', 'minted']);
    expect(resolveAccessToken).toHaveBeenCalledTimes(1);
  });

  /**
   * Typed rather than a bare Error, because both surfaces read it back: the
   * Telegram handler answers it with the repair instructions instead of "щось
   * пішло не так", and the model relays the message when the SDK feeds the
   * failed tool call into the conversation.
   */
  it('throws a recognisable Google-access error when no token can be produced', async () => {
    const failing = runWithUser({ id: 'telegram-user' }, () => getCalendarUserOrThrow());

    await expect(failing).rejects.toBeInstanceOf(GoogleAccessError);
    await expect(failing).rejects.toThrow(/reconnect Google/i);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const envMock: Record<string, string | undefined> = {};

vi.mock('@/lib/env.mjs', () => ({
  get env() {
    return envMock;
  },
}));

import { scheduleDelivery, isQstashConfigured } from '@/lib/push/qstash';

/** Fixed clock so the Not-Before assertions are exact. */
const NOW = new Date('2026-07-21T12:00:00Z');

function setEnv(overrides: Record<string, string | undefined>) {
  for (const key of Object.keys(envMock)) delete envMock[key];
  Object.assign(envMock, overrides);
}

function mockFetchOk(messageId = 'msg_1') {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ messageId }),
    text: async () => '',
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv({
    QSTASH_TOKEN: 'qstash-token',
    CRON_SECRET: 'cron-secret',
    APP_URL: 'https://assistant.example.com',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isQstashConfigured', () => {
  it('tracks whether a token is present', () => {
    expect(isQstashConfigured()).toBe(true);
    setEnv({});
    expect(isQstashConfigured()).toBe(false);
  });
});

describe('scheduleDelivery', () => {
  it('publishes to the drain endpoint with the callback instant', async () => {
    const fetchMock = mockFetchOk('msg_abc');

    const id = await scheduleDelivery({
      queueRowId: 'row-1',
      notifyAt: new Date('2026-07-21T12:10:00Z'),
    });

    expect(id).toBe('msg_abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://qstash.upstash.io/v2/publish/https://assistant.example.com/api/push/drain'
    );
    // 2026-07-21T12:10:00Z as whole seconds.
    expect(init.headers['Upstash-Not-Before']).toBe('1784635800');
    expect(JSON.parse(init.body)).toEqual({ queueRowId: 'row-1' });
  });

  it('forwards the cron secret so the callback authenticates like any cron', async () => {
    const fetchMock = mockFetchOk();

    await scheduleDelivery({
      queueRowId: 'row-1',
      notifyAt: new Date('2026-07-21T12:10:00Z'),
    });

    const [, init] = fetchMock.mock.calls[0];
    // Ours, to QStash.
    expect(init.headers.Authorization).toBe('Bearer qstash-token');
    // QStash's, to us — arrives as a plain Authorization header.
    expect(init.headers['Upstash-Forward-Authorization']).toBe('Bearer cron-secret');
  });

  it('clamps a past instant to now rather than scheduling backwards', async () => {
    const fetchMock = mockFetchOk();

    await scheduleDelivery({
      queueRowId: 'row-1',
      notifyAt: new Date('2026-07-21T09:00:00Z'),
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Upstash-Not-Before']).toBe(String(NOW.getTime() / 1000));
  });

  it('falls back to NEXTAUTH_URL when APP_URL is unset', async () => {
    setEnv({
      QSTASH_TOKEN: 'qstash-token',
      CRON_SECRET: 'cron-secret',
      NEXTAUTH_URL: 'https://fallback.example.com/',
    });
    const fetchMock = mockFetchOk();

    await scheduleDelivery({ queueRowId: 'row-1', notifyAt: NOW });

    // Trailing slash trimmed, so the path is not doubled up.
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://qstash.upstash.io/v2/publish/https://fallback.example.com/api/push/drain'
    );
  });

  it('does not schedule against localhost, which QStash cannot reach', async () => {
    setEnv({
      QSTASH_TOKEN: 'qstash-token',
      CRON_SECRET: 'cron-secret',
      NEXTAUTH_URL: 'http://localhost:3000',
    });
    const fetchMock = mockFetchOk();

    expect(await scheduleDelivery({ queueRowId: 'row-1', notifyAt: NOW })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not schedule an unauthenticated callback', async () => {
    setEnv({ QSTASH_TOKEN: 'qstash-token', APP_URL: 'https://assistant.example.com' });
    const fetchMock = mockFetchOk();

    expect(await scheduleDelivery({ queueRowId: 'row-1', notifyAt: NOW })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without a token, leaving the row for the sweep', async () => {
    setEnv({ CRON_SECRET: 'cron-secret', APP_URL: 'https://assistant.example.com' });
    const fetchMock = mockFetchOk();

    expect(await scheduleDelivery({ queueRowId: 'row-1', notifyAt: NOW })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows an API rejection instead of failing the enqueue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
        json: async () => ({}),
      })
    );

    expect(await scheduleDelivery({ queueRowId: 'row-1', notifyAt: NOW })).toBeNull();
  });

  it('swallows a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    expect(await scheduleDelivery({ queueRowId: 'row-1', notifyAt: NOW })).toBeNull();
  });
});

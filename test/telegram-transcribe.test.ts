import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Set per test, before the module under test reads it. Hoisted alongside the
// `vi.mock` factory, which otherwise runs before this declaration exists.
const env = vi.hoisted(() => ({}) as { GROQ_API_KEY?: string });
vi.mock('@/lib/env.mjs', () => ({ env }));

import { isTranscriptionConfigured, transcribeVoice } from '@/lib/telegram/transcribe';

const AUDIO = Buffer.from('not really opus, never leaves the fetch mock');

/** Groq answers `response_format: text` with the bare transcript. */
function respond(status: number, body: string) {
  return vi.fn().mockResolvedValue(new Response(body, { status }));
}

beforeEach(() => {
  env.GROQ_API_KEY = 'gsk_test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transcribeVoice', () => {
  it('returns the transcript on success', async () => {
    vi.stubGlobal('fetch', respond(200, '  Привіт, це тест  '));

    await expect(transcribeVoice(AUDIO)).resolves.toEqual({
      ok: true,
      text: 'Привіт, це тест',
    });
  });

  it('sends the Ukrainian language hint, which short clips need', async () => {
    const fetchMock = respond(200, 'текст');
    vi.stubGlobal('fetch', fetchMock);

    await transcribeVoice(AUDIO);

    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('language')).toBe('uk');
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
  });

  it('reports a rejected key as unavailable, not as unrecognised speech', async () => {
    vi.stubGlobal('fetch', respond(401, '{"error":{"code":"invalid_api_key"}}'));

    await expect(transcribeVoice(AUDIO)).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    // The one failure re-recording cannot fix has to name itself in the log.
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('GROQ_API_KEY'));
  });

  it('reports any other refusal as unavailable', async () => {
    vi.stubGlobal('fetch', respond(429, 'rate limited'));

    await expect(transcribeVoice(AUDIO)).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
  });

  it('treats a network throw as unavailable rather than crashing the update', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    );

    await expect(transcribeVoice(AUDIO)).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
  });

  it('separates a blank transcript from a broken service', async () => {
    vi.stubGlobal('fetch', respond(200, '   '));

    await expect(transcribeVoice(AUDIO)).resolves.toEqual({ ok: false, failure: 'empty' });
  });

  it('reports an unset key without calling out', async () => {
    delete env.GROQ_API_KEY;
    const fetchMock = respond(200, 'текст');
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeVoice(AUDIO)).resolves.toEqual({
      ok: false,
      failure: 'unconfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isTranscriptionConfigured()).toBe(false);
  });
});

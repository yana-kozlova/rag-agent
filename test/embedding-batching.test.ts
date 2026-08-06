import { describe, expect, it, vi, beforeEach } from 'vitest';

// The module validates env, opens a database connection and builds an OpenAI
// client at import time; the batching rules under test need none of it.
vi.mock('@/lib/env.mjs', () => ({ env: {} }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}));

const embedMany = vi.hoisted(() => vi.fn());
vi.mock('ai', () => ({
  embedMany,
  embed: vi.fn(),
}));

import { generateEmbeddings } from '@/lib/ai/embedding';

/**
 * One embeddings request has a ceiling; a book does not.
 *
 * Until EPUB uploads existed nothing chunked past a handful of values, so the
 * single-request version was never wrong in practice. These tests pin the split
 * so a 300-page book cannot quietly go back to being one oversized call that
 * the API rejects outright.
 */

beforeEach(() => {
  embedMany.mockReset();
  embedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
    embeddings: values.map(() => [0.1, 0.2, 0.3]),
    usage: { tokens: values.length },
  }));
});

/** Prose long enough to chunk into `roughly` many pieces. */
function book(chars: number): string {
  const paragraph = 'Слова течуть рівно й нескінченно, як пісок крізь пальці. ';
  return paragraph.repeat(Math.ceil(chars / paragraph.length));
}

describe('generateEmbeddings batching', () => {
  it('sends a short note as a single request', async () => {
    await generateEmbeddings('Коротка нотатка про зустріч у четвер.');

    expect(embedMany).toHaveBeenCalledTimes(1);
  });

  it('splits a book across several requests', async () => {
    await generateEmbeddings(book(400_000));

    expect(embedMany.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps every request inside the per-request ceilings', async () => {
    await generateEmbeddings(book(400_000));

    for (const [{ values }] of embedMany.mock.calls) {
      expect(values.length).toBeLessThanOrEqual(256);
      const chars = values.reduce((sum: number, v: string) => sum + v.length, 0);
      // A batch may exceed the budget only by its final chunk, never by a whole
      // chunk's worth twice over.
      expect(chars).toBeLessThanOrEqual(150_000 + 2_000);
    }
  });

  it('returns one embedding per chunk, in order, across batch boundaries', async () => {
    // Tag each embedding with the text it came from, so a misaligned join shows.
    embedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((v) => [v.length]),
      usage: { tokens: values.length },
    }));

    const result = await generateEmbeddings(book(400_000));

    const sent = embedMany.mock.calls.flatMap(([{ values }]) => values);
    expect(result).toHaveLength(sent.length);
    for (const [index, entry] of result.entries()) {
      expect(entry.content).toBe(sent[index]);
      expect(entry.embedding).toEqual([sent[index].length]);
    }
  });

  it('makes no request at all for empty content', async () => {
    const result = await generateEmbeddings('   ');

    expect(result).toEqual([]);
    expect(embedMany).not.toHaveBeenCalled();
  });
});

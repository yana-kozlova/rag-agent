import { describe, it, expect, vi } from 'vitest';

// The tool module reaches the database, OpenAI and the session at import time;
// the ranking rules under test reach none of them.
vi.mock('@/lib/env.mjs', () => ({ env: {} }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}));
vi.mock('ai', () => ({ embedMany: vi.fn(), embed: vi.fn(), generateObject: vi.fn() }));
vi.mock('@/lib/utils/auth', () => ({ getSessionOrNull: vi.fn() }));

import { __test } from '@/lib/ai/tools/information/get-information';

const { aggregateResults, diversifyBySource, isRelevant } = __test;

/** A row in the shape `findRelevantContent` returns. */
function hit(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'chunk-1',
    content: 'текст',
    title: 'Нотатка',
    similarity: 0.7,
    score: 1 / 61,
    lexical: false,
    source: 'resource',
    sourceId: 'note-1',
    metadata: null,
    ...over,
  };
}

/**
 * What the model is finally handed, and in what order.
 *
 * Retrieval below this point does real work — two retrievers, reciprocal rank
 * fusion, a recency tiebreak, several phrasings of the question. All of it is
 * expressed as a `score` on each row, and all of it is undone by one careless
 * `sort` here. That is not a hypothetical: this file's job is what was already
 * being thrown away.
 */

describe('aggregating the results of several phrasings', () => {
  /** The regression. Sorting on similarity discarded fusion at the last step. */
  it('ranks by fusion score, not by cosine', () => {
    const fused = hit({ id: 'a', sourceId: 'note-a', content: 'той', similarity: 0.55, score: 0.03 });
    const merelyClose = hit({ id: 'b', sourceId: 'note-b', content: 'інший', similarity: 0.92, score: 0.01 });

    const ranked = aggregateResults([[merelyClose, fused]]);

    expect(ranked.map((r: any) => r.id)).toEqual(['a', 'b']);
  });

  /**
   * The point of asking the question more than one way: agreement between
   * phrasings is evidence, and it can only count if the scores add up.
   */
  it('adds up the score a chunk earned from every phrasing that found it', () => {
    const fromFirst = hit({ id: 'a', score: 0.01 });
    const fromSecond = hit({ id: 'a', score: 0.01 });
    const fromOneOnly = hit({ id: 'b', sourceId: 'note-b', content: 'інше', score: 0.015 });

    const ranked = aggregateResults([[fromFirst], [fromSecond, fromOneOnly]]);

    expect(ranked[0].id).toBe('a');
    expect(ranked[0].score).toBeCloseTo(0.02, 10);
  });

  it('returns one entry per chunk however many phrasings found it', () => {
    const ranked = aggregateResults([[hit()], [hit()], [hit()]]);

    expect(ranked).toHaveLength(1);
  });

  /**
   * `similarity` describes the chunk against the question. The phrasing that
   * worded it best is the truest reading; averaging would penalise a chunk for
   * the variants that missed it.
   */
  it('keeps the best cosine any phrasing achieved', () => {
    const ranked = aggregateResults([
      [hit({ similarity: 0.4 })],
      [hit({ similarity: 0.8 })],
    ]);

    expect(ranked[0].similarity).toBe(0.8);
  });

  it('remembers that some phrasing matched the chunk word for word', () => {
    const ranked = aggregateResults([
      [hit({ lexical: false })],
      [hit({ lexical: true })],
    ]);

    expect(ranked[0].lexical).toBe(true);
  });

  /** Distinct chunks really can carry the same sentence, after a note merge. */
  it('drops a chunk repeating text already kept, keeping the better-scored copy', () => {
    const better = hit({ id: 'a', sourceId: 'note-a', content: 'однаковий текст', score: 0.03 });
    const worse = hit({ id: 'b', sourceId: 'note-b', content: 'однаковий текст', score: 0.01 });

    const ranked = aggregateResults([[worse, better]]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe('a');
  });

  it('survives a result carrying no score at all', () => {
    const ranked = aggregateResults([[hit({ score: undefined })]]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(0);
  });

  it('has nothing to say about nothing', () => {
    expect(aggregateResults([])).toEqual([]);
    expect(aggregateResults([[], []])).toEqual([]);
  });
});

describe('deciding what is relevant enough to show', () => {
  it('keeps a semantically close chunk', () => {
    expect(isRelevant(hit({ similarity: 0.8 }))).toBe(true);
  });

  it('drops a distant one', () => {
    expect(isRelevant(hit({ similarity: 0.2 }))).toBe(false);
  });

  /**
   * The regression this half exists for. A chunk holding an invoice number or a
   * surname scores low against the question by construction — the rest of it is
   * about something else, which is exactly why the embedding did not rank it and
   * exactly why full-text search was added. Judging it on cosine deleted every
   * lexical-only hit before the model saw one.
   */
  it('keeps an exact-wording match however low its cosine', () => {
    expect(isRelevant(hit({ similarity: 0.11, lexical: true }))).toBe(true);
  });

  it('treats a missing similarity as no evidence rather than as certainty', () => {
    expect(isRelevant(hit({ similarity: null }))).toBe(false);
  });
});

describe('spreading results over the notes they came from', () => {
  const fromNote = (note: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      hit({ id: `${note}-${i}`, sourceId: note, content: `${note} частина ${i}` })
    );

  /**
   * A long document is many chunks about one subject. Ranked alone, all five
   * slots go to five consecutive paragraphs of the same book while the note that
   * answers the question sits sixth. Deduplication does not catch it: the chunks
   * differ, they are simply all the same source.
   */
  it('does not let one note take every slot', () => {
    const results = [...fromNote('book', 8), ...fromNote('note', 2)];

    const picked = diversifyBySource(results, 5);

    expect(picked.filter((r: any) => r.sourceId === 'note')).toHaveLength(2);
  });

  it('caps a single source at two chunks while others are waiting', () => {
    const results = [...fromNote('book', 8), ...fromNote('a', 1), ...fromNote('b', 1)];

    const picked = diversifyBySource(results, 4);

    expect(picked.filter((r: any) => r.sourceId === 'book')).toHaveLength(2);
  });

  /** The cap spreads; it must never shrink the answer. */
  it('fills the remaining slots from what the cap held back', () => {
    const picked = diversifyBySource(fromNote('book', 8), 5);

    expect(picked).toHaveLength(5);
  });

  it('preserves the ranking it was given', () => {
    const picked = diversifyBySource([...fromNote('a', 1), ...fromNote('b', 1)], 5);

    expect(picked.map((r: any) => r.id)).toEqual(['a-0', 'b-0']);
  });

  it('returns fewer than the limit only when there is less than that', () => {
    expect(diversifyBySource(fromNote('a', 1), 5)).toHaveLength(1);
    expect(diversifyBySource([], 5)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';

import { toTsQuery, fuseByRrf, recencyBoost, STOPWORDS } from '@/lib/ai/retrieval';

/**
 * The ranking rules of hybrid search, which are pure precisely so that they can
 * be pinned here without a database or an embedding call — and then were not.
 *
 * Every rule below encodes a failure that was observed rather than imagined:
 * a query for everything, a fused list decided by one retriever, a note from
 * two years ago answering "where do I live". They are cheap to break silently,
 * because nothing about a slightly worse ranking looks like a bug.
 */

describe('toTsQuery', () => {
  /**
   * The flooding case. `ts_rank_cd` has no IDF, so a term in every chunk is not
   * discounted; with the terms OR'd, one function word puts the whole base in
   * the candidate list and the LIMIT cuts off the chunk that actually matched.
   */
  it('drops function words so a question is not a query for everything', () => {
    const query = toTsQuery('що в мене завтра?');

    expect(query).toBe('завтр:*');
  });

  it('drops English function words too', () => {
    const query = toTsQuery('what do I know about Andriy');

    expect(query).not.toMatch(/what|about/);
    expect(query).toMatch(/andri/);
  });

  /**
   * A wildcard on a function word is the worst version of the problem: `за:*`
   * is not the word "за", it matches "завтра", "заняття", "записати".
   */
  it('never emits a wildcard built from a function word', () => {
    const query = toTsQuery('скільки я плачу за абонемент у спортзалі') ?? '';

    expect(query).not.toMatch(/(^|\s)за:\*/);
    expect(query.split(' | ')).toEqual(['скільк:*', 'плач:*', 'абонеме:*', 'спортза:*']);
  });

  /**
   * Skipping the lexical retriever is the correct answer here, not a
   * degradation. There is no exact match to look for in a question made of
   * grammar; the vector half answers it, and a lexical list ranked by stopword
   * frequency would be noise entering fusion at rank 1.
   */
  it('returns null when nothing but function words survives', () => {
    expect(toTsQuery('що це у мене')).toBeNull();
  });

  it('returns null when there is nothing to match on at all', () => {
    expect(toTsQuery('?!.')).toBeNull();
    expect(toTsQuery('🙂')).toBeNull();
    expect(toTsQuery('')).toBeNull();
  });

  /**
   * Truncation is what earns the wildcard: the query says "спортзалі", the note
   * says "спортзал", and only a cut prefix reaches both.
   */
  it('truncates a long token and wildcards it, so an inflected form still matches', () => {
    expect(toTsQuery('спортзалі')).toBe('спортза:*');
  });

  /**
   * Nothing was cut, so `:*` cannot reach a single inflected form — Ukrainian
   * inflects at the final character and that character is inside the prefix.
   * "рука:*" finds "рукав" and "рукавиця", never "руки" or "руці". All it buys
   * is noise.
   */
  it('leaves a short token exact rather than wildcarding it into unrelated words', () => {
    expect(toTsQuery('рука')).toBe('рука');
    expect(toTsQuery('ЕКГ результат')).toBe('екг | результ:*');
  });

  /**
   * tsquery has its own operator syntax and a user question is not written in
   * it. A stray `!` would invert the query or error outright.
   */
  it('drops tsquery operators instead of trying to escape them', () => {
    const query = toTsQuery('вартість & термін | !важливо') ?? '';

    expect(query).not.toMatch(/[&!()]/);
    // Every emitted term is letters and digits, optionally wildcarded — nothing
    // else can reach Postgres however the question was punctuated.
    for (const term of query.split(' | ')) {
      expect(term).toMatch(/^[\p{L}\p{N}]+(:\*)?$/u);
    }
  });

  it('emits each term once however often it was said', () => {
    const terms = (toTsQuery('спортзал спортзалу спортзалі') ?? '').split(' | ');

    expect(terms).toEqual([...new Set(terms)]);
  });

  it('keeps digits, which are the exact matches worth having', () => {
    expect(toTsQuery('рахунок 2024 на 1500 грн')).toMatch(/2024/);
  });

  /**
   * The cap used to cut by position, which drops the end of a long question —
   * and in both languages here the specific noun sits at the end.
   */
  it('caps a long question by keeping the most specific terms, not the first ones', () => {
    const query = toTsQuery(
      'аа бб вв гг дд ее жж зз ии кк лл мм нн електрокардіограма'
    ) ?? '';
    const terms = query.split(' | ');

    expect(terms.length).toBeLessThanOrEqual(12);
    expect(query).toMatch(/електрок/);
  });
});

describe('STOPWORDS', () => {
  /** Shared with query expansion, so "not a content word" means one thing. */
  it('covers the function words of both languages in the base', () => {
    for (const word of ['за', 'що', 'на', 'мене', 'the', 'what', 'about', 'is']) {
      expect(STOPWORDS.has(word)).toBe(true);
    }
  });

  it('does not swallow words a note is actually about', () => {
    for (const word of ['голова', 'спортзал', 'андрій', 'invoice', 'сон']) {
      expect(STOPWORDS.has(word)).toBe(false);
    }
  });
});

describe('fuseByRrf', () => {
  const idsOf = (scores: Map<string, number>) =>
    [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  /**
   * The entire point of fusing. Otherwise the more confident retriever decides
   * every query and the second one is decoration.
   */
  it('puts a document both retrievers found above one that only one ranked first', () => {
    const vector = [{ id: 'only-vector' }, { id: 'both' }];
    const lexical = [{ id: 'only-lexical' }, { id: 'both' }];

    const ranked = idsOf(fuseByRrf([vector, lexical], (row) => row.id));

    expect(ranked[0]).toBe('both');
  });

  /**
   * Damping is what makes the above possible: without it rank 1 would be worth
   * many times rank 2 and agreement could never outweigh confidence.
   */
  it('keeps the top ranks close enough that agreement can outweigh confidence', () => {
    const scores = fuseByRrf([[{ id: 'first' }, { id: 'second' }]], (row) => row.id);

    const first = scores.get('first')!;
    const second = scores.get('second')!;
    expect(first / second).toBeLessThan(1.05);
  });

  it('sums what each list contributed', () => {
    const scores = fuseByRrf([[{ id: 'a' }], [{ id: 'a' }]], (row) => row.id);

    expect(scores.get('a')).toBeCloseTo(2 / 61, 10);
  });

  it('scores by position, not by how many lists exist', () => {
    const scores = fuseByRrf([[{ id: 'a' }, { id: 'b' }], []], (row) => row.id);

    expect(scores.get('a')).toBeCloseTo(1 / 61, 10);
    expect(scores.get('b')).toBeCloseTo(1 / 62, 10);
  });

  it('returns nothing for nothing', () => {
    expect(fuseByRrf<{ id: string }>([], (row) => row.id).size).toBe(0);
    expect(fuseByRrf<{ id: string }>([[], []], (row) => row.id).size).toBe(0);
  });
});

describe('recencyBoost', () => {
  const now = new Date('2026-08-07T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it('favours the newer of two notes', () => {
    expect(recencyBoost(daysAgo(1), now)).toBeGreaterThan(recencyBoost(daysAgo(400), now));
  });

  it('halves over the half-life rather than falling off a cliff', () => {
    const fresh = recencyBoost(now, now);
    const halfLife = recencyBoost(daysAgo(180), now);

    expect(halfLife / fresh).toBeCloseTo(0.5, 6);
  });

  /**
   * "Recent" is evidence about relevance, not a substitute for it. A note both
   * retrievers ranked first must not be displaced by a newer one that only
   * appeared in a single list — if it can be, the boost has stopped settling
   * ties and started deciding queries.
   */
  it('cannot overturn a document that both retrievers ranked well', () => {
    const agreedOn = 2 / 61; // rank 1 in both lists
    const oneListOnly = 1 / 61; // rank 1 in one list

    expect(oneListOnly + recencyBoost(now, now)).toBeLessThan(agreedOn);
  });

  /** A clock skew or a future-dated row should not earn more than "today". */
  it('gives a future date no more than a note written now', () => {
    expect(recencyBoost(new Date(now.getTime() + 86_400_000), now)).toBeCloseTo(
      recencyBoost(now, now),
      10
    );
  });

  it('treats a missing or unparseable date as no evidence either way', () => {
    expect(recencyBoost(null, now)).toBe(0);
    expect(recencyBoost(undefined, now)).toBe(0);
    expect(recencyBoost('not a date', now)).toBe(0);
  });

  it('accepts the ISO string a driver may hand back instead of a Date', () => {
    expect(recencyBoost(daysAgo(180).toISOString(), now)).toBeCloseTo(
      recencyBoost(daysAgo(180), now),
      10
    );
  });
});

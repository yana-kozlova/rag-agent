import { describe, it, expect, vi } from 'vitest';

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('@/lib/env.mjs', () => ({
  get env() {
    return envMock;
  },
}));

import { mergeNoteContent, __test } from '@/lib/ai/note-merge';

const { factSurvives, normalize } = __test;

/**
 * The guard that decides whether a model's rewrite is allowed to replace a
 * note. It is the only thing standing between "the note reads better now" and
 * "a fact silently disappeared six months ago".
 */
describe('deciding whether a fact survived a rewrite', () => {
  const fact = { subject: 'Андрій', predicate: 'was born on', object: '04.12.1985' };

  it('accepts a rewrite that rephrases but keeps the anchors', () => {
    expect(factSurvives(fact, normalize('День народження Андрій — 04.12.1985'))).toBe(true);
  });

  it('rejects a rewrite that lost the subject', () => {
    expect(factSurvives(fact, normalize('Народився 04.12.1985'))).toBe(false);
  });

  it('rejects a rewrite that lost the value', () => {
    expect(factSurvives(fact, normalize('Андрій has a birthday in December'))).toBe(false);
  });

  /** A one-character object matches everything; checking it proves nothing. */
  it('ignores anchors too short to mean anything', () => {
    expect(factSurvives({ subject: 'x', object: 'y' }, 'anything at all')).toBe(true);
    expect(factSurvives({}, 'anything at all')).toBe(true);
  });
});

describe('merging without a model', () => {
  it('appends rather than losing anything', async () => {
    const merged = await mergeNoteContent({
      existing: 'Андрій — чоловік Яни.',
      addition: 'Андрій працює в Urtime.',
    });

    expect(merged.strategy).toBe('appended');
    expect(merged.content).toBe('Андрій — чоловік Яни.\n\nАндрій працює в Urtime.');
  });

  it('returns the other side when one is empty', async () => {
    expect((await mergeNoteContent({ existing: '', addition: 'new' })).content).toBe('new');
    expect((await mergeNoteContent({ existing: 'old', addition: '' })).content).toBe('old');
  });
});

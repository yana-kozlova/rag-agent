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

/**
 * The check used to compare the anchor as one string, which only ever passed
 * because the note contained the fact list verbatim — `formatStructuredContent`
 * appended every fact as prose. With those restatements gone the anchor has to
 * be recognised in the summary carrying it, where the same fact is written out
 * as a sentence. Matching the string would now fail on every note and turn
 * merging into appending, which is how a note starts repeating itself again.
 */
describe('recognising a fact inside prose rather than a fact list', () => {
  const fact = {
    subject: 'user',
    predicate: 'needs',
    object: 'medical certificate from pediatrician for Artem',
  };

  const summary = normalize(
    'User needs to obtain a medical certificate from a pediatrician for her child, Artem, for school purposes.'
  );

  it('accepts the summary that says the same thing in its own words', () => {
    expect(factSurvives(fact, summary)).toBe(true);
  });

  it('still rejects a rewrite that dropped the person', () => {
    expect(
      factSurvives(fact, normalize('User needs to obtain a medical certificate for school.'))
    ).toBe(false);
  });

  it('still rejects a rewrite that dropped the thing needed', () => {
    expect(factSurvives(fact, normalize('User has an appointment for Artem.'))).toBe(false);
  });

  /** Ukrainian inflects; a stemmer is more machinery than this check needs. */
  it('accepts an inflected form of a name', () => {
    expect(
      factSurvives(
        { subject: 'Андрій', predicate: 'works at', object: 'Urtime' },
        normalize('У Андрія нова робота в Urtime.')
      )
    ).toBe(true);
  });

  it('is not satisfied by the grammar alone', () => {
    expect(__test.anchorTokens('from the pediatrician for')).toEqual(['pediatrician']);
    expect(__test.anchorTokens('для школи')).toEqual(['школи']);
  });
});

/**
 * Notes are written in the language the user typed, and a fact about the
 * account holder carries a placeholder subject — the word for "user" in that
 * language, never their name. So the subject is a word the note itself has no
 * reason to contain: it says "Артему потрібна довідка", or nothing at all.
 *
 * Anchoring on it would report every such fact as dropped, reject every
 * rewrite, and turn merging back into appending without a single log line
 * saying so. Whatever the fact actually claims lives in its object, and that
 * still has to be there.
 */
describe('a fact whose subject is the account holder', () => {
  const fact = {
    subject: 'користувач',
    predicate: 'потребує',
    object: 'довідку від педіатра для Артема',
  };

  it('accepts a note that never says the placeholder word', () => {
    expect(
      factSurvives(fact, normalize('Артему потрібна довідка від педіатра для школи.'))
    ).toBe(true);
  });

  it('still rejects a note that dropped the person', () => {
    expect(factSurvives(fact, normalize('Потрібна довідка від педіатра для школи.'))).toBe(false);
  });

  it('still rejects a note that dropped the thing needed', () => {
    expect(factSurvives(fact, normalize('У Артема запис на прийом.'))).toBe(false);
  });

  it('treats the English spelling of the placeholder the same way', () => {
    expect(__test.anchorTokens('user')).toEqual([]);
    expect(__test.anchorTokens('користувач')).toEqual([]);
    // Not a blanket ban on the word: it still anchors inside a real phrase.
    expect(__test.anchorTokens('user manual')).toEqual(['manual']);
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

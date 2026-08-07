import { describe, it, expect } from 'vitest';
import { fold, matchNames, normalizeName, resolveSelfName } from '@/lib/actions/entity-identity';

describe('folding a name', () => {
  /** The pair that split the first real graph in two. */
  it('brings a name written in either script to the same key', () => {
    expect(fold('Яна')).toBe(fold('Yana'));
    expect(fold('Андрій')).toBe(fold('Andriy'));
    expect(fold('Андрій')).toBe(fold('Andrii'));
  });

  it('ignores case, spacing and punctuation', () => {
    expect(fold('  yana   KOZLOVA ')).toBe(fold('Yana Kozlova'));
    expect(fold('Anna-Maria')).toBe(fold('Anna Maria'));
  });

  it('keeps genuinely different names apart', () => {
    expect(fold('Андрій')).not.toBe(fold('Олена'));
    expect(fold('Artem')).not.toBe(fold('Andriy'));
  });
});

describe('matching two names', () => {
  it('recognises the same spelling', () => {
    expect(matchNames('Андрій', 'андрій ')).toBe('same-spelling');
  });

  it('recognises one name written in two scripts', () => {
    expect(matchNames('Яна', 'Yana')).toBe('same-sound');
    expect(matchNames('Андрій', 'Andriy')).toBe('same-sound');
  });

  it('recognises a short name inside a fuller one', () => {
    expect(matchNames('Yana', 'Yana Kozlova')).toBe('contained');
    expect(matchNames('Яна', 'Yana Kozlova')).toBe('contained');
  });

  /**
   * A shared surname is not evidence. This is the one place where being
   * over-eager would put two real, distinct people in front of the user as a
   * merge suggestion — and a wrongly accepted merge is not one click to undo.
   */
  it('does not treat a shared surname as one person', () => {
    expect(matchNames('Andriy Kovalenko', 'Olena Kovalenko')).toBeNull();
    expect(matchNames('Kovalenko', 'Olena Kovalenko')).toBeNull();
  });

  it('says nothing about unrelated names', () => {
    expect(matchNames('Андрій', 'Артем')).toBeNull();
    expect(matchNames('', 'Yana')).toBeNull();
  });
});

describe('the account holder', () => {
  it('collapses however the model referred to them', () => {
    expect(resolveSelfName('User', 'Yana Kozlova')).toBe('Yana Kozlova');
    expect(resolveSelfName('користувач', 'Yana Kozlova')).toBe('Yana Kozlova');
    expect(resolveSelfName('Яна', 'Yana Kozlova')).toBe('Yana Kozlova');
    expect(resolveSelfName('Yana', 'Yana Kozlova')).toBe('Yana Kozlova');
  });

  it('leaves everyone else alone', () => {
    expect(resolveSelfName('Андрій', 'Yana Kozlova')).toBe('Андрій');
    expect(resolveSelfName('Artem', 'Yana Kozlova')).toBe('Artem');
  });

  it('does nothing when the account has no name', () => {
    expect(resolveSelfName('User', null)).toBe('User');
  });
});

describe('normalizeName', () => {
  it('is only case and whitespace, so it stays safe as a storage key', () => {
    expect(normalizeName('  Yana   Kozlova ')).toBe('yana kozlova');
    expect(normalizeName('Яна')).toBe('яна');
    // Crucially not folded: two spellings stay two keys until someone merges them.
    expect(normalizeName('Яна')).not.toBe(normalizeName('Yana'));
  });
});

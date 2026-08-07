import { describe, expect, it } from 'vitest';

import {
  canonicalizeSymptom,
  canonicalizeSymptoms,
  symptomKey,
} from '@/lib/wellbeing/symptoms';

describe('symptomKey', () => {
  it('collapses the grammatical forms of one complaint', () => {
    const key = symptomKey('головний біль');

    expect(symptomKey('болить голова')).toBe(key);
    expect(symptomKey('головного болю')).toBe(key);
    expect(symptomKey('біль голови')).toBe(key);
    expect(symptomKey('Головний Біль.')).toBe(key);
  });

  it('ignores word order and function words', () => {
    expect(symptomKey('шум у вухах')).toBe(symptomKey('вуха шум'));
  });

  it('keeps genuinely different complaints apart', () => {
    const keys = ['головний біль', 'нудота', 'безсоння', 'важка голова', 'шум у вухах'].map(
      symptomKey
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not merge distinct words the user chose to distinguish', () => {
    expect(symptomKey('втома')).not.toBe(symptomKey('виснаження'));
  });

  it('unifies adjective and noun forms of the same stem', () => {
    expect(symptomKey('важка голова')).toBe(symptomKey('важкої голови'));
  });

  it('is empty for a label with no usable tokens', () => {
    expect(symptomKey('!!!')).toBe('');
  });
});

describe('canonicalizeSymptom', () => {
  const known = ['головний біль', 'нудота'];

  it('returns the spelling the user already uses', () => {
    expect(canonicalizeSymptom('болить голова', known)).toBe('головний біль');
    expect(canonicalizeSymptom('Головного Болю', known)).toBe('головний біль');
  });

  it('leaves a genuinely new complaint alone, only normalised', () => {
    expect(canonicalizeSymptom('  Безсоння.', known)).toBe('безсоння');
  });

  it('never invents a label when the vocabulary is empty', () => {
    expect(canonicalizeSymptom('головний біль', [])).toBe('головний біль');
  });

  it('folds a longer naming of the same complaint onto the existing one', () => {
    expect(canonicalizeSymptom('білий шум в голові', ['білий шум'])).toBe('білий шум');
  });

  it('folds the looser naming onto the existing longer one, too', () => {
    expect(canonicalizeSymptom('білий шум', ['білий шум в голові'])).toBe('білий шум в голові');
  });

  it('will not let a one-word label be swallowed by a longer phrase', () => {
    expect(canonicalizeSymptom('нудота', ['нудота після їжі'])).toBe('нудота');
    expect(canonicalizeSymptom('нудота після їжі', ['нудота'])).toBe('нудота після їжі');
  });

  it('does not confuse "білий" with "біль" when they stem alike', () => {
    // Both reduce to `біл`, so unordered containment made "білий шум в голові"
    // look like a narrower "головний біль". Word order tells them apart.
    expect(
      canonicalizeSymptom('білий шум в голові', ['головний біль', 'нудота', 'білий шум'])
    ).toBe('білий шум');
  });

  it('keeps two same-length descriptions apart', () => {
    expect(canonicalizeSymptom('важка голова', ['мутна голова'])).toBe('важка голова');
  });

  it('prefers the vocabulary the user reaches for most', () => {
    // `known` arrives frequency-ordered, so the first match wins.
    expect(canonicalizeSymptom('білий шум у вухах', ['білий шум', 'білий шум в голові'])).toBe(
      'білий шум'
    );
  });
});

describe('canonicalizeSymptoms', () => {
  it('folds a new wording onto the existing label and reports it', () => {
    const result = canonicalizeSymptoms(['болить голова'], ['головний біль']);

    expect(result.symptoms).toEqual(['головний біль']);
    expect(result.changed).toEqual([{ from: 'болить голова', to: 'головний біль' }]);
  });

  it('de-duplicates two spellings of one complaint inside a single check-in', () => {
    const result = canonicalizeSymptoms(['головний біль', 'болить голова'], []);

    expect(result.symptoms).toEqual(['головний біль']);
  });

  it('reports nothing changed when the wording already matches', () => {
    const result = canonicalizeSymptoms(['нудота'], ['нудота', 'головний біль']);

    expect(result.symptoms).toEqual(['нудота']);
    expect(result.changed).toEqual([]);
  });

  it('keeps several distinct symptoms from one check-in', () => {
    const result = canonicalizeSymptoms(['важка голова', 'нудота', 'шум у вухах'], []);

    expect(result.symptoms).toEqual(['важка голова', 'нудота', 'шум у вухах']);
  });

  it('handles an absent or empty list', () => {
    expect(canonicalizeSymptoms(undefined, ['нудота'])).toEqual({ symptoms: [], changed: [] });
    expect(canonicalizeSymptoms([], [])).toEqual({ symptoms: [], changed: [] });
  });

  it('drops labels that normalise away to nothing, keeping the real ones', () => {
    expect(canonicalizeSymptoms(['   ', '...', 'нудота'], []).symptoms).toEqual(['нудота']);
  });
});

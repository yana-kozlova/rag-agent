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

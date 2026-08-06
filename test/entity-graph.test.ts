import { describe, expect, it, vi } from 'vitest';

// The module reaches for the database at import time; the rules under test do not.
vi.mock('@/lib/db', () => ({ db: {} }));

import { toGraphCandidates } from '@/lib/actions/entities';

describe('toGraphCandidates', () => {
  it('keeps the kinds of thing worth a page of their own', () => {
    const result = toGraphCandidates([
      { name: 'Марта', type: 'person' },
      { name: 'Acme', type: 'organization' },
      { name: 'Landing redesign', type: 'project' },
    ]);

    expect(result.map((e) => e.name)).toEqual(['Марта', 'Acme', 'Landing redesign']);
  });

  // The recipe case: fifteen true statements, none of them knowledge.
  it('drops ingredients and other one-off nouns', () => {
    const result = toGraphCandidates([
      { name: 'butter', type: 'ingredient' },
      { name: 'brandy/whiskey/rum', type: 'ingredient' },
      { name: 'adolescence', type: 'life stage' },
      { name: 'Артем', type: 'person' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Артем');
  });

  it('folds synonyms onto the canonical type', () => {
    const result = toGraphCandidates([
      { name: 'Acme', type: 'company' },
      { name: 'Kyiv', type: 'city' },
      { name: 'React', type: 'technology' },
    ]);

    expect(result.map((e) => e.type)).toEqual(['organization', 'place', 'skill']);
  });

  it('collapses the same name mentioned twice in one note', () => {
    const result = toGraphCandidates([
      { name: 'Марта', type: 'person' },
      { name: '  марта ', type: 'person' },
      { name: 'МАРТА', type: 'Person' },
    ]);

    expect(result).toHaveLength(1);
    // The normalised key matches, while the displayed name stays as written.
    expect(result[0].normalizedName).toBe('марта');
  });

  it('keeps the same name under two different types apart', () => {
    const result = toGraphCandidates([
      { name: 'Sequoia', type: 'organization' },
      { name: 'Sequoia', type: 'place' },
    ]);

    expect(result).toHaveLength(2);
  });

  it('rejects names that are not names', () => {
    const result = toGraphCandidates([
      { name: '', type: 'person' },
      { name: ' ', type: 'person' },
      { name: '42', type: 'person' },
      { name: 'x'.repeat(200), type: 'person' },
      { name: 'Ok', type: 'person' },
    ]);

    expect(result.map((e) => e.name)).toEqual(['Ok']);
  });

  it('flattens key/value attributes into an object', () => {
    const [entity] = toGraphCandidates([
      {
        name: 'Марта',
        type: 'person',
        attributes: [
          { key: 'role', value: 'designer' },
          { key: 'days', value: 'Tue–Thu' },
        ],
      },
    ]);

    expect(entity.attributes).toEqual({ role: 'designer', days: 'Tue–Thu' });
  });

  it('accepts attributes already stored as an object', () => {
    const [entity] = toGraphCandidates([
      { name: 'Марта', type: 'person', attributes: { role: 'designer' } },
    ]);

    expect(entity.attributes).toEqual({ role: 'designer' });
  });

  it('normalises empty attributes to null rather than an empty object', () => {
    const [entity] = toGraphCandidates([
      { name: 'Марта', type: 'person', attributes: [] },
    ]);

    expect(entity.attributes).toBeNull();
  });

  it('survives an empty or missing list', () => {
    expect(toGraphCandidates([])).toEqual([]);
    expect(toGraphCandidates(undefined as any)).toEqual([]);
  });
});

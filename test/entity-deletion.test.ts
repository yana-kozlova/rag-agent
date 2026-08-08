import { describe, expect, it, vi } from 'vitest';

// The module reaches for the database at import time; the rules under test do not.
vi.mock('@/lib/db', () => ({ db: {} }));

import { identityKey, toGraphCandidates, withoutExcluded } from '@/lib/actions/entities';

/**
 * The rule a deleted entity leaves behind.
 *
 * Deleting a node cannot be a delete of a row: `entities` is rebuilt from every
 * note's `metadata.entities`, so the name has to be refused at the point the
 * projection would recreate it. That refusal is the only part of the feature
 * that is pure, and it is also the part that silently swallows things if it is
 * one character too broad.
 */

function excluded(...keys: Array<{ normalizedName: string; type: string }>) {
  return new Set(keys.map(identityKey));
}

describe('withoutExcluded', () => {
  it('refuses a name the user has buried', () => {
    const candidates = toGraphCandidates([
      { name: 'Дякую', type: 'person' },
      { name: 'Артем', type: 'person' },
    ]);

    const kept = withoutExcluded(candidates, excluded({ normalizedName: 'дякую', type: 'person' }));

    expect(kept.map((c) => c.name)).toEqual(['Артем']);
  });

  // The exclusion is keyed on the same triple as `entities.identity`, so it is
  // a decision about one name *of one type* and must not reach past it.
  it('leaves the same name under another type alone', () => {
    const candidates = toGraphCandidates([
      { name: 'Sequoia', type: 'organization' },
      { name: 'Sequoia', type: 'place' },
    ]);

    const kept = withoutExcluded(
      candidates,
      excluded({ normalizedName: 'sequoia', type: 'organization' })
    );

    expect(kept.map((c) => c.type)).toEqual(['place']);
  });

  // The tombstone stores the matching key, and the note carries whatever the
  // model typed this time. Comparing the displayed spellings would let a stray
  // capital resurrect the node.
  it('matches on the normalised name rather than the written one', () => {
    const candidates = toGraphCandidates([{ name: '  МАРТА ', type: 'Person' }]);

    expect(withoutExcluded(candidates, excluded({ normalizedName: 'марта', type: 'person' }))).toEqual(
      []
    );
  });

  it('changes nothing when the user has buried nothing', () => {
    const candidates = toGraphCandidates([
      { name: 'Марта', type: 'person' },
      { name: 'Acme', type: 'company' },
    ]);

    expect(withoutExcluded(candidates, new Set())).toEqual(candidates);
  });
});

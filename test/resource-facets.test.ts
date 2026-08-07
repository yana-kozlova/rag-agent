import { describe, expect, it } from 'vitest';

import { collectFacets } from '@/lib/utils/resource-facets';
import {
  EXTRACTABLE_RESOURCE_TYPES,
  RESOURCE_TYPES,
  resourceTypeIcon,
  resourceTypeLabel,
} from '@/lib/utils/resource-types';
import { resourceMetadataSchema } from '@/lib/db/schema/resources';
import { informationExtractionSchema } from '@/lib/ai/information-extraction';

/**
 * The Knowledge Base filter used to be a hand-written list of types, and it had
 * drifted: it offered types nothing carried and omitted `image`, `event`,
 * `preference` and `need`, which the extractor had been assigning all along —
 * so those notes existed and could not be reached from the page that exists to
 * reach them. These tests pin the two things that stop it happening again: the
 * options are counted from the rows, and every writer of `metadata.type` draws
 * from one list.
 */

describe('collectFacets', () => {
  it('offers only the types the rows actually carry', () => {
    const facets = collectFacets([
      { metadata: { type: 'person' } },
      { metadata: { type: 'preference' } },
      { metadata: { type: 'person' } },
    ]);

    expect(facets.types).toEqual([
      { type: 'person', count: 2 },
      { type: 'preference', count: 1 },
    ]);
  });

  it('counts an untyped row as a note, matching how the UI labels it', () => {
    const facets = collectFacets([
      { metadata: null },
      { metadata: {} },
      { metadata: { type: 'note' } },
    ]);

    expect(facets.types).toEqual([{ type: 'note', count: 3 }]);
  });

  it('keeps a type it has never heard of rather than dropping the rows', () => {
    // `metadata` is passthrough, so a row written by an older version can hold
    // anything. Silently omitting it is the original bug in a new costume.
    const facets = collectFacets([{ metadata: { type: 'recipe' } }]);

    expect(facets.types).toEqual([{ type: 'recipe', count: 1 }]);
  });

  it('orders by the canonical list so the dropdown does not reshuffle', () => {
    const facets = collectFacets([
      { metadata: { type: 'other' } },
      { metadata: { type: 'zzz-unknown' } },
      { metadata: { type: 'note' } },
      { metadata: { type: 'person' } },
    ]);

    expect(facets.types.map(t => t.type)).toEqual(['note', 'person', 'other', 'zzz-unknown']);
  });

  it('collects tags and categories, trimmed and deduplicated', () => {
    const facets = collectFacets([
      { metadata: { tags: ['work', ' health '], category: 'personal' } },
      { metadata: { tags: ['health'], category: ' personal ' } },
    ]);

    expect(facets.tags).toEqual(['health', 'work']);
    expect(facets.categories).toEqual(['personal']);
  });
});

describe('the type list has one home', () => {
  it('is what the metadata schema accepts', () => {
    for (const type of RESOURCE_TYPES) {
      expect(resourceMetadataSchema.parse({ type }).type).toBe(type);
    }
  });

  it('is a superset of what the extractor may choose', () => {
    for (const type of EXTRACTABLE_RESOURCE_TYPES) {
      expect(RESOURCE_TYPES).toContain(type);
    }
    // `image` is the vision path's to assign, never the extractor's.
    expect(EXTRACTABLE_RESOURCE_TYPES).not.toContain('image');
    expect(informationExtractionSchema.shape.contentType.safeParse('image').success).toBe(false);
    expect(informationExtractionSchema.shape.contentType.safeParse('person').success).toBe(true);
  });

  it('gives every type an icon and a label, including one it has not met', () => {
    for (const type of RESOURCE_TYPES) {
      expect(resourceTypeIcon(type)).toBeTruthy();
      expect(resourceTypeLabel(type)).toBe(type.charAt(0).toUpperCase() + type.slice(1));
    }
    expect(resourceTypeIcon('recipe')).toBe(resourceTypeIcon('other'));
    expect(resourceTypeLabel('recipe')).toBe('Recipe');
  });
});

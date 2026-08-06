import { describe, expect, it } from 'vitest';

import { informationExtractionSchema } from '@/lib/ai/information-extraction';
import { insertResourceSchema, resourceMetadataSchema } from '@/lib/db/schema/resources';

/**
 * The two schemas either side of a save have to agree about "nothing here".
 *
 * The extractor says it with `null` — its every optional branch defaults to
 * null so a partial answer from the model still validates. The metadata schema
 * used to say it with a missing key, and `.optional()` rejects null, so a
 * single fact the model had no context for failed validation for the entire
 * resource and the note was dropped with a wall of Zod JSON in its place.
 */
describe('resource metadata accepts what the extractor emits', () => {
  it('saves facts whose context the model left empty', () => {
    const parsed = insertResourceSchema.parse({
      content: 'structured note',
      userId: '00000000-0000-0000-0000-000000000000',
      metadata: {
        type: 'note',
        facts: [
          { subject: 'user', predicate: 'likes', object: 'guitar', context: null },
          { subject: 'user', predicate: 'works at', object: 'Acme', context: null },
        ],
      },
    });

    expect(parsed.metadata?.facts).toHaveLength(2);
    expect(parsed.metadata?.facts?.[0].context).toBeUndefined();
    // And undefined is not a JSON value, so the jsonb column never sees the key.
    expect(JSON.parse(JSON.stringify(parsed.metadata))?.facts[0]).toEqual({
      subject: 'user',
      predicate: 'likes',
      object: 'guitar',
    });
  });

  it('keeps a context the model did fill in', () => {
    const parsed = resourceMetadataSchema.parse({
      facts: [{ subject: 'user', predicate: 'reads', object: 'books', context: 'before bed' }],
    });

    expect(parsed.facts?.[0].context).toBe('before bed');
  });

  it('accepts every null branch of a whole extraction result', () => {
    // What `generateObject` returns when the model answered with the required
    // fields and nothing else — the shape addResource/analyzeFile hand on.
    const extracted = informationExtractionSchema.parse({
      facts: [{ subject: 'user', predicate: 'needs', object: 'a schedule', context: null }],
      entities: [{ name: 'guitar', type: 'activity', relationship: null, attributes: null }],
      needs: [{ need: 'plan the day', priority: null, context: null }],
      structuredContent: { title: 'Daily schedule', summary: '', keyPoints: [], tags: [] },
      userName: null,
      contentType: 'note',
    });

    const metadata = resourceMetadataSchema.parse({
      type: extracted.contentType,
      tags: extracted.structuredContent.tags,
      facts: extracted.facts,
      entities: extracted.entities.map((e) => ({
        name: e.name,
        type: e.type,
        relationship: e.relationship,
      })),
      needs: extracted.needs,
      keyPoints: extracted.structuredContent.keyPoints,
      userName: extracted.userName,
    });

    expect(metadata.entities?.[0].relationship).toBeUndefined();
    expect(metadata.needs?.[0].priority).toBeUndefined();
    expect(metadata.userName).toBeUndefined();
  });
});

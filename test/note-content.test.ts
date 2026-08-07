import { describe, expect, it } from 'vitest';

import {
  formatStructuredContent,
  informationExtractionSchema,
  stripLegacyProseSections,
} from '@/lib/ai/information-extraction';

/**
 * What a saved note is allowed to contain.
 *
 * One request for a pediatrician's certificate used to be stored five times
 * over — prose summary, the same as bullets, again as subject-predicate-object,
 * again as "name - type (relationship)", once more as a need — so 190
 * characters of information were kept as 743, embedded as five near-identical
 * chunks, and pushed the note past the length at which dossier routing still
 * folds a fact into the note that should hold it.
 */

const extracted = informationExtractionSchema.parse({
  facts: [
    { subject: 'user', predicate: 'needs', object: 'medical certificate from pediatrician for Artem' },
    { subject: 'user', predicate: 'wants to obtain', object: 'medical certificate for school' },
  ],
  entities: [
    { name: 'Artem', type: 'person', relationship: "user's child" },
    { name: 'school', type: 'place', relationship: 'destination for medical certificate' },
  ],
  needs: [
    {
      need: 'obtain medical certificate from pediatrician for Artem',
      priority: 'high',
      context: 'for school, within specified dates',
    },
  ],
  structuredContent: {
    title: 'User needs medical certificate for Artem from pediatrician',
    summary:
      'User needs to obtain a medical certificate from a pediatrician for her child, Artem, for school purposes.',
    keyPoints: ['For her child, Artem', 'Date range: 17.08 to 21.08.26'],
    tags: ['medical certificate', 'school'],
  },
  contentType: 'need',
});

describe('the text a note is stored as', () => {
  const content = formatStructuredContent(extracted, 'original message');

  it('keeps the summary and the key points', () => {
    expect(content).toBe(
      [
        'User needs to obtain a medical certificate from a pediatrician for her child, Artem, for school purposes.',
        '',
        '- For her child, Artem',
        '- Date range: 17.08 to 21.08.26',
      ].join('\n')
    );
  });

  it('does not restate the facts, entities or needs already in metadata', () => {
    expect(content).not.toContain('user needs medical certificate');
    expect(content).not.toContain("Artem - person (user's child)");
    expect(content).not.toContain('[high priority]');
  });

  it('still appends the original message when asked for it', () => {
    const withOriginal = formatStructuredContent(extracted, 'дай довідку від педіатра', true);
    expect(withOriginal).toContain('Original message:');
    expect(withOriginal).toContain('дай довідку від педіатра');
  });

  /** An extraction that produced no bullets must not leave a trailing blank. */
  it('is just the summary when there are no key points', () => {
    const bare = informationExtractionSchema.parse({
      structuredContent: { title: 'x', summary: 'Артем любить програмування.' },
    });
    expect(formatStructuredContent(bare, '')).toBe('Артем любить програмування.');
  });
});

/**
 * Cleaning up the notes written before the above. The text has in some cases
 * since been merged and rewritten, so a line goes only when regenerating it
 * from that note's own metadata reproduces it exactly.
 */
describe('taking the restatements back out of a stored note', () => {
  const metadata = {
    type: 'need',
    facts: [
      {
        subject: 'user',
        predicate: 'needs',
        object: 'medical certificate from pediatrician for Artem',
        context: null,
      },
    ],
    entities: [{ name: 'Artem', type: 'person', relationship: "user's child" }],
    needs: [
      {
        need: 'obtain medical certificate from pediatrician for Artem',
        priority: 'high',
        context: 'for school, within specified dates',
      },
    ],
    keyPoints: ['For her child, Artem'],
  };

  const stored = [
    'User needs to obtain a medical certificate from a pediatrician for her child, Artem.',
    '',
    '- For her child, Artem',
    '',
    'user needs medical certificate from pediatrician for Artem',
    '',
    "Artem - person (user's child)",
    '',
    'obtain medical certificate from pediatrician for Artem [high priority]. for school, within specified dates',
  ].join('\n');

  it('leaves the summary and the key points, and nothing after them', () => {
    expect(stripLegacyProseSections(stored, metadata)).toBe(
      [
        'User needs to obtain a medical certificate from a pediatrician for her child, Artem.',
        '',
        '- For her child, Artem',
      ].join('\n')
    );
  });

  it('reports nothing to do on a note already compacted', () => {
    const compacted = stripLegacyProseSections(stored, metadata)!;
    expect(stripLegacyProseSections(compacted, metadata)).toBeNull();
  });

  /** The whole safety argument: only verbatim generated output is removed. */
  it('keeps a line the user has since edited', () => {
    const edited = stored.replace(
      'user needs medical certificate from pediatrician for Artem',
      'user needs a medical certificate from the pediatrician for Artem'
    );
    expect(stripLegacyProseSections(edited, metadata)).toContain(
      'user needs a medical certificate from the pediatrician for Artem'
    );
  });

  it('refuses to empty a note that is nothing but restatements', () => {
    const onlyFacts = 'user needs medical certificate from pediatrician for Artem';
    expect(stripLegacyProseSections(onlyFacts, metadata)).toBeNull();
  });

  it('does nothing when the metadata carries no such lists', () => {
    expect(stripLegacyProseSections(stored, { type: 'note' })).toBeNull();
    expect(stripLegacyProseSections(stored, null)).toBeNull();
  });
});

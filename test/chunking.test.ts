import { describe, it, expect, vi } from 'vitest';

// The module validates env, opens a database connection and builds an OpenAI
// client at import time; the chunking rules under test need none of it.
vi.mock('@/lib/env.mjs', () => ({ env: {} }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}));
vi.mock('ai', () => ({ embedMany: vi.fn(), embed: vi.fn() }));

import { __test } from '@/lib/ai/embedding';

const { generateChunks, detectContentType, preserveContext } = __test;

/**
 * How a note is cut before it is embedded.
 *
 * Everything downstream — the vector, the tsvector, the passage the model
 * quotes back — is built from these strings and from nothing else. A chunker
 * that drops a sentence does not fail loudly; the text stays in `resources`,
 * looks correct on the page, and is simply never found again.
 */

describe('chunking without losing text', () => {
  /**
   * The regression. Chunks were cut back to the last sentence boundary in the
   * window, but the next chunk still started a full window on from the previous
   * start — so whenever the trim fired, everything between the cut and that
   * point existed in no chunk at all.
   */
  it('keeps text that falls after an early sentence boundary', () => {
    // One short sentence, then a long unpunctuated run: the last sentence
    // boundary in the first window lands early, and the trim bites hard.
    const marker = 'МАРКЕРЦЕЙМАЄВИЖИТИ';
    const text = `Коротке речення. ${'Х'.repeat(430)}. ${marker} ${'У'.repeat(2000)}`;

    const chunks = generateChunks(text, 800, 200);

    expect(chunks.join(' ')).toContain(marker);
  });

  it('leaves no gap anywhere in a long prose note', () => {
    const sentences = Array.from(
      { length: 120 },
      (_, i) => `Речення номер ${i} про те, як минав той довгий і рівний тиждень.`
    ).join(' ');

    const chunks = generateChunks(sentences, 800, 200);
    const joined = chunks.join(' ');

    for (let i = 0; i < 120; i++) {
      expect(joined).toContain(`Речення номер ${i} `);
    }
  });

  it('overlaps consecutive chunks rather than butting them together', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Фраза ${i} тут стоїть.`).join(' ');

    const chunks = generateChunks(text, 400, 100);

    expect(chunks.length).toBeGreaterThan(1);
    // The tail of each chunk reappears at the head of the next.
    for (let i = 0; i < chunks.length - 1; i++) {
      const tailWord = chunks[i].trim().split(/\s+/).slice(-3)[0];
      expect(chunks[i + 1]).toContain(tailWord);
    }
  });

  /**
   * Both sizes are env-configurable and nothing else checks the pair makes
   * sense. An overlap at or past half the chunk means each step forward is
   * smaller than the overlap carried back.
   */
  it('terminates when the overlap is configured larger than the chunk', () => {
    const chunks = generateChunks('Слова течуть рівно й нескінченно. '.repeat(60), 300, 900);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(200);
  });

  it('returns a short note whole', () => {
    expect(generateChunks('Андрій — мій чоловік.')).toEqual(['Андрій — мій чоловік.']);
  });

  it('returns nothing for empty content', () => {
    expect(generateChunks('   \n  ')).toEqual([]);
  });

  it('does not carry a word across the boundary cut in half', () => {
    const text = 'спортзал абонемент тренування розклад. '.repeat(120);

    for (const chunk of generateChunks(text, 500, 120)) {
      // Every token in a chunk is a token the source actually contained.
      for (const token of chunk.split(/\s+/).filter(Boolean)) {
        expect(text.includes(token)).toBe(true);
      }
    }
  });
});

describe('detectContentType', () => {
  /**
   * `\d+\.` used to be matched unanchored — the `m` flag sat on an alternation
   * whose second branch carried no `^` — so an ordinary sentence with a date or
   * a version number in it was chunked line by line as a list.
   */
  it('does not call an ordinary sentence a list because it contains a number', () => {
    expect(detectContentType('Андрій народився в 1985. Живе в Києві.')).not.toBe('list');
    expect(detectContentType('Версія 2.0 вийшла вчора')).not.toBe('list');
    expect(detectContentType('Зустріч о 14.30 в офісі')).not.toBe('list');
  });

  it('still recognises a real list', () => {
    expect(detectContentType('- молоко\n- хліб\n- яйця')).toBe('list');
    expect(detectContentType('1. подзвонити\n2. записатися\n3. оплатити')).toBe('list');
  });

  /**
   * `=>`, `->` and `::` were matched anywhere in the text, so a note using an
   * arrow as punctuation was chunked as source code.
   */
  it('does not call prose code because it contains an arrow', () => {
    expect(detectContentType('Питання -> відповідь, і так по колу')).not.toBe('code');
    expect(detectContentType('Час 10::30 біля входу')).not.toBe('code');
  });

  it('still recognises code', () => {
    expect(detectContentType('```ts\nconst a = 1;\n```')).toBe('code');
    expect(detectContentType('function f() {\n  return 1;\n}')).toBe('code');
  });

  it('recognises a table', () => {
    expect(detectContentType('| a | b |\n| 1 | 2 |')).toBe('table');
  });
});

describe('preserveContext', () => {
  /** A chunk from the middle of a document should say what section it is in. */
  it('carries the heading a chunk sits under', () => {
    const result = preserveContext('решта абзацу', '## Витрати\n\nпочаток абзацу');

    expect(result).toBe('## Витрати\n\nрешта абзацу');
  });

  /**
   * A chunk continues the section most recently opened, not the document's
   * first one.
   */
  it('uses the last heading, not the first', () => {
    const result = preserveContext('текст', '# Книга\n\nвступ\n\n## Розділ 3\n\nпочаток');

    expect(result.startsWith('## Розділ 3')).toBe(true);
  });

  it('does not repeat a heading the chunk already opens with', () => {
    const result = preserveContext('## Витрати\n\nтекст', '## Витрати\n\nпопередній');

    expect(result).toBe('## Витрати\n\nтекст');
  });

  it('leaves a chunk alone when there is no heading to carry', () => {
    expect(preserveContext('текст', 'звичайний попередній абзац')).toBe('текст');
    expect(preserveContext('текст', '')).toBe('текст');
  });
});

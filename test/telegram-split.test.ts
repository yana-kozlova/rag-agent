import { describe, expect, it, vi } from 'vitest';

// The module under test pulls in the Bot API client, which reads validated env
// at import time. Splitting itself needs none of it.
vi.mock('@/lib/env.mjs', () => ({ env: {} }));

import { splitForTelegram } from '@/lib/telegram/api';

const LIMIT = 4096;

describe('splitForTelegram', () => {
  it('leaves a message that fits untouched', () => {
    expect(splitForTelegram('коротка відповідь')).toEqual(['коротка відповідь']);
  });

  it('never emits a piece over the API limit', () => {
    const long = 'слово '.repeat(3000);
    for (const piece of splitForTelegram(long)) {
      expect(piece.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('prefers a paragraph boundary when one is in range', () => {
    const head = 'а'.repeat(LIMIT - 100);
    const [first] = splitForTelegram(`${head}\n\nдругий абзац${'б'.repeat(LIMIT)}`);
    expect(first).toBe(head);
  });

  it('does not split mid-word when a space is available', () => {
    const pieces = splitForTelegram(`${'слово '.repeat(1000)}кінець`);
    for (const piece of pieces) {
      expect(piece.startsWith(' ')).toBe(false);
      expect(piece.endsWith(' ')).toBe(false);
    }
  });

  it('still splits text with no boundary at all', () => {
    const pieces = splitForTelegram('я'.repeat(LIMIT * 2 + 10));
    expect(pieces.length).toBe(3);
    expect(pieces[0].length).toBe(LIMIT);
  });

  it('loses no characters other than boundary whitespace', () => {
    const original = `${'дані '.repeat(2000)}хвіст`;
    const rejoined = splitForTelegram(original).join(' ');
    expect(rejoined.replace(/\s+/g, '')).toBe(original.replace(/\s+/g, ''));
  });
});

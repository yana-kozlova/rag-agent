import { describe, expect, it } from 'vitest';

import {
  acceptsPointer,
  inkBounds,
  normalizePressure,
  parseDraft,
  strokeHit,
  widthFor,
  type InkStroke,
} from '@/lib/utils/ink';

const line: InkStroke = { points: [[0, 0, 0.5], [100, 0, 0.5]] };

describe('acceptsPointer', () => {
  it('lets a finger draw until a pen has been seen, then treats touch as the palm', () => {
    expect(acceptsPointer('touch', false)).toBe(true);
    expect(acceptsPointer('touch', true)).toBe(false);
    expect(acceptsPointer('pen', true)).toBe(true);
    expect(acceptsPointer('mouse', true)).toBe(true);
  });
});

describe('normalizePressure', () => {
  it('trusts only a pen, and not a pen reporting zero', () => {
    expect(normalizePressure(0.8, 'pen')).toBe(0.8);
    expect(normalizePressure(0, 'pen')).toBe(0.5);
    expect(normalizePressure(1, 'touch')).toBe(0.5);
    expect(widthFor(1)).toBeGreaterThan(widthFor(0.1));
  });
});

describe('strokeHit', () => {
  it('takes a stroke crossed between two far-apart samples', () => {
    expect(strokeHit(line, 50, 5, 12)).toBe(true);
  });

  it('leaves a stroke the eraser only passes near', () => {
    expect(strokeHit(line, 50, 40, 12)).toBe(false);
    expect(strokeHit(line, 130, 0, 12)).toBe(false);
  });

  it('handles a dot', () => {
    expect(strokeHit({ points: [[10, 10, 0.5]] }, 14, 10, 12)).toBe(true);
  });
});

describe('inkBounds', () => {
  it('is null for an empty pad', () => {
    expect(inkBounds([])).toBeNull();
  });

  it('wraps everything written, padded', () => {
    expect(inkBounds([line, { points: [[20, 60, 0.5]] }], 10)).toEqual({
      x: -10,
      y: -10,
      width: 120,
      height: 80,
    });
  });
});

describe('parseDraft', () => {
  it('reads back what it was given', () => {
    expect(parseDraft(JSON.stringify([line]))).toEqual([line]);
  });

  it('drops malformed points and strokes instead of throwing', () => {
    expect(parseDraft('not json')).toEqual([]);
    expect(parseDraft('{"points":[]}')).toEqual([]);
    expect(
      parseDraft(JSON.stringify([{ points: [[1, 2, 0.5], [1, 'x', 0.5], [3]] }, { points: [] }, null]))
    ).toEqual([{ points: [[1, 2, 0.5]] }]);
  });
});

import { describe, expect, it, vi } from 'vitest';

// The Bot API client reads validated env at import time; only the origin the
// app is reachable at matters here.
vi.mock('@/lib/env.mjs', () => ({
  env: { APP_URL: 'https://brain.example.com', NEXTAUTH_URL: 'http://localhost:3000' },
}));

import { flattenMarkdownLinks } from '@/lib/telegram/api';

describe('flattenMarkdownLinks', () => {
  it('turns an in-app path into an address that exists outside the app', () => {
    expect(flattenMarkdownLinks('Ось [Рецепт манника](/resources/abc123).')).toBe(
      'Ось Рецепт манника: https://brain.example.com/resources/abc123.'
    );
  });

  it('keeps an absolute link as label plus URL', () => {
    expect(flattenMarkdownLinks('[docs](https://example.com/a)')).toBe(
      'docs: https://example.com/a'
    );
  });

  it('prints a URL once when it is its own label', () => {
    expect(flattenMarkdownLinks('[https://example.com/a](https://example.com/a)')).toBe(
      'https://example.com/a'
    );
  });

  it('reduces a target that was never an address to its label', () => {
    expect(flattenMarkdownLinks('[Рецепт манника](#abc123)')).toBe('Рецепт манника');
  });

  it('leaves text without links, and bare URLs, alone', () => {
    const plain = 'Завтра о 10:00 зустріч. https://example.com/a';
    expect(flattenMarkdownLinks(plain)).toBe(plain);
  });

  it('rewrites every link in a message', () => {
    expect(
      flattenMarkdownLinks('[а](/resources/1) та [б](/resources/2)')
    ).toBe(
      'а: https://brain.example.com/resources/1 та б: https://brain.example.com/resources/2'
    );
  });
});

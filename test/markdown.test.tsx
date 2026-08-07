import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderSimpleMarkdown } from '@/app/components/utils/markdown';

describe('renderSimpleMarkdown', () => {
  it('renders headings starting with ###', () => {
    const html = renderToStaticMarkup(renderSimpleMarkdown('### Hello World'));
    expect(html).toContain('font-semibold');
    expect(html).toContain('Hello World');
  });

  it('renders unordered lists for lines starting with -', () => {
    const input = '- one\n- two\n- three';
    const html = renderToStaticMarkup(renderSimpleMarkdown(input));
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    expect((html.match(/<li/g) || []).length).toBe(3);
  });

  it('renders bold text for **bold** spans', () => {
    const input = 'This is **bold** text';
    const html = renderToStaticMarkup(renderSimpleMarkdown(input));
    expect(html).toContain('<strong>bold</strong>');
  });

  it('flushes list buffer when switching back to paragraph', () => {
    const input = '- a\n- b\nparagraph';
    const html = renderToStaticMarkup(renderSimpleMarkdown(input));
    // expect one ul and a paragraph after
    expect((html.match(/<ul/g) || []).length).toBe(1);
    expect((html.match(/<p/g) || []).length).toBe(1);
  });

  it('renders an in-app path as a link', () => {
    const html = renderToStaticMarkup(
      renderSimpleMarkdown('Ось [Рецепт манника](/resources/58t77itajpwdwpgf61im1) для тебе')
    );
    expect(html).toContain('href="/resources/58t77itajpwdwpgf61im1"');
    expect(html).toContain('>Рецепт манника</a>');
    expect(html).not.toContain('[Рецепт манника]');
  });

  it('opens an external link in a new tab, with the internal one left alone', () => {
    const external = renderToStaticMarkup(renderSimpleMarkdown('[docs](https://example.com/a)'));
    expect(external).toContain('target="_blank"');
    expect(external).toContain('rel="noopener noreferrer"');

    expect(renderToStaticMarkup(renderSimpleMarkdown('[note](/resources/x)'))).not.toContain(
      'target="_blank"'
    );
  });

  // The bug this renderer was fixed for: the model invents `#<id>` when it has
  // no real address, and a link that goes nowhere must not look clickable.
  it('drops link targets that are not addresses, keeping the label', () => {
    for (const href of ['#58t77itajpwdwpgf61im1', 'javascript:alert', '//evil.example.com']) {
      const html = renderToStaticMarkup(renderSimpleMarkdown(`[Рецепт](${href})`));
      expect(html).not.toContain('<a');
      expect(html).toContain('Рецепт');
      expect(html).not.toContain(href);
    }
  });

  // A target with parentheses is not a link to begin with — the pattern stops
  // at the first `)`. It has to stay inert text rather than half-parse.
  it('never builds an anchor out of a target containing parentheses', () => {
    const html = renderToStaticMarkup(renderSimpleMarkdown('[Рецепт](javascript:alert(1))'));
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
  });

  it('links a bare URL without swallowing the sentence it ends', () => {
    const html = renderToStaticMarkup(renderSimpleMarkdown('Дивись https://example.com/a, там усе.'));
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain(', там усе.');
  });

  it('renders links inside list items and alongside bold text', () => {
    const html = renderToStaticMarkup(
      renderSimpleMarkdown('- **Манник**: [відкрити](/resources/abc)')
    );
    expect(html).toContain('<strong>Манник</strong>');
    expect(html).toContain('href="/resources/abc"');
  });
});



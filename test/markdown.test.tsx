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
});



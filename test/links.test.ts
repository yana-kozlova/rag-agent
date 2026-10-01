import { describe, expect, it } from 'vitest';
import { isReachableUrl, unlinkUnreachable } from '@/lib/utils/links';

describe('isReachableUrl', () => {
  it('accepts an ordinary public address', () => {
    for (const url of ['https://nextjs.org/docs', 'http://zoom.us/j/123', 'https://a.b.co.uk/x?y=1']) {
      expect(isReachableUrl(url)).toBe(true);
    }
  });

  // What the model wrote on 6 and 10 September, with no address to hand.
  it('refuses a host that is a sentence rather than a place', () => {
    expect(isReachableUrl('https://your-link-to-the-resource/')).toBe(false);
    expect(isReachableUrl('https://your-link-to-the-table/')).toBe(false);
  });

  it('refuses the names reserved for documentation and the local machine', () => {
    for (const url of [
      'https://example.com/note',
      'https://www.example.org',
      'https://notes.example/x',
      'http://app.test',
      'http://localhost:3000/resources/a',
      'https://printer.local',
    ]) {
      expect(isReachableUrl(url)).toBe(false);
    }
  });

  it('refuses what is not an http(s) URL', () => {
    for (const url of ['javascript:alert(1)', 'mailto:a@b.com', '/resources/abc', 'not a url']) {
      expect(isReachableUrl(url)).toBe(false);
    }
  });
});

describe('unlinkUnreachable', () => {
  it('reduces a stand-in link to its words and leaves real ones alone', () => {
    expect(
      unlinkUnreachable(
        'Деталі [тут](https://your-link-to-the-resource/). Також [нотатка](/resources/abc) і [docs](https://nextjs.org/docs).'
      )
    ).toBe('Деталі тут. Також [нотатка](/resources/abc) і [docs](https://nextjs.org/docs).');
  });
});

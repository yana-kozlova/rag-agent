import { describe, it, expect, vi } from 'vitest';

/**
 * One reply, two surfaces, and only one of them rendering Markdown.
 *
 * `sendMessage` sends without `parse_mode` on purpose, so a schedule written
 * as "### Завтра" over "1. **Робочі години**: з 08:30" arrived in the bot with
 * the hashes and asterisks visible — noisier than the plain text they were
 * decorating. The web chat renders the same answer properly, which is why it
 * went unnoticed.
 */

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('@/lib/env.mjs', () => ({ get env() { return envMock; } }));

import { stripMarkdown } from '@/lib/telegram/api';

describe('stripMarkdown', () => {
  it('removes headings', () => {
    expect(stripMarkdown('### Завтра, 19 серпня 2026')).toBe('Завтра, 19 серпня 2026');
    expect(stripMarkdown('## Заголовок ##')).toBe('Заголовок');
  });

  it('unwraps bold, italic and strikethrough', () => {
    expect(stripMarkdown('**Робочі години**: з 08:30')).toBe('Робочі години: з 08:30');
    expect(stripMarkdown('це *важливо* і __дуже__')).toBe('це важливо і дуже');
    expect(stripMarkdown('~~скасовано~~')).toBe('скасовано');
  });

  it('unwraps inline code and drops fences', () => {
    expect(stripMarkdown('запусти `pnpm test`')).toBe('запусти pnpm test');
    expect(stripMarkdown('```ts\nconst a = 1\n```')).toBe('const a = 1\n');
  });

  /**
   * The marks have to hug the text. Multiplication and a stray asterisk are
   * not emphasis, and mangling them would be a worse bug than the one fixed.
   */
  it('leaves arithmetic and loose asterisks alone', () => {
    expect(stripMarkdown('формула 3 * 4 * 5')).toBe('формула 3 * 4 * 5');
    expect(stripMarkdown('зірочка сама * по собі')).toBe('зірочка сама * по собі');
  });

  /** A list reads as a list in plain text; the markers stay. */
  it('keeps list markers and the schedule column', () => {
    expect(stripMarkdown('- 10:00  Нарада')).toBe('- 10:00  Нарада');
    expect(stripMarkdown('1. 13:10  Педіатр')).toBe('1. 13:10  Педіатр');
    expect(stripMarkdown('10:00  Коротка нарада Tribal1')).toBe('10:00  Коротка нарада Tribal1');
  });

  it('strips blockquotes and rules', () => {
    expect(stripMarkdown('> цитата')).toBe('цитата');
    expect(stripMarkdown('---')).toBe('');
  });

  /** The whole reported message, end to end. */
  it('turns the reported schedule into plain text', () => {
    const input = [
      '### Завтра, 19 серпня 2026',
      '1. **Робочі години**: з 08:30 до 18:00',
      '2. **Прийом у педіатра**: з 13:10 до 13:35',
    ].join('\n');

    expect(stripMarkdown(input)).toBe(
      [
        'Завтра, 19 серпня 2026',
        '1. Робочі години: з 08:30 до 18:00',
        '2. Прийом у педіатра: з 13:10 до 13:35',
      ].join('\n')
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  createLinkGrounder,
  groundLinks,
  groundLinksTransform,
  groundsFrom,
  settledLength,
} from '@/lib/ai/grounded-links';

// What a turn's tools handed back, in the form the transform accumulates it.
const GROUNDS = JSON.stringify([
  { success: true, id: 'abc123', url: '/resources/abc123' },
  { success: true, url: '/tables/t9', tableTitle: 'Прийом ліків' },
  { results: [{ content: 'Зустріч: https://zoom.us/j/555 о 10:00', url: '/resources/zz7' }] },
]);

describe('groundLinks', () => {
  it('keeps a link a tool handed over', () => {
    const text = 'Зберегла: [Ростік](/resources/abc123). Таблиця: [Прийом ліків](/tables/t9).';
    expect(groundLinks(text, GROUNDS)).toBe(text);
  });

  // The two replies this was written for.
  it('reduces a stand-in address to the words it was hung on', () => {
    expect(groundLinks('[Деталі тут](https://your-link-to-the-resource/).', GROUNDS)).toBe('Деталі тут.');
    expect(groundLinks('Таблицю видно [тут](https://your-link-to-the-table/).', GROUNDS)).toBe(
      'Таблицю видно тут.'
    );
  });

  it('unlinks an in-app path nothing supplied', () => {
    expect(groundLinks('[Нотатка](/resources/nope42)', GROUNDS)).toBe('Нотатка');
  });

  it('does not take the front of a supplied id for the id', () => {
    expect(groundLinks('[Нотатка](/resources/abc)', GROUNDS)).toBe('Нотатка');
  });

  it("keeps the app's own pages, which exist whatever the turn looked at", () => {
    const text = 'Див. [задачі](/tasks), [таймлайн](/timeline/) і [Google](/settings#google).';
    expect(groundLinks(text, '')).toBe(text);
  });

  it('drops an invented host from a real address and keeps the path', () => {
    expect(groundLinks('[Ростік](https://my-brain.vercel.app/resources/abc123)', GROUNDS)).toBe(
      '[Ростік](/resources/abc123)'
    );
  });

  it("never reads a foreign site's path as one of the app's pages", () => {
    expect(groundLinks('[Задачі](https://en.wikipedia.org/tasks)', GROUNDS)).toBe('Задачі');
  });

  it('keeps an outside address that came out of a note', () => {
    const text = 'Посилання: [Zoom](https://zoom.us/j/555), або https://zoom.us/j/555.';
    expect(groundLinks(text, GROUNDS)).toBe(text);
  });

  it('unlinks an outside address nobody supplied, and removes a bare one', () => {
    expect(groundLinks('[Документація](https://nextjs.org/docs)', GROUNDS)).toBe('Документація');

    const bare = groundLinks('Дивись https://your-link-to-the-resource/ там.', GROUNDS);
    expect(bare).not.toContain('http');
    expect(bare).toContain('там.');
  });

  it('drops a link whose words are the invented address too', () => {
    expect(
      groundLinks('[https://your-link-to-the-resource/](https://your-link-to-the-resource/)', GROUNDS)
    ).toBe('');
  });

  it('reduces an id dressed as an anchor to its label', () => {
    expect(groundLinks('[Ростік](#abc123)', GROUNDS)).toBe('Ростік');
  });

  it('keeps a mail address only when it was handed over', () => {
    const grounds = JSON.stringify({ email: 'olena@gmail.com' });
    expect(groundLinks('[Олена](mailto:olena@gmail.com)', grounds)).toBe('[Олена](mailto:olena@gmail.com)');
    expect(groundLinks('[Олена](mailto:olena@gmail.com)', '')).toBe('Олена');
  });
});

describe('groundsFrom', () => {
  it("counts what the user said and what the tools answered, never the assistant's own words", () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Ось мій сайт https://olena.dev' },
      { role: 'assistant', content: 'Деталі [тут](https://your-link-to-the-resource/)' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: '1',
            toolName: 'addResource',
            output: { type: 'json', value: { url: '/resources/abc123' } },
          },
        ],
      },
    ];
    const grounds = groundsFrom(messages);

    expect(groundLinks('[сайт](https://olena.dev) і [нотатка](/resources/abc123)', grounds)).toBe(
      '[сайт](https://olena.dev) і [нотатка](/resources/abc123)'
    );
    // An old stand-in cannot vouch for the next one.
    expect(groundLinks('[тут](https://your-link-to-the-resource/)', grounds)).toBe('тут');
  });
});

describe('streamed grounding', () => {
  const REPLY =
    'Зберегла [Ростік](/resources/abc123) і таблицю [Прийом ліків](/tables/t9). ' +
    'Деталі [тут](https://your-link-to-the-resource/), зустріч https://zoom.us/j/555, а [docs](https://nextjs.org/docs) — ні.\n' +
    '[1] примітка без посилання та [незакрите';

  function streamed(text: string, sizes: number[]): string {
    const grounder = createLinkGrounder(() => GROUNDS);
    let out = '';
    for (let at = 0, i = 0; at < text.length; i++) {
      const size = sizes[i % sizes.length];
      out += grounder.push(text.slice(at, at + size));
      at += size;
    }
    return out + grounder.flush();
  }

  it('grounds a reply delivered in pieces exactly as it grounds the whole', () => {
    const whole = groundLinks(REPLY, GROUNDS);
    for (const sizes of [[1], [2, 5], [3, 1, 7], [11], [REPLY.length]]) {
      expect(streamed(REPLY, sizes)).toBe(whole);
    }
  });

  it('never releases part of a link before the rest has arrived', () => {
    expect(settledLength('Ось [Рост')).toBe(4);
    expect(settledLength('Ось [Ростік](/resou')).toBe(4);
    expect(settledLength('Ось [Ростік](/resources/abc123)')).toBe(4);
    expect(settledLength('Ось [Ростік](/resources/abc123) і')).toBe('Ось [Ростік](/resources/abc123) '.length);
  });

  it('holds back the word being written, which may be the front of a URL', () => {
    expect(settledLength('зустріч https://zoo')).toBe('зустріч '.length);
    expect(settledLength('текст ')).toBe('текст '.length);
  });

  it('lets go of a bracket that is not becoming a link', () => {
    expect(settledLength('[1] примітка ')).toBe('[1] примітка '.length);
  });
});

describe('groundLinksTransform', () => {
  async function run(parts: any[], seed = ''): Promise<any[]> {
    const input = new ReadableStream<any>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });
    const reader = input
      .pipeThrough(groundLinksTransform(seed)({ tools: {} as any, stopStream() {} }) as any)
      .getReader();

    const seen: any[] = [];
    for (let next = await reader.read(); !next.done; next = await reader.read()) seen.push(next.value);
    return seen;
  }

  it('grounds streamed text against the tool results that came through before it', async () => {
    const seen = await run([
      {
        type: 'tool-result',
        toolCallId: '1',
        toolName: 'addResource',
        input: {},
        output: { success: true, url: '/resources/abc123' },
      },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'Зберегла [Рост' },
      { type: 'text-delta', id: 't1', text: 'ік](/resources/ab' },
      { type: 'text-delta', id: 't1', text: 'c123). Деталі [тут](https://your-link' },
      { type: 'text-delta', id: 't1', text: '-to-the-resource/).' },
      { type: 'text-end', id: 't1' },
      { type: 'finish-step', response: {}, usage: {}, finishReason: 'stop' },
    ]);

    const text = seen
      .filter((part) => part.type === 'text-delta')
      .map((part) => part.text)
      .join('');
    expect(text).toBe('Зберегла [Ростік](/resources/abc123). Деталі тут.');

    // What was held back still arrives before the text is closed.
    const types = seen.map((part) => part.type);
    expect(types.lastIndexOf('text-delta')).toBeLessThan(types.indexOf('text-end'));
    expect(types).toContain('tool-result');
    expect(types).toContain('finish-step');
  });

  it('grounds against the conversation it was seeded with', async () => {
    const seen = await run(
      [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', text: 'Ось [Прийом ліків](/tables/t9) ' },
        { type: 'text-delta', id: 't1', text: 'і [інша](/tables/zzz).' },
        { type: 'text-end', id: 't1' },
      ],
      GROUNDS
    );

    const text = seen
      .filter((part) => part.type === 'text-delta')
      .map((part) => part.text)
      .join('');
    expect(text).toBe('Ось [Прийом ліків](/tables/t9) і інша.');
  });
});

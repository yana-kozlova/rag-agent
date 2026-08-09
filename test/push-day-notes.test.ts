import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What reaches the briefing as "background".
 *
 * The morning of 2026-08-09 produced a briefing whose closing sentence reported
 * the user's mood and their coffee — from a check-in three days earlier, on a
 * day whose only calendar entry was somebody's birthday. Nothing in the base was
 * about that day; retrieval returned its top *k* because top *k* is what it
 * returns, and everything downstream treated the list as an answer.
 */

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);

vi.mock('@/lib/env.mjs', () => ({
  get env() {
    return envMock;
  },
}));

const findRelevantContent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai/embedding', () => ({ findRelevantContent }));

import { fetchDayNotes } from '@/lib/push/day-notes';

const USER = 'user-1';

const EVENTS = [
  {
    id: 'e1',
    calendarId: 'primary',
    title: 'День народження: Ельвіра',
    start: '2026-08-09T00:00:00+03:00',
    end: '2026-08-10T00:00:00+03:00',
    allDay: true,
  },
] as any;

/** A retrieval hit, at the shape `findRelevantContent` actually returns. */
function hit(content: string, similarity: number, extra: Record<string, unknown> = {}) {
  return {
    id: content,
    content,
    title: null,
    similarity,
    score: similarity,
    lexical: false,
    source: 'resource',
    sourceId: 'r1',
    metadata: null,
    createdAt: new Date('2026-08-06T09:15:00Z'),
    ...extra,
  };
}

beforeEach(() => {
  findRelevantContent.mockReset();
});

describe('a day nothing was written about', () => {
  it('returns nothing rather than the nearest six notes', async () => {
    findRelevantContent.mockResolvedValue([
      hit('Треба поміняти зимову гуму', 0.31),
      hit('Пароль від роутера', 0.24),
    ]);

    expect(await fetchDayNotes(USER, EVENTS)).toEqual([]);
  });

  it('keeps a note that is genuinely close to the day', async () => {
    findRelevantContent.mockResolvedValue([
      hit('Ельвіра любить півонії, не троянди', 0.78),
      hit('Пароль від роутера', 0.24),
    ]);

    const notes = await fetchDayNotes(USER, EVENTS);

    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain('півонії');
  });

  /**
   * `getInformation` admits any lexical hit, because a surname or an invoice
   * number scores low by construction and that is the whole reason the lexical
   * retriever exists. It is the wrong rule here: this query is a calendar title,
   * and "День народження" reduces to a prefix matching half a Ukrainian base on
   * a word that means nothing about today.
   */
  it('does not wave through a lexical-only match on a common word', async () => {
    findRelevantContent.mockResolvedValue([
      hit('Один день у Львові — гарна погода', 0.22, { lexical: true }),
    ]);

    expect(await fetchDayNotes(USER, EVENTS)).toEqual([]);
  });
});

describe('wellbeing check-ins', () => {
  /**
   * Dropped on genre, not on age: a check-in from this morning is no more
   * briefing material than one from Tuesday. The tracker records and does not
   * assess, and an unasked-for paragraph about how the user has been feeling is
   * assessment.
   */
  it('never reach the briefing, however well they score', async () => {
    findRelevantContent.mockResolvedValue([
      hit('[2026-08-06]\n\n09:15 · настрій 2/5\nнастрій не дуже, кава допомогла', 0.93, {
        metadata: { type: 'note', category: 'wellbeing', tags: ['wellbeing', 'check-in'] },
      }),
    ]);

    expect(await fetchDayNotes(USER, EVENTS)).toEqual([]);
  });

  it('are recognised by their tags too, for rows written before the category', async () => {
    findRelevantContent.mockResolvedValue([
      hit('болить голова', 0.9, { metadata: { type: 'note', tags: ['wellbeing'] } }),
    ]);

    expect(await fetchDayNotes(USER, EVENTS)).toEqual([]);
  });

  it('does not drop an ordinary note that merely has metadata', async () => {
    findRelevantContent.mockResolvedValue([
      hit('Ельвіра працює у стоматології', 0.8, {
        metadata: { type: 'note', tags: ['people'] },
      }),
    ]);

    expect(await fetchDayNotes(USER, EVENTS)).toHaveLength(1);
  });
});

describe('the date a note was written', () => {
  it('rides along, so the briefing can tell today from Tuesday', async () => {
    findRelevantContent.mockResolvedValue([hit('Ельвіра любить півонії', 0.8)]);

    expect((await fetchDayNotes(USER, EVENTS))[0].writtenOn).toBe('2026-08-06');
  });

  it('is null rather than a broken date when retrieval gives nothing usable', async () => {
    findRelevantContent.mockResolvedValue([
      hit('Ельвіра любить півонії', 0.8, { createdAt: 'not a date' }),
    ]);

    expect((await fetchDayNotes(USER, EVENTS))[0].writtenOn).toBeNull();
  });
});

describe('degrading', () => {
  it('costs the notes and never the briefing', async () => {
    findRelevantContent.mockRejectedValue(new Error('embedding provider down'));

    expect(await fetchDayNotes(USER, EVENTS)).toEqual([]);
  });

  it('does not search at all on an empty calendar', async () => {
    expect(await fetchDayNotes(USER, [])).toEqual([]);
    expect(findRelevantContent).not.toHaveBeenCalled();
  });
});

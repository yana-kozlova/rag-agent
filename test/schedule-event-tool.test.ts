import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Three ways one appointment went wrong: the address was dropped (no field for
 * it), "no, today" could not reach the event created two days out (the move
 * search read one day either side), and a confirmed override needed
 * `ignoreConflicts`, which nothing explained.
 */

const getSessionOrThrow = vi.hoisted(() => vi.fn());
const conflictsAndAlternatives = vi.hoisted(() => vi.fn());
const fetchEvents = vi.hoisted(() => vi.fn());
const createEvent = vi.hoisted(() => vi.fn());
const patchEvent = vi.hoisted(() => vi.fn());

/*
 * Mocked outright, not spread over the real modules: `@/lib/utils/auth` pulls
 * in next-auth and `calendar-conflicts` pulls in the database, neither of which
 * loads under vitest. `parseInputOrThrow` is reproduced rather than stubbed,
 * because the tool's zod schema is part of what is under test.
 */
vi.mock('@/lib/utils/auth', () => ({
  getSessionOrThrow,
  parseInputOrThrow: (schema: any, input: unknown) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.message);
    return parsed.data;
  },
}));

vi.mock('@/lib/services/calendar', () => ({
  GoogleCalendarService: class {
    fetchEvents = fetchEvents;
    createEvent = createEvent;
    patchEvent = patchEvent;
  },
}));

vi.mock('@/lib/utils/calendar-conflicts', () => ({
  conflictsAndAlternatives,
  formatWhen: ({ start, end }: { start: string; end: string }) => ({ label: `${start} - ${end}` }),
}));

import { scheduleEventTool } from '@/lib/ai/tools/events/schedule-event';

const TODAY_START = '2026-08-17T14:30:00+03:00';
const TODAY_END = '2026-08-17T15:00:00+03:00';

beforeEach(() => {
  vi.clearAllMocks();
  getSessionOrThrow.mockResolvedValue({ user: { id: 'user-1', accessToken: 'token' } });
  conflictsAndAlternatives.mockResolvedValue({ conflicts: [], alternatives: [], alsoDuring: [] });
  fetchEvents.mockResolvedValue({ items: [] });
  createEvent.mockResolvedValue({ id: 'created-1', htmlLink: 'https://example.test/e' });
  patchEvent.mockResolvedValue({ id: 'moved-1' });
});

describe('scheduleEvent — location', () => {
  it('sends the address the user gave to Google', async () => {
    await scheduleEventTool.execute({
      title: 'Прийом Арчі у ветеринара',
      location: 'Кавказька 207',
      start: TODAY_START,
      end: TODAY_END,
    });

    expect(createEvent).toHaveBeenCalledWith(
      'primary',
      expect.objectContaining({ location: 'Кавказька 207' })
    );
  });

  /** An absent key leaves the stored value alone; null or '' would erase it. */
  it('leaves an existing address untouched when moving without one', async () => {
    fetchEvents.mockResolvedValue({
      items: [
        {
          id: 'evt-1',
          summary: 'Прийом Арчі у ветеринара',
          status: 'confirmed',
          start: { dateTime: '2026-08-18T18:00:00+03:00' },
          end: { dateTime: '2026-08-18T18:30:00+03:00' },
        },
      ],
    });

    await scheduleEventTool.execute({
      title: 'Прийом Арчі у ветеринара',
      start: TODAY_START,
      end: TODAY_END,
    });

    expect(patchEvent).toHaveBeenCalledTimes(1);
    expect(patchEvent.mock.calls[0][2].location).toBeUndefined();
  });
});

describe('scheduleEvent — finding the event to move', () => {
  /** The duplicate case: the appointment is 27.5h away, the old window reached 24. */
  it('reaches an event more than a day away from the wanted time', async () => {
    await scheduleEventTool.execute({
      title: 'Прийом Арчі у ветеринара',
      start: TODAY_START,
      end: TODAY_END,
    });

    const [, opts] = fetchEvents.mock.calls[0];
    const spanHours =
      (new Date(opts.timeMax).getTime() - new Date(opts.timeMin).getTime()) / 3_600_000;
    expect(spanHours).toBe(144);

    const wanted = new Date('2026-08-18T18:00:00+03:00');
    expect(new Date(opts.timeMin) < wanted && wanted < new Date(opts.timeMax)).toBe(true);
  });

  it('moves that event rather than creating a second one', async () => {
    fetchEvents.mockResolvedValue({
      items: [
        {
          id: 'evt-1',
          summary: 'Прийом Арчі у ветеринара',
          status: 'confirmed',
          start: { dateTime: '2026-08-18T18:00:00+03:00' },
          end: { dateTime: '2026-08-18T18:30:00+03:00' },
        },
      ],
    });

    const res: any = await scheduleEventTool.execute({
      title: 'Прийом Арчі у ветеринара',
      start: TODAY_START,
      end: TODAY_END,
    });

    expect(res.action).toBe('moved-existing');
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('scheduleEvent — a busy time is a question', () => {
  const busy = {
    conflicts: [
      {
        calendarId: 'primary',
        eventId: 'work',
        title: 'Робочі години',
        start: '2026-08-17T08:30:00+03:00',
        end: '2026-08-17T18:00:00+03:00',
      },
    ],
    alternatives: [{ start: '2026-08-17T18:00:00+03:00', end: '2026-08-17T18:30:00+03:00' }],
    alsoDuring: [],
  };

  it('writes nothing and says how to override', async () => {
    conflictsAndAlternatives.mockResolvedValue(busy);

    const res: any = await scheduleEventTool.execute({
      title: 'Прийом Арчі у ветеринара',
      start: TODAY_START,
      end: TODAY_END,
    });

    expect(res.success).toBe(false);
    expect(createEvent).not.toHaveBeenCalled();
    expect(patchEvent).not.toHaveBeenCalled();
    expect(res.message).toContain('ignoreConflicts=true');
  });

  it('books the time the user insisted on', async () => {
    conflictsAndAlternatives.mockResolvedValue(busy);

    const res: any = await scheduleEventTool.execute({
      title: 'Прийом Арчі у ветеринара',
      start: TODAY_START,
      end: TODAY_END,
      ignoreConflicts: true,
    });

    expect(res.success).toBe(true);
    expect(createEvent).toHaveBeenCalledWith(
      'primary',
      expect.objectContaining({ start: TODAY_START, end: TODAY_END })
    );
    // The clash is still reported — overridden, not hidden.
    expect(res.warning).toBeTruthy();
    expect(res.conflicts).toHaveLength(1);
  });

  /** A field handed to the model with no explanation is a field it will ignore. */
  it('explains alsoDuring wherever it appears', async () => {
    conflictsAndAlternatives.mockResolvedValue({
      conflicts: [],
      alternatives: [],
      alsoDuring: [
        {
          calendarId: 'primary',
          eventId: 'anniv',
          title: 'Річниця Андрія та Яни',
          start: '2026-08-17',
          end: '2026-08-18',
          reason: 'all-day',
        },
      ],
    });

    const res: any = await scheduleEventTool.execute({
      title: 'Прийом Арчі у ветеринара',
      start: TODAY_START,
      end: TODAY_END,
    });

    expect(res.success).toBe(true);
    expect(res.alsoDuring).toHaveLength(1);
    expect(res.note).toMatch(/context/i);
  });
});

import { describe, expect, it } from 'vitest';

import { buildAgenda, type AgendaTaskInput } from '@/lib/utils/agenda';

const today = '2026-09-28';
const dayStart = new Date('2026-09-28T00:00:00Z');
const dayEnd = new Date('2026-09-29T00:00:00Z');
const now = new Date('2026-09-28T12:00:00Z');

const task = (over: Partial<AgendaTaskInput> & { id: string }): AgendaTaskInput => ({
  title: over.id,
  dueOn: null,
  scheduledFor: null,
  ...over,
});

const empty = { overdue: [], today: [], upcoming: [] };

describe('buildAgenda', () => {
  it('shows a timed task once, as its calendar event, with a tick', () => {
    const agenda = buildAgenda({
      events: [
        {
          id: 'primary:evt1',
          title: 'Call the school',
          start: '2026-09-28T15:00:00Z',
          end: '2026-09-28T15:30:00Z',
        },
      ],
      tasks: {
        ...empty,
        today: [task({ id: 't1', title: 'Call the school', scheduledFor: today, googleEventId: 'evt1' })],
      },
      today,
      dayStart,
      dayEnd,
      now,
    });

    expect(agenda.day).toHaveLength(1);
    expect(agenda.day[0]).toMatchObject({ key: 'event:primary:evt1', taskId: 't1' });
  });

  it('keeps an overdue task on its event instead of listing it twice', () => {
    const agenda = buildAgenda({
      events: [
        { id: 'primary:e', title: 'Form', start: '2026-09-28T09:00:00Z', end: '2026-09-28T09:30:00Z' },
      ],
      tasks: {
        ...empty,
        overdue: [task({ id: 'late', dueOn: '2026-09-25', scheduledFor: today, googleEventId: 'e' })],
      },
      today,
      dayStart,
      dayEnd,
      now,
    });

    expect(agenda.overdue).toHaveLength(0);
    expect(agenda.day[0]).toMatchObject({ taskId: 'late', overdue: true, past: true });
  });

  it('puts all-day entries first, then timed ones in order', () => {
    const agenda = buildAgenda({
      events: [
        { id: 'c:late', title: 'Late', start: '2026-09-28T18:00:00Z', end: '2026-09-28T19:00:00Z' },
        { id: 'c:bday', title: 'Birthday', start: '2026-09-28', end: '2026-09-29' },
        { id: 'c:early', title: 'Early', start: '2026-09-28T08:00:00Z', end: '2026-09-28T09:00:00Z' },
      ],
      tasks: { ...empty, today: [task({ id: 'plain', scheduledFor: today })] },
      today,
      dayStart,
      dayEnd,
      now,
    });

    expect(agenda.day.map((e) => e.title)).toEqual(['Birthday', 'plain', 'Early', 'Late']);
    expect(agenda.day.find((e) => e.title === 'Early')?.past).toBe(true);
    expect(agenda.day.find((e) => e.title === 'Late')?.past).toBe(false);
  });

  it('leaves out events on other days, including an all-day one ending today', () => {
    const agenda = buildAgenda({
      events: [
        { id: 'c:y', title: 'Yesterday', start: '2026-09-27', end: '2026-09-28' },
        { id: 'c:t', title: 'Tomorrow', start: '2026-09-29T10:00:00Z', end: '2026-09-29T11:00:00Z' },
        { id: 'c:span', title: 'Trip', start: '2026-09-27', end: '2026-09-30' },
      ],
      tasks: empty,
      today,
      dayStart,
      dayEnd,
      now,
    });

    expect(agenda.day.map((e) => e.title)).toEqual(['Trip']);
  });

  it('lists deadlines within the horizon and nothing past it', () => {
    const agenda = buildAgenda({
      events: [],
      tasks: {
        ...empty,
        upcoming: [
          task({ id: 'soon', dueOn: '2026-09-30' }),
          task({ id: 'later', dueOn: '2026-10-20' }),
        ],
      },
      today,
      dayStart,
      dayEnd,
      now,
      horizonDays: 3,
    });

    expect(agenda.soon.map((e) => e.taskId)).toEqual(['soon']);
  });
});

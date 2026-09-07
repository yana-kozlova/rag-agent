/**
 * The tasks block in the morning briefing.
 *
 * No OPENAI_API_KEY here, so `generateBriefing` takes its deterministic path —
 * which is the half that matters: the block is assembled by the application and
 * a failed generation must never cost it.
 */
import { describe, it, expect } from 'vitest';

import { generateBriefing, type BriefingEvent, type BriefingTask } from '@/lib/push/briefing';

const TZ = 'Europe/Kyiv';

const ev = (title: string, at: string): BriefingEvent => ({
  id: at,
  calendarId: 'primary',
  title,
  start: `2026-08-18T${at}:00+03:00`,
  end: `2026-08-18T${at}:00+03:00`,
  allDay: false,
});

const task = (over: Partial<BriefingTask> = {}): BriefingTask => ({
  id: 'a',
  title: 'Купити форму',
  daysLate: 0,
  due: null,
  ...over,
});

describe('the tasks block', () => {
  it('is absent entirely when nothing is outstanding', async () => {
    const briefing = await generateBriefing([ev('Standup', '09:00')], TZ, 'uk', [], []);
    expect(briefing.body).toBe('09:00 Standup');
  });

  it('sits under the schedule, separated by a blank line', async () => {
    const briefing = await generateBriefing(
      [ev('Standup', '09:00')],
      TZ,
      'uk',
      [],
      [task({ daysLate: 3 })]
    );

    expect(briefing.body).toBe('09:00 Standup\n\nТреба зробити:\n• Купити форму — на 3 дні пізніше');
  });

  it('prints the lateness the application computed, in the right plural form', async () => {
    const body = async (daysLate: number) =>
      (await generateBriefing([], TZ, 'uk', [], [task({ daysLate })])).body;

    expect(await body(1)).toContain('на 1 день пізніше');
    expect(await body(3)).toContain('на 3 дні пізніше');
    expect(await body(5)).toContain('на 5 днів пізніше');
  });

  it('says when a deadline lands today or tomorrow instead of a lateness', async () => {
    const today = await generateBriefing([], TZ, 'uk', [], [task({ due: 'today' })]);
    const tomorrow = await generateBriefing([], TZ, 'uk', [], [task({ due: 'tomorrow' })]);

    expect(today.body).toContain('сьогодні останній день');
    expect(tomorrow.body).toContain('завтра останній день');
  });

  it('leaves a task with neither lateness nor a near deadline bare', async () => {
    const briefing = await generateBriefing([], TZ, 'uk', [], [task()]);
    const line = briefing.body.split('\n').find((l) => l.startsWith('• '));

    expect(line).toBe('• Купити форму');
  });

  // The reason this block exists at all: our own table, not Google's.
  it('survives a calendar that could not be read', async () => {
    const briefing = await generateBriefing(null, TZ, 'uk', [], [task({ daysLate: 2 })]);

    expect(briefing.body).toContain('Не вдалося прочитати календар');
    expect(briefing.body).toContain('Купити форму — на 2 дні пізніше');
  });

  it('goes out on a day with nothing scheduled', async () => {
    const briefing = await generateBriefing([], TZ, 'uk', [], [task({ due: 'today' })]);

    expect(briefing.body).toContain('нічого не заплановано');
    expect(briefing.body).toContain('Треба зробити:');
  });

  it('orders itself after the saved dates', async () => {
    const briefing = await generateBriefing(
      [],
      TZ,
      'uk',
      [{ title: 'День народження', kind: 'birth', daysAway: 1, years: null }],
      [task({ daysLate: 1 })]
    );

    expect(briefing.body.indexOf('Дати:')).toBeLessThan(briefing.body.indexOf('Треба зробити:'));
  });

  it('collapses the tail past five into a count', async () => {
    const many = Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, title: `Завдання ${i}` }));
    const briefing = await generateBriefing([], TZ, 'uk', [], many);

    expect(briefing.body).toContain('Завдання 4');
    expect(briefing.body).not.toContain('Завдання 5');
    expect(briefing.body).toContain('+ще 3');
  });

  it('truncates a title too long for a list', async () => {
    const briefing = await generateBriefing(
      [],
      TZ,
      'uk',
      [],
      [task({ title: 'я'.repeat(500) })]
    );

    const line = briefing.body.split('\n').find((l) => l.startsWith('• '))!;
    expect(line.length).toBeLessThan(100);
    expect(line.endsWith('…')).toBe(true);
  });

  it('writes the block in English for an English locale', async () => {
    const briefing = await generateBriefing([], TZ, 'en', [], [task({ daysLate: 1 })]);

    expect(briefing.body).toContain('To do:');
    expect(briefing.body).toContain('1 day late');
  });

  it('labels a commitment as planned rather than as a deadline', async () => {
    const briefing = await generateBriefing([], TZ, 'uk', [], [
      task({ title: 'Подати заяву', committed: true }),
    ]);

    const line = briefing.body.split('\n').find((l) => l.startsWith('• '))!;
    expect(line).toBe('• Подати заяву — заплановано на сьогодні');
  });

  it('lets lateness win over a commitment, since only one of them is urgent', async () => {
    // Disjoint in practice — `bucketTasks` files an overdue task as overdue
    // whatever day it was committed to — but the line must not print both.
    const briefing = await generateBriefing([], TZ, 'uk', [], [
      task({ daysLate: 2, committed: true }),
    ]);

    const line = briefing.body.split('\n').find((l) => l.startsWith('• '))!;
    expect(line).toContain('на 2 дні пізніше');
    expect(line).not.toContain('заплановано');
  });

  it('writes the commitment in English for an English locale', async () => {
    const briefing = await generateBriefing([], TZ, 'en', [], [
      task({ title: 'File the form', committed: true }),
    ]);

    expect(briefing.body).toContain('• File the form — planned for today');
  });

  it('counts the undated pile instead of listing it', async () => {
    const briefing = await generateBriefing([], TZ, 'uk', [], [task()], 'unreadable', {
      someday: 7,
    });

    expect(briefing.body).toContain('+ 7 без дати');
    // A tail of the task list, under the same header — not a block of its own.
    expect(briefing.body).toContain('Треба зробити:');
    expect(briefing.body.trim().endsWith('+ 7 без дати')).toBe(true);
  });

  it('still names the undated pile on a morning with nothing due', async () => {
    // The block would otherwise be empty and vanish, which is exactly the
    // morning the number is worth reading.
    const briefing = await generateBriefing([], TZ, 'uk', [], [], 'unreadable', { someday: 3 });
    expect(briefing.body).toContain('+ 3 без дати');
  });

  it('says nothing about an empty pile', async () => {
    const briefing = await generateBriefing([], TZ, 'uk', [], [task()], 'unreadable', {
      someday: 0,
      fromNotes: 0,
    });

    expect(briefing.body).not.toContain('без дати');
    expect(briefing.body).not.toContain('нотатках');
  });

  it('gives the notes count a block of its own, below the tasks', async () => {
    const briefing = await generateBriefing([], TZ, 'uk', [], [task()], 'unreadable', {
      fromNotes: 3,
    });

    const [tasksBlock, notesBlock] = briefing.body.split('\n\n').slice(-2);
    expect(tasksBlock).toContain('Треба зробити:');
    expect(notesBlock).toBe('📝 Схоже на задачі в нотатках: 3');
  });

  it('goes out even when nothing at all is due, since notes are not the task list', async () => {
    const briefing = await generateBriefing([], TZ, 'uk', [], [], 'unreadable', { fromNotes: 2 });
    expect(briefing.body).toContain('📝 Схоже на задачі в нотатках: 2');
  });

  it('writes both counts in English for an English locale', async () => {
    const briefing = await generateBriefing([], TZ, 'en', [], [task()], 'unreadable', {
      someday: 4,
      fromNotes: 1,
    });

    expect(briefing.body).toContain('+ 4 without a date');
    expect(briefing.body).toContain('📝 Looks like tasks in your notes: 1');
  });
});

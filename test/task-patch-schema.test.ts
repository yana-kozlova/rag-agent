/**
 * What an edit is allowed to touch.
 *
 * `taskInputSchema.partial()` was being used here, which also admits
 * `scheduledFor` — so `PATCH {action:'edit', patch:{scheduledFor}}` set the day
 * of work without creating the calendar event that is supposed to *be* it, and
 * the row went on claiming a day Google had never heard of. Scheduling has one
 * door; this is the test that keeps it the only one.
 */
import { describe, it, expect } from 'vitest';

import { taskInputSchema, taskPatchSchema } from '@/lib/db/schema/tasks';

describe('taskPatchSchema', () => {
  it('accepts the editable fields', () => {
    const parsed = taskPatchSchema.parse({
      title: 'Купити форму',
      note: 'у школі',
      dueOn: '2026-08-31',
      priority: 'high',
      area: 'дім',
      recurrence: 'weekly',
      recurrenceInterval: 2,
    });

    expect(parsed.title).toBe('Купити форму');
    expect(parsed.dueOn).toBe('2026-08-31');
    expect(parsed.recurrenceInterval).toBe(2);
  });

  it('drops every scheduling field, so an edit can never write one', () => {
    const parsed = taskPatchSchema.parse({
      title: 'Довідка',
      scheduledFor: '2026-09-01',
      scheduledStart: '2026-09-01T15:00:00+03:00',
      scheduledEnd: '2026-09-01T15:30:00+03:00',
    }) as Record<string, unknown>;

    expect(parsed.scheduledFor).toBeUndefined();
    expect(parsed.scheduledStart).toBeUndefined();
    expect(parsed.scheduledEnd).toBeUndefined();
    expect(parsed.title).toBe('Довідка');
  });

  it('is genuinely narrower than the input schema it came from', () => {
    // Guards the refactor that would quietly restore `.partial()`.
    const input = taskInputSchema.parse({ title: 'x', scheduledFor: '2026-09-01' });
    expect(input.scheduledFor).toBe('2026-09-01');

    expect(Object.keys(taskPatchSchema.shape)).not.toContain('scheduledFor');
  });

  it('allows an empty patch', () => {
    expect(taskPatchSchema.parse({})).toEqual({});
  });

  it('still enforces the caps a full input does', () => {
    expect(() => taskPatchSchema.parse({ title: 'x'.repeat(201) })).toThrow();
    expect(() => taskPatchSchema.parse({ area: 'y'.repeat(61) })).toThrow();
    expect(() => taskPatchSchema.parse({ recurrenceInterval: 0 })).toThrow();
    expect(() => taskPatchSchema.parse({ dueOn: '31.08.2026' })).toThrow();
    expect(() => taskPatchSchema.parse({ priority: 'urgent' })).toThrow();
  });
});

describe('taskInputSchema offset guard', () => {
  // Same reasoning as scheduleEvent: a model handed a local time will label it
  // UTC, and an event three hours out is not visibly wrong in a reply.
  it('refuses Z and +00:00 on a scheduled time', () => {
    expect(() =>
      taskInputSchema.parse({ title: 'x', scheduledFor: '2026-09-01', scheduledStart: '2026-09-01T15:00:00Z' })
    ).toThrow();

    expect(() =>
      taskInputSchema.parse({
        title: 'x',
        scheduledFor: '2026-09-01',
        scheduledStart: '2026-09-01T15:00:00+00:00',
      })
    ).toThrow();
  });

  it('accepts a real zone offset', () => {
    const parsed = taskInputSchema.parse({
      title: 'x',
      scheduledFor: '2026-09-01',
      scheduledStart: '2026-09-01T15:00:00+03:00',
    });

    expect(parsed.scheduledStart).toBe('2026-09-01T15:00:00+03:00');
  });
});

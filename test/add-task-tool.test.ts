/**
 * What `addTask` actually hands the action layer.
 *
 * The bug this pins: `startTime` was declared in the tool's schema, described to
 * the model, typed in `execute` — and never passed on. "Заплануй довідку на
 * завтра о 15:00" silently became an all-day entry, and nothing anywhere said
 * so. Unit tests over the pure module could not see it; only the seam between
 * the tool and the action can.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createTask = vi.hoisted(() => vi.fn());
const getSessionOrNull = vi.hoisted(() => vi.fn());

vi.mock('@/lib/actions/tasks', () => ({ createTask }));
vi.mock('@/lib/utils/auth', () => ({ getSessionOrNull }));

import { addTaskTool } from '@/lib/ai/tools/tasks/add-task';

/** The single call's argument object. */
const sent = () => createTask.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  getSessionOrNull.mockResolvedValue({ user: { id: 'user-1' } });
  createTask.mockResolvedValue({
    success: true,
    duplicate: false,
    task: {
      id: 'task-1',
      title: 'Довідка',
      dueOn: null,
      scheduledFor: '2026-08-19',
      recurrence: 'none',
    },
    message: 'ok',
  });
});

describe('addTask passes the hour through', () => {
  it('forwards startTime beside the day', async () => {
    await addTaskTool.execute({
      title: 'Довідка',
      scheduledFor: '2026-08-19',
      startTime: '15:00',
    });

    expect(sent().startTime).toBe('15:00');
    expect(sent().input.scheduledFor).toBe('2026-08-19');
  });

  it('leaves startTime undefined when no hour was named', async () => {
    await addTaskTool.execute({ title: 'Довідка', scheduledFor: '2026-08-19' });
    expect(sent().startTime).toBeUndefined();
  });

  it('does not turn a bare deadline into a scheduled day', async () => {
    await addTaskTool.execute({ title: 'Купити форму', dueOn: '2026-08-31' });

    expect(sent().input.dueOn).toBe('2026-08-31');
    expect(sent().input.scheduledFor).toBeUndefined();
    expect(sent().startTime).toBeUndefined();
  });

  it('carries the rest of the fields', async () => {
    await addTaskTool.execute({
      title: 'Вітаміни',
      dueOn: '2026-08-20',
      priority: 'high',
      area: 'дім',
      recurrence: 'daily',
      recurrenceInterval: 2,
      note: 'після сніданку',
    });

    expect(sent().input).toMatchObject({
      title: 'Вітаміни',
      dueOn: '2026-08-20',
      priority: 'high',
      area: 'дім',
      recurrence: 'daily',
      recurrenceInterval: 2,
      note: 'після сніданку',
    });
  });

  it('reports a duplicate rather than claiming a fresh save', async () => {
    createTask.mockResolvedValueOnce({
      success: true,
      duplicate: true,
      task: { id: 'task-1', title: 'Купити форму', dueOn: null, scheduledFor: null, recurrence: 'none' },
      message: 'dupe',
    });

    const result = await addTaskTool.execute({ title: 'Купити форму' });

    expect(result.duplicate).toBe(true);
    expect(result.message).toMatch(/already/i);
  });

  it('surfaces a calendar failure instead of reporting a clean save', async () => {
    createTask.mockResolvedValueOnce({
      success: true,
      duplicate: false,
      task: { id: 'task-1', title: 'Довідка', dueOn: null, scheduledFor: '2026-08-19', recurrence: 'none' },
      calendarError: 'boom',
      message: 'partial',
    });

    const result = await addTaskTool.execute({ title: 'Довідка', scheduledFor: '2026-08-19' });

    expect(result.calendarError).toBe('boom');
    expect(result.message).toMatch(/calendar/i);
  });

  it('refuses without a session', async () => {
    getSessionOrNull.mockResolvedValueOnce(null);
    await expect(addTaskTool.execute({ title: 'x' })).rejects.toThrow('Unauthorized');
  });
});

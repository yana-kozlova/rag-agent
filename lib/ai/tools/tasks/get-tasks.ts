import { z } from 'zod';

import { getTasksView } from '@/lib/actions/tasks';
import { daysLate } from '@/lib/tasks/tasks';
import { getSessionOrNull } from '@/lib/utils/auth';
import type { Task } from '@/lib/db/schema/tasks';

/**
 * What is outstanding.
 *
 * Answers in buckets rather than as one list because the buckets are the answer:
 * "що в мене горить" is the overdue one, "що сьогодні" is the committed one, and
 * "що взагалі треба зробити" is all four. A flat list ordered by date makes the
 * model re-derive that split every time, and it gets it wrong in the direction
 * that matters — reporting a deadline three weeks out beside one that passed.
 */
export const getTasksTool = {
  description: [
    'List outstanding tasks. Use for "що мені треба зробити", "що горить", "які дедлайни", "що я не зробила".',
    'Returns four groups: overdue (deadline passed), today (committed to today), upcoming (still ahead), someday (no date).',
    'Read the groups off as given — never recompute whether something is late.',
  ].join('\n'),
  inputSchema: z.object({
    group: z
      .enum(['all', 'overdue', 'today', 'upcoming', 'someday'])
      .optional()
      .describe('Narrow to one group. Defaults to all.'),
  }),
  execute: async (input: { group?: 'all' | 'overdue' | 'today' | 'upcoming' | 'someday' }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const view = await getTasksView(session.user.id);
    const group = input.group ?? 'all';

    // The application computes lateness, never the model — the same rule that
    // put `Day:` into the calendar lines and `daysAway` into the briefing.
    const line = (task: Task) => ({
      id: task.id,
      title: task.title,
      dueOn: task.dueOn,
      scheduledFor: task.scheduledFor,
      daysLate: daysLate(task.dueOn, view.today) || undefined,
      priority: task.priority ?? undefined,
      area: task.area ?? undefined,
      recurrence: task.recurrence === 'none' ? undefined : task.recurrence,
    });

    const groups = {
      overdue: view.buckets.overdue.map(line),
      today: view.buckets.today.map(line),
      upcoming: view.buckets.upcoming.map(line),
      someday: view.buckets.someday.map(line),
    };

    return {
      success: true,
      today: view.today,
      url: '/tasks',
      counts: view.counts,
      ...(group === 'all' ? { groups } : { [group]: groups[group] }),
      message:
        view.counts.open === 0
          ? 'Nothing outstanding. Say so plainly.'
          : 'Report these as they are grouped. "daysLate" is already computed — never work it out from the dates.',
    };
  },
} as const;

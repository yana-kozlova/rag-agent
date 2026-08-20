import { z } from 'zod';

import { createTask } from '@/lib/actions/tasks';
import { getSessionOrNull } from '@/lib/utils/auth';
import { MAX_TASK_AREA, MAX_TASK_NOTE, MAX_TASK_TITLE, TASK_PRIORITIES, TASK_RECURRENCES } from '@/lib/tasks/tasks';

/**
 * Something the user has to do.
 *
 * The line against the other two date-carrying tools is written in the system
 * prompt, but the one it has to hold on its own is against `rememberDate`: a
 * deadline is a task and never a date on the axis. Extraction has refused
 * deadlines from the timeline since it was built, on the grounds that `needs`
 * was collecting them for a layer that did not exist yet. This is that layer,
 * and the refusal now has somewhere to point.
 *
 * `scheduledFor` is deliberately separate from `dueOn` and deliberately harder
 * to reach: committing to a day writes a Google Calendar event, so the model
 * must not fill it in because a date was mentioned. The user says when it is
 * due; the user separately says when they will do it.
 */
export const addTaskTool = {
  description: [
    'Save something the user has to do: an errand, a form to submit, a call to make, a thing to buy.',
    'Use for anything with a deadline ("до 31.08", "треба подати заяву до понеділка") — a deadline is a task, never a timeline date.',
    'dueOn is the LAST acceptable day. Do not set scheduledFor unless the user said which day they will actually do it — that writes a calendar event.',
    'Recurring chores go here too, with recurrence set; the task rolls forward on its own when completed.',
    'Not for meetings, appointments or visits at a fixed time — those are scheduleEvent.',
  ].join('\n'),
  inputSchema: z.object({
    title: z
      .string()
      .max(MAX_TASK_TITLE)
      .describe("What has to be done, in the user's own language — \"купити форму\", \"подати заяву в садок\""),
    dueOn: z
      .string()
      .optional()
      .describe('YYYY-MM-DD — the last acceptable day. Omit when no deadline was stated; most tasks have none.'),
    scheduledFor: z
      .string()
      .optional()
      .describe(
        'YYYY-MM-DD — the day the user said they will DO it. Only when they actually chose a day. This creates a calendar event.'
      ),
    startTime: z
      .string()
      .optional()
      .describe('HH:mm, only when they named an hour as well as a day. Requires scheduledFor.'),
    priority: z.enum(TASK_PRIORITIES).optional().describe('Only when the user signalled urgency'),
    area: z
      .string()
      .max(MAX_TASK_AREA)
      .optional()
      .describe('A grouping label if one is obvious — "дім", "робота", "Артем"'),
    recurrence: z
      .enum(TASK_RECURRENCES)
      .optional()
      .describe('How often it repeats. Omit for a one-off, which is most tasks.'),
    recurrenceInterval: z
      .number()
      .int()
      .optional()
      .describe('Every N units — 2 with "weekly" means every fortnight. Defaults to 1.'),
    note: z.string().max(MAX_TASK_NOTE).optional().describe('Detail that makes it actionable — an address, a document number'),
  }),
  execute: async (input: {
    title: string;
    dueOn?: string;
    scheduledFor?: string;
    startTime?: string;
    priority?: 'high' | 'medium' | 'low';
    area?: string;
    recurrence?: 'none' | 'daily' | 'weekly' | 'monthly' | 'annual';
    recurrenceInterval?: number;
    note?: string;
  }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const result = await createTask({
      userId: session.user.id,
      input: {
        title: input.title,
        dueOn: input.dueOn,
        scheduledFor: input.scheduledFor,
        priority: input.priority,
        area: input.area,
        recurrence: input.recurrence,
        recurrenceInterval: input.recurrenceInterval,
        note: input.note,
      },
      // Handed over as a wall time rather than folded into `scheduledStart`
      // here: turning "15:00" into an instant needs the user's zone, and
      // `scheduleTask` is what has it. An hour with no day is dropped there,
      // since an hour on no day is not a plan.
      startTime: input.startTime,
      source: 'user',
    });

    if (!result.success || !result.task) {
      return { success: false, message: result.message };
    }

    return {
      success: true,
      duplicate: result.duplicate ?? false,
      id: result.task.id,
      url: '/tasks',
      saved: {
        title: result.task.title,
        dueOn: result.task.dueOn,
        scheduledFor: result.task.scheduledFor,
        recurrence: result.task.recurrence,
      },
      calendarError: result.calendarError,
      message: result.duplicate
        ? 'That task is already on the list. Confirm it back rather than saving again.'
        : result.calendarError
          ? 'Task saved, but adding it to the calendar failed. Say so.'
          : 'Task saved. Confirm it back briefly.',
    };
  },
} as const;

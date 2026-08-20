import { z } from 'zod';

import { resolveTask, scheduleTask, unscheduleTask } from '@/lib/actions/tasks';
import { getSessionOrNull } from '@/lib/utils/auth';

/**
 * Committing a task to a day — the one action here that writes to Google.
 *
 * Separate from `addTask` because it is a different decision made at a different
 * time. A deadline arrives with the task ("довідку до 17.08"); the day of work
 * is chosen later, often after looking at what else that week holds. Folding
 * them into one call is what would make the model schedule everything it saved,
 * filling the calendar with days the user never agreed to spend.
 *
 * Without an hour this writes an all-day event marked Free: a whole-day
 * intention holds no time, so it must not veto a meeting and must not be listed
 * among the day's commitments. With an hour it is an ordinary event, because
 * then it really does take the time.
 */
export const scheduleTaskTool = {
  description: [
    'Commit an existing task to a day, which puts it on the calendar: "зроблю це завтра", "постав довідку на четвер".',
    'Without a time it becomes an all-day entry marked Free. With a time it becomes a normal event.',
    'Pass clear=true to take it off its day again and remove the event.',
    'The day of work is not the deadline — a task due Friday can be scheduled for Tuesday.',
  ].join('\n'),
  inputSchema: z.object({
    title: z.string().describe("The task, as the user named it"),
    taskId: z.string().optional().describe('The id, when a previous getTasks result supplied one'),
    day: z
      .string()
      .optional()
      .describe('YYYY-MM-DD — the day they will do it. Required unless clear=true.'),
    startTime: z.string().optional().describe('HH:mm in the user\'s own zone, only if they named an hour'),
    endTime: z.string().optional().describe('HH:mm, only if they said how long'),
    clear: z.boolean().optional().describe('True to unschedule: drops the day and deletes the event'),
  }),
  execute: async (input: {
    title: string;
    taskId?: string;
    day?: string;
    startTime?: string;
    endTime?: string;
    clear?: boolean;
  }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const found = await resolveTask({
      userId: session.user.id,
      taskId: input.taskId,
      title: input.title,
    });

    if (found.status === 'none') {
      return { success: false, message: 'No open task matches that. Say you could not find it.' };
    }

    if (found.status === 'ambiguous') {
      return {
        success: false,
        ambiguous: found.tasks.map((t) => ({ id: t.id, title: t.title, dueOn: t.dueOn })),
        message: 'Several tasks match. Ask which one — never pick.',
      };
    }

    if (input.clear) {
      const cleared = await unscheduleTask({ userId: session.user.id, taskId: found.task.id });
      return {
        success: cleared.success,
        url: '/tasks',
        calendarError: cleared.calendarError,
        message: cleared.message,
      };
    }

    if (!input.day) {
      return { success: false, message: 'No day given. Ask which day they want to do it.' };
    }

    const result = await scheduleTask({
      userId: session.user.id,
      taskId: found.task.id,
      day: input.day,
      startTime: input.startTime,
      endTime: input.endTime,
    });

    if (!result.success || !result.task) return { success: false, message: result.message };

    return {
      success: true,
      url: '/tasks',
      scheduled: {
        title: result.task.title,
        day: result.task.scheduledFor,
        at: result.task.scheduledStart ? result.task.scheduledStart.slice(11, 16) : undefined,
        dueOn: result.task.dueOn,
      },
      calendarError: result.calendarError,
      message: result.calendarError
        ? 'The task is scheduled, but the calendar event failed. Say so.'
        : 'Scheduled and on the calendar. Confirm the day back.',
    };
  },
} as const;

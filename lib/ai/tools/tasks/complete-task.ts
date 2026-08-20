import { z } from 'zod';

import { completeTask, resolveTask } from '@/lib/actions/tasks';
import { getSessionOrNull } from '@/lib/utils/auth';

/**
 * Marking something done — the highest-frequency thing anyone does to a task,
 * and the reason this is a tool while deleting is an API route.
 *
 * Closing is reversible: the row stays, `reopenTask` puts it back, and the
 * completion log keeps its record either way. Deleting is not, which is why the
 * model may do the first and not the second — the wellbeing and timeline
 * precedent, where the same line is drawn for the same reason.
 *
 * An ambiguous name is reported back rather than resolved. Closing the wrong
 * task removes something that still needs doing from the only list tracking it,
 * and the user finds out when the deadline has passed.
 */
export const completeTaskTool = {
  description: [
    'Mark a task done: "зробила", "купила форму", "довідку взяла".',
    'A recurring task rolls to its next occurrence instead of closing — report the new date back.',
    'Identify it by title in the user\'s own words; if the result says ambiguous, ask which one rather than picking.',
  ].join('\n'),
  inputSchema: z.object({
    title: z
      .string()
      .describe("The task, as the user named it — \"купити форму\". Enough of the title to identify it."),
    taskId: z.string().optional().describe('The id, when a previous getTasks result supplied one'),
  }),
  execute: async (input: { title: string; taskId?: string }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const found = await resolveTask({
      userId: session.user.id,
      taskId: input.taskId,
      title: input.title,
    });

    if (found.status === 'none') {
      return {
        success: false,
        message: 'No open task matches that. Do not invent one — say you could not find it.',
      };
    }

    if (found.status === 'ambiguous') {
      return {
        success: false,
        ambiguous: found.tasks.map((t) => ({ id: t.id, title: t.title, dueOn: t.dueOn })),
        message: 'Several tasks match. Ask the user which one — never pick.',
      };
    }

    const result = await completeTask({ userId: session.user.id, taskId: found.task.id });
    if (!result.success || !result.task) return { success: false, message: result.message };

    const rolled = result.task.status === 'open';

    return {
      success: true,
      url: '/tasks',
      closed: { title: result.task.title },
      // A recurring task did not close, it moved. Saying "done" without this
      // reads as if it is off the list for good.
      nextDueOn: rolled ? result.task.dueOn : undefined,
      alreadyDone: result.duplicate ?? false,
      message: result.duplicate
        ? 'That was already marked done. Say so rather than confirming a second time.'
        : rolled
          ? 'Done, and it has rolled forward. Tell the user when the next one is due.'
          : 'Done. Confirm briefly.',
    };
  },
} as const;

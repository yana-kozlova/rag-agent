import { completeTask, updateTask } from '@/lib/actions/tasks';
import { timezoneFor } from '@/lib/actions/user-timezone';
import { copyFor } from '@/lib/push/copy';
import { addLocalDays } from '@/lib/push/timezone';
import type { BriefingTask } from '@/lib/push/briefing';
import { answerCallbackQuery, clearReplyMarkup, sendMessage } from './api';
import { encodeTaskCallback } from './callback-data';

/**
 * Overdue tasks, asked about one message at a time.
 *
 * The obvious design — buttons under the briefing itself — does not survive
 * contact with the code. `clearReplyMarkup` wipes a keyboard entirely and does
 * so deliberately, so that "Save" on a week-old briefing cannot quietly file a
 * second copy; pressing one task's button would retire every other task's too.
 * `snooze` compounds it by rebuilding the notification from its text with a
 * hardcoded action list, so the task lines would come back with no buttons under
 * them.
 *
 * One message per task sidesteps all of it. Each carries its own keyboard, a
 * press clears only its own, and none of the notification machinery has to
 * change. The cost is up to `MAX_ASKED` short messages on a bad morning, which
 * in a chat reads as a conversation rather than as clutter.
 */

/**
 * How many overdue tasks get asked about. Past three this stops being a prompt
 * and becomes a queue, and a morning that opens with six questions is a morning
 * the notifications get muted.
 */
const MAX_ASKED = 3;

/** Send one message per overdue task, each with its own two buttons. */
export async function askAboutOverdue(
  chatId: string,
  tasks: BriefingTask[],
  locale?: string | null
): Promise<number> {
  const overdue = tasks.filter((task) => task.daysLate > 0).slice(0, MAX_ASKED);
  if (overdue.length === 0) return 0;

  const copy = copyFor(locale);
  let sent = 0;

  for (const task of overdue) {
    const delivered = await sendMessage(
      chatId,
      `${task.title} — ${copy.tasks.late(task.daysLate)}`,
      {
        // Unlike a quick action's label, the title here is only ever displayed —
        // the task id rides in `callback_data` — so `stripMarkdown` mangling an
        // asterisk costs appearance and never a failed match.
        replyMarkup: {
          inline_keyboard: [
            [
              { text: copy.tasks.done, callback_data: encodeTaskCallback('done', task.id) },
              { text: copy.tasks.tomorrow, callback_data: encodeTaskCallback('tomorrow', task.id) },
            ],
          ],
        },
      }
    );

    if (delivered) sent += 1;
  }

  return sent;
}

/**
 * A pressed task button.
 *
 * "Tomorrow" moves the *deadline*, not the day of work, and deliberately: the
 * deadline is what makes the task overdue, and leaving it in the past while
 * scheduling a day of work would keep the task shouting every morning with a
 * plan already attached to it. It is the user's own date either way — nothing
 * moves it without a press.
 */
export async function handleTaskPress(
  queryId: string,
  chatId: string,
  messageId: number,
  userId: string,
  action: 'done' | 'tomorrow',
  taskId: string,
  locale?: string | null
): Promise<void> {
  const copy = copyFor(locale);

  if (action === 'done') {
    const result = await completeTask({ userId, taskId });

    if (!result.success) {
      await answerCallbackQuery(queryId, copy.tasks.alreadyHandled);
      return;
    }

    await clearReplyMarkup(chatId, messageId);
    await answerCallbackQuery(
      queryId,
      result.duplicate ? copy.tasks.alreadyHandled : copy.tasks.markedDone
    );
    return;
  }

  const timezone = await timezoneFor(userId);
  const tomorrow = addLocalDays(new Date(), timezone, 1);

  const result = await updateTask({ userId, taskId, patch: { dueOn: tomorrow } });

  if (!result.success) {
    await answerCallbackQuery(queryId, copy.tasks.alreadyHandled);
    return;
  }

  await clearReplyMarkup(chatId, messageId);
  await answerCallbackQuery(queryId, copy.tasks.movedToTomorrow);
}

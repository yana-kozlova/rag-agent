import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/auth';
import { sendMessage } from '@/lib/telegram/api';
import { encodeCallbackData } from '@/lib/telegram/callback-data';
import {
  DEFAULT_SNOOZE_MINUTES,
  type NotificationAction,
  type NotificationPayload,
} from './utils';

/**
 * The single door every proactive notification leaves through.
 *
 * Web Push used to be that door, and it never really opened: a subscription is
 * bound to one browser profile, expires without telling anyone, and on iOS only
 * exists for an installed PWA — so the briefing was reliably generated and
 * unreliably seen. Telegram is where the assistant already talks, the chat id is
 * already on the user record, and delivery either succeeds or reports why.
 *
 * Everything that used to call `sendToSubscriptions` calls this instead, so
 * there is exactly one place that knows how a notification becomes a message.
 */

/**
 * Ukrainian, like every other word the bot says of its own accord.
 *
 * The notification *body* is still English — `generateBriefing` and the insight
 * scanner are prompted that way, a leftover from writing for a browser
 * notification. That is worth fixing, but in the prompts: a button is the bot
 * speaking, and it should sound like the bot.
 */
const BUTTON_LABELS: Record<NotificationAction, string> = {
  snooze: 'Пізніше',
  save: 'Зберегти',
  dismiss: 'Прибрати',
};

/**
 * Title and body as one message.
 *
 * A blank line between them is not decoration: it is the seam
 * `splitNotification` cuts on when a snoozed notification has to be rebuilt
 * from the text Telegram hands back.
 */
export function renderNotification(payload: NotificationPayload): string {
  const title = payload.title.trim();
  const body = payload.body?.trim();
  return body ? `${title}\n\n${body}` : title;
}

/**
 * The inverse, for the snooze handler.
 *
 * A button press carries the message text but not the payload that produced it,
 * so re-queueing "the same notification, later" means reading it back off the
 * message. A message with no blank line is all title — that is what
 * `renderNotification` produces for a body-less payload.
 */
export function splitNotification(text: string): { title: string; body: string } {
  const seam = text.indexOf('\n\n');
  if (seam === -1) return { title: text.trim(), body: '' };

  return {
    title: text.slice(0, seam).trim(),
    body: text.slice(seam + 2).trim(),
  };
}

/** The inline keyboard for a payload's actions, or nothing when it has none. */
export function buildKeyboard(payload: NotificationPayload) {
  const actions = payload.actions ?? [];
  if (actions.length === 0) return undefined;

  return {
    // One row: three buttons at most, and Telegram lays a single row out fine.
    inline_keyboard: [
      actions.map((action) => ({
        text: BUTTON_LABELS[action],
        callback_data: encodeCallbackData(
          action,
          payload.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES
        ),
      })),
    ],
  };
}

/**
 * How a delivery ended.
 *
 * The distinction between the two failures is the whole point of the type: an
 * account with no chat linked will still have no chat linked on the next sweep,
 * while a Telegram request that did not go through is worth trying again. A
 * single boolean collapsed them, and the queue retired both — so one bad moment
 * on the network silently threw away a reminder the user had asked for.
 */
export type DeliveryResult = 'sent' | 'unreachable' | 'failed';

/**
 * Deliver one notification to the user's linked chat.
 *
 * Never throws: callers are cron paths that have already spent an LLM call by
 * the time they get here, and an exception at this point would lose the work
 * rather than report it.
 */
export async function deliverToUser(
  userId: string,
  payload: NotificationPayload,
  context = 'push/deliver'
): Promise<DeliveryResult> {
  const [row] = await db
    .select({ chatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row?.chatId) {
    console.warn(`[${context}] No Telegram chat linked for ${userId} — nothing to deliver to.`);
    return 'unreachable';
  }

  const sent = await sendMessage(row.chatId, renderNotification(payload), {
    replyMarkup: buildKeyboard(payload),
  });

  return sent ? 'sent' : 'failed';
}

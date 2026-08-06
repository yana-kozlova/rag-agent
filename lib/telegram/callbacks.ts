import { createResource } from '@/lib/actions/resources';
import { splitNotification } from '@/lib/push/deliver';
import { enqueueNotification } from '@/lib/push/queue';
import { answerCallbackQuery, clearReplyMarkup } from './api';
import { parseCallbackData } from './callback-data';
import { findUserByChatId } from './link';

/**
 * The buttons under a notification, pressed.
 *
 * Web Push put these in a service worker, which could act with no page open but
 * only because a same-origin `fetch` still carried the session cookie. Telegram
 * has no cookie to carry: the press proves which chat it came from and nothing
 * else, so the user is resolved from the chat id exactly as an ordinary message
 * is — `findUserByChatId`, or nothing happens.
 */

/** Only the fields this handler reads; Telegram sends more. */
export type TelegramCallbackQuery = {
  id?: string;
  data?: string;
  message?: {
    message_id?: number;
    chat?: { id?: number | string };
    /** Absent when the message is too old for Telegram to still hand back. */
    text?: string;
  };
};

/** Prefixes a snoozed notification so its return isn't mistaken for a new one. */
const SNOOZE_MARKER = '⏰';

export async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  const queryId = query?.id;
  // Without an id there is no way to release the button's loading state, and
  // nothing here is worth doing silently.
  if (!queryId) return;

  const rawChatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;

  if (rawChatId === undefined || rawChatId === null || messageId === undefined) {
    await answerCallbackQuery(queryId, 'Це повідомлення вже недоступне.');
    return;
  }

  const chatId = String(rawChatId);

  const parsed = parseCallbackData(query.data);
  if (!parsed) {
    await answerCallbackQuery(queryId, 'Ця кнопка більше не працює.');
    return;
  }

  const user = await findUserByChatId(chatId);
  if (!user) {
    await answerCallbackQuery(queryId, 'Цей чат не прив’язаний до акаунта.');
    return;
  }

  if (parsed.action === 'dismiss') {
    await clearReplyMarkup(chatId, messageId);
    await answerCallbackQuery(queryId, 'Прибрала.');
    return;
  }

  // Both remaining actions work on the notification's own text. It is only
  // missing for a message Telegram considers too old to return, which is also
  // long past the point where acting on it helps.
  const text = query.message?.text?.trim();
  if (!text) {
    await answerCallbackQuery(queryId, 'Не бачу тексту цього сповіщення.');
    return;
  }

  if (parsed.action === 'snooze') {
    await snooze(user.id, text, parsed.minutes, queryId, chatId, messageId);
    return;
  }

  await save(user.id, text, queryId, chatId, messageId);
}

/**
 * Queue the same notification again, later.
 *
 * It is rebuilt from the message rather than from the row that produced it: the
 * original payload is long gone by the time a button is pressed, and the text
 * on screen is by definition what the user is postponing.
 */
async function snooze(
  userId: string,
  text: string,
  minutes: number,
  queryId: string,
  chatId: string,
  messageId: number
): Promise<void> {
  const original = splitNotification(text);
  const title = original.title.startsWith(SNOOZE_MARKER)
    ? original.title
    : `${SNOOZE_MARKER} ${original.title}`;

  const id = await enqueueNotification({
    userId,
    notifyAt: new Date(Date.now() + minutes * 60_000),
    kind: 'snoozed',
    payload: {
      title,
      body: original.body,
      // Offered again, so a second postponement doesn't need the web app.
      actions: ['snooze', 'dismiss'],
      snoozeMinutes: minutes,
    },
  });

  if (!id) {
    await answerCallbackQuery(queryId, 'Не змогла відкласти 😔');
    return;
  }

  await clearReplyMarkup(chatId, messageId);
  await answerCallbackQuery(queryId, `Нагадаю ${formatDelay(minutes)}.`);
}

/** Keep the notification's text in the knowledge base. */
async function save(
  userId: string,
  text: string,
  queryId: string,
  chatId: string,
  messageId: number
): Promise<void> {
  const original = splitNotification(text);

  const result = await createResource({
    content: text,
    title: original.title || undefined,
    userId,
  } as any);

  if (!result?.success) {
    await answerCallbackQuery(queryId, 'Не змогла зберегти 😔');
    return;
  }

  await clearReplyMarkup(chatId, messageId);
  await answerCallbackQuery(queryId, 'Зберегла в базу знань.');
}

function formatDelay(minutes: number): string {
  if (minutes < 60) return `за ${minutes} хв`;

  const hours = Math.round(minutes / 60);
  return `за ${hours} год`;
}

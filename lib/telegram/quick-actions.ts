import {
  findQuickActionByLabel,
  listQuickActions,
  runQuickAction,
  undoQuickActionRun,
  type QuickActionWithColumns,
} from '@/lib/actions/quick-actions';
import { runWithUser } from '@/lib/auth/context';
import { askFields, promptFor } from '@/lib/quick-actions/quick-actions';
import { answerCallbackQuery, clearReplyMarkup, sendMessage } from './api';
import { encodeQuickActionCallback, encodeQuickUndoCallback } from './callback-data';
import { buildPromptText, labelFromPrompt, splitAnswers } from './quick-action-prompt';

/**
 * Quick actions in the bot.
 *
 * This is where the feature earns most of its keep: the routines it records —
 * a dog's medicine, a child's temperature — happen with a phone in hand and
 * nowhere near a browser. `/q` prints the buttons; a press writes a row and
 * calls no model.
 *
 * The awkward part is the ones that ask for a value, because a callback press
 * carries no conversation and there is nowhere to keep "waiting for a number"
 * without inventing session state for one feature. So the prompt is sent as a
 * `force_reply` and the reply is matched back by the label quoted in it — the
 * label is unique per user (a database constraint, not a hope), which is what
 * makes that lookup exact rather than a guess. If the button is renamed or
 * deleted between prompt and reply the match fails and says so, which is the
 * right failure: nothing is written under a name that no longer means
 * anything.
 */

/** Two per row: any narrower and Ukrainian labels truncate to nothing. */
const BUTTONS_PER_ROW = 2;

export function isQuickActionCommand(text: string): boolean {
  return /^\/(q|quick)(@\S+)?(\s|$)/.test(text);
}

/** The list, as a pressable keyboard. */
export async function sendQuickActionList(chatId: string, userId: string): Promise<void> {
  const actions = await runWithUser({ id: userId, surface: 'telegram' }, listQuickActions);

  if (actions.length === 0) {
    await sendMessage(
      chatId,
      'Швидких записів ще немає. Опиши рутину — «Арчі щодня приймає ліки, зроби кнопку» — і я збережу її як кнопку.'
    );
    return;
  }

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < actions.length; i += BUTTONS_PER_ROW) {
    rows.push(
      actions.slice(i, i + BUTTONS_PER_ROW).map((action) => ({
        text: buttonFace(action),
        callback_data: encodeQuickActionCallback(action.id),
      }))
    );
  }

  await sendMessage(chatId, 'Швидкі записи:', {
    replyMarkup: { inline_keyboard: rows },
  });
}

/**
 * A press.
 *
 * The keyboard is deliberately left in place afterwards, unlike a
 * notification's: this message is a control panel, not a one-time decision,
 * and tomorrow's press should not need a new `/q`.
 */
export async function handleQuickActionPress(
  queryId: string,
  chatId: string,
  userId: string,
  actionId: string
): Promise<void> {
  const actions = await runWithUser({ id: userId, surface: 'telegram' }, listQuickActions);
  const action = actions.find((a) => a.id === actionId);

  if (!action) {
    await answerCallbackQuery(queryId, 'Цієї кнопки вже немає.');
    return;
  }

  const asks = askFields(action.fields);
  if (asks.length > 0) {
    await answerCallbackQuery(queryId, 'Потрібне значення 👇');
    await promptForAnswers(chatId, action);
    return;
  }

  const result = await runWithUser({ id: userId, surface: 'telegram' }, () =>
    runQuickAction(action.id, {})
  );

  if (!result.ok) {
    await answerCallbackQuery(queryId, truncateToast(result.error));
    return;
  }

  await answerCallbackQuery(queryId, truncateToast(`Записала: ${result.summary}`));
  await sendConfirmation(chatId, result.label, result.summary, action.id, result.rowId);
}

/** Undo, from the button under a confirmation. */
export async function handleQuickUndo(
  queryId: string,
  chatId: string,
  messageId: number,
  userId: string,
  actionId: string,
  rowId: string
): Promise<void> {
  const result = await runWithUser({ id: userId, surface: 'telegram' }, () =>
    undoQuickActionRun(actionId, rowId)
  );

  if (!result.ok) {
    await answerCallbackQuery(queryId, truncateToast(result.error));
    return;
  }

  // Here the keyboard *does* go: the row is gone, and a live "Скасувати" over
  // nothing would report a failure on every later press.
  await clearReplyMarkup(chatId, messageId);
  await answerCallbackQuery(queryId, 'Скасувала.');
  await sendMessage(chatId, '↩️ Запис скасовано.');
}

/**
 * The reply to a prompt, if that is what this message is.
 *
 * Returns true when it handled the message, so `processUpdate` can end the
 * turn without sending the text to the agent — which would otherwise read
 * "37.2" as a question and answer it.
 */
export async function handleQuickActionReply(
  chatId: string,
  userId: string,
  quotedText: string | undefined,
  answerText: string
): Promise<boolean> {
  const label = labelFromPrompt(quotedText);
  if (!label) return false;

  const action = await runWithUser({ id: userId, surface: 'telegram' }, () =>
    findQuickActionByLabel(label)
  );

  if (!action) {
    await sendMessage(chatId, `Не знаходжу кнопку «${label}» — можливо, її вже прибрали.`);
    return true;
  }

  const asks = askFields(action.fields);
  const answers = splitAnswers(answerText, asks.length);

  const result = await runWithUser({ id: userId, surface: 'telegram' }, () =>
    runQuickAction(
      action.id,
      Object.fromEntries(asks.map((field, i) => [field.columnId, answers[i] ?? '']))
    )
  );

  if (!result.ok) {
    await sendMessage(
      chatId,
      result.missing?.length
        ? `Не вистачає: ${result.missing.join(', ')}. Надішли ще раз через кому.`
        : `Не вдалось записати: ${result.error}`
    );
    return true;
  }

  await sendConfirmation(chatId, result.label, result.summary, action.id, result.rowId);
  return true;
}

async function promptForAnswers(chatId: string, action: QuickActionWithColumns): Promise<void> {
  const asks = askFields(action.fields);
  const labels = asks.map((field) => promptFor(field, action.columns));

  await sendMessage(chatId, buildPromptText(action.label, labels), {
    replyMarkup: {
      force_reply: true,
      input_field_placeholder: labels.join(', ').slice(0, 64),
    },
  });
}

async function sendConfirmation(
  chatId: string,
  label: string,
  summary: string,
  actionId: string,
  rowId: string
): Promise<void> {
  await sendMessage(chatId, `✅ ${label}${summary ? `\n${summary}` : ''}`, {
    replyMarkup: {
      inline_keyboard: [
        [{ text: '↩️ Скасувати', callback_data: encodeQuickUndoCallback(actionId, rowId) }],
      ],
    },
  });
}

function buttonFace(action: QuickActionWithColumns): string {
  const asks = askFields(action.fields).length > 0 ? ' …' : '';
  return `${action.icon ? `${action.icon} ` : ''}${action.label}${asks}`;
}

/** Telegram truncates a callback toast past ~200 characters; do it deliberately. */
function truncateToast(text: string): string {
  return text.length > 195 ? `${text.slice(0, 194)}…` : text;
}

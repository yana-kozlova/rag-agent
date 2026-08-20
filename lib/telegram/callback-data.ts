import { DEFAULT_SNOOZE_MINUTES, type NotificationAction } from '@/lib/push/utils';

/**
 * The wire format for a notification button.
 *
 * Telegram allows 64 bytes of `callback_data` and hands it straight back on a
 * press — no server-side state, no expiry. That budget is why an action is a
 * name and a number rather than anything carrying the notification with it:
 * everything else the handler needs it reads off the message the button is
 * attached to.
 *
 * Its own module, and dependency-free, so that the code building buttons and
 * the code parsing them can share it without importing each other.
 */

/** Namespace, so a later feature's buttons can never be read as these. */
const PREFIX = 'n';

/**
 * Quick actions took that later-feature slot. Two namespaces, one parser each,
 * and neither can read the other's presses — which matters more here than for
 * notifications, because a quick-action keyboard is meant to stay live and
 * pressable for as long as the chat scrolls back.
 */
const QUICK_PREFIX = 'q';
/** The undo offered under a press, carrying both ids it needs to be safe. */
const QUICK_UNDO_PREFIX = 'qu';

export function encodeQuickActionCallback(id: string): string {
  return `${QUICK_PREFIX}:${id}`;
}

/** The quick action id, or null if this press was not one. */
export function parseQuickActionCallback(data: string | undefined | null): string | null {
  if (!data) return null;
  const [prefix, id] = data.split(':');
  return prefix === QUICK_PREFIX && id ? id : null;
}

/**
 * Both ids fit: `qu:` plus two 21-character nanoids is 46 bytes, inside
 * Telegram's 64-byte `callback_data` budget. Carrying the row rather than
 * looking up "the last one" is what makes undo mean *this* press — a second
 * press before the first is undone would otherwise retract the wrong row.
 */
export function encodeQuickUndoCallback(actionId: string, rowId: string): string {
  return `${QUICK_UNDO_PREFIX}:${actionId}:${rowId}`;
}

export function parseQuickUndoCallback(
  data: string | undefined | null
): { actionId: string; rowId: string } | null {
  if (!data) return null;
  const [prefix, actionId, rowId] = data.split(':');
  if (prefix !== QUICK_UNDO_PREFIX || !actionId || !rowId) return null;
  return { actionId, rowId };
}

/**
 * Overdue tasks took the fourth slot. `t:d:<id>` closes one, `t:s:<id>` moves it
 * to tomorrow — 25 bytes with a 21-character nanoid, well inside the 64-byte
 * `callback_data` budget.
 *
 * The task id rides in the data rather than being read back off the message
 * text, unlike the notification actions above. That is what lets each overdue
 * task go out as its own message with its own keyboard: a press identifies its
 * task outright, so clearing that message's markup retires exactly one button
 * pair and leaves the others live. Reconstructing from text could not do that
 * without parsing a list back out of prose.
 */
const TASK_PREFIX = 't';

export type TaskCallback = { action: 'done' | 'tomorrow'; taskId: string };

export function encodeTaskCallback(action: 'done' | 'tomorrow', taskId: string): string {
  return `${TASK_PREFIX}:${action === 'done' ? 'd' : 's'}:${taskId}`;
}

export function parseTaskCallback(data: string | undefined | null): TaskCallback | null {
  if (!data) return null;

  const [prefix, verb, taskId] = data.split(':');
  if (prefix !== TASK_PREFIX || !taskId) return null;
  if (verb !== 'd' && verb !== 's') return null;

  return { action: verb === 'd' ? 'done' : 'tomorrow', taskId };
}

/** A day. Past that, "later" is not a snooze, it is a different notification. */
export const MAX_SNOOZE_MINUTES = 24 * 60;

export type ParsedCallback = {
  action: NotificationAction;
  /** Only meaningful for `snooze`; carried always so the parser stays total. */
  minutes: number;
};

export function encodeCallbackData(
  action: NotificationAction,
  snoozeMinutes: number = DEFAULT_SNOOZE_MINUTES
): string {
  return action === 'snooze' ? `${PREFIX}:snooze:${snoozeMinutes}` : `${PREFIX}:${action}`;
}

/**
 * Read a press back.
 *
 * Returns null for anything unrecognised. `callback_data` comes from the
 * client side of Telegram, so a hand-crafted value is possible even though the
 * only realistic source is a button this app sent — an out-of-range or
 * non-numeric snooze is clamped rather than trusted.
 */
export function parseCallbackData(data: string | undefined | null): ParsedCallback | null {
  if (!data) return null;

  const [prefix, action, rawMinutes] = data.split(':');
  if (prefix !== PREFIX) return null;

  if (action === 'save' || action === 'dismiss') {
    return { action, minutes: DEFAULT_SNOOZE_MINUTES };
  }

  if (action !== 'snooze') return null;

  const parsed = Number(rawMinutes);
  const minutes = Number.isFinite(parsed)
    ? Math.min(MAX_SNOOZE_MINUTES, Math.max(1, Math.round(parsed)))
    : DEFAULT_SNOOZE_MINUTES;

  return { action: 'snooze', minutes };
}

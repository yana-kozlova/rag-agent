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

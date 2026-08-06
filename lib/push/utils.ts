import { env } from '@/lib/env.mjs';

/**
 * What a proactive notification is, independent of how it gets delivered.
 *
 * This used to be a Web Push payload — icon, badge, tag, `requireInteraction`,
 * a `data.url` for the service worker to open on click. All of it described a
 * browser notification, and none of it survives the move to Telegram, which
 * takes text and buttons and nothing else. What is left is what a notification
 * actually is: something to say, and a couple of things to do about it.
 */
export interface NotificationPayload {
  title: string;
  body: string;
  /** Buttons under the message. Omit for a notification with nothing to act on. */
  actions?: NotificationAction[];
  /** How far ahead "Later" moves this one. Defaults to `DEFAULT_SNOOZE_MINUTES`. */
  snoozeMinutes?: number;
  /** Context kept with the queued row for debugging. Never shown to the user. */
  data?: Record<string, unknown>;
}

/**
 * A button offered under a notification.
 *
 * Deliberately a closed set rather than free-form. A press comes back from
 * Telegram as at most 64 bytes of `callback_data`, so an action has to be
 * something the handler can carry out knowing only its name, the chat it
 * happened in, and the text of the message it was attached to — there is no
 * room to smuggle state through the button itself.
 */
export type NotificationAction = 'snooze' | 'save' | 'dismiss';

/** Used when a payload asks for "Later" without saying how much later. */
export const DEFAULT_SNOOZE_MINUTES = 10;

/**
 * Guard for cron-triggered endpoints.
 *
 * Fails *closed*: with no CRON_SECRET configured these routes are reachable by
 * anyone who knows the path, so an unset secret is treated as misconfiguration
 * rather than as "no auth needed". Development is exempted so local runs work.
 */
export function validateCronSecret(req: Request): boolean {
  const cronSecret = env.CRON_SECRET || process.env.CRON_SECRET;

  if (!cronSecret || typeof cronSecret !== 'string' || cronSecret.trim().length === 0) {
    if (process.env.NODE_ENV !== 'production') return true;
    console.error(
      '[push] CRON_SECRET is not set in production — refusing to run cron endpoint.'
    );
    return false;
  }

  const authHeader = req.headers.get('authorization');
  const providedSecret =
    authHeader?.replace('Bearer ', '') || new URL(req.url).searchParams.get('secret');

  if (!providedSecret) return false;

  return timingSafeEqual(providedSecret, cronSecret);
}

/** Constant-time string compare, so the secret can't be probed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

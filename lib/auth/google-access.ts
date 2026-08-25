import { env } from '@/lib/env.mjs';

/**
 * Whether this account can still reach Google, and whose problem it is when it
 * cannot.
 *
 * A refresh token is not forever. Google ends one when the user revokes access,
 * when they change their password, and — the case that bites here — after seven
 * days for any OAuth client still in "Testing" publishing status. So a
 * deployment that works perfectly on the day it is set up loses its calendar a
 * week later, and everything downstream reports the symptom rather than the
 * cause: the briefing says the calendar could not be read, a calendar tool
 * fails, and nothing anywhere says the words "grant access again".
 *
 * The distinction this module exists to draw is between the two ways a refresh
 * can fail. `invalid_grant` is Google saying the permission is gone, which only
 * the user can fix and which they must be told about. Everything else — a
 * timeout, a 5xx, a client secret the deployment got wrong — is Google not
 * answering, or the deployment being broken, and sending the user through an
 * OAuth dance for either of those is how a message that means "act now" gets
 * trained into one that is ignored. It is the same rule `images:prune` follows
 * with 404 versus a timeout, and for the same reason.
 *
 * Deliberately free of database and Google imports so both token modules can
 * depend on it (`lib/auth/google-token.ts` for the web and Telegram paths,
 * `lib/push/google-token.ts` for cron) without either depending on the other.
 */

export type GoogleAccessStatus =
  /** A token was minted just now. */
  | 'ok'
  /** No refresh token stored at all — never consented, or consent withdrawn. */
  | 'missing'
  /** Google refused the refresh token: revoked, expired, or superseded. */
  | 'expired'
  /** Google did not answer, or answered something that is not about the user. */
  | 'unavailable';

export type GoogleTokenFailure = Exclude<GoogleAccessStatus, 'ok'>;

export type GoogleTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: GoogleTokenFailure };

/**
 * Whether the user has to grant access again, or whether the right advice is
 * "wait".
 *
 * Only the two failures that are actually about the user's permission. An
 * `unavailable` told to reconnect would send someone through Google's consent
 * screen to fix an outage they cannot affect.
 */
export function needsReconnect(status: GoogleAccessStatus): boolean {
  return status === 'expired' || status === 'missing';
}

/**
 * A failed refresh, read as one of the two facts above.
 *
 * `invalid_grant` is the only code that means the permission is gone. Note what
 * is deliberately *not* mapped to it: `invalid_client` and `unauthorized_client`
 * mean this deployment's own credentials are wrong, and no amount of
 * re-consenting by the user will change that — they would arrive back at the
 * same message, having been told twice that it was their fault.
 */
export function classifyGoogleTokenFailure(error: unknown): GoogleTokenFailure {
  const response = (error as { response?: { data?: { error?: unknown } } })?.response;
  const code = typeof response?.data?.error === 'string' ? response.data.error : '';
  const message = error instanceof Error ? error.message : String(error ?? '');

  // The library surfaces the OAuth error code on the response body, and folds it
  // into the message on some paths; either is proof enough.
  if (code === 'invalid_grant' || /invalid_grant/i.test(message)) return 'expired';

  return 'unavailable';
}

/** Where the account holder goes to grant access again. */
export const RECONNECT_PATH = '/settings#google';

/**
 * The full address of that page, or null when this deployment does not know
 * where it is served from.
 *
 * Same origin resolution as `flattenMarkdownLinks` uses for the same reason: a
 * bare path is meaningless in a Telegram message, which is exactly where this
 * link is needed most.
 */
export function reconnectUrl(): string | null {
  const origin = (env.APP_URL || env.NEXTAUTH_URL || '').replace(/\/+$/, '');
  return origin ? `${origin}${RECONNECT_PATH}` : null;
}

/**
 * Thrown when a calendar tool is asked to work without a usable Google token.
 *
 * Typed rather than a bare `Error` so the Telegram surface can answer it with
 * the repair instructions instead of "щось пішло не так", which is true and
 * useless. The message is written for the model rather than at it: the AI SDK
 * feeds a failed tool call back into the conversation, so whatever is written
 * here is what the assistant reads before deciding what to say — and the one
 * answer that must never come out of this is "your day is free".
 */
export class GoogleAccessError extends Error {
  constructor() {
    super(
      'Google access for this account is unavailable — the permission has most likely ' +
        'expired and has to be granted again. Tell the user their calendar cannot be read ' +
        'until they reconnect Google: send /google to the Telegram bot, or open ' +
        'Settings → Google in the app. Never answer this by saying the day is free.'
    );
    this.name = 'GoogleAccessError';
  }
}

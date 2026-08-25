import { OAuth2Client } from 'google-auth-library';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accounts } from '@/lib/db/schema';
import { env } from '@/lib/env.mjs';
import {
  classifyGoogleTokenFailure,
  type GoogleAccessStatus,
  type GoogleTokenResult,
} from '@/lib/auth/google-access';

/**
 * Mint a Google access token for a user without a session.
 *
 * The web app refreshes tokens inside the NextAuth JWT callback, so the token
 * only ever exists in the session cookie. Entry points with no cookie — the
 * Telegram webhook, cron and QStash callbacks — need another source, and the
 * `account` row the Drizzle adapter writes at sign-in is it: `refresh_token`
 * there is long-lived, so a fresh access token is always one call away.
 *
 * Note `accounts.access_token` is deliberately ignored — nothing updates it
 * after sign-in, so it is stale within the hour. Only the refresh token is
 * trustworthy.
 */

/**
 * Write the tokens from a sign-in back to the `account` row.
 *
 * The Drizzle adapter fills that row once, when the Google account is first
 * linked, and never touches it again — later sign-ins just find the existing
 * row. So the stored tokens and scopes freeze at whatever the very first
 * sign-in produced, which is how an account can sit for months carrying no
 * calendar scope and no refresh token while the web app works perfectly off
 * the session cookie. Calling this on every sign-in keeps the row honest.
 */
export async function persistGoogleAccount(params: {
  providerAccountId: string;
  refreshToken?: string | null;
  accessToken?: string | null;
  expiresAt?: number | null;
  scope?: string | null;
}): Promise<void> {
  try {
    await db
      .update(accounts)
      .set({
        // Google returns a refresh token only when it re-prompts for consent.
        // Overwriting with null on the quieter flows would throw away the one
        // credential that cannot be re-derived.
        ...(params.refreshToken ? { refresh_token: params.refreshToken } : {}),
        access_token: params.accessToken ?? null,
        expires_at: params.expiresAt ?? null,
        scope: params.scope ?? null,
      })
      .where(
        and(
          eq(accounts.provider, 'google'),
          eq(accounts.providerAccountId, params.providerAccountId),
        ),
      );

    // A fresh sign-in invalidates whatever we minted from the previous one.
    cache.clear();
  } catch (error) {
    // Never block a sign-in over bookkeeping.
    console.error('[google-token] could not persist account tokens:', error);
  }
}

type CachedToken = { token: string; expiresAt: number };

/**
 * Access tokens live an hour; refreshing on every message would add a Google
 * round-trip to each one. Warm serverless instances reuse this, cold ones just
 * mint again — it is a cache, never a source of truth.
 */
const cache = new Map<string, CachedToken>();

/** Refresh a minute early so a token can't expire mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Mint a token, or say why not.
 *
 * The reason is the whole difference between a user who has to do something and
 * a user who has to wait — see `lib/auth/google-access.ts`. `getGoogleAccessToken`
 * below keeps the older shape for the callers that only ever wanted a token.
 */
export async function mintGoogleAccessToken(userId: string): Promise<GoogleTokenResult> {
  const cached = cache.get(userId);
  if (cached && Date.now() < cached.expiresAt - EXPIRY_MARGIN_MS) {
    return { ok: true, token: cached.token };
  }

  const rows = await db
    .select({ refreshToken: accounts.refresh_token })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'google')))
    .limit(1);

  const refreshToken = rows[0]?.refreshToken;
  if (!refreshToken) {
    // Signed up before `access_type: offline` was set, or revoked access.
    // Re-consenting on the web writes a new account row and fixes it.
    console.warn(`[google-token] no refresh token stored for user ${userId}`);
    return { ok: false, reason: 'missing' };
  }

  try {
    const client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      'postmessage',
    );
    client.setCredentials({ refresh_token: refreshToken });

    const response = await client.getAccessToken();
    const token = response.token;
    // Google answered without refusing and without a token: not the user's
    // permission, so not something they can repair by re-consenting.
    if (!token) return { ok: false, reason: 'unavailable' };

    const expiresIn = response.res?.data?.expires_in;
    cache.set(userId, {
      token,
      expiresAt: Date.now() + (typeof expiresIn === 'number' ? expiresIn * 1000 : 3600_000),
    });

    return { ok: true, token };
  } catch (error) {
    console.error('[google-token] refresh failed:', error);
    cache.delete(userId);
    return { ok: false, reason: classifyGoogleTokenFailure(error) };
  }
}

export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const result = await mintGoogleAccessToken(userId);
  return result.ok ? result.token : null;
}

/**
 * Can this account still reach Google?
 *
 * Answered by actually minting a token rather than by reading a stored expiry:
 * `accounts.access_token` is only as fresh as the last background job that
 * happened to refresh it, and a status panel that can be confidently wrong is
 * worse than no status panel. Costs one Google round-trip on a cold cache,
 * which is the right price for the two places that ask — a settings screen and
 * a `/google` in the bot, both of them opened by someone who suspects
 * something is broken.
 */
export async function checkGoogleAccess(userId: string): Promise<GoogleAccessStatus> {
  const result = await mintGoogleAccessToken(userId);
  return result.ok ? 'ok' : result.reason;
}

import { OAuth2Client } from 'google-auth-library';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accounts } from '@/lib/db/schema';
import { env } from '@/lib/env.mjs';

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

type CachedToken = { token: string; expiresAt: number };

/**
 * Access tokens live an hour; refreshing on every message would add a Google
 * round-trip to each one. Warm serverless instances reuse this, cold ones just
 * mint again — it is a cache, never a source of truth.
 */
const cache = new Map<string, CachedToken>();

/** Refresh a minute early so a token can't expire mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const cached = cache.get(userId);
  if (cached && Date.now() < cached.expiresAt - EXPIRY_MARGIN_MS) {
    return cached.token;
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
    return null;
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
    if (!token) return null;

    const expiresIn = response.res?.data?.expires_in;
    cache.set(userId, {
      token,
      expiresAt: Date.now() + (typeof expiresIn === 'number' ? expiresIn * 1000 : 3600_000),
    });

    return token;
  } catch (error) {
    console.error('[google-token] refresh failed:', error);
    cache.delete(userId);
    return null;
  }
}

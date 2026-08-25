import { db } from '@/lib/db';
import { accounts, users } from '@/lib/db/schema/auth';
import { eq, and } from 'drizzle-orm';
import { OAuth2Client } from 'google-auth-library';
import { GoogleCalendarService } from '@/lib/services/calendar';
import { classifyGoogleTokenFailure, type GoogleTokenResult } from '@/lib/auth/google-access';
import { DEFAULT_TIMEZONE, isValidTimezone } from './timezone';

/**
 * Get a usable Google access token for a user in a background job, or say why
 * there is none.
 *
 * Cron runs with no session, so the NextAuth JWT refresh path doesn't apply —
 * this refreshes straight off the stored refresh_token instead.
 *
 * The reason matters to exactly one caller, the morning briefing: a calendar it
 * could not read is worth one line, and a Google permission that has ended is
 * worth telling the user how to repair. Everything else asks
 * `getAccessTokenForUser` below and gets the token or nothing.
 */
export async function getAccessTokenResult(userId: string): Promise<GoogleTokenResult> {
  try {
    const accountRows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'google')))
      .limit(1);

    const account = accountRows[0];
    if (!account?.refresh_token) return { ok: false, reason: 'missing' };

    // Reuse the stored token while it has more than 5 minutes left.
    const now = Math.floor(Date.now() / 1000);
    if (account.access_token && account.expires_at && account.expires_at > now + 300) {
      return { ok: true, token: account.access_token };
    }

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'postmessage'
    );
    oauth2Client.setCredentials({ refresh_token: account.refresh_token });

    const tokenResponse = await oauth2Client.getAccessToken();
    if (!tokenResponse.token) return { ok: false, reason: 'unavailable' };

    const expiresAt = tokenResponse.res?.data?.expires_in
      ? now + tokenResponse.res.data.expires_in
      : now + 3600;

    await db
      .update(accounts)
      .set({ access_token: tokenResponse.token, expires_at: expiresAt })
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'google')));

    return { ok: true, token: tokenResponse.token };
  } catch (error) {
    console.error(`[push/google-token] Error for user ${userId}:`, error);
    return { ok: false, reason: classifyGoogleTokenFailure(error) };
  }
}

export async function getAccessTokenForUser(userId: string): Promise<string | null> {
  const result = await getAccessTokenResult(userId);
  return result.ok ? result.token : null;
}

/**
 * Resolve a user's IANA timezone, preferring the cached column and falling back
 * to their Google Calendar setting (which is then cached for next time).
 *
 * Never falls back to the server's zone: on Vercel that is UTC, and silently
 * using it is exactly how notifications end up hours off.
 */
export async function resolveUserTimezone(
  userId: string,
  accessToken?: string | null,
  /** Already-loaded value, to skip a redundant lookup in batch jobs. */
  knownTimezone?: string | null
): Promise<string> {
  if (isValidTimezone(knownTimezone)) return knownTimezone;

  const userRows = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const cached = userRows[0]?.timezone;
  if (isValidTimezone(cached)) return cached;

  if (accessToken) {
    try {
      const tz = await new GoogleCalendarService(accessToken, userId).getTimeZone();
      if (isValidTimezone(tz)) {
        await db.update(users).set({ timezone: tz }).where(eq(users.id, userId));
        return tz;
      }
    } catch (error) {
      console.error(`[push/google-token] Timezone lookup failed for ${userId}:`, error);
    }
  }

  return DEFAULT_TIMEZONE;
}

import { db } from '@/lib/db';
import { accounts, users } from '@/lib/db/schema/auth';
import { eq, and, sql } from 'drizzle-orm';
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
  // Every linked Google account, freshest first. One user can have more than one
  // `google` row — two Google identities behind one login is ordinary — and a
  // sign-in only ever refreshes the one that signed in. Taking `limit(1)` off an
  // unordered read picked between them arbitrarily, so an account whose
  // permission had been re-granted still lost its briefing whenever the planner
  // handed back the other row. See the same fix in `lib/auth/google-token.ts`.
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'google')))
    .orderBy(sql`${accounts.expires_at} desc nulls last`);

  const candidates = rows.filter((row) => !!row.refresh_token);
  if (candidates.length === 0) return { ok: false, reason: 'missing' };

  const now = Math.floor(Date.now() / 1000);
  // Only "every account refused us" proves the permission is gone; one dead
  // grant beside one Google outage must be reported as "wait", never as "grant
  // access again". Same rule as the web path.
  let sawUnavailable = false;

  for (const account of candidates) {
    // Reuse the stored token while it has more than 5 minutes left.
    if (account.access_token && account.expires_at && account.expires_at > now + 300) {
      return { ok: true, token: account.access_token };
    }

    try {
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'postmessage'
      );
      oauth2Client.setCredentials({ refresh_token: account.refresh_token as string });

      const tokenResponse = await oauth2Client.getAccessToken();
      if (!tokenResponse.token) {
        sawUnavailable = true;
        continue;
      }

      const expiresAt = tokenResponse.res?.data?.expires_in
        ? now + tokenResponse.res.data.expires_in
        : now + 3600;

      // Scoped to the account the token was actually minted from. Without the
      // `providerAccountId` this wrote it to *every* google row the user has, so
      // a dead account was stamped with a live token and a fresh expiry — and
      // then satisfied the reuse branch above on the next run, handing out a
      // token minted for a different Google identity as if it were its own.
      await db
        .update(accounts)
        .set({ access_token: tokenResponse.token, expires_at: expiresAt })
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.provider, 'google'),
            eq(accounts.providerAccountId, account.providerAccountId)
          )
        );

      return { ok: true, token: tokenResponse.token };
    } catch (error) {
      const reason = classifyGoogleTokenFailure(error);
      console.error(
        `[push/google-token] Error for user ${userId}, google:${account.providerAccountId} (${reason}):`,
        error
      );
      if (reason === 'unavailable') sawUnavailable = true;
    }
  }

  return { ok: false, reason: sawUnavailable ? 'unavailable' : 'expired' };
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

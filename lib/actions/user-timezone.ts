import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/auth';
import { DEFAULT_TIMEZONE, getLocalDateKey, isValidTimezone } from '@/lib/push/timezone';

/**
 * The zone a user's days are measured in.
 *
 * Falls back rather than throwing, always: every caller is on a path where the
 * zone is a detail and the work is not. A missing or corrupted zone must not
 * cost a check-in, a saved date, or a cron run that has already paid for an LLM
 * call — it costs the day boundary being Kyiv's instead of theirs.
 */
export async function timezoneFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return isValidTimezone(row?.timezone) ? row.timezone : DEFAULT_TIMEZONE;
}

/**
 * Today, as the user would say it. `YYYY-MM-DD` in their own zone.
 *
 * Worth a query on the save path: it is what "вчора" and "минулої суботи"
 * resolve against, and at 01:00 in Kyiv the server is still on yesterday — a
 * date extracted then would be filed a day early and stay that way.
 */
export async function todayFor(userId: string): Promise<string> {
  return getLocalDateKey(new Date(), await timezoneFor(userId));
}

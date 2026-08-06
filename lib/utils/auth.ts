import { z } from 'zod';
import { getCalendarUserOrThrow, getUser, type UserContext } from '@/lib/auth/context';

/**
 * Session-shaped view of whoever this call acts for.
 *
 * Tools used to read the NextAuth session directly, which tied them to a cookie
 * and so to the browser. They now go through the request context instead — the
 * web path still resolves the same session, while cookie-less entry points (the
 * Telegram webhook, cron callbacks) supply the user themselves. The `{ user }`
 * shape is kept so call sites read unchanged.
 */
export type ToolSession = { user: UserContext };

/** For calendar work: throws unless a usable Google access token is available. */
export async function getSessionOrThrow(): Promise<{ user: UserContext & { accessToken: string } }> {
  return { user: await getCalendarUserOrThrow() };
}

/** For everything else: identity only, null when nobody is signed in. */
export async function getSessionOrNull(): Promise<ToolSession | null> {
  const user = await getUser();
  return user ? { user } : null;
}

export function parseInputOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data as T;
}

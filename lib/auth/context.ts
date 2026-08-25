import { AsyncLocalStorage } from 'node:async_hooks';
import { auth } from '@/app/api/auth/auth';
import { GoogleAccessError } from '@/lib/auth/google-access';

/**
 * Who a tool is acting for.
 *
 * The web chat gets this from the NextAuth session cookie. Entry points with no
 * cookie at all — the Telegram webhook, cron/QStash callbacks — build it
 * themselves and push it onto the context before running the agent.
 */
export type UserContext = {
  id: string;
  name?: string | null;
  email?: string | null;
  /** Google access token (Calendar scope). Already in hand on the web path. */
  accessToken?: string | null;
  /**
   * Lazy alternative to `accessToken`, for callers that would have to mint one.
   * Minting costs a round-trip to Google, so it is deferred until a calendar
   * tool actually asks — most messages never touch the calendar.
   */
  resolveAccessToken?: () => Promise<string | null>;
  /**
   * Which door this call came in through. Only things that record where a
   * datum originated need it — everything else treats every surface alike.
   */
  surface?: 'web' | 'telegram';
};

/**
 * Requires the Node runtime; `AsyncLocalStorage` does not exist on Edge. Every
 * route that runs tools is Node (the default) — only `middleware.ts` is Edge,
 * and it never touches tools.
 */
const storage = new AsyncLocalStorage<UserContext>();

/** Run `fn` with an explicit user, for entry points that carry no session. */
export function runWithUser<T>(user: UserContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(user, fn);
}

/**
 * The user this call is acting for, or null if nobody is.
 *
 * Falls back to the NextAuth session when no context was pushed, which is what
 * keeps the web path working unchanged: routes there set nothing and still
 * resolve exactly the session they always did.
 */
export async function getUser(): Promise<UserContext | null> {
  const ambient = storage.getStore();
  if (ambient) return ambient;

  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    accessToken: (session.user.accessToken as string | undefined) ?? null,
    surface: 'web',
  };
}

export async function getUserOrThrow(): Promise<UserContext> {
  const user = await getUser();
  if (!user) {
    throw new Error('Unauthorized: no user in context');
  }
  return user;
}

/**
 * The user plus a usable Google access token — what the calendar tools need.
 *
 * A resolved token is cached back onto the context object, which is per-run, so
 * several calendar tools in one agent turn mint at most one token.
 */
export async function getCalendarUserOrThrow(): Promise<UserContext & { accessToken: string }> {
  const user = await getUserOrThrow();

  if (!user.accessToken && user.resolveAccessToken) {
    user.accessToken = await user.resolveAccessToken();
  }

  // Typed, and worded for the model that will read it back: a token that could
  // not be minted is almost always a permission Google has ended, which the
  // user can repair in a minute — but only if something says so. Left as a bare
  // "Unauthorized" it reached them as "щось пішло не так на моєму боці".
  if (!user.accessToken) {
    throw new GoogleAccessError();
  }

  return user as UserContext & { accessToken: string };
}

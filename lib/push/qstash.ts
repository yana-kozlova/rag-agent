import { env } from '@/lib/env.mjs';

/**
 * Exact-time delivery for queued notifications, via Upstash QStash.
 *
 * The alternative — a cron polling the queue — has to run every few minutes to
 * feel responsive, which wakes a serverless Postgres thousands of times a day
 * to discover there is nothing to do. QStash inverts that: we hand it an
 * instant, it calls back then, and nothing runs in between.
 *
 * Talking to the REST API directly rather than pulling in @upstash/qstash: the
 * publish call is one fetch, and authentication of the callback reuses the
 * CRON_SECRET check every other cron endpoint already performs — QStash
 * forwards any header prefixed with `Upstash-Forward-`. That keeps one auth
 * path in the codebase instead of two.
 */

const QSTASH_PUBLISH_URL = 'https://qstash.upstash.io/v2/publish';

export function isQstashConfigured(): boolean {
  return Boolean(env.QSTASH_TOKEN);
}

/** Public origin QStash should call back into. */
function callbackOrigin(): string | null {
  const origin = env.APP_URL || env.NEXTAUTH_URL;
  if (!origin) return null;
  // localhost is unreachable from Upstash; scheduling there would silently
  // never fire, so fall back to the sweep instead of pretending it worked.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(origin)) return null;
  return origin.replace(/\/$/, '');
}

/**
 * Ask QStash to POST one of our endpoints, optionally not before a given
 * instant. The callback authenticates with CRON_SECRET, forwarded as a plain
 * `Authorization` header, so every push endpoint validates it identically.
 *
 * Returns the QStash message id, or null when publishing was not possible —
 * no token, no reachable origin, no secret, or the API rejected it. Callers
 * treat null as "QStash didn't take it" and fall back accordingly; it is never
 * a throw they must catch.
 */
export async function publishJob(params: {
  /** App-relative path, e.g. '/api/push/drain'. */
  path: string;
  body: unknown;
  /** Earliest delivery instant. Omit or pass a past time for "send now". */
  notBefore?: Date;
  /** QStash-side retries on a transient 5xx from us. */
  retries?: number;
}): Promise<string | null> {
  const token = env.QSTASH_TOKEN;
  const origin = callbackOrigin();
  if (!token || !origin) return null;

  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[push/qstash] CRON_SECRET is unset; refusing to schedule an unauthenticated callback.');
    return null;
  }

  const destination = `${origin}${params.path}`;

  // Whole seconds since the epoch; QStash rejects fractional values. A time
  // already past means "send now".
  const notBefore = Math.max(
    Math.floor(Date.now() / 1000),
    Math.floor((params.notBefore?.getTime() ?? 0) / 1000)
  );

  try {
    const res = await fetch(`${QSTASH_PUBLISH_URL}/${destination}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Upstash-Not-Before': String(notBefore),
        // Reaches our route as a plain `Authorization` header.
        'Upstash-Forward-Authorization': `Bearer ${cronSecret}`,
        'Upstash-Retries': String(params.retries ?? 3),
      },
      body: JSON.stringify(params.body),
    });

    if (!res.ok) {
      console.error(
        `[push/qstash] Publish to ${params.path} failed (${res.status}): ${await res.text().catch(() => '')}`
      );
      return null;
    }

    const body = (await res.json().catch(() => null)) as { messageId?: string } | null;
    return body?.messageId ?? null;
  } catch (error) {
    console.error('[push/qstash] Publish threw:', error);
    return null;
  }
}

/**
 * Ask QStash to POST the drain endpoint when `notifyAt` arrives.
 *
 * Null is not an error the caller needs to handle: the queue row is already
 * durable, so the sweep picks it up regardless. Precision degrades; delivery
 * does not.
 */
export async function scheduleDelivery(params: {
  queueRowId: string;
  notifyAt: Date;
}): Promise<string | null> {
  return publishJob({
    path: '/api/push/drain',
    body: { queueRowId: params.queueRowId },
    notBefore: params.notifyAt,
  });
}

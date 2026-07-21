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
 * Ask QStash to POST the drain endpoint when `notifyAt` arrives.
 *
 * Returns the QStash message id, or null when scheduling was not possible —
 * no token, no reachable origin, or the API rejected it. Null is not an error
 * the caller needs to handle: the queue row is already durable, so the sweep
 * picks it up regardless. Precision degrades; delivery does not.
 */
export async function scheduleDelivery(params: {
  queueRowId: string;
  notifyAt: Date;
}): Promise<string | null> {
  const token = env.QSTASH_TOKEN;
  const origin = callbackOrigin();
  if (!token || !origin) return null;

  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[push/qstash] CRON_SECRET is unset; refusing to schedule an unauthenticated callback.');
    return null;
  }

  const destination = `${origin}/api/push/drain`;

  // Whole seconds since the epoch; QStash rejects fractional values. A time
  // already past means "send now", which is exactly the desired behaviour for
  // a snooze that was queued late.
  const notBefore = Math.max(
    Math.floor(Date.now() / 1000),
    Math.floor(params.notifyAt.getTime() / 1000)
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
        // A transient 5xx on our side shouldn't drop the notification.
        'Upstash-Retries': '3',
      },
      body: JSON.stringify({ queueRowId: params.queueRowId }),
    });

    if (!res.ok) {
      console.error(
        `[push/qstash] Publish failed (${res.status}): ${await res.text().catch(() => '')}`
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

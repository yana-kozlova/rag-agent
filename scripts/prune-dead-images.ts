import 'dotenv/config';
import { asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema';
import { mapWithConcurrency } from '@/lib/push/concurrency';

/**
 * Forgets image URLs whose object is no longer there.
 *
 * `metadata.imageUrl` points into a Vercel Blob store, and a store that is
 * deleted and recreated gets a new id — so every URL saved against the old one
 * now 404s while the row still claims to have a picture. The symptom is silent
 * and only visual: the Knowledge Base card renders an `<Image>` for anything
 * with an `imageUrl` and shows the description preview otherwise, so a dead
 * link turns the card into an empty grey box instead of the text that would
 * have been there.
 *
 *   pnpm images:prune --dry   # report what is gone, write nothing
 *   pnpm images:prune         # drop imageUrl/imagePathname from the dead ones
 *
 * The resource is never deleted, only the two keys that point at bytes. An
 * image's `content` is the vision model's description of it — that is the half
 * the knowledge base actually searches, it is still true, and a resource
 * without an `imageUrl` is a state the app already supports: it is exactly what
 * an upload with no `BLOB_READ_WRITE_TOKEN` produces.
 *
 * **Only an explicit 404 or 410 counts as gone.** A timeout, a DNS failure, a
 * 500 or a rate limit means "could not tell", and treating that as absence
 * would erase live URLs — the one mistake here that cannot be undone, since
 * nothing else in the database remembers where the bytes were.
 */

const dryRun = process.argv.includes('--dry');

/** Blob URLs are on a CDN; a handful at a time is plenty and stays polite. */
const CONCURRENCY = 6;

const REQUEST_TIMEOUT_MS = 10_000;

type Verdict = 'alive' | 'gone' | 'unknown';

async function probe(url: string): Promise<{ verdict: Verdict; detail: string }> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 404 || res.status === 410) return { verdict: 'gone', detail: `${res.status}` };
    if (res.ok) return { verdict: 'alive', detail: `${res.status}` };

    // Anything else — 403, 429, 5xx — says something about the request or the
    // service, not about whether the object exists.
    return { verdict: 'unknown', detail: `${res.status}` };
  } catch (error) {
    return {
      verdict: 'unknown',
      detail: error instanceof Error ? error.message : 'request failed',
    };
  }
}

async function main() {
  const rows = await db
    .select({
      id: resources.id,
      title: resources.title,
      metadata: resources.metadata,
    })
    .from(resources)
    .orderBy(asc(resources.createdAt));

  const withImages = rows.filter((row) => {
    const url = (row.metadata as { imageUrl?: unknown } | null)?.imageUrl;
    return typeof url === 'string' && url.length > 0;
  });

  console.log(
    `Found ${withImages.length} resource(s) with an image URL, of ${rows.length} total. dry=${dryRun}\n`
  );

  if (withImages.length === 0) {
    console.log('Nothing to check.');
    process.exit(0);
  }

  const checked = await mapWithConcurrency(withImages, CONCURRENCY, async (row) => {
    const meta = row.metadata as Record<string, unknown>;
    const url = meta.imageUrl as string;
    return { row, url, ...(await probe(url)) };
  });

  let pruned = 0;
  let alive = 0;
  let unknown = 0;

  for (const result of checked) {
    const label = (result.row.title || result.row.id).replace(/\s+/g, ' ');

    if (result.verdict === 'alive') {
      alive += 1;
      continue;
    }

    if (result.verdict === 'unknown') {
      unknown += 1;
      console.log(`  ?       ${label}\n          left alone — ${result.detail}`);
      continue;
    }

    console.log(`  gone    ${label}\n          ${result.url}`);
    pruned += 1;

    if (dryRun) continue;

    // Both keys go together: `imagePathname` is a handle on the same object and
    // is worse than useless once the object is not there — it looks like a way
    // to recover the URL.
    const meta = { ...(result.row.metadata as Record<string, unknown>) };
    delete meta.imageUrl;
    delete meta.imagePathname;

    await db
      .update(resources)
      .set({ metadata: meta as any })
      .where(eq(resources.id, result.row.id));
  }

  console.log(
    `\nDone. alive=${alive} ${dryRun ? 'would prune' : 'pruned'}=${pruned} undetermined=${unknown}` +
      (unknown > 0 ? '\nRe-run to retry the undetermined ones; nothing was changed for them.' : '')
  );

  process.exit(0);
}

main().catch((error) => {
  console.error('Prune failed:', error);
  process.exit(1);
});

import 'dotenv/config';
import { asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema';
import { extractDates } from '@/lib/ai/information-extraction';
import { syncTimelineForResource } from '@/lib/actions/timeline';
import { timezoneFor } from '@/lib/actions/user-timezone';
import { getLocalDateKey } from '@/lib/push/timezone';

/**
 * Reads the dates out of notes saved before the timeline existed.
 *
 * Every note in the base predates it, so without this the axis starts empty and
 * fills only as new notes arrive — and the dates worth having are mostly old
 * ones. A birthday recorded two years ago is exactly what the timeline is for
 * and exactly what a forward-only feature would never show.
 *
 *   pnpm timeline:backfill --dry    # report what would be recorded, write nothing
 *   pnpm timeline:backfill          # extract and record
 *   pnpm timeline:backfill --force  # re-read notes that already have dates
 *
 * This calls the dates-only extractor, not the full one. Re-running the full
 * extraction would rewrite every note's type, tags, facts and entities as a side
 * effect of wanting its dates, replacing structure the user may have corrected
 * by hand. Nothing here touches `content` either: the note is the user's, only
 * the axis around it is being filled in.
 *
 * `metadata.dates` is written alongside the rows so the note carries its own
 * record, exactly as a note saved today would — and so a second run can tell
 * which notes have already been read.
 */

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry');

/** Between requests, so a large base does not walk into a rate limit. */
const PAUSE_MS = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const rows = await db
    .select({
      id: resources.id,
      userId: resources.userId,
      title: resources.title,
      content: resources.content,
      metadata: resources.metadata,
    })
    .from(resources)
    .orderBy(asc(resources.createdAt));

  console.log(`Found ${rows.length} note(s). force=${force} dry=${dryRun}\n`);

  // One lookup per user rather than per note: the zone is what "вчора" resolves
  // against, and a base of hundreds of notes belongs to a handful of people.
  const todayByUser = new Map<string, string>();

  let read = 0;
  let skipped = 0;
  let failed = 0;
  let recorded = 0;

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const label = (row.title || row.content.slice(0, 40)).replace(/\s+/g, ' ');

    if (Array.isArray(meta.dates) && !force) {
      skipped += 1;
      continue;
    }

    let today = todayByUser.get(row.userId);
    if (!today) {
      today = getLocalDateKey(new Date(), await timezoneFor(row.userId));
      todayByUser.set(row.userId, today);
    }

    const dates = await extractDates(row.content, today, 'backfillTimeline');
    await sleep(PAUSE_MS);

    if (dates === null) {
      console.log(`  FAILED  ${label}`);
      failed += 1;
      continue;
    }

    read += 1;

    if (dates.length === 0) {
      // Recorded as an empty list, not left absent: that is what stops the next
      // run paying for this note again.
      if (!dryRun) {
        await db
          .update(resources)
          .set({ metadata: { ...meta, dates: [] } as any })
          .where(eq(resources.id, row.id));
      }
      continue;
    }

    console.log(
      `  ok      ${label}\n` +
        dates.map((d) => `          ${d.date}  ${d.title}${d.recurring ? '  (annual)' : ''}`).join('\n')
    );

    if (dryRun) continue;

    await db
      .update(resources)
      .set({ metadata: { ...meta, dates } as any })
      .where(eq(resources.id, row.id));

    // `replace` so a second run with --force corrects rather than duplicates.
    const result = await syncTimelineForResource({
      resourceId: row.id,
      userId: row.userId,
      dates,
      replace: true,
    });

    recorded += result.written;
  }

  console.log(
    `\nDone. read=${read} skipped=${skipped} failed=${failed} ` +
      `${dryRun ? 'would record' : 'recorded'}=${recorded}`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});

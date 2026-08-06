import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema';
import { extractStructuredInformation } from '@/lib/ai/information-extraction';
import { syncEntitiesForResource } from '@/lib/actions/entities';

/**
 * Re-runs extraction over notes saved before the graph existed — or saved while
 * extraction was failing — and links whatever it finds into it.
 *
 * Every note in the base predates this, so without a backfill the graph starts
 * empty and stays empty until enough new notes accumulate to make it useful.
 *
 *   pnpm kb:backfill          # only notes with no entities yet
 *   pnpm kb:backfill --force  # re-extract everything
 *   pnpm kb:backfill --dry    # report what would change, write nothing
 */

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry');

/** Extraction sees the whole note; longer ones are summarised, not chunked. */
const MAX_CONTENT = 4000;

async function main() {
  const rows = await db.select().from(resources);
  console.log(`Found ${rows.length} note(s). force=${force} dry=${dryRun}\n`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let linked = 0;

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const hasEntities = Array.isArray(meta.entities) && meta.entities.length > 0;
    const label = (row.title || row.content.slice(0, 40)).replace(/\s+/g, ' ');

    if (hasEntities && !force) {
      console.log(`  skip    ${label}`);
      skipped += 1;
      continue;
    }

    const extracted = await extractStructuredInformation(
      row.content.slice(0, MAX_CONTENT),
      null,
      'backfill'
    );

    if (!extracted) {
      console.log(`  FAILED  ${label}`);
      failed += 1;
      continue;
    }

    const entities = extracted.entities.map((e) => ({
      name: e.name,
      type: e.type,
      relationship: e.relationship,
      attributes: e.attributes,
    }));

    console.log(
      `  ok      ${label}\n` +
        `          type=${extracted.contentType} tags=${extracted.structuredContent.tags.length} ` +
        `facts=${extracted.facts.length} entities=${entities.length}`
    );

    if (dryRun) {
      processed += 1;
      continue;
    }

    // Content is deliberately left alone — rewriting a note the user wrote is
    // not this script's business. Only the structure around it is filled in.
    await db
      .update(resources)
      .set({
        metadata: {
          ...meta,
          type: extracted.contentType,
          tags: extracted.structuredContent.tags,
          keyPoints: extracted.structuredContent.keyPoints,
          facts: extracted.facts,
          entities,
          needs: extracted.needs,
        } as any,
      })
      .where(eq(resources.id, row.id));

    const result = await syncEntitiesForResource({
      resourceId: row.id,
      userId: row.userId,
      entities,
    });

    linked += result.linked;
    processed += 1;
  }

  console.log(
    `\nDone. processed=${processed} skipped=${skipped} failed=${failed} entities linked=${linked}`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});

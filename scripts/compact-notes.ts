import 'dotenv/config';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { embeddings as embeddingsTable, resources } from '@/lib/db/schema';
import { generateEmbeddings } from '@/lib/ai/embedding';
import { stripLegacyProseSections } from '@/lib/ai/information-extraction';

/**
 * Removes the restatements from notes written before `formatStructuredContent`
 * stopped producing them.
 *
 * Every note saved through `addResource` used to carry its one fact five times:
 * a summary, the same thing as key points, again as subject-predicate-object,
 * again as "name - type (relationship)", and once more as a need. The last
 * three are already in `metadata` and are dropped from the text now — but the
 * notes already in the database still read that way, still embed five near
 * identical chunks, and still sit over `MAX_ROUTABLE_LENGTH`, which is what
 * stops a new fact about someone from folding into the note they already have.
 *
 *   pnpm kb:compact --dry   # report what would change, write nothing
 *   pnpm kb:compact         # apply, and re-embed what changed
 *
 * A line is removed only when regenerating it from this note's own metadata
 * reproduces it character for character. Notes that have since been merged,
 * rewritten by the model or edited by hand therefore lose exactly the lines
 * that are still verbatim generated output and nothing else — there is no
 * pattern matching here that could take a sentence someone wrote themselves.
 *
 * `metadata` is untouched: it is where the facts, entities and needs are
 * supposed to live, and the graph and the merge check read them from there.
 */

const dryRun = process.argv.includes('--dry');

async function main() {
  const rows = await db
    .select({
      id: resources.id,
      title: resources.title,
      content: resources.content,
      metadata: resources.metadata,
    })
    .from(resources)
    .orderBy(asc(resources.createdAt));

  console.log(`Found ${rows.length} note(s). dry=${dryRun}\n`);

  let changed = 0;
  let before = 0;
  let after = 0;

  for (const row of rows) {
    const compacted = stripLegacyProseSections(row.content, row.metadata);
    if (compacted === null || compacted === row.content) continue;

    changed += 1;
    before += row.content.length;
    after += compacted.length;

    const saved = row.content.length - compacted.length;
    console.log(
      `  ${row.title ?? '(untitled)'} — ${row.content.length} -> ${compacted.length} chars (-${saved})`
    );

    if (dryRun) continue;

    await db.update(resources).set({ content: compacted }).where(eq(resources.id, row.id));

    // The old chunks describe text that no longer exists, and a stale chunk is
    // worse than a missing one: it keeps scoring against queries and answers
    // them out of a version of the note nobody can open. Deleted first so a
    // failure here leaves the note unsearchable rather than wrongly searchable.
    await db.delete(embeddingsTable).where(eq(embeddingsTable.sourceId, row.id));

    const fresh = await generateEmbeddings(compacted, 'compactNotes');
    if (fresh.length > 0) {
      await db.insert(embeddingsTable).values(
        fresh.map((embedding) => ({
          sourceId: row.id,
          source: 'resource' as const,
          content: embedding.content,
          embedding: embedding.embedding,
        }))
      );
    }
  }

  const percent = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
  console.log(
    `\n${dryRun ? 'Would compact' : 'Compacted'} ${changed} note(s) of ${rows.length}` +
      (changed > 0 ? `: ${before} -> ${after} chars (-${percent}%).` : '.')
  );

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import 'dotenv/config';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { wellbeingEntries } from '@/lib/db/schema';
import { canonicalizeSymptoms } from '@/lib/wellbeing/symptoms';

/**
 * Re-runs symptom canonicalisation over check-ins already in the database.
 *
 * Labels are matched against the vocabulary a user had built *at the time*, and
 * that matching has since been loosened — first to fold inflected forms
 * together, then to fold a longer naming of one complaint onto the shorter one
 * ("білий шум в голові" onto "білий шум"). Entries written before each change
 * keep the fragments, and a frequency chart of fragments reports that nothing
 * ever recurs.
 *
 *   pnpm wellbeing:canonicalize --dry   # report what would change, write nothing
 *   pnpm wellbeing:canonicalize         # apply
 *
 * Only `symptoms` is touched. Measurements, notes and the link to the day's
 * knowledge-base note are left exactly as they are.
 */

const dryRun = process.argv.includes('--dry');

async function main() {
  const rows = await db
    .select()
    .from(wellbeingEntries)
    .orderBy(asc(wellbeingEntries.userId), asc(wellbeingEntries.recordedAt));

  console.log(`Found ${rows.length} check-in(s). dry=${dryRun}\n`);

  // Rebuilt per user, oldest entry first, so the vocabulary grows exactly as it
  // did when these were written — a later label folds onto an earlier one, and
  // never the other way round.
  const vocabulary = new Map<string, string[]>();
  let changed = 0;

  for (const row of rows) {
    const before = row.symptoms ?? [];
    if (before.length === 0) continue;

    const known = vocabulary.get(row.userId) ?? [];
    const { symptoms: after } = canonicalizeSymptoms(before, known);

    // Whatever survived joins the vocabulary, matched or not.
    vocabulary.set(row.userId, [...new Set([...known, ...after])]);

    if (after.length === before.length && after.every((s, i) => s === before[i])) continue;

    console.log(`  ${row.localDate}  ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    changed += 1;

    if (!dryRun) {
      await db
        .update(wellbeingEntries)
        .set({ symptoms: after })
        .where(eq(wellbeingEntries.id, row.id));
    }
  }

  console.log(
    `\n${dryRun ? 'Would update' : 'Updated'} ${changed} check-in(s) of ${rows.length}.`
  );

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  logWellbeingSchema,
  wellbeingEntries,
  type LogWellbeingInput,
  type WellbeingEntry,
} from '@/lib/db/schema/wellbeing';
import { createResource, updateResource } from '@/lib/actions/resources';
import { formatSleep, hoursToMinutes } from '@/lib/wellbeing/scale';
import { canonicalizeSymptoms, type Canonicalization } from '@/lib/wellbeing/symptoms';
import { dayNoteContent } from '@/lib/wellbeing/day-note';
import {
  buildDailySeries,
  sleepMoodSplit,
  summarizeRange,
  symptomDayCounts,
  type DayPoint,
  type RangeSummary,
  type SleepMoodSplit,
  type SymptomCount,
} from '@/lib/wellbeing/aggregate';
import { addLocalDays, getLocalDateKey } from '@/lib/push/timezone';
import { timezoneFor } from './user-timezone';

/**
 * The symptom labels this user has actually used, most-used first.
 *
 * The vocabulary a new check-in is matched against. Ordered by frequency so the
 * spelling that wins is the one they reach for, and capped at the recent past
 * because a label abandoned a year ago should not pull today's wording back
 * onto it.
 */
export async function knownSymptoms(userId: string, limit = 60): Promise<string[]> {
  const rows = await db
    .select({ symptoms: wellbeingEntries.symptoms })
    .from(wellbeingEntries)
    .where(eq(wellbeingEntries.userId, userId))
    .orderBy(desc(wellbeingEntries.recordedAt))
    .limit(400);

  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const symptom of row.symptoms ?? []) {
      counts.set(symptom, (counts.get(symptom) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([symptom]) => symptom);
}

export type LoggedEntry = WellbeingEntry & {
  timezone: string;
  /** Labels that were folded onto an existing one, so the caller can say so. */
  canonicalized: Canonicalization[];
};

/**
 * Bring the day's note in the knowledge base level with the day's check-ins.
 *
 * Finding the note is an exact lookup rather than a search: the day's entries
 * carry the resource id, so the note that gets updated is provably the one this
 * day already wrote. If none of them has one — first note of the day, or the
 * user deleted it from the knowledge base — a new one is created and every
 * entry of that day is pointed at it, so tomorrow's lookup still works no
 * matter which row it starts from.
 *
 * Returns the resource id, or null when the day has nothing worth indexing.
 */
async function syncDayNote(
  userId: string,
  localDate: string,
  tz: string
): Promise<string | null> {
  const entries = await listWellbeingEntries(userId, { from: localDate, to: localDate });
  if (entries.length === 0) return null;

  // Numbers alone stay out of the knowledge base: they are already on the chart
  // and in `getWellbeing`, and a note that says only "mood 3/5" is a row that
  // learned to take up space in search results.
  if (!entries.some((e) => e.note?.trim())) return null;

  const content = dayNoteContent(entries, tz);
  const symptoms = [...new Set(entries.flatMap((e) => e.symptoms ?? []))];

  const metadata = {
    type: 'note' as const,
    category: 'wellbeing',
    tags: ['wellbeing', 'check-in', ...symptoms],
  };

  const existingId = entries.find((e) => e.resourceId)?.resourceId ?? null;

  if (existingId) {
    const updated = await updateResource(existingId, {
      title: `Check-in · ${localDate}`,
      content,
      metadata,
    });

    // A resource that has gone missing (deleted in the knowledge base while its
    // entries still point at it) falls through to being created again below.
    if (updated.success) {
      await linkDayEntries(userId, localDate, existingId);
      return existingId;
    }
  }

  const created = await createResource({
    title: `Check-in · ${localDate}`,
    content,
    metadata,
  });

  if (!created.success || !created.id) return null;

  await linkDayEntries(userId, localDate, created.id);
  return created.id;
}

/** Points every check-in of the day at the day's note, so any of them can find it. */
async function linkDayEntries(userId: string, localDate: string, resourceId: string) {
  await db
    .update(wellbeingEntries)
    .set({ resourceId })
    .where(
      and(eq(wellbeingEntries.userId, userId), eq(wellbeingEntries.localDate, localDate))
    );
}

/**
 * Record one check-in.
 *
 * The row lands first and the note is indexed after, deliberately: the numbers
 * are the durable record and cost one INSERT, while indexing costs an embedding
 * call that can fail or be slow. A failed index loses the note from *search*
 * only — it is still on the entry, still on the chart, still visible on the
 * page. Ordering it the other way round would mean a flaky OpenAI call could
 * cost the user the measurement itself.
 */
export async function logWellbeingEntry(params: {
  userId: string;
  input: LogWellbeingInput;
  source?: 'web' | 'telegram';
}): Promise<LoggedEntry> {
  const input = logWellbeingSchema.parse(params.input);
  const tz = await timezoneFor(params.userId);

  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  if (Number.isNaN(recordedAt.getTime())) {
    throw new Error(`Invalid recordedAt: ${input.recordedAt}`);
  }

  const note = input.note?.trim() || null;

  // Matched against what this user already says, not against a fixed list:
  // the vocabulary is theirs, and a canned one would be wrong in a different
  // way for every person using it.
  const { symptoms, changed } = canonicalizeSymptoms(
    input.symptoms,
    input.symptoms?.length ? await knownSymptoms(params.userId) : []
  );

  const [entry] = await db
    .insert(wellbeingEntries)
    .values({
      userId: params.userId,
      recordedAt,
      localDate: getLocalDateKey(recordedAt, tz),
      mood: input.mood ?? null,
      energy: input.energy ?? null,
      sleepMinutes: input.sleepHours !== undefined ? hoursToMinutes(input.sleepHours) : null,
      symptoms,
      note,
      source: params.source ?? 'web',
    })
    .returning();

  if (note) {
    try {
      const resourceId = await syncDayNote(params.userId, entry.localDate, tz);
      if (resourceId) entry.resourceId = resourceId;
    } catch (error) {
      console.error('[wellbeing] Indexing the note failed (non-fatal):', error);
    }
  }

  return { ...entry, timezone: tz, canonicalized: changed };
}

/** Raw check-ins over a local-date range, inclusive, oldest first. */
export async function listWellbeingEntries(
  userId: string,
  range: { from: string; to: string }
): Promise<WellbeingEntry[]> {
  return db
    .select()
    .from(wellbeingEntries)
    .where(
      and(
        eq(wellbeingEntries.userId, userId),
        gte(wellbeingEntries.localDate, range.from),
        lte(wellbeingEntries.localDate, range.to)
      )
    )
    .orderBy(asc(wellbeingEntries.recordedAt));
}

/** The most recent check-ins regardless of date — for "how are you doing" surfaces. */
export async function recentWellbeingEntries(
  userId: string,
  limit = 5
): Promise<WellbeingEntry[]> {
  return db
    .select()
    .from(wellbeingEntries)
    .where(eq(wellbeingEntries.userId, userId))
    .orderBy(desc(wellbeingEntries.recordedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export type WellbeingReport = {
  from: string;
  to: string;
  timezone: string;
  days: DayPoint[];
  entries: WellbeingEntry[];
  summary: RangeSummary;
  symptoms: SymptomCount[];
  sleepVsMood: SleepMoodSplit | null;
};

/**
 * Everything a chart or an answer needs for the last `days` days, in one pass.
 *
 * The range ends today in the user's zone, not the server's: at 01:00 in Kyiv
 * the server is still on yesterday, and a report that silently omits the day
 * you just logged reads as data loss.
 */
export async function getWellbeingReport(
  userId: string,
  dayCount = 30
): Promise<WellbeingReport> {
  const tz = await timezoneFor(userId);
  const span = Math.min(Math.max(Math.trunc(dayCount), 1), 365);

  const now = new Date();
  const to = getLocalDateKey(now, tz);
  const from = addLocalDays(now, tz, -(span - 1));

  const entries = await listWellbeingEntries(userId, { from, to });
  const days = buildDailySeries(entries, from, to);

  return {
    from,
    to,
    timezone: tz,
    days,
    entries,
    summary: summarizeRange(days),
    symptoms: symptomDayCounts(days),
    sleepVsMood: sleepMoodSplit(days),
  };
}

/** Removes a check-in. Scoped by user id so an id alone is not authority to delete. */
export async function deleteWellbeingEntry(userId: string, entryId: string): Promise<boolean> {
  const deleted = await db
    .delete(wellbeingEntries)
    .where(and(eq(wellbeingEntries.id, entryId), eq(wellbeingEntries.userId, userId)))
    .returning({ id: wellbeingEntries.id, localDate: wellbeingEntries.localDate });

  if (deleted.length === 0) return false;

  // The day's note is rebuilt from what is left, so a deleted check-in stops
  // being searchable instead of lingering as text with no row behind it.
  // Non-fatal: the deletion the user asked for has already happened.
  //
  // One case is deliberately left alone — a day whose *every* note-bearing
  // entry is gone keeps its note, orphaned. Rewriting it is impossible (there
  // is no content left to write) and deleting a knowledge-base row on the
  // user's behalf is a bigger risk than a stale one they can remove themselves.
  try {
    const tz = await timezoneFor(userId);
    await syncDayNote(userId, deleted[0].localDate, tz);
  } catch (error) {
    console.error('[wellbeing] Rebuilding the day note after a delete failed:', error);
  }

  return true;
}

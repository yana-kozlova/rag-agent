import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema/auth';
import {
  logWellbeingSchema,
  wellbeingEntries,
  type LogWellbeingInput,
  type WellbeingEntry,
} from '@/lib/db/schema/wellbeing';
import { createResource } from '@/lib/actions/resources';
import { formatSleep, hoursToMinutes, normalizeSymptoms } from '@/lib/wellbeing/scale';
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
import { DEFAULT_TIMEZONE, addLocalDays, getLocalDateKey, isValidTimezone } from '@/lib/push/timezone';

/** The zone the user's days are measured in. Falls back rather than throwing — a missing zone must not cost a check-in. */
async function timezoneFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return isValidTimezone(row?.timezone) ? row.timezone : DEFAULT_TIMEZONE;
}

/**
 * The searchable copy of a check-in.
 *
 * Without it the tracker is a silo: `getInformation` would have no idea the
 * user has ever mentioned a headache, and "коли востаннє боліла голова?" — the
 * most natural question to ask a second brain about your health — would come
 * back empty while the answer sat in another table.
 *
 * The user's own words lead, because that is what retrieval matches on; the
 * numbers follow as one compact line so the note still reads as a record.
 */
function resourceContent(
  entry: Pick<WellbeingEntry, 'mood' | 'energy' | 'sleepMinutes' | 'symptoms' | 'note' | 'localDate'>
): string {
  const stats: string[] = [];
  if (entry.mood !== null) stats.push(`mood ${entry.mood}/5`);
  if (entry.energy !== null) stats.push(`energy ${entry.energy}/5`);
  if (entry.sleepMinutes !== null) stats.push(`sleep ${formatSleep(entry.sleepMinutes)}`);
  if (entry.symptoms.length > 0) stats.push(entry.symptoms.join(', '));

  return [entry.note?.trim(), stats.length > 0 ? `[${entry.localDate}] ${stats.join(' · ')}` : null]
    .filter(Boolean)
    .join('\n\n');
}

export type LoggedEntry = WellbeingEntry & { timezone: string };

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

  const [entry] = await db
    .insert(wellbeingEntries)
    .values({
      userId: params.userId,
      recordedAt,
      localDate: getLocalDateKey(recordedAt, tz),
      mood: input.mood ?? null,
      energy: input.energy ?? null,
      sleepMinutes: input.sleepHours !== undefined ? hoursToMinutes(input.sleepHours) : null,
      symptoms: normalizeSymptoms(input.symptoms),
      note,
      source: params.source ?? 'web',
    })
    .returning();

  if (note) {
    try {
      const created = await createResource({
        userId: params.userId,
        title: `Check-in · ${entry.localDate}`,
        content: resourceContent(entry),
        metadata: {
          type: 'note',
          category: 'wellbeing',
          tags: ['wellbeing', 'check-in', ...entry.symptoms],
        },
      });

      if (created.success && created.id) {
        await db
          .update(wellbeingEntries)
          .set({ resourceId: created.id })
          .where(eq(wellbeingEntries.id, entry.id));

        entry.resourceId = created.id;
      }
    } catch (error) {
      console.error('[wellbeing] Indexing the note failed (non-fatal):', error);
    }
  }

  return { ...entry, timezone: tz };
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
    .returning({ id: wellbeingEntries.id });

  return deleted.length > 0;
}

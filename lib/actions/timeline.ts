import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { entities, entityAliases } from '@/lib/db/schema/entities';
import { resources } from '@/lib/db/schema/resources';
import {
  timelineEventInputSchema,
  timelineEvents,
  type TimelineEvent,
  type TimelineEventInput,
} from '@/lib/db/schema/timeline';
import { getLocalDateKey } from '@/lib/push/timezone';
import {
  UPCOMING_HORIZON_DAYS,
  formatDateSpec,
  isSameStoredDate,
  parseDateSpec,
  resolveRecurrence,
  subjectKey as toSubjectKey,
  toTimelineCandidates,
  upcomingOccurrences,
  type DatePrecision,
  type ExtractedDate,
  type Recurrence,
  type TimelineCandidate,
  type TimelineOccurrence,
} from '@/lib/timeline/timeline';
import { normalizeName } from './entity-identity';
import { timezoneFor } from './user-timezone';

/**
 * Writing and reading the timeline.
 *
 * Dates reach this module two ways and they are not equal. Extraction produces
 * them as a by-product of saving a note, so those rows belong to that note and
 * are replaced wholesale when it changes — the same contract
 * `syncEntitiesForResource` has with the graph, and for the same reason: without
 * it an edited note can only ever add, so a date corrected today leaves
 * yesterday's version on the axis beside it. Dates the user states outright
 * (through the tool or the form) belong to nobody but them and are never touched
 * by a sync.
 */

/** Nothing pages the axis, but a runaway import must not be able to render it unusable. */
const MAX_TIMELINE_ROWS = 500;

/** The user's own today, not the server's — the whole of "upcoming" turns on it. */
async function todayFor(userId: string): Promise<{ today: string; timezone: string }> {
  const timezone = await timezoneFor(userId);
  return { today: getLocalDateKey(new Date(), timezone), timezone };
}

/**
 * The graph node a date is about, when its subject names one.
 *
 * Read-only on purpose: this resolves against nodes and aliases that are already
 * there and never creates either. Entities come from `syncEntitiesForResource`,
 * which has the self-name collapsing, the type canonicalisation and the alias
 * rules; a second writer with a cheaper version of those rules is how a graph
 * ends up with two Andriys again.
 */
async function resolveEntity(userId: string, subject: string | null): Promise<string | null> {
  if (!subject) return null;

  const normalized = normalizeName(subject);
  if (!normalized) return null;

  const [alias] = await db
    .select({ entityId: entityAliases.entityId })
    .from(entityAliases)
    .where(and(eq(entityAliases.userId, userId), eq(entityAliases.normalizedAlias, normalized)))
    .limit(1);

  if (alias) return alias.entityId;

  // Most-mentioned first: if a name really did land on two nodes, the date
  // belongs on the one the user's notes are actually about.
  const [entity] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.normalizedName, normalized)))
    .orderBy(desc(entities.mentionCount))
    .limit(1);

  return entity?.id ?? null;
}

type WritableRow = TimelineCandidate & {
  userId: string;
  entityId: string | null;
  resourceId: string | null;
  source: string;
};

async function insertRows(rows: WritableRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  // Conflicts are the identity index: the same day, subject, kind and wording
  // already recorded from somewhere else. Doing nothing keeps whichever row got
  // there first, which is the one with the older evidence behind it.
  //
  // The row therefore points at one note while two may support it, and deleting
  // that note takes the date with it. A `timeline_mentions` table would fix that
  // the way `entity_mentions` does for the graph; it is not here because the
  // case needs two notes to state the same day, kind, subject *and* wording, and
  // an unused join table is its own kind of debt. Worth revisiting if a real
  // base ever produces one.
  const written = await db
    .insert(timelineEvents)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: timelineEvents.id });

  return written.length;
}

/**
 * Bring one note's dates level with what it currently says.
 *
 * `replace` drops the note's previous extraction rows first. Only its own: a
 * date the user typed themselves has `resource_id` null and a `source` that is
 * not `extraction`, and re-saving a note must never be able to delete it.
 */
export async function syncTimelineForResource(params: {
  resourceId: string;
  userId: string;
  dates: ExtractedDate[];
  replace?: boolean;
}): Promise<{ written: number }> {
  const candidates = toTimelineCandidates(params.dates ?? []);

  if (params.replace) {
    await db
      .delete(timelineEvents)
      .where(
        and(
          eq(timelineEvents.userId, params.userId),
          eq(timelineEvents.resourceId, params.resourceId),
          eq(timelineEvents.source, 'extraction'),
          // A row the user has corrected by hand is no longer this note's to
          // replace. Without this the whole of `updateTimelineEvent` is undone
          // the next time anything folds a fact into that note: the corrected
          // row is deleted and the model's original written back in its place,
          // silently, with the edit having looked like it worked for days.
          isNull(timelineEvents.editedAt)
        )
      );
  }

  if (candidates.length === 0) return { written: 0 };

  const rows: WritableRow[] = [];
  for (const candidate of candidates) {
    rows.push({
      ...candidate,
      userId: params.userId,
      entityId: await resolveEntity(params.userId, candidate.subject),
      resourceId: params.resourceId,
      source: 'extraction',
    });
  }

  return { written: await insertRows(rows) };
}

export type RecordResult =
  | { success: true; event: TimelineEvent; duplicate: boolean }
  | { success: false; message: string };

/**
 * Record one date the user stated outright.
 *
 * Returns the existing row rather than an error when the date is already there:
 * saying a birthday twice is not a mistake to report back, and the caller —
 * usually a model relaying to the user — should be able to confirm it either
 * way without deciding what "conflict" means.
 */
export async function recordTimelineEvent(params: {
  userId: string;
  input: TimelineEventInput;
  source?: 'tool' | 'manual';
  resourceId?: string | null;
}): Promise<RecordResult> {
  // Reported, not thrown. The caller is usually a model relaying to a user, and
  // an over-long subject it invented must come back as a sentence it can act on
  // rather than as an exception in the middle of the turn.
  const parsed = timelineEventInputSchema.safeParse(params.input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Invalid date.' };
  }
  const input = parsed.data;

  const spec = parseDateSpec(input.date);
  if (!spec) {
    return {
      success: false,
      message: `Unrecognised date "${input.date}". Use YYYY-MM-DD, YYYY-MM, YYYY, or --MM-DD for a day and month with no year.`,
    };
  }

  const subject = input.subject?.trim() || null;
  const row: WritableRow = {
    occurredOn: spec.occurredOn,
    precision: spec.precision,
    // A `day-month` date can only be annual; anything else is annual only if it
    // has a month and a day to come round on. A model asked to record "ми
    // одружились у 2015" will happily set recurring — and a year stored as
    // 1 January would then be announced as an anniversary on New Year's Day.
    recurrence: resolveRecurrence(spec.precision, input.recurrence === 'annual'),
    title: input.title,
    kind: input.kind?.toLowerCase() || 'other',
    note: input.note || null,
    subject,
    subjectKey: toSubjectKey(subject),
    userId: params.userId,
    entityId: await resolveEntity(params.userId, subject),
    resourceId: params.resourceId ?? null,
    source: params.source ?? 'tool',
  };

  const [inserted] = await db
    .insert(timelineEvents)
    .values(row)
    .onConflictDoNothing()
    .returning();

  if (inserted) return { success: true, event: inserted, duplicate: false };

  // Nothing was written, so the identity index rejected it. Reading the row back
  // matches that index exactly — including its `lower(btrim(title))` — because a
  // looser lookup could return a *different* event on the same day and confirm
  // the wrong date back to the user.
  const [existing] = await db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.userId, params.userId),
        eq(timelineEvents.occurredOn, row.occurredOn),
        eq(timelineEvents.kind, row.kind),
        eq(timelineEvents.subjectKey, row.subjectKey),
        sql`lower(btrim(${timelineEvents.title})) = lower(btrim(${row.title}))`
      )
    )
    .limit(1);

  return existing
    ? { success: true, event: existing, duplicate: true }
    : { success: false, message: 'Could not save the date.' };
}

/** `%` and `_` are wildcards in LIKE and literal characters in a title. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Every date this user has, newest first. */
export async function listTimelineEvents(
  userId: string,
  limit = MAX_TIMELINE_ROWS
): Promise<TimelineEvent[]> {
  return db
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.userId, userId))
    .orderBy(desc(timelineEvents.occurredOn), asc(timelineEvents.title))
    .limit(Math.min(Math.max(limit, 1), MAX_TIMELINE_ROWS));
}

/**
 * The axis, narrowed.
 *
 * `from`/`to` are calendar dates and are compared as such — a year on its own is
 * widened to the whole of it by the caller, because "що було у 2022" means the
 * year and not the first of January.
 *
 * `subject` matches the folded name, so "андрій" finds "Андрій"; `search` is a
 * plain substring over the title and note. Neither is semantic on purpose: the
 * question this answers is "when", and anything vaguer than that is what
 * `getInformation` is for.
 */
export async function queryTimelineEvents(
  userId: string,
  filters: { from?: string; to?: string; subject?: string; search?: string } = {},
  limit = 50
): Promise<TimelineEvent[]> {
  const where: (SQL | undefined)[] = [eq(timelineEvents.userId, userId)];

  if (filters.from) where.push(gte(timelineEvents.occurredOn, filters.from));
  if (filters.to) where.push(lte(timelineEvents.occurredOn, filters.to));
  if (filters.subject) where.push(eq(timelineEvents.subjectKey, toSubjectKey(filters.subject)));
  if (filters.search) {
    // Escaped for the same reason `listEntities` escapes: `%` and `_` are
    // wildcards to LIKE and ordinary characters in a title. A search for "50%"
    // otherwise matches "50" followed by anything at all.
    const pattern = `%${escapeLike(filters.search.trim())}%`;
    where.push(or(ilike(timelineEvents.title, pattern), ilike(timelineEvents.note, pattern)));
  }

  return db
    .select()
    .from(timelineEvents)
    .where(and(...where))
    .orderBy(desc(timelineEvents.occurredOn))
    .limit(Math.min(Math.max(limit, 1), MAX_TIMELINE_ROWS));
}

/**
 * What is coming, soonest first.
 *
 * The candidate set is narrowed in SQL to annual dates plus anything not yet
 * past — projecting every date a user has ever recorded, in Node, to discard all
 * but a fortnight of them, is work that grows with the length of their life.
 */
export async function upcomingTimeline(
  userId: string,
  horizonDays = UPCOMING_HORIZON_DAYS
): Promise<{ today: string; timezone: string; occurrences: TimelineOccurrence<TimelineEvent>[] }> {
  const { today, timezone } = await todayFor(userId);

  const candidates = await db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.userId, userId),
        or(eq(timelineEvents.recurrence, 'annual'), gte(timelineEvents.occurredOn, today))
      )
    )
    .orderBy(asc(timelineEvents.occurredOn))
    .limit(MAX_TIMELINE_ROWS);

  return {
    today,
    timezone,
    occurrences: upcomingOccurrences(
      candidates.map((row) => ({
        ...row,
        precision: row.precision as DatePrecision,
        recurrence: row.recurrence as Recurrence,
      })),
      today,
      horizonDays
    ),
  };
}

export type TimelineView = {
  today: string;
  timezone: string;
  events: TimelineEvent[];
  upcoming: TimelineOccurrence<TimelineEvent>[];
  /** Titles of the notes the dates came from, for the "why do you know this" link. */
  sources: Record<string, { id: string; title: string | null }>;
};

/** Everything the timeline page needs, in one pass. */
export async function getTimelineView(
  userId: string,
  horizonDays = UPCOMING_HORIZON_DAYS
): Promise<TimelineView> {
  const { today, timezone } = await todayFor(userId);
  const events = await listTimelineEvents(userId);

  const upcoming = upcomingOccurrences(
    events.map((row) => ({
      ...row,
      precision: row.precision as DatePrecision,
      recurrence: row.recurrence as Recurrence,
    })),
    today,
    horizonDays
  );

  const resourceIds = [...new Set(events.map((e) => e.resourceId).filter((id): id is string => !!id))];

  const sources: TimelineView['sources'] = {};
  if (resourceIds.length > 0) {
    const rows = await db
      .select({ id: resources.id, title: resources.title })
      .from(resources)
      .where(inArray(resources.id, resourceIds));

    for (const row of rows) sources[row.id] = row;
  }

  return { today, timezone, events, upcoming, sources };
}

export type UpdateResult =
  | { success: true; event: TimelineEvent }
  | { success: false; message: string };

/** Postgres' unique violation, which here is only ever the identity index. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/**
 * Correct a date that is already on the axis.
 *
 * The gap this fills is narrow and was awkward: until now the only repair for a
 * wrong date was to delete the row and type it again, which throws away the link
 * back to the note that is the evidence for it — so the honest correction cost
 * the provenance, and keeping the provenance meant living with the wrong day.
 * Most rows here were written by a model reading prose, so they are wrong in the
 * ordinary way models are wrong: the right day off by one, the subject's name
 * left in the title, a birthday filed under the day the note was written.
 *
 * Two things make the correction stick, and neither is enough alone. The row is
 * stamped `editedAt`, which is what exempts it from the wholesale replace in
 * `syncTimelineForResource`. And the note's own `metadata.dates` is restated to
 * match, because that list is what the sync rebuilds *from*: leave it saying
 * 31 August and the next re-save inserts the model's original as a second row
 * beside the corrected one, the identity index having no reason to call them the
 * same event.
 *
 * Not a tool, on the same reasoning that keeps deletion out of the model's hands
 * — quietly rewriting the day something happened is a change nobody reviews.
 */
export async function updateTimelineEvent(params: {
  userId: string;
  eventId: string;
  input: TimelineEventInput;
}): Promise<UpdateResult> {
  const parsed = timelineEventInputSchema.safeParse(params.input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Invalid date.' };
  }
  const input = parsed.data;

  const spec = parseDateSpec(input.date);
  if (!spec) {
    return {
      success: false,
      message: `Unrecognised date "${input.date}". Use YYYY-MM-DD, YYYY-MM, YYYY, or --MM-DD for a day and month with no year.`,
    };
  }

  // Read first: the previous date and title are how the matching entry is found
  // in the note, and after the update they are gone.
  const [existing] = await db
    .select()
    .from(timelineEvents)
    .where(and(eq(timelineEvents.id, params.eventId), eq(timelineEvents.userId, params.userId)))
    .limit(1);

  if (!existing) return { success: false, message: 'That date is not here any more.' };

  const subject = input.subject?.trim() || null;
  const now = new Date();

  let updated: TimelineEvent | undefined;
  try {
    [updated] = await db
      .update(timelineEvents)
      .set({
        occurredOn: spec.occurredOn,
        precision: spec.precision,
        recurrence: resolveRecurrence(spec.precision, input.recurrence === 'annual'),
        title: input.title,
        kind: input.kind?.toLowerCase() || 'other',
        // Absent means cleared, not unchanged: the form shows every field, so
        // an empty one is the user saying to empty it.
        note: input.note || null,
        subject,
        subjectKey: toSubjectKey(subject),
        // Re-resolved rather than kept, because the subject may be the thing
        // being corrected — a date filed against the wrong person is exactly
        // the mistake this exists for.
        entityId: await resolveEntity(params.userId, subject),
        editedAt: now,
        updatedAt: now,
      })
      .where(and(eq(timelineEvents.id, params.eventId), eq(timelineEvents.userId, params.userId)))
      .returning();
  } catch (error) {
    // Edited onto the same day, kind, subject and wording as another row. The
    // insert path can answer this with `onConflictDoNothing` and hand back the
    // row that was already there; an update cannot, because the user is looking
    // at a row that must either change or say why it did not.
    if (isUniqueViolation(error)) {
      return {
        success: false,
        message: 'That is already on the timeline as another date. Delete one of the two instead.',
      };
    }
    throw error;
  }

  if (!updated) return { success: false, message: 'That date is not here any more.' };

  if (updated.resourceId) {
    try {
      await rewriteDateOnResource(params.userId, updated.resourceId, existing, {
        date: formatDateSpec(updated.occurredOn, spec.precision),
        title: updated.title,
        kind: updated.kind,
        subject: updated.subject,
        note: updated.note,
        recurring: updated.recurrence === 'annual',
      });
    } catch (error) {
      console.error('[timeline] Restating the date in its note failed (non-fatal):', error);
    }
  }

  return { success: true, event: updated };
}

/** Removes a date. Scoped by user id, so an id alone is not authority to delete. */
export async function deleteTimelineEvent(userId: string, eventId: string): Promise<boolean> {
  const [deleted] = await db
    .delete(timelineEvents)
    .where(and(eq(timelineEvents.id, eventId), eq(timelineEvents.userId, userId)))
    .returning();

  if (!deleted) return false;

  // Take it out of the note as well, or the deletion does not survive.
  //
  // The row is a projection of `metadata.dates`, and anything that re-syncs the
  // note — editing it in the Knowledge Base, folding a new fact into it —
  // rebuilds the row from that list. Without this, a date the user deliberately
  // removed comes back the next time they fix a typo, which reads as the delete
  // button not working.
  if (deleted.resourceId) {
    try {
      await rewriteDateOnResource(userId, deleted.resourceId, deleted, null);
    } catch (error) {
      console.error('[timeline] Removing the date from its note failed (non-fatal):', error);
    }
  }

  return true;
}

/**
 * Restates or drops one date in a note's own record of them.
 *
 * One function for both because deleting a row and correcting one are the same
 * operation against `metadata.dates` — find the entry this row came from, then
 * either replace it or leave it out. Two functions would be two answers to
 * "which entry is this row", and the interesting half is the matching.
 *
 * Matched by re-parsing each stored spec rather than by string equality: the
 * note may hold `1985` where the row holds `1985-01-01`, and the two are the
 * same date said at different precisions.
 *
 * Nothing is written when no entry matches, `next` or not. The list has already
 * drifted from the row at that point, and appending a date the note's own prose
 * may not support to fix a projection would be editing the evidence to match the
 * conclusion. The corrected row survives on its `editedAt` regardless; the worst
 * case is the stale date reappearing as a visible second row, which is the
 * direction this codebase fails in everywhere else.
 */
async function rewriteDateOnResource(
  userId: string,
  resourceId: string,
  previous: { occurredOn: string; title: string },
  next: ExtractedDate | null
): Promise<void> {
  const [note] = await db
    .select({ metadata: resources.metadata })
    .from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.userId, userId)))
    .limit(1);

  const meta = (note?.metadata ?? null) as Record<string, unknown> | null;
  if (!meta || !Array.isArray(meta.dates)) return;

  let matched = false;
  const dates: ExtractedDate[] = [];

  for (const entry of meta.dates as ExtractedDate[]) {
    if (!isSameStoredDate(entry, previous)) {
      dates.push(entry);
      continue;
    }
    matched = true;
    if (next) dates.push(next);
  }

  if (!matched) return;

  await db
    .update(resources)
    .set({ metadata: { ...meta, dates } as any })
    .where(eq(resources.id, resourceId));
}

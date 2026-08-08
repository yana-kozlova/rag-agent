import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';

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
  isSameStoredDate,
  parseDateSpec,
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
          eq(timelineEvents.source, 'extraction')
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
    recurrence:
      spec.precision === 'day-month' ? 'annual' : ((input.recurrence ?? 'none') as Recurrence),
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
    const pattern = `%${filters.search.trim()}%`;
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
      await forgetDateOnResource(userId, deleted.resourceId, deleted);
    } catch (error) {
      console.error('[timeline] Removing the date from its note failed (non-fatal):', error);
    }
  }

  return true;
}

/**
 * Drops one date from a note's own record of them.
 *
 * Matched by re-parsing each stored spec rather than by string equality: the
 * note may hold `1985` where the row holds `1985-01-01`, and the two are the
 * same date said at different precisions.
 */
async function forgetDateOnResource(
  userId: string,
  resourceId: string,
  removed: TimelineEvent
): Promise<void> {
  const [note] = await db
    .select({ metadata: resources.metadata })
    .from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.userId, userId)))
    .limit(1);

  const meta = (note?.metadata ?? null) as Record<string, unknown> | null;
  if (!meta || !Array.isArray(meta.dates)) return;

  const kept = (meta.dates as ExtractedDate[]).filter(
    (entry) =>
      !isSameStoredDate(entry, { occurredOn: removed.occurredOn, title: removed.title })
  );

  if (kept.length === (meta.dates as unknown[]).length) return;

  await db
    .update(resources)
    .set({ metadata: { ...meta, dates: kept } as any })
    .where(eq(resources.id, resourceId));
}

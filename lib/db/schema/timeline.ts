import { date, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { nanoid } from '@/lib/utils';
import {
  DATE_PRECISIONS,
  MAX_TIMELINE_NOTE,
  MAX_TIMELINE_TITLE,
  RECURRENCES,
} from '@/lib/timeline/timeline';
import { entities } from './entities';
import { users } from './auth';
import { resources } from './resources';

/**
 * The dates a life is measured by, on one axis.
 *
 * The knowledge base could already hold "Артем народився 12 березня 2019" — as
 * prose, embedded, findable by asking. What it could not do is put it in order.
 * Nothing answered "what happened in 2022?", nothing knew a birthday was in
 * three days, and a note about a move sat in the same undifferentiated pile as a
 * preference about oat milk. Prose cannot be sorted by when, for the same reason
 * `wellbeing_entries` exists: no amount of embedding turns a paragraph into an
 * axis.
 *
 * So a date is stored twice, like a check-in is. The note keeps its wording and
 * stays searchable; this row keeps the day, and is what the timeline, the
 * upcoming widget and the briefing read. `metadata.dates` on the resource is the
 * note's own record of what extraction found — this table is the projection of
 * all of them into one ordered series, exactly as `entities` is the projection
 * of every note's `metadata.entities` into one graph.
 */
export const timelineEvents = pgTable(
  'timeline_events',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Always a real calendar date, even when only part of it is known — see
     * `precision`. Kept as a `date` and read as a string: this is a day on a
     * calendar, not an instant, and giving it a timezone is how a birthday ends
     * up rendering as the day before.
     */
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),

    /** Which components of `occurredOn` the note actually said. */
    precision: text('precision').notNull().default('day'),

    /** Whether it comes round again. `day-month` dates are always annual. */
    recurrence: text('recurrence').notNull().default('none'),

    /** The label on the axis — "Артем народився", "переїзд до Львова". */
    title: text('title').notNull(),

    /** Free-form, see `TIMELINE_KINDS`. Only the glyph and the grouping read it. */
    kind: text('kind').notNull().default('other'),

    /** One sentence of detail, when the note carried one worth keeping. */
    note: text('note'),

    /** Whose date it is, as written: "Андрій", "Артем". Null for dates about no one. */
    subject: text('subject'),

    /**
     * `subject` folded for matching, `''` when there is none. Not nullable
     * because it is part of the identity index and Postgres treats NULLs as
     * distinct — two undated-subject moves on the same day would both insert.
     */
    subjectKey: text('subject_key').notNull().default(''),

    /**
     * The graph node this date is about, when the subject resolves to one. Set
     * null rather than cascade: losing the person from the graph is not a reason
     * to forget when their child was born.
     */
    entityId: varchar('entity_id', { length: 191 }).references(() => entities.id, {
      onDelete: 'set null',
    }),

    /**
     * The note this was read out of. Cascades: the note is the evidence, and a
     * dated claim whose source the user deleted has nothing behind it. Null for
     * dates added by hand or through the tool, which is what keeps those alive
     * regardless of what happens in the knowledge base.
     */
    resourceId: varchar('resource_id', { length: 191 }).references(() => resources.id, {
      onDelete: 'cascade',
    }),

    /**
     * `extraction` | `tool` | `manual` | `backfill`. On the `assistant_directives`
     * precedent: all four are treated identically, but someone puzzled by a date
     * they never typed needs to see that a model read it off a note.
     */
    source: text('source').notNull().default('extraction'),

    /**
     * When the user last corrected this row by hand, and null until they have.
     *
     * Two jobs, which is why it is a timestamp on the row rather than a badge in
     * the UI. It is what the chip on the axis reads — a date somebody has since
     * fixed is not the model's reading any more, and `source` cannot say so
     * because it records where the date *came from*, which has not changed.
     *
     * And it is what makes the correction survive. An `extraction` row is a
     * projection of the note's `metadata.dates`, replaced wholesale by
     * `syncTimelineForResource` every time the note is re-saved; without this
     * column the sync deletes the corrected row and writes the model's original
     * back, so a fixed date silently reverts the next time the user folds a fact
     * into that note. Exactly `entities.relationship_source`, one step smaller:
     * there the sync updates a surviving row, here it deletes and rebuilds, so
     * what the flag has to buy is exemption from the delete.
     */
    editedAt: timestamp('edited_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // ⚠️ `timeline_events_identity_unique` — the index every `onConflictDoNothing`
    // in `lib/actions/timeline.ts` relies on — is NOT declared here. It is an
    // expression index (`lower(btrim(title))`) that Drizzle cannot express, so it
    // lives only in migration 0022. `drizzle-kit push` compares this file against
    // the database and drops what it does not find: pushing would silently remove
    // it, and dedupe would stop working with nothing raising. Use `db:generate` +
    // `db:migrate` on this table, never `db:push`.

    // Every read is "this user, in date order" — the axis, the upcoming list and
    // the briefing all want exactly that.
    userDateIdx: index('timeline_user_date_idx').on(table.userId, table.occurredOn),
    resourceIdx: index('timeline_resource_idx').on(table.resourceId),
    entityIdx: index('timeline_entity_idx').on(table.entityId),
  })
);

/**
 * What a caller may record. The date arrives as written — `2019-03-12`,
 * `2022-06`, `1985`, `--03-14` — and `parseDateSpec` decides what was meant;
 * asking a model to fill in `precision` separately invites it to claim a day it
 * was never given.
 */
export const timelineEventInputSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TIMELINE_TITLE),
  date: z.string().trim().min(4).max(10),
  kind: z.string().trim().max(40).optional(),
  note: z.string().trim().max(MAX_TIMELINE_NOTE).optional(),
  subject: z.string().trim().max(120).optional(),
  recurrence: z.enum(RECURRENCES).optional(),
});

export type TimelineEventInput = z.infer<typeof timelineEventInputSchema>;
export type TimelineEvent = typeof timelineEvents.$inferSelect;

/** Guards for values read back out of a column that is plain `text`. */
export const timelinePrecisionSchema = z.enum(DATE_PRECISIONS);
export const timelineRecurrenceSchema = z.enum(RECURRENCES);

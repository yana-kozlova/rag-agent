import { date, index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { nanoid } from '@/lib/utils';
import {
  MAX_RECURRENCE_INTERVAL,
  MAX_TASK_AREA,
  MAX_TASK_NOTE,
  MAX_TASK_TITLE,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_STATUSES,
} from '@/lib/tasks/tasks';
import { users } from './auth';
import { resources } from './resources';

/**
 * The things that have to be done.
 *
 * The knowledge base could already hold "треба купити форму до 31.08" as
 * searchable prose, and `metadata.needs` has been extracting exactly this shape
 * from every note for months with nothing reading it. What prose could not do is
 * be *closed* — nothing knew which of those were still outstanding, nothing
 * sorted them by when they stop being possible, and the extraction rules had to
 * refuse deadlines outright to keep them off the timeline, where they would have
 * made the axis a worse to-do list.
 *
 * Two dates, and the whole design turns on their being separate. See the module
 * comment in `lib/tasks/tasks.ts`.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    note: text('note'),

    /** `open` | `done` | `dropped`. Part of the identity index's predicate. */
    status: text('status').notNull().default('open'),

    /**
     * The last acceptable day. Never written to Google Calendar: a deadline is
     * not an appointment, and putting it there claims a day the user has not
     * agreed to spend.
     */
    dueOn: date('due_on', { mode: 'string' }),

    /**
     * The day the user committed to doing it — which is what creates the
     * calendar event. A task can be scheduled well before its deadline, or have
     * a deadline and no plan yet, or be planned with no deadline at all.
     */
    scheduledFor: date('scheduled_for', { mode: 'string' }),

    /**
     * When a time was named as well as a day. `text` rather than `timestamp`
     * because these carry a real UTC offset and a timestamp column would drop
     * it — the same reasoning that makes `scheduleEvent` reject `Z`.
     */
    scheduledStart: text('scheduled_start'),
    scheduledEnd: text('scheduled_end'),

    /**
     * The calendar event standing for `scheduledFor`, so rescheduling can patch
     * it rather than leave a second copy. Nothing reconciles the other
     * direction: an event edited or deleted in Google does not come back here,
     * and `unscheduleTask` tolerates an id that no longer resolves.
     */
    googleEventId: text('google_event_id'),
    googleCalendarId: text('google_calendar_id'),

    /** `high` | `medium` | `low`, or nothing. The extractor already assigns these. */
    priority: text('priority'),

    /** A grouping label — "дім", "робота", "Артем". Free-form by design. */
    area: text('area'),

    recurrence: text('recurrence').notNull().default('none'),
    recurrenceInterval: integer('recurrence_interval').notNull().default(1),

    completedAt: timestamp('completed_at'),

    /**
     * The note this was read out of, when it came from one. Cascades, because
     * the note is the evidence — same contract `timeline_events` has. A task the
     * user typed has none, which is what keeps it alive regardless of what
     * happens in the knowledge base.
     */
    resourceId: varchar('resource_id', { length: 191 }).references(() => resources.id, {
      onDelete: 'cascade',
    }),

    /** `user` | `extraction` | `telegram`. Read identically; shown for provenance. */
    source: text('source').notNull().default('user'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // ⚠️ `tasks_open_identity_unique` — the index `createTask`'s
    // `onConflictDoNothing` relies on — is NOT declared here. It is both an
    // expression index (`lower(btrim(title))`) and a partial one (`WHERE status
    // = 'open'`), and drizzle can express neither, so it lives only in migration
    // 0027. `drizzle-kit push` compares this file against the database and drops
    // what it does not find: pushing would silently remove it, and the model
    // would start creating a second "купити форму" beside the first with nothing
    // raising. Use `db:generate` + `db:migrate` on this table, never `db:push`.

    // Every read is "this user's open tasks, soonest first".
    userStatusIdx: index('tasks_user_status_idx').on(table.userId, table.status),
    userDueIdx: index('tasks_user_due_idx').on(table.userId, table.dueOn),
    userScheduledIdx: index('tasks_user_scheduled_idx').on(table.userId, table.scheduledFor),
    resourceIdx: index('tasks_resource_idx').on(table.resourceId),
  })
);

/**
 * One closing of one occurrence.
 *
 * A recurring task is a single row that rolls its due date forward, so without
 * this the past would not exist: "чи приймала я вітаміни цього тижня" has no
 * answer from a row that only knows when it is next due. Writing a line per
 * completion buys that history without materialising future occurrences, which
 * would need a generator, a horizon and a cleanup.
 */
export const taskCompletions = pgTable(
  'task_completions',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 191 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),

    /** The user's local day, denormalised for grouping — `wellbeing` precedent. */
    completedOn: date('completed_on', { mode: 'string' }).notNull(),

    /** Which occurrence this closed. Null for a task that never had a deadline. */
    dueOn: date('due_on', { mode: 'string' }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // ⚠️ `task_completions_once_per_day` lives only in migration 0027.
    taskIdx: index('task_completions_task_idx').on(table.taskId),
    userDayIdx: index('task_completions_user_day_idx').on(table.userId, table.completedOn),
  })
);

/**
 * Needs already dealt with, so the same one is not proposed twice.
 *
 * The mirror of `entity_exclusions`: suggestions themselves have no rows — they
 * are computed from every note's `metadata.needs` minus this table — because a
 * suggestion is a reading of a note, and materialising readings means keeping
 * them in step with notes that get edited. Accepting and dismissing both write
 * here, since both mean "this one is handled" and only the settings-style
 * question of *why* differs.
 */
export const taskSuggestions = pgTable(
  'task_suggestions',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resourceId: varchar('resource_id', { length: 191 })
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),

    /** `needKey` of the need text. See `lib/tasks/tasks.ts`. */
    needKey: text('need_key').notNull(),

    /** `accepted` | `dismissed`. */
    reason: text('reason').notNull(),

    /** The task an acceptance created, when it created one. */
    taskId: varchar('task_id', { length: 191 }).references(() => tasks.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // ⚠️ `task_suggestions_identity_unique` lives only in migration 0027.
    userResourceIdx: index('task_suggestions_user_resource_idx').on(
      table.userId,
      table.resourceId
    ),
  })
);

/** A calendar day as stored — the format every date column here uses. */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/**
 * An offset-bearing RFC-3339 instant.
 *
 * `Z` and `+00:00` are refused for the reason `scheduleEvent` refuses them: a
 * model handed a local time will happily label it UTC, and an event three hours
 * out is not visibly wrong to anyone reading the reply. Build these with
 * `localDateTimeToIso`, which cannot produce one.
 */
const offsetInstant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/,
    'expected an RFC-3339 time with a real UTC offset'
  )
  .refine((v) => !v.endsWith('+00:00'), 'offset must be the user\'s zone, not UTC');

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TASK_TITLE),
  note: z.string().trim().max(MAX_TASK_NOTE).optional(),
  dueOn: dateKey.optional(),
  scheduledFor: dateKey.optional(),
  scheduledStart: offsetInstant.optional(),
  scheduledEnd: offsetInstant.optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  area: z.string().trim().max(MAX_TASK_AREA).optional(),
  recurrence: z.enum(TASK_RECURRENCES).optional(),
  recurrenceInterval: z.number().int().min(1).max(MAX_RECURRENCE_INTERVAL).optional(),
});

/**
 * What an edit may touch — everything except the scheduling fields.
 *
 * Narrowed on purpose rather than by convention. `taskInputSchema.partial()`
 * would also admit `scheduledFor`, and writing that through an edit sets the day
 * of work without creating the calendar event that is supposed to *be* it: the
 * row then claims a day Google has never heard of. Scheduling has one door,
 * `scheduleTask`, and this is what keeps it the only one.
 */
export const taskPatchSchema = taskInputSchema
  .pick({
    title: true,
    note: true,
    dueOn: true,
    priority: true,
    area: true,
    recurrence: true,
    recurrenceInterval: true,
  })
  .partial();

export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskPatch = z.infer<typeof taskPatchSchema>;
export type Task = typeof tasks.$inferSelect;
export type TaskCompletion = typeof taskCompletions.$inferSelect;

/** Guards for values read back out of columns that are plain `text`. */
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const taskRecurrenceSchema = z.enum(TASK_RECURRENCES);

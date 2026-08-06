import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { jsonb } from '../jsonb';
import { WELLBEING_SCALE_MAX, WELLBEING_SCALE_MIN } from '@/lib/wellbeing/scale';
import { nanoid } from '@/lib/utils';
import { users } from './auth';
import { resources } from './resources';

/**
 * How the user felt, as numbers.
 *
 * Everything else the assistant stores is prose that gets embedded and searched.
 * That answers "коли востаннє боліла голова?" and cannot answer "чи стало краще
 * цього місяця?" — you cannot average a paragraph. So state is kept twice: the
 * scales here, where a chart can read them, and the user's own words in
 * `resources` (linked by `resourceId`), where retrieval can.
 *
 * Every check-in is a new row. The day is a series, not a cell: "зранку добре,
 * після обіду розболілась голова" is two facts, and updating one row in place
 * would keep only the second and lose when the change happened — which is the
 * part worth charting. Aggregation into one point per day happens at read time
 * (`lib/wellbeing/aggregate.ts`), where the choice of mean-vs-last is visible
 * and reversible.
 */
export const wellbeingEntries = pgTable(
  'wellbeing_entries',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** When the state *was*, not when it was typed. "вчора спала 5 годин" backdates. */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * `recordedAt` rendered as YYYY-MM-DD in the user's own zone, denormalised.
     * Charts group by local day, and deriving that from a UTC instant in SQL
     * means re-applying the zone on every read — including for entries made
     * before a DST shift, where the offset today is not the offset then.
     */
    localDate: text('local_date').notNull(),

    /** 1–5, worst to best. Null when the check-in did not mention it. */
    mood: integer('mood'),
    energy: integer('energy'),

    /**
     * Minutes, not hours: an integer that is exactly what was said. Floats would
     * turn "7 год 20 хв" into 7.333333 and back out again as something else.
     */
    sleepMinutes: integer('sleep_minutes'),

    /** Normalised lowercase labels — "головний біль", "нудота". Never null, possibly empty. */
    symptoms: jsonb('symptoms').$type<string[]>().notNull().default([] as any),

    /** What the user actually wrote, verbatim. */
    note: text('note'),

    /**
     * The searchable copy of `note` in the knowledge base. Nullable on purpose:
     * embedding it is a separate, failable step, and a check-in whose numbers
     * were saved but whose note never got indexed is still a check-in.
     */
    resourceId: varchar('resource_id', { length: 191 }).references(() => resources.id, {
      onDelete: 'set null',
    }),

    /** Which surface it came in through — `web` | `telegram`. */
    source: text('source').notNull().default('web'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    // Every read is "this user, this date range, in order" — one index covers it.
    userDateIdx: index('wellbeing_user_date_idx').on(table.userId, table.localDate),
    userRecordedIdx: index('wellbeing_user_recorded_idx').on(table.userId, table.recordedAt),
  })
);

const scale = z
  .number()
  .int()
  .min(WELLBEING_SCALE_MIN)
  .max(WELLBEING_SCALE_MAX);

/**
 * What a caller may log. Sleep arrives in hours because that is how people say
 * it; the column stores minutes.
 *
 * A check-in with nothing in it is rejected — the model, asked to be helpful,
 * will otherwise log an empty row for "привіт".
 */
export const logWellbeingSchema = z
  .object({
    mood: scale.optional(),
    energy: scale.optional(),
    sleepHours: z.number().min(0).max(24).optional(),
    symptoms: z.array(z.string().min(1)).max(12).optional(),
    note: z.string().max(2000).optional(),
    /** ISO instant. Defaults to now; set it when logging a past state. */
    recordedAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (v) =>
      v.mood !== undefined ||
      v.energy !== undefined ||
      v.sleepHours !== undefined ||
      (v.symptoms?.length ?? 0) > 0 ||
      (v.note?.trim().length ?? 0) > 0,
    { message: 'A check-in needs at least one of: mood, energy, sleepHours, symptoms, note.' }
  );

export type LogWellbeingInput = z.infer<typeof logWellbeingSchema>;
export type WellbeingEntry = typeof wellbeingEntries.$inferSelect;

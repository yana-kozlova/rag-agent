import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { jsonb } from '../jsonb';
import { MAX_LABEL_LENGTH } from '@/lib/quick-actions/quick-actions';
import { nanoid } from '@/lib/utils';
import { users } from './auth';
import { userTables } from './user-tables';

/**
 * A button that writes one table row, with no model in the loop.
 *
 * Everything else that writes a row reads a sentence first. That is right for
 * a fact stated once and wrong for a thing done daily: recording "Арчі прийняв
 * ліки" cost a chat completion and several seconds to store six characters
 * that never vary. Here the varying part is the only part anyone is asked for,
 * and pressing the button spends one INSERT and one embedding call.
 *
 * The template lives in a row rather than in the table's `settings` because it
 * is not a property of the table: two people's medication, a child's
 * temperature and a bill paid can all be buttons over the same log, and one of
 * them is deleted next week while the table stays. It also needs its own cap —
 * `MAX_QUICK_ACTIONS` is what keeps a screen of buttons pressable at a glance,
 * and a cap cannot be enforced over a JSON blob on someone else's row.
 */
export const quickActions = pgTable(
  'quick_actions',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Cascades. A button onto a deleted table has nowhere to write, and a
     * dead button that reports a failure on every press is worse than a
     * missing one — the table is the thing that was deleted, and this went
     * with it.
     */
    tableId: varchar('table_id', { length: 191 })
      .notNull()
      .references(() => userTables.id, { onDelete: 'cascade' }),

    /** The button's face: "Арчі — ліки". Unique per user, see below. */
    label: text('label').notNull(),

    /** One emoji, so the right button is found without reading. Optional. */
    icon: text('icon'),

    /** Array of QuickField — which column gets a literal, a date, or a question. */
    fields: jsonb('fields').notNull(),

    /**
     * When it was last pressed, and how often.
     *
     * `lastUsedAt` answers the question a person actually has in front of a
     * daily button — *did I already do this today?* — which is why it is read
     * back onto the button rather than kept for analytics. `useCount` is the
     * cheap half of the same record and is what tells a stale button from a
     * live one when the list needs pruning.
     */
    lastUsedAt: timestamp('last_used_at'),
    useCount: integer('use_count').notNull().default(0),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // ⚠️ `quick_actions_user_label_idx` — the unique index on
    // `(user_id, lower(btrim(label)))` — is NOT declared here. It is an
    // expression index Drizzle cannot express, so it lives only in migration
    // 0026. `drizzle-kit push` compares this file against the database and
    // drops what it does not find: pushing would silently remove it, and two
    // things would break with nothing raising. The assistant could create a
    // second "Арчі — ліки" indistinguishable from the first, and — worse,
    // because it fails silently and far from here — `findQuickActionByLabel`
    // would stop being a lookup and start being a coin toss, since a Telegram
    // reply is matched back to its button by the label quoted in the prompt.
    // Use `db:generate` + `db:migrate` on this table, never `db:push`.
    // Same hazard, same wording as `timeline_events_identity_unique`.

    // The only read there is: every button for one user, in creation order.
    // Creation order rather than most-recently-used, deliberately: a button
    // pressed every morning should be in the same place every morning, and a
    // list that reshuffles itself under a thumb is how the wrong row gets
    // written.
    userIdx: index('quick_actions_user_idx').on(table.userId, table.createdAt),
    tableIdx: index('quick_actions_table_idx').on(table.tableId),
    lengthCheck: check(
      'quick_actions_label_len',
      sql`char_length(${table.label}) between 1 and ${sql.raw(String(MAX_LABEL_LENGTH))}`
    ),
  })
);

export const quickFieldSchema = z.object({
  columnId: z.string().min(1),
  kind: z.enum(['fixed', 'today', 'now', 'ask']),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  prompt: z.string().max(60).optional(),
});

export const createQuickActionSchema = z.object({
  tableId: z.string().min(1),
  label: z.string().trim().min(1).max(MAX_LABEL_LENGTH),
  icon: z.string().trim().max(8).nullable().optional(),
  fields: z.array(quickFieldSchema).min(1),
});

export type QuickActionRow = typeof quickActions.$inferSelect;
export type CreateQuickActionInput = z.infer<typeof createQuickActionSchema>;

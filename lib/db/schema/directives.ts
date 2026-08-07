import { check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { MAX_DIRECTIVE_LENGTH } from '@/lib/directives/directives';
import { nanoid } from '@/lib/utils';
import { users } from './auth';

/**
 * How the user wants to be talked to, as rules the model reads every turn.
 *
 * Preferences were already storable — `addResource` classifies them as
 * `type: 'preference'` and embeds them — but a resource only exists when
 * `getInformation` goes looking, and it does not go looking before answering
 * "what's on tomorrow?". So "write shorter" sat in the knowledge base being
 * findable and never once applied. These are not retrieved; they are prepended.
 *
 * That is also why this is a table and not a resource with a flag on it. A note
 * is prose that gets embedded and searched, and a wrong one is inert until
 * something matches it. A directive is a short rule that runs on every request
 * across both surfaces, and a wrong one quietly degrades every answer — so it
 * needs to be listable, bounded and deletable by hand, which is a different
 * life cycle than "one row among thousands".
 */
export const assistantDirectives = pgTable(
  'assistant_directives',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** The rule itself, in the user's own words. "Answer in Ukrainian", "skip the preamble". */
    text: text('text').notNull(),

    /**
     * `user` — they asked for it in as many words. `inferred` — the model read
     * it off a correction they made twice.
     *
     * Stored because the two deserve different trust: an inferred rule is the
     * model's reading of a habit, and the settings screen marks it as such so a
     * misread can be spotted as *not something you said* rather than puzzled
     * over. Nothing about the prompt distinguishes them; both are followed.
     */
    source: text('source').notNull().default('user'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // The only read there is: every directive for one user, oldest first.
    userIdx: index('assistant_directives_user_idx').on(table.userId, table.createdAt),
    // Enforced here as well as in zod, on the wellbeing precedent: the cap is
    // what keeps this a rule list rather than a second system prompt, and a
    // future caller that skips the zod schema must not be able to widen it.
    lengthCheck: check(
      'assistant_directives_text_len',
      sql`char_length(${table.text}) between 1 and ${sql.raw(String(MAX_DIRECTIVE_LENGTH))}`
    ),
  })
);

export const directiveSourceSchema = z.enum(['user', 'inferred']);

export const rememberDirectiveSchema = z.object({
  text: z.string().trim().min(1).max(MAX_DIRECTIVE_LENGTH),
  source: directiveSourceSchema.default('user'),
});

export type AssistantDirective = typeof assistantDirectives.$inferSelect;
export type RememberDirectiveInput = z.infer<typeof rememberDirectiveSchema>;

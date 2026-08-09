import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar, unique } from 'drizzle-orm/pg-core';
import { nanoid } from '@/lib/utils';
import { users } from './auth';
import { resources } from './resources';

/**
 * The graph layer over the knowledge base.
 *
 * Extraction already finds the people, projects and organisations in a note,
 * but until now each one lived inside that note's metadata blob. Three notes
 * mentioning Marta therefore held three unrelated strings, and nothing could
 * answer "what do I know about Marta?" — the base was a pile of documents with
 * no nodes.
 *
 * `entities` are those nodes; `entity_mentions` is the edge back to the note
 * that is the evidence for it. Resources stay the documents; entities become
 * the things the documents are about.
 */

export const entities = pgTable(
  'entities',
  {
    id: varchar('id', { length: 191 }).primaryKey().$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** As last written by the model — this is what gets displayed. */
    name: text('name').notNull(),
    /**
     * Lowercased and whitespace-collapsed, purely for matching. "Марта",
     * "марта" and "Марта " must resolve to one node rather than three.
     */
    normalizedName: text('normalized_name').notNull(),
    type: text('type').notNull(),
    /** How they relate to *the user* — "colleague", "sister", "hobby". */
    relationship: text('relationship'),
    /**
     * Whose word `relationship` is: `model` if extraction wrote it, `user` if
     * the account holder did.
     *
     * Needed for the same reason `entity_aliases` is. This column is a
     * projection — `syncEntitiesForResource` rewrites it from every note that
     * mentions the node — so an edit that only touched the value would hold
     * until the next mention and then quietly revert, which is worse than no
     * edit at all because nobody watches a relationship change back.
     *
     * Unlike a name, though, the row itself survives a sync (the upsert
     * updates, it never deletes), so one flag on the row is enough and no
     * second table is needed. `user` means the sync leaves the value alone,
     * including when the user's answer was "nothing" — the model reading a
     * relationship off a sentence about somebody else is precisely the failure
     * being overruled, and it will read the same sentence the same way again.
     */
    relationshipSource: text('relationship_source').notNull().default('model'),
    /** Free-form details the model attached; shape varies by entity type. */
    attributes: jsonb('attributes'),
    /**
     * Denormalised count of mentions. Kept because the entity list sorts by it
     * on every render, and a join-and-count there is pure waste.
     */
    mentionCount: integer('mention_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // One node per name+type per person. Two different Martas would collide
    // here, which is the right trade: merging is recoverable, and a graph that
    // silently splits the same person is not.
    identity: unique('entities_identity_unique').on(table.userId, table.normalizedName, table.type),
    userIdx: index('entities_user_idx').on(table.userId),
    typeIdx: index('entities_type_idx').on(table.userId, table.type),
  })
);

export const entityMentions = pgTable(
  'entity_mentions',
  {
    entityId: varchar('entity_id', { length: 191 })
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    resourceId: varchar('resource_id', { length: 191 })
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    /** The sentence or fact that produced this mention, for showing "why". */
    context: text('context'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.entityId, table.resourceId] }),
    resourceIdx: index('entity_mentions_resource_idx').on(table.resourceId),
  })
);

/**
 * Names that were decided to mean an entity already in the graph.
 *
 * Merging two nodes is not enough on its own: identity is
 * `(user_id, normalized_name, type)`, so the next note writing "Яна" would
 * upsert a fresh node and the merge would have to be repeated forever. An
 * alias is what makes one decision permanent — `syncEntitiesForResource`
 * consults it before creating anything, so a spelling that was once resolved
 * by hand keeps resolving by itself.
 *
 * Unique on the same triple as `entities.identity`, so an alias can never
 * point two ways at once, and a name cannot be both a node and an alias.
 */
export const entityAliases = pgTable(
  'entity_aliases',
  {
    id: varchar('id', { length: 191 }).primaryKey().$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityId: varchar('entity_id', { length: 191 })
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    /** The spelling being redirected, normalised the same way names are. */
    normalizedAlias: text('normalized_alias').notNull(),
    type: text('type').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    identity: unique('entity_aliases_identity_unique').on(
      table.userId,
      table.normalizedAlias,
      table.type
    ),
    entityIdx: index('entity_aliases_entity_idx').on(table.entityId),
  })
);

/**
 * Names the user has decided are not nodes at all.
 *
 * The mirror image of `entity_aliases`, and it exists for the same reason.
 * `entities` is a projection of every note's `metadata.entities`, rebuilt by
 * `syncEntitiesForResource` — so deleting a row is exactly as durable as
 * editing `entities.name` was, which is to say it lasts until the next note
 * mentions the name and then silently comes back. An alias says "this spelling
 * means that node"; an exclusion says "this spelling means nothing", and both
 * are consulted before the upsert that would otherwise overrule them.
 *
 * Keyed on the same triple as `entities.identity`, so an exclusion is scoped to
 * one name *of one type*: deciding that the project called Sequoia is not worth
 * a node says nothing about the place.
 *
 * Nothing here cascades from `entities` — the row outlives the node it buried,
 * which is the entire point. It is deleted only by restoring, or by the user
 * going away.
 */
export const entityExclusions = pgTable(
  'entity_exclusions',
  {
    id: varchar('id', { length: 191 }).primaryKey().$defaultFn(() => nanoid()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** As it was displayed when deleted, purely so the list of hidden names is readable. */
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    type: text('type').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    identity: unique('entity_exclusions_identity_unique').on(
      table.userId,
      table.normalizedName,
      table.type
    ),
    userIdx: index('entity_exclusions_user_idx').on(table.userId),
  })
);

export type Entity = typeof entities.$inferSelect;
export type EntityMention = typeof entityMentions.$inferSelect;
export type EntityAlias = typeof entityAliases.$inferSelect;
export type EntityExclusion = typeof entityExclusions.$inferSelect;

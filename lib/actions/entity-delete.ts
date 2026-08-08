'use server';

import { and, desc, eq, sql as raw } from 'drizzle-orm';
import { db } from '@/lib/db';
import { entities, entityAliases, entityExclusions, resources } from '@/lib/db/schema';
import { getSessionOrNull } from '@/lib/utils/auth';
import {
  escapeLike,
  identityKey,
  syncEntitiesForResource,
  toGraphCandidates,
  type ExtractedEntity,
} from './entities';

/**
 * Taking a node out of the graph, and putting it back.
 *
 * Merging repairs a node that split; renaming repairs one the model misspelled.
 * Neither can answer the third thing the graph gets wrong, which is making a
 * node out of something that was never a subject — a greeting read as a person,
 * a stray noun read as a place, a one-off the extractor was liberal about on
 * purpose. There is nothing to merge those into and no name that would make
 * them worth keeping. The only correction is "this is not a thing".
 *
 * Deleting the row alone would not survive, for exactly the reason renaming a
 * column would not: `entities` is a projection of every note's
 * `metadata.entities`, so the next note mentioning the name upserts it straight
 * back — and it returns with a mention count of one while twenty notes still
 * talk about it, which reads as data loss rather than as a delete that failed.
 * So a delete writes `entity_exclusions` rows, which `syncEntitiesForResource`
 * consults before it creates anything. Same mechanism as an alias, opposite
 * meaning.
 *
 * Nothing the user wrote is touched. The notes keep their words and their
 * `metadata.entities`, retrieval still finds them, and `timeline_events` keeps
 * its dates because `entity_id` sets null rather than cascading. That is what
 * makes restoring possible at all: the evidence is still there, so lifting the
 * tombstone can rebuild the node from the notes it came from — and it is why
 * this is the one entity operation here that is not a one-way door.
 */

export type DeleteResult = {
  success: boolean;
  message: string;
};

export type RestoreResult = {
  success: boolean;
  message: string;
  /** Where the rebuilt node lives, when the notes still supported one. */
  entityId?: string;
};

/**
 * How many notes one restore will re-read.
 *
 * A restore replays `syncEntitiesForResource` over the notes that mention the
 * name, and a two-letter name matches a lot of prose. The cap keeps one click
 * from turning into a thousand queries; a node mentioned in more notes than
 * this comes back the rest of the way as those notes are next saved.
 */
const MAX_REBUILD = 100;

export async function deleteEntity(entityId: string): Promise<DeleteResult> {
  const session = await getSessionOrNull();
  const userId = session?.user?.id;
  if (!userId) return { success: false, message: 'Unauthorized. Please sign in.' };

  // Ownership is checked by looking in *this user's* rows, so a crafted id
  // cannot reach into another account's graph.
  const [entity] = await db
    .select({
      id: entities.id,
      name: entities.name,
      normalizedName: entities.normalizedName,
      type: entities.type,
    })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.id, entityId)))
    .limit(1);

  if (!entity) return { success: false, message: 'Entity not found or access denied.' };

  // Every spelling that resolved here has to be buried too. These rows cascade
  // away with the node, so reading them after the delete would find nothing —
  // and leaving them unburied means deleting a node that absorbed three
  // spellings suppresses one of them and lets the other two rebuild it under a
  // new id, which is the same node back wearing a different name.
  const aliases = await db
    .select({ normalizedAlias: entityAliases.normalizedAlias, type: entityAliases.type })
    .from(entityAliases)
    .where(and(eq(entityAliases.userId, userId), eq(entityAliases.entityId, entity.id)));

  try {
    await db.transaction(async (tx) => {
      const buried = [
        { name: entity.name, normalizedName: entity.normalizedName, type: entity.type },
        ...aliases.map((a) => ({
          // An alias only ever stored the matching key, so that is also the
          // best name available to show in the hidden list.
          name: a.normalizedAlias,
          normalizedName: a.normalizedAlias,
          type: a.type,
        })),
      ];

      for (const row of buried) {
        await tx.insert(entityExclusions).values({ userId, ...row }).onConflictDoNothing();
      }

      // Mentions and aliases go with it by cascade; timeline events keep their
      // dates and lose only the link.
      await tx.delete(entities).where(eq(entities.id, entity.id));
    });

    return { success: true, message: `Deleted "${entity.name}".` };
  } catch (error) {
    console.error('[deleteEntity] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Could not delete this entity.',
    };
  }
}

/**
 * Lifting a tombstone, and rebuilding what it hid.
 *
 * Dropping the exclusion row on its own would leave the user waiting for a node
 * that only reappears the next time they happen to save a note naming it —
 * a restore that visibly does nothing. The notes are still the evidence, so the
 * node is rebuilt from them: the same sync that would have created it runs
 * again over the notes whose `metadata.entities` still carry the name.
 */
export async function restoreEntity(exclusionId: string): Promise<RestoreResult> {
  const session = await getSessionOrNull();
  const userId = session?.user?.id;
  if (!userId) return { success: false, message: 'Unauthorized. Please sign in.' };

  const [exclusion] = await db
    .select({
      id: entityExclusions.id,
      name: entityExclusions.name,
      normalizedName: entityExclusions.normalizedName,
      type: entityExclusions.type,
    })
    .from(entityExclusions)
    .where(and(eq(entityExclusions.userId, userId), eq(entityExclusions.id, exclusionId)))
    .limit(1);

  if (!exclusion) return { success: false, message: 'Nothing hidden under that name.' };

  // Lifted first and unconditionally. The rebuild below is best-effort — it can
  // find nothing, or fail — and none of that is a reason to leave the name
  // buried, because a user who asked for it back and got a silent no-op has no
  // second way to ask.
  await db.delete(entityExclusions).where(eq(entityExclusions.id, exclusion.id));

  try {
    const rebuilt = await rebuildFromNotes(userId, exclusion.normalizedName, exclusion.type);

    if (rebuilt === 0) {
      return {
        success: true,
        message: `"${exclusion.name}" is no longer hidden. No note mentions it now, so it will appear again when one does.`,
      };
    }

    const [entity] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.userId, userId),
          eq(entities.normalizedName, exclusion.normalizedName),
          eq(entities.type, exclusion.type)
        )
      )
      .limit(1);

    return {
      success: true,
      message: `Restored "${exclusion.name}" from ${rebuilt} ${rebuilt === 1 ? 'note' : 'notes'}.`,
      entityId: entity?.id,
    };
  } catch (error) {
    console.error('[restoreEntity] rebuild failed:', error);
    return {
      success: true,
      message: `"${exclusion.name}" is no longer hidden, but rebuilding it from your notes failed. It will come back as those notes are next saved.`,
    };
  }
}

/**
 * Re-link the notes that still name this identity.
 *
 * The candidate notes are narrowed in SQL by a substring of the *whole*
 * entities blob, which is a superset filter and nothing more — the same string
 * can appear as another entity's name or inside a relationship. `toGraphCandidates`
 * then decides properly, on the same normalisation and type-folding rules the
 * node was created under, so the SQL only has to be cheap and generous.
 */
async function rebuildFromNotes(
  userId: string,
  normalizedName: string,
  type: string
): Promise<number> {
  const wanted = identityKey({ normalizedName, type });
  const pattern = `%${escapeLike(normalizedName)}%`;

  const rows = await db
    .select({ id: resources.id, metadata: resources.metadata })
    .from(resources)
    .where(
      and(
        eq(resources.userId, userId),
        raw`lower((${resources.metadata} -> 'entities')::text) like ${pattern}`
      )
    )
    .orderBy(desc(resources.createdAt))
    .limit(MAX_REBUILD);

  let rebuilt = 0;

  for (const row of rows) {
    const extracted = (row.metadata as { entities?: ExtractedEntity[] } | null)?.entities;
    if (!Array.isArray(extracted) || extracted.length === 0) continue;

    if (!toGraphCandidates(extracted).some((c) => identityKey(c) === wanted)) continue;

    // `replace: false` — this note's other entities are not being re-decided
    // here, only re-asserted, and every write in the sync is an upsert or a
    // conflict-do-nothing.
    await syncEntitiesForResource({
      resourceId: row.id,
      userId,
      entities: extracted,
      replace: false,
    });

    rebuilt += 1;
  }

  return rebuilt;
}

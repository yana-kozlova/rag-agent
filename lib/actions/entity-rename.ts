'use server';

import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { entities, entityAliases } from '@/lib/db/schema';
import { getSessionOrNull } from '@/lib/utils/auth';
import { clearExclusions } from './entities';
import { planRename } from './entity-identity';

/**
 * Giving a node the name the user would have given it.
 *
 * `entities.name` is "as last written by the model", and `syncEntitiesForResource`
 * rewrites it on every note that mentions the node. So an edit that only touched
 * the column would survive until the next mention and then silently revert —
 * worse than having no edit at all, because nobody watches a name change back.
 *
 * What makes it permanent is the same mechanism a merge uses: an `entity_aliases`
 * row is consulted *before* the upsert, and a resolved alias skips it entirely.
 * A rename therefore writes two aliases — the old spelling, so notes still using
 * it land here instead of recreating the node they were split from, and the new
 * one, so nothing rewrites the name the user just chose.
 */

export type EntityRef = { id: string; name: string; type: string; mentionCount: number };

export type RenameResult = {
  success: boolean;
  message: string;
  /**
   * Set when the requested name is already taken. Renaming into an occupied
   * identity is not a rename, it is the merge the user probably meant — so the
   * node they collided with is handed back rather than an error they can only
   * read.
   */
  mergeInto?: EntityRef;
};

export async function renameEntity(entityId: string, requestedName: string): Promise<RenameResult> {
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

  const plan = planRename(entity, requestedName);
  if (plan.kind === 'invalid') return { success: false, message: plan.message };
  if (plan.kind === 'unchanged') return { success: true, message: 'Name unchanged.' };

  // Only a rename moves the row to a new identity; a respell already owns the
  // one it is asking for and cannot collide with anything.
  if (plan.kind === 'rename') {
    const taken = await occupant(userId, plan.normalizedName, entity.type, entity.id);
    if (taken) {
      return {
        success: false,
        message: `"${taken.name}" already exists.`,
        mergeInto: taken,
      };
    }
  }

  try {
    await db.transaction(async (tx) => {
      // Both spellings point here afterwards. `onConflictDoNothing` rather than
      // an upsert: an alias that already resolves elsewhere belongs to a
      // decision made earlier, and hijacking it would undo that merge.
      const spellings = [...new Set([entity.normalizedName, plan.normalizedName])];

      for (const normalizedAlias of spellings) {
        await tx
          .insert(entityAliases)
          .values({ userId, entityId: entity.id, normalizedAlias, type: entity.type })
          .onConflictDoNothing();
      }

      // Both spellings now mean this node, so a tombstone left on either from an
      // earlier delete has been overruled — and one still standing would keep
      // the name in the hidden list while the node it named is on screen.
      await clearExclusions(
        tx,
        userId,
        spellings.map((normalizedName) => ({ normalizedName, type: entity.type }))
      );

      await tx
        .update(entities)
        .set({ name: plan.name, normalizedName: plan.normalizedName, updatedAt: new Date() })
        .where(eq(entities.id, entity.id));
    });

    return { success: true, message: `Renamed to "${plan.name}".` };
  } catch (error) {
    console.error('[renameEntity] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Could not rename this entity.',
    };
  }
}

/**
 * Whoever already answers to this name and type — as a node, or as a spelling
 * some earlier merge redirected. Both are collisions: the unique index rejects
 * the first, and the second would leave the new name resolving to a different
 * node than the one wearing it.
 */
async function occupant(
  userId: string,
  normalizedName: string,
  type: string,
  self: string
): Promise<EntityRef | null> {
  const [node] = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      mentionCount: entities.mentionCount,
    })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.normalizedName, normalizedName),
        eq(entities.type, type),
        ne(entities.id, self)
      )
    )
    .limit(1);

  if (node) return node;

  const [aliased] = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      mentionCount: entities.mentionCount,
    })
    .from(entityAliases)
    .innerJoin(entities, eq(entities.id, entityAliases.entityId))
    .where(
      and(
        eq(entityAliases.userId, userId),
        eq(entityAliases.normalizedAlias, normalizedName),
        eq(entityAliases.type, type),
        ne(entityAliases.entityId, self)
      )
    )
    .limit(1);

  return aliased ?? null;
}

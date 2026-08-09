'use server';

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { entities } from '@/lib/db/schema';
import { MAX_RELATIONSHIP_LENGTH, normalizeRelationship } from '@/lib/entities/relationship';
import { getSessionOrNull } from '@/lib/utils/auth';

/**
 * Saying who someone actually is to you.
 *
 * `entities.relationship` means "how this node relates to *the user*", and
 * extraction fills it from whatever relation the sentence happened to state.
 * A note saying a child is somebody's godson is a true sentence about that
 * somebody, and it lands here as the user's godson — the one word on the entity
 * page that is not evidence but a claim, printed beside the name as fact.
 *
 * Merging, renaming and deleting already cover the three ways a node's
 * *identity* goes wrong. This is the fourth thing that goes wrong and the only
 * one of the four that leaves the node correct: right person, right type, right
 * notes, wrong relation. Nothing could correct it, so a mislabelled relation was
 * permanent — and it is the graph's one editorial line, printed beside the name
 * on the entity page, in the entity list, on the people widget and in the note
 * view, in every case as a statement of fact rather than as evidence.
 *
 * Like the other three, this is a decision rather than an edit. `relationship`
 * is rewritten from every note that mentions the node, so setting the column
 * alone would revert at the next mention; `relationship_source` is what
 * `syncEntitiesForResource` consults before it writes, exactly as it consults
 * `entity_aliases` before it writes a name.
 */

export type RelationshipResult = {
  success: boolean;
  message: string;
};

export async function setRelationship(
  entityId: string,
  requested: string
): Promise<RelationshipResult> {
  const session = await getSessionOrNull();
  const userId = session?.user?.id;
  if (!userId) return { success: false, message: 'Unauthorized. Please sign in.' };

  const relationship = normalizeRelationship(requested);

  if (relationship && relationship.length > MAX_RELATIONSHIP_LENGTH) {
    return {
      success: false,
      message: `Keep it under ${MAX_RELATIONSHIP_LENGTH} characters — anything longer is a fact, and belongs in a note.`,
    };
  }

  try {
    // Ownership is enforced in the `where`, so a crafted id cannot reach into
    // another account's graph — same shape as the rename and delete actions.
    const [updated] = await db
      .update(entities)
      .set({ relationship, relationshipSource: 'user', updatedAt: new Date() })
      .where(and(eq(entities.userId, userId), eq(entities.id, entityId)))
      .returning({ id: entities.id });

    if (!updated) return { success: false, message: 'Entity not found or access denied.' };

    return {
      success: true,
      message: relationship ? `Saved “${relationship}”.` : 'Cleared.',
    };
  } catch (error) {
    console.error('[setRelationship] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Could not save this relationship.',
    };
  }
}

/**
 * Hand the field back to extraction.
 *
 * The undo for the action above, and the reason it can exist at all is that
 * nothing was destroyed: the notes still say what they said, so the next one
 * that mentions this node fills the relationship in again. The current wording
 * is deliberately left standing until that happens — clearing it here would
 * make "let it decide again" read as "delete what I wrote", and the sync never
 * overwrites a known relationship with nothing anyway.
 */
export async function resetRelationship(entityId: string): Promise<RelationshipResult> {
  const session = await getSessionOrNull();
  const userId = session?.user?.id;
  if (!userId) return { success: false, message: 'Unauthorized. Please sign in.' };

  try {
    const [updated] = await db
      .update(entities)
      .set({ relationshipSource: 'model', updatedAt: new Date() })
      .where(and(eq(entities.userId, userId), eq(entities.id, entityId)))
      .returning({ id: entities.id });

    if (!updated) return { success: false, message: 'Entity not found or access denied.' };

    return { success: true, message: 'Your notes will fill this in again.' };
  } catch (error) {
    console.error('[resetRelationship] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Could not reset this relationship.',
    };
  }
}

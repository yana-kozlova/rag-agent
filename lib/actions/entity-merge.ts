'use server';

import { and, eq, inArray, sql as raw } from 'drizzle-orm';
import { db } from '@/lib/db';
import { entities, entityAliases, entityMentions } from '@/lib/db/schema';
import { getSessionOrNull } from '@/lib/utils/auth';
import { clearExclusions } from './entities';
import { matchNames, type MatchReason } from './entity-identity';

/**
 * Putting a split node back together.
 *
 * The schema always preferred collision to division — see the comment on
 * `entities.identity` — but until now there was no way to act when the graph
 * split anyway. Suggestions are found by cheap string rules and never applied
 * automatically: only the user knows whether two Andriys are one person, and a
 * wrong merge is not one click to undo.
 */

export type MergeCandidate = {
  reason: MatchReason;
  /** Proposed to survive: the better-attested and more specific of the two. */
  winner: { id: string; name: string; type: string; mentionCount: number };
  loser: { id: string; name: string; type: string; mentionCount: number };
};

type Row = { id: string; name: string; type: string; mentionCount: number };

/**
 * Which of two nodes should survive.
 *
 * More mentions first, because that node is the one already woven into the
 * graph. On a tie the longer name wins: "Yana Kozlova" carries more than
 * "Yana", and the shorter spelling survives as an alias regardless.
 */
function pickWinner(a: Row, b: Row): [Row, Row] {
  if (a.mentionCount !== b.mentionCount) {
    return a.mentionCount > b.mentionCount ? [a, b] : [b, a];
  }
  return a.name.length >= b.name.length ? [a, b] : [b, a];
}

type Related = { relationship: string | null; relationshipSource: string };

/**
 * Which of two relationships the merged node keeps.
 *
 * The winner's own value wins, as everything else here does — except against a
 * relationship the user set by hand, which wins from either side. Which of two
 * duplicates survives is decided by mention count, a detail the user never sees
 * and never chose; if they have told this graph who somebody is, that answer
 * cannot depend on which of the two rows the model happened to write more notes
 * about. Keyed on the source rather than on the value, so a deliberately
 * emptied relationship also survives — it is an answer too.
 *
 * Two hand-set values is the one genuinely ambiguous case, and there the winner
 * takes it: the merge dialog names the survivor, so that is the answer the user
 * is looking at while they confirm.
 */
export function pickRelationship(winner: Related, loser: Related): Related {
  if (winner.relationshipSource === loser.relationshipSource) {
    return {
      relationship: winner.relationship ?? loser.relationship,
      relationshipSource: winner.relationshipSource,
    };
  }

  // Rebuilt rather than returned whole: the callers pass their full entity rows
  // in, and this result is spread straight into an `update ... set`.
  const chosen = winner.relationshipSource === 'user' ? winner : loser;
  return { relationship: chosen.relationship, relationshipSource: chosen.relationshipSource };
}

export async function findMergeCandidates(userId: string): Promise<MergeCandidate[]> {
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      mentionCount: entities.mentionCount,
    })
    .from(entities)
    .where(eq(entities.userId, userId));

  // Compared within a type only: a person and a project sharing a name are not
  // the same thing, and the identity index already treats them separately.
  const byType = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = byType.get(row.type) ?? [];
    bucket.push(row);
    byType.set(row.type, bucket);
  }

  const candidates: MergeCandidate[] = [];

  for (const bucket of byType.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const reason = matchNames(bucket[i]!.name, bucket[j]!.name);
        if (!reason) continue;

        const [winner, loser] = pickWinner(bucket[i]!, bucket[j]!);
        candidates.push({ reason, winner, loser });
      }
    }
  }

  // Same-spelling pairs should not exist at all (the unique index forbids
  // them), so if one appears it is the most urgent thing to show.
  const order: Record<MatchReason, number> = {
    'same-spelling': 0,
    'same-sound': 1,
    contained: 2,
  };

  return candidates.sort((a, b) => order[a.reason] - order[b.reason]);
}

export async function mergeEntities(winnerId: string, loserId: string) {
  const session = await getSessionOrNull();
  const userId = session?.user?.id;
  if (!userId) return { success: false, message: 'Unauthorized. Please sign in.' };

  if (winnerId === loserId) {
    return { success: false, message: 'Cannot merge an entity into itself.' };
  }

  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      normalizedName: entities.normalizedName,
      type: entities.type,
      relationship: entities.relationship,
      relationshipSource: entities.relationshipSource,
      attributes: entities.attributes,
    })
    .from(entities)
    .where(and(eq(entities.userId, userId), inArray(entities.id, [winnerId, loserId])));

  const winner = rows.find((r) => r.id === winnerId);
  const loser = rows.find((r) => r.id === loserId);

  // Ownership is checked by finding both in *this user's* rows, so a crafted
  // id cannot reach into another account's graph.
  if (!winner || !loser) {
    return { success: false, message: 'Entity not found or access denied.' };
  }

  // Types are allowed to differ, and nothing below depends on them matching:
  // the winner's type survives, and the alias keeps the *loser's*, so a note
  // that types the name that way again still lands here. Suggestions are still
  // made within a type — an identical name under two types is usually two
  // different things — but the model assigns types unstably enough that one
  // project filed once as `project` and once as `organization` is the ordinary
  // reason to reach for a manual merge, and the user can see both on screen.
  try {
    await db.transaction(async (tx) => {
      // Repoint first. `entity_mentions.entity_id` cascades on delete, so
      // dropping the loser before this would take its edges with it — the one
      // ordering mistake here that silently loses data.
      await tx.execute(raw`
        insert into ${entityMentions} (entity_id, resource_id, context, created_at)
        select ${winnerId}, ${entityMentions.resourceId}, ${entityMentions.context}, ${entityMentions.createdAt}
        from ${entityMentions}
        where ${entityMentions.entityId} = ${loserId}
        on conflict do nothing
      `);

      // Aliases already pointing at the loser have to follow it, for the same
      // reason and with the same cascade waiting to eat them.
      await tx
        .update(entityAliases)
        .set({ entityId: winnerId })
        .where(eq(entityAliases.entityId, loserId));

      // The decision itself, made permanent: the loser's spelling now resolves
      // to the winner, so the next note writing it does not recreate the node.
      await tx
        .insert(entityAliases)
        .values({
          userId,
          entityId: winnerId,
          normalizedAlias: loser.normalizedName,
          type: loser.type,
        })
        .onConflictDoNothing();

      // Both names now mean this node, so neither can still be buried. A user
      // who deletes a duplicate and later merges something into its spelling
      // would otherwise leave a tombstone standing over a live node.
      await clearExclusions(tx, userId, [
        { normalizedName: loser.normalizedName, type: loser.type },
        { normalizedName: winner.normalizedName, type: winner.type },
      ]);

      await tx
        .update(entities)
        .set({
          // Winner's own values win; the loser only fills in blanks.
          attributes: {
            ...((loser.attributes as Record<string, unknown>) ?? {}),
            ...((winner.attributes as Record<string, unknown>) ?? {}),
          } as any,
          ...pickRelationship(winner, loser),
          updatedAt: new Date(),
        })
        .where(eq(entities.id, winnerId));

      await tx.delete(entities).where(eq(entities.id, loserId));

      await tx
        .update(entities)
        .set({
          mentionCount: raw`(select count(*) from ${entityMentions} where ${entityMentions.entityId} = ${winnerId})`,
        })
        .where(eq(entities.id, winnerId));
    });

    return {
      success: true,
      message: `Merged "${loser.name}" into "${winner.name}".`,
      entityId: winnerId,
    };
  } catch (error) {
    console.error('[mergeEntities] failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Could not merge these entities.',
    };
  }
}

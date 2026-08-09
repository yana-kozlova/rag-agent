import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { entities } from '@/lib/db/schema';
import { matchNames, type MatchReason } from '@/lib/actions/entity-identity';

/**
 * Which pairs of nodes look like one node said twice.
 *
 * Here rather than beside `mergeEntities` because this only reads, and reading
 * is what made its old home wrong: `lib/actions/entity-merge.ts` is
 * `'use server'`, so every export of it is a reachable endpoint, and this one
 * took the user whose graph to search as a *parameter*. That is an endpoint
 * that hands anyone who can reach it the names of the people in someone else's
 * base. The action next door needs the session because it writes; this needs
 * the id because `app/entities/page.tsx` has already resolved it — and a plain
 * module is the difference between "a function the server component calls" and
 * "a URL".
 *
 * Suggestions are found by cheap string rules and never applied automatically:
 * only the user knows whether two Andriys are one person, and a wrong merge is
 * not one click to undo.
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

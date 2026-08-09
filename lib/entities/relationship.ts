/**
 * What may stand in an entity's `relationship`, and which of two survives a merge.
 *
 * Here rather than beside the column because the editor on `/entities/[id]` is
 * a client component, and importing from the schema would drag drizzle and
 * every table definition into the browser — same reason as
 * `lib/wellbeing/scale.ts` and `lib/directives/directives.ts`. It is also where
 * the merge rule has to live: `lib/actions/entity-merge.ts` is `'use server'`,
 * and every export of such a module must be an async function, so a pure rule
 * cannot sit beside the action that applies it however much it belongs there.
 */

/**
 * A relationship is a phrase, not a paragraph: it is printed inline beside the
 * name on the entity page, in the note view and on the people widget, and
 * anything longer than this is a fact and belongs in the note that says it.
 */
export const MAX_RELATIONSHIP_LENGTH = 80;

/**
 * A relationship as it will be stored: one phrase, or nothing.
 *
 * Empty is an answer rather than a missing one. "They are not anything in
 * particular to me" is exactly the correction a relationship read off a
 * sentence about somebody else needs, so this returns null and lets the caller
 * record that null as the user's word — the alternative, treating blank as
 * "no opinion", hands the field straight back to the reading being overruled.
 */
export function normalizeRelationship(value: string): string | null {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Enough of an entity row to decide the question below. */
export type Related = { relationship: string | null; relationshipSource: string };

/**
 * Which of two relationships the merged node keeps.
 *
 * The winner's own value wins, as everything else in a merge does — except
 * against a relationship the user set by hand, which wins from either side.
 * Which of two duplicates survives is decided by mention count, a detail the
 * user never sees and never chose; if they have told this graph who somebody
 * is, that answer cannot depend on which of the two rows the model happened to
 * write more notes about. Keyed on the source rather than on the value, so a
 * deliberately emptied relationship also survives — it is an answer too.
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

  // Rebuilt rather than returned whole: the caller passes its full entity rows
  // in, and this result is spread straight into an `update ... set`.
  const chosen = winner.relationshipSource === 'user' ? winner : loser;
  return { relationship: chosen.relationship, relationshipSource: chosen.relationshipSource };
}

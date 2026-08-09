/**
 * What may stand in an entity's `relationship`.
 *
 * Here rather than beside the column because the editor on `/entities/[id]` is
 * a client component, and importing from the schema would drag drizzle and
 * every table definition into the browser — same reason as
 * `lib/wellbeing/scale.ts` and `lib/directives/directives.ts`.
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

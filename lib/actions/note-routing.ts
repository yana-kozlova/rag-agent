import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { entities, entityMentions, resources } from '@/lib/db/schema';
import { normalizeName } from './entity-identity';
import type { GraphCandidate } from './entities';

/**
 * Which existing note a new fact belongs to.
 *
 * Notes are dossiers, not transcripts: writing about Андрій twice should thicken
 * one note about him rather than scatter him across the base. Saving used to be
 * an unconditional insert, so a single message once produced two notes about the
 * same person 900ms apart, and the graph split her identity three ways behind it.
 *
 * Everything here is deterministic. The alternative — asking an embedding
 * whether two texts are "the same" — needs a threshold thin enough to separate
 * "Андрій is my husband" from "Андрій was born in 1985", which are two different
 * facts about one person and sit very close together. Routing by *subject*
 * instead of by *sameness* removes that razor entirely.
 */

/**
 * Longer than this and it is an import, not a fact.
 *
 * A pasted document mentions many people in passing; folding it into someone's
 * dossier would bury the dossier. Length is a blunt signal, but it is the one
 * that distinguishes "Андрій got a new job" from a wall of text he appears in.
 */
const MAX_ROUTABLE_LENGTH = 600;

export type Dossier = {
  id: string;
  title: string | null;
  content: string;
  metadata: unknown;
};

/**
 * The note to append to, or null to create a new one.
 *
 * Null is the safe answer and the default: a new note costs a duplicate at
 * worst, while appending to the wrong note edits something the user did not ask
 * to be touched.
 */
export async function findDossier(params: {
  userId: string;
  candidates: GraphCandidate[];
  contentLength: number;
}): Promise<Dossier | null> {
  const { userId, candidates, contentLength } = params;

  // Two subjects means the note is about a situation, not a person. Only a
  // single-subject fact has an unambiguous dossier to belong to.
  if (candidates.length !== 1) return null;
  if (contentLength > MAX_ROUTABLE_LENGTH) return null;

  const subject = candidates[0]!;

  const [entity] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.normalizedName, subject.normalizedName),
        eq(entities.type, subject.type)
      )
    )
    .limit(1);

  if (!entity) return null;

  const mentioned = await db
    .select({ resourceId: entityMentions.resourceId })
    .from(entityMentions)
    .where(eq(entityMentions.entityId, entity.id));

  if (mentioned.length === 0) return null;

  const ids = mentioned.map((m) => m.resourceId);

  // How many entities each of those notes talks about. A note about only this
  // person is their dossier; a note where they are one name among six is a
  // record of something else they happened to be in.
  const counts = await db
    .select({
      resourceId: entityMentions.resourceId,
      subjects: count(entityMentions.entityId),
    })
    .from(entityMentions)
    .where(inArray(entityMentions.resourceId, ids))
    .groupBy(entityMentions.resourceId);

  const soleSubject = new Set(
    counts.filter((c) => Number(c.subjects) === 1).map((c) => c.resourceId)
  );

  if (soleSubject.size === 0) return null;

  const [dossier] = await db
    .select({
      id: resources.id,
      title: resources.title,
      content: resources.content,
      metadata: resources.metadata,
    })
    .from(resources)
    .where(
      and(
        eq(resources.userId, userId),
        inArray(resources.id, [...soleSubject])
      )
    )
    // Most recently touched: if several notes are only about this person, the
    // live one is where the last fact went.
    .orderBy(desc(resources.updatedAt))
    .limit(1);

  return dossier ?? null;
}

/** Title for a merged dossier: keep the one already there. */
export function dossierTitle(existing: string | null, incoming: string | undefined): string | null {
  return existing?.trim() || incoming?.trim() || null;
}

/** Exported for tests: the same normalisation the graph keys on. */
export const normalizeSubject = normalizeName;

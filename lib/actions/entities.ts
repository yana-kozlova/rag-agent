import { and, desc, eq, ilike, inArray, notInArray, or, sql as raw } from 'drizzle-orm';
import { db } from '@/lib/db';
import { entities, entityAliases, entityExclusions, entityMentions, resources } from '@/lib/db/schema';
import { users } from '@/lib/db/schema/auth';
import { isUsableName, normalizeName, resolveSelfName } from './entity-identity';

/**
 * Turning the entities a note mentions into nodes of a graph.
 *
 * Extraction produces them per note; this is what makes them shared. Marta
 * named in three notes becomes one row pointed at three times, which is the
 * whole difference between a pile of documents and a knowledge base.
 */

export type ExtractedEntity = {
  name?: string;
  type?: string;
  relationship?: string | null;
  /**
   * Key/value pairs as extraction produces them, or an already-flattened
   * object from an older note. Both are accepted; both are stored flattened.
   */
  attributes?: Array<{ key: string; value: string }> | Record<string, unknown> | null;
  context?: string | null;
};

/** Pairs are how the model returns attributes; an object is how we store them. */
function flattenAttributes(
  attributes: ExtractedEntity['attributes']
): Record<string, unknown> | null {
  if (!attributes) return null;

  if (Array.isArray(attributes)) {
    const flat: Record<string, string> = {};
    for (const pair of attributes) {
      if (pair?.key) flat[pair.key] = pair.value ?? '';
    }
    return Object.keys(flat).length > 0 ? flat : null;
  }

  return Object.keys(attributes).length > 0 ? attributes : null;
}

/** Matching key: case and stray whitespace must not fork a node. */
const normalize = normalizeName;

/**
 * Which kinds of thing deserve to be nodes.
 *
 * Extraction is deliberately liberal — constraining it to a fixed taxonomy is
 * what used to make whole extractions fail — so it returns everything it sees.
 * On one cake recipe that was fifteen ingredients: butter, rum, sprinkles.
 * Each is a true statement and none is worth a page of its own, and together
 * they buried the two actual people in the graph.
 *
 * So the note keeps every entity in its metadata, and only these become shared
 * nodes. A graph is useful in proportion to what it leaves out.
 */
const GRAPH_TYPES = new Set([
  'person',
  'organization',
  'project',
  'place',
  'skill',
  'goal',
  'event',
  'activity',
]);

/** Common synonyms the model reaches for, folded onto the canonical type. */
const TYPE_ALIASES: Record<string, string> = {
  people: 'person',
  human: 'person',
  company: 'organization',
  employer: 'organization',
  team: 'organization',
  location: 'place',
  city: 'place',
  country: 'place',
  product: 'project',
  work: 'project',
  hobby: 'activity',
  interest: 'activity',
  technology: 'skill',
  tool: 'skill',
  objective: 'goal',
};

function canonicalType(type: string): string {
  const lower = type.trim().toLowerCase();
  return TYPE_ALIASES[lower] ?? lower;
}

export type GraphCandidate = {
  name: string;
  normalizedName: string;
  type: string;
  relationship: string | null;
  attributes: Record<string, unknown> | null;
  context: string | null;
};

/**
 * Everything between what extraction returned and what becomes a node:
 * unusable names dropped, types canonicalised and filtered, duplicates within
 * one note collapsed. Pure, so the rules can be tested without a database.
 */
export function toGraphCandidates(entities: ExtractedEntity[]): GraphCandidate[] {
  const candidates = (entities ?? [])
    .filter((e) => e?.name && isUsableName(e.name))
    .map((e) => ({
      name: e.name!.trim(),
      normalizedName: normalize(e.name!),
      type: canonicalType(e.type || 'other'),
      relationship: e.relationship?.trim() || null,
      attributes: flattenAttributes(e.attributes),
      context: e.context?.trim() || null,
    }))
    .filter((e) => GRAPH_TYPES.has(e.type));

  // Two mentions of the same name in one note are one edge, not two.
  const unique = new Map<string, GraphCandidate>();
  for (const c of candidates) unique.set(identityKey(c), c);

  return [...unique.values()];
}

/** `(normalized name, type)` as one string — the identity a node is keyed on. */
export function identityKey(candidate: { normalizedName: string; type: string }): string {
  return `${candidate.normalizedName}::${candidate.type}`;
}

/**
 * Candidates the user has already decided are not nodes.
 *
 * Applied *before* alias resolution, which is safe because the two sets are
 * kept disjoint at the point of writing: deleting a node buries its aliases
 * along with its own name, and `clearExclusions` lifts an exclusion whenever a
 * merge or a rename decides that spelling means something after all.
 *
 * Pure, so the rule can be read and tested without a database — the same reason
 * `toGraphCandidates` is.
 */
export function withoutExcluded(
  candidates: GraphCandidate[],
  excluded: ReadonlySet<string>
): GraphCandidate[] {
  if (excluded.size === 0) return candidates;
  return candidates.filter((c) => !excluded.has(identityKey(c)));
}

/** Every identity this user has buried. One query per save, like the alias lookup. */
async function excludedKeys(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ normalizedName: entityExclusions.normalizedName, type: entityExclusions.type })
    .from(entityExclusions)
    .where(eq(entityExclusions.userId, userId));

  return new Set(rows.map(identityKey));
}

/** Anything with a `.delete()` — the connection or a transaction handle. */
type Writer = Pick<typeof db, 'delete'>;

/**
 * Lift the tombstones on names that have just been given a meaning.
 *
 * A merge or a rename writes an alias saying a spelling resolves to a node.
 * An exclusion left standing on that same spelling would then be both wrong and
 * invisible — the node exists, while the list of hidden names still claims it
 * was buried. The later decision wins, so the older one goes.
 */
export async function clearExclusions(
  tx: Writer,
  userId: string,
  identities: Array<{ normalizedName: string; type: string }>
): Promise<void> {
  if (identities.length === 0) return;

  await tx.delete(entityExclusions).where(
    and(
      eq(entityExclusions.userId, userId),
      or(
        ...identities.map((i) =>
          and(
            eq(entityExclusions.normalizedName, i.normalizedName),
            eq(entityExclusions.type, i.type)
          )
        )
      )
    )
  );
}

/** The account holder's own name, for collapsing self-references. */
async function selfNameFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.name?.trim() || null;
}

/** A spelling already decided to mean an existing node, or nothing. */
async function resolveAlias(
  userId: string,
  normalizedName: string,
  type: string
): Promise<string | null> {
  const [row] = await db
    .select({ entityId: entityAliases.entityId })
    .from(entityAliases)
    .where(
      and(
        eq(entityAliases.userId, userId),
        eq(entityAliases.normalizedAlias, normalizedName),
        eq(entityAliases.type, type)
      )
    )
    .limit(1);

  return row?.entityId ?? null;
}

export async function syncEntitiesForResource(params: {
  resourceId: string;
  userId: string;
  entities: ExtractedEntity[];
  /**
   * True when re-syncing an edited note. Mentions the new text no longer
   * supports are dropped, so a person removed from a note stops being linked
   * to it — without this an edit could only ever add edges.
   */
  replace?: boolean;
}): Promise<{ linked: number }> {
  const selfName = await selfNameFor(params.userId);

  // Whatever the model called the account holder this time resolves to their
  // one node before anything is written, so "User", "Яна" and "Yana Kozlova"
  // cannot become three.
  const named = (params.entities ?? []).map((e) =>
    e?.name ? { ...e, name: resolveSelfName(e.name, selfName) } : e
  );

  // A deleted node must stay deleted. Filtered here rather than at the upsert
  // so an excluded name also stops holding a mention edge open — otherwise the
  // node would be gone while the note still pointed at where it used to be.
  const unique = withoutExcluded(toGraphCandidates(named), await excludedKeys(params.userId));

  if (unique.length === 0) {
    if (params.replace) {
      await db.delete(entityMentions).where(eq(entityMentions.resourceId, params.resourceId));
    }
    return { linked: 0 };
  }

  let linked = 0;
  const linkedIds: string[] = [];

  for (const candidate of unique) {
    // An alias short-circuits the upsert entirely: a spelling the user has
    // already resolved by hand must land on the node they chose, and must not
    // rename it back to the spelling they rejected.
    let entityId = await resolveAlias(params.userId, candidate.normalizedName, candidate.type);

    if (entityId) {
      // The name is the user's, not the model's — that is what an alias records,
      // and skipping the upsert is what keeps it. A later note may still know
      // something new about the node though, so the relationship is filled in
      // by the same rule the upsert uses; only the spelling is off limits.
      if (candidate.relationship) {
        await db
          .update(entities)
          .set({ relationship: candidate.relationship, updatedAt: new Date() })
          .where(eq(entities.id, entityId));
      }
    } else {
      // Upsert rather than select-then-insert: concurrent saves of the same
      // person would otherwise race and one would violate the unique index.
      const [entity] = await db
        .insert(entities)
        .values({
          userId: params.userId,
          name: candidate.name,
          normalizedName: candidate.normalizedName,
          type: candidate.type,
          relationship: candidate.relationship,
          attributes: candidate.attributes as any,
        })
        .onConflictDoUpdate({
          target: [entities.userId, entities.normalizedName, entities.type],
          set: {
            // Keep the latest spelling and any relationship we have learned,
            // but never overwrite a known relationship with nothing.
            name: candidate.name,
            relationship: raw`coalesce(${candidate.relationship}, ${entities.relationship})`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: entities.id });

      if (!entity) continue;
      entityId = entity.id;
    }

    await db
      .insert(entityMentions)
      .values({
        entityId,
        resourceId: params.resourceId,
        context: candidate.context,
      })
      .onConflictDoNothing();

    linkedIds.push(entityId);
    linked += 1;
  }

  // Edges this note no longer supports. Done before the counts are recomputed,
  // so a node that just lost its last mention reports zero rather than one.
  if (params.replace && linkedIds.length > 0) {
    await db
      .delete(entityMentions)
      .where(
        and(
          eq(entityMentions.resourceId, params.resourceId),
          notInArray(entityMentions.entityId, linkedIds)
        )
      );
  }

  // Recomputed rather than incremented, so the count self-heals after a
  // deleted note or a failed run instead of drifting forever.
  if (linkedIds.length > 0) {
    await db
      .update(entities)
      .set({
        mentionCount: raw`(select count(*) from ${entityMentions} where ${entityMentions.entityId} = ${entities.id})`,
      })
      .where(inArray(entities.id, linkedIds));
  }

  return { linked };
}

/** `%` and `_` are wildcards in LIKE and literal characters in a name. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Entities for the user, most-mentioned first. */
export async function listEntities(
  userId: string,
  options: { type?: string; q?: string; limit?: number } = {}
) {
  const query = options.q?.trim();

  const where = and(
    eq(entities.userId, userId),
    options.type ? eq(entities.type, options.type) : undefined,
    // Substring rather than prefix: the reason to search by hand is usually a
    // spelling the automatic rules could not fold, and "Коваленко" has to find
    // "Андрій Коваленко". `ilike` covers case, which is all normalisation adds.
    query ? ilike(entities.name, `%${escapeLike(query)}%`) : undefined
  );

  return db
    .select()
    .from(entities)
    .where(where)
    .orderBy(desc(entities.mentionCount), desc(entities.updatedAt))
    .limit(options.limit ?? 50);
}

export type HiddenEntity = {
  id: string;
  name: string;
  type: string;
  createdAt: Date;
};

/**
 * What this user has buried, newest first — the undo list for `deleteEntity`.
 *
 * A read rather than a server action, and here rather than beside the delete it
 * belongs to, because it takes a user id: as an action it would be an endpoint
 * anyone signed in could call with somebody else's id.
 */
export async function listHiddenEntities(userId: string): Promise<HiddenEntity[]> {
  return db
    .select({
      id: entityExclusions.id,
      name: entityExclusions.name,
      type: entityExclusions.type,
      createdAt: entityExclusions.createdAt,
    })
    .from(entityExclusions)
    .where(eq(entityExclusions.userId, userId))
    .orderBy(desc(entityExclusions.createdAt))
    .limit(100);
}

/** One entity plus every note that mentions it — the "what do I know" view. */
export async function getEntityWithMentions(entityId: string, userId: string) {
  const [entity] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.userId, userId)))
    .limit(1);

  if (!entity) return null;

  const mentions = await db
    .select({
      resourceId: resources.id,
      title: resources.title,
      content: resources.content,
      metadata: resources.metadata,
      createdAt: resources.createdAt,
      context: entityMentions.context,
    })
    .from(entityMentions)
    .innerJoin(resources, eq(resources.id, entityMentions.resourceId))
    .where(eq(entityMentions.entityId, entityId))
    .orderBy(desc(resources.createdAt));

  return { entity, mentions };
}

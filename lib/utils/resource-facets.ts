import { RESOURCE_TYPES } from './resource-types';

export type TypeFacet = { type: string; count: number };

export type ResourceFacets = {
  tags: string[];
  categories: string[];
  /** Types this user actually has, with how many rows carry each. */
  types: TypeFacet[];
};

/**
 * What the Knowledge Base filters can offer, derived from the rows themselves.
 *
 * The type list is counted rather than hard-coded for the same reason tags
 * always were: a filter that offers a value nothing has is noise, and one that
 * omits a value something has makes those rows unreachable. Ordering follows
 * `RESOURCE_TYPES` so the dropdown does not reshuffle itself as content
 * changes; anything unrecognised (metadata is `passthrough()`) is kept and
 * sorted onto the end rather than dropped.
 *
 * Both the page's first paint and `/api/resources/tags` read through here, so
 * the list cannot differ between the server render and the refresh after an
 * edit.
 */
export function collectFacets(rows: { metadata: unknown }[]): ResourceFacets {
  const tags = new Set<string>();
  const categories = new Set<string>();
  const typeCounts = new Map<string, number>();

  for (const row of rows) {
    const meta = row.metadata as any;
    if (Array.isArray(meta?.tags)) {
      for (const tag of meta.tags) {
        if (tag && typeof tag === 'string') tags.add(tag.trim());
      }
    }
    if (meta?.category && typeof meta.category === 'string') {
      categories.add(meta.category.trim());
    }
    // An absent type reads as 'note' everywhere else in the UI, so it counts as
    // one here too — otherwise filtering by Note hides the untyped rows.
    const type = typeof meta?.type === 'string' && meta.type ? meta.type : 'note';
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }

  const order = new Map<string, number>(RESOURCE_TYPES.map((t, i) => [t, i]));
  const types = Array.from(typeCounts, ([type, count]) => ({ type, count })).sort((a, b) => {
    const ai = order.get(a.type) ?? RESOURCE_TYPES.length;
    const bi = order.get(b.type) ?? RESOURCE_TYPES.length;
    return ai - bi || a.type.localeCompare(b.type);
  });

  return {
    tags: Array.from(tags).sort(),
    categories: Array.from(categories).sort(),
    types,
  };
}

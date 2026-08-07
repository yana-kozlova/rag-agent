/**
 * The `metadata.type` a resource can carry.
 *
 * It is one list because it drifted when it was four. The Knowledge Base filter
 * was written by hand and quietly stopped offering `image`, `event`,
 * `preference` and `need` — types the extractor had been assigning all along,
 * so those notes were invisible from the page whose whole job is to reach them.
 * The edit form's list had drifted differently again, which meant re-saving a
 * `preference` note through the UI silently reclassified it.
 *
 * Lives in `lib/utils` rather than beside the column it constrains because the
 * Knowledge Base is a client component, and importing from
 * `lib/db/schema/resources.ts` would drag drizzle and every table definition
 * into the browser (same reason as `lib/utils/uploadable.ts`).
 */
export const RESOURCE_TYPES = [
  'note',
  'document',
  'image',
  'schedule',
  'person',
  'project',
  'skill',
  'event',
  'learning',
  'preference',
  'need',
  'other',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * What the extractor is allowed to choose. `image` is missing on purpose: it is
 * assigned by the vision path (`lib/actions/save-image.ts`) from the fact that
 * bytes arrived, never inferred from reading text — a note *about* a photograph
 * is not an image resource, and calling it one hides the picture the card would
 * otherwise show.
 */
export const EXTRACTABLE_RESOURCE_TYPES = [
  'note',
  'document',
  'schedule',
  'person',
  'project',
  'skill',
  'event',
  'learning',
  'preference',
  'need',
  'other',
] as const satisfies readonly ResourceType[];

export type ExtractableResourceType = (typeof EXTRACTABLE_RESOURCE_TYPES)[number];

/**
 * One glyph per type, exhaustive by construction — adding a type to the list
 * above will not compile until it has an icon here. Used by the note page and
 * by the Knowledge Base cards, which is the point: the same kind of note must
 * not be marked two different ways on two screens.
 */
export const RESOURCE_TYPE_ICON: Record<ResourceType, string> = {
  note: '📝',
  document: '🔗',
  image: '🖼️',
  schedule: '🗓️',
  person: '🧑',
  project: '📁',
  skill: '🛠️',
  event: '📅',
  learning: '🎓',
  preference: '💡',
  need: '⏰',
  other: '📄',
};

/** Falls back for the same reason `resourceTypeLabel` takes a plain string. */
export function resourceTypeIcon(type: string): string {
  return RESOURCE_TYPE_ICON[type as ResourceType] ?? RESOURCE_TYPE_ICON.other;
}

/**
 * Display name for a type. Takes a plain string rather than `ResourceType`:
 * `metadata` is `passthrough()`, so a row written by an older version can hold
 * a type this list has never heard of, and a filter that silently drops it
 * would be the very bug this module exists to stop.
 */
export function resourceTypeLabel(type: string): string {
  if (!type) return 'Note';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

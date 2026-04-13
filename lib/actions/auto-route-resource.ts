'use server';

/**
 * Convention-based resource → table auto-routing.
 *
 * Zero LLM calls: uses only metadata that was already extracted during
 * createResource (facts, entities, keyPoints, tags, contentType) and maps
 * them onto table columns by NAME convention.
 *
 * A table opts in by setting `settings.autoRoute = { matchTypes?, matchTags? }`.
 * On a new resource, every table whose rule matches will get one new row
 * (with `sourceResourceIds` bookkeeping and back-links written via
 * createTableRowsBulk).
 *
 * Keep this file LLM-free — that's the whole point (token budget).
 */

import { db } from '@/lib/db';
import { userTables, type TableColumn, type TableSettings } from '@/lib/db/schema';
import { resources } from '@/lib/db/schema/resources';
import { and, eq } from 'drizzle-orm';
import { createTableRowsBulk } from './user-tables';

type ResourceMetadata = {
  type?: string;
  tags?: string[];
  facts?: Array<{ subject: string; predicate: string; object: string; context?: string }>;
  entities?: Array<{ name: string; type: string; relationship?: string }>;
  needs?: Array<{ need: string; priority?: string; context?: string }>;
  keyPoints?: string[];
  category?: string;
  personName?: string;
  projectName?: string;
  skillName?: string;
  userName?: string;
  linkedRows?: Array<{ tableId: string; rowId: string }>;
  [k: string]: any;
};

// Column-name convention → a function that derives the value from resource
// data. Keys are lower-cased/normalized so the match is forgiving
// ("Title", "TITLE", "title" all hit the same rule).
type ColumnDeriver = (ctx: {
  resource: { id: string; title: string | null; content: string; createdAt: Date };
  metadata: ResourceMetadata;
}) => string | number | null | undefined;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .trim();

const conventions: Record<string, ColumnDeriver> = {
  // Title-like
  title: ({ resource }) => resource.title ?? null,
  name: ({ resource, metadata }) =>
    metadata.personName ?? metadata.projectName ?? metadata.skillName ?? resource.title ?? null,

  // Summary / description / content
  summary: ({ metadata, resource }) =>
    metadata.keyPoints?.[0] ?? resource.content.slice(0, 500),
  description: ({ metadata, resource }) =>
    metadata.keyPoints?.[0] ?? resource.content.slice(0, 500),
  notes: ({ resource }) => resource.content.slice(0, 1000),
  content: ({ resource }) => resource.content.slice(0, 1000),

  // Dates
  date: ({ resource }) => resource.createdAt.toISOString().slice(0, 10),
  createdat: ({ resource }) => resource.createdAt.toISOString(),
  created: ({ resource }) => resource.createdAt.toISOString(),

  // Entity-typed fields
  person: ({ metadata }) =>
    metadata.personName ?? metadata.entities?.find((e) => e.type === 'person')?.name ?? null,
  project: ({ metadata }) =>
    metadata.projectName ?? metadata.entities?.find((e) => e.type === 'project')?.name ?? null,
  skill: ({ metadata }) =>
    metadata.skillName ?? metadata.entities?.find((e) => e.type === 'skill')?.name ?? null,

  // Tags/category
  tags: ({ metadata }) => metadata.tags?.join(', ') ?? null,
  category: ({ metadata }) => metadata.category ?? null,
  type: ({ metadata }) => metadata.type ?? null,
};

function deriveValue(
  columnName: string,
  ctx: Parameters<ColumnDeriver>[0]
): string | number | null | undefined {
  const key = normalize(columnName);
  const deriver = conventions[key];
  if (!deriver) return null;
  return deriver(ctx);
}

function matchesAutoRoute(
  metadata: ResourceMetadata,
  autoRoute: NonNullable<TableSettings['autoRoute']>
): boolean {
  const hasTypes = autoRoute.matchTypes && autoRoute.matchTypes.length > 0;
  const hasTags = autoRoute.matchTags && autoRoute.matchTags.length > 0;

  if (!hasTypes && !hasTags) return false; // nothing configured → don't route

  if (hasTypes && metadata.type && autoRoute.matchTypes!.includes(metadata.type)) {
    return true;
  }
  if (hasTags && metadata.tags && metadata.tags.length > 0) {
    const overlap = metadata.tags.some((t) => autoRoute.matchTags!.includes(t));
    if (overlap) return true;
  }
  return false;
}

/**
 * Route a freshly-created resource into any user tables whose autoRoute rule
 * matches. Returns a list of { tableId, tableTitle } that were populated so
 * the caller can log it.
 *
 * Safe to call in a fire-and-forget try/catch — all errors are swallowed and
 * logged so the outer createResource never fails because of routing.
 */
export async function autoRouteResource(
  resourceId: string,
  userId: string
): Promise<Array<{ tableId: string; tableTitle: string; rowId: string }>> {
  try {
    const [resource] = await db
      .select({
        id: resources.id,
        title: resources.title,
        content: resources.content,
        createdAt: resources.createdAt,
        metadata: resources.metadata,
      })
      .from(resources)
      .where(and(eq(resources.id, resourceId), eq(resources.userId, userId)))
      .limit(1);

    if (!resource) return [];

    const metadata = (resource.metadata as ResourceMetadata | null) ?? {};

    // Load the user's tables. Small result set per user — full scan is fine.
    const tables = await db
      .select()
      .from(userTables)
      .where(eq(userTables.userId, userId));

    const ctx = {
      resource: {
        id: resource.id,
        title: resource.title,
        content: resource.content,
        createdAt: resource.createdAt,
      },
      metadata,
    };

    const routed: Array<{ tableId: string; tableTitle: string; rowId: string }> = [];

    for (const table of tables) {
      const settings = (table.settings as TableSettings | null) ?? {};
      const autoRoute = settings.autoRoute;
      if (!autoRoute) continue;
      if (!matchesAutoRoute(metadata, autoRoute)) continue;

      const columns = table.columns as TableColumn[];
      const rowData: Record<string, any> = {};
      let mappedAny = false;

      for (const col of columns) {
        const value = deriveValue(col.name, ctx);
        if (value !== null && value !== undefined && value !== '') {
          rowData[col.id] = value;
          mappedAny = true;
        }
      }

      // If we couldn't map a single required column (or nothing at all), skip.
      if (!mappedAny) continue;
      const missingRequired = columns.some(
        (c) => c.required && (rowData[c.id] === undefined || rowData[c.id] === '')
      );
      if (missingRequired) continue;

      // Don't double-route: if this resource already has a link to this table,
      // skip. (Also protects against re-runs.)
      const alreadyLinked = (metadata.linkedRows ?? []).some(
        (l) => l.tableId === table.id
      );
      if (alreadyLinked) continue;

      const result = await createTableRowsBulk({
        userTableId: table.id,
        rows: [rowData],
        sourceResourceIdsPerRow: [[resource.id]],
      });

      if (result.success && result.ids && result.ids[0]) {
        routed.push({ tableId: table.id, tableTitle: table.title, rowId: result.ids[0] });
      }
    }

    if (routed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[autoRouteResource] resource=${resourceId} routed to ${routed.length} table(s): ${routed
          .map((r) => r.tableTitle)
          .join(', ')}`
      );
    }

    return routed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[autoRouteResource] error', err);
    return [];
  }
}

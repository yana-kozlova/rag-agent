import { z } from 'zod';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { userTables, resources, type TableColumn } from '@/lib/db/schema';
import { eq, and, ilike, inArray } from 'drizzle-orm';
import { findRelevantContent } from '@/lib/ai/embedding';

const MAX_CANDIDATES = 10;
const MAX_CONTENT_CHARS = 4000;

export const extractToTableTool = {
  description: `Find user notes relevant to a table and return candidates with full content for extraction. Then call addTableRows with extracted rows and sourceResourceIdsPerRow for back-links.`,
  inputSchema: z.object({
    tableId: z
      .string()
      .optional()
      .describe('The ID of the target table (preferred if known)'),
    tableTitle: z
      .string()
      .optional()
      .describe('The title of the target table (used if tableId not provided)'),
    query: z
      .string()
      .describe(
        "Semantic query describing what notes to pull (e.g. 'meetings with people', 'books I've read', 'job applications'). Keep it focused on the subject, not the action."
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_CANDIDATES)
      .optional()
      .describe(`Max number of candidate resources to return (default 8, max ${MAX_CANDIDATES}).`),
  }),
  execute: async ({
    tableId,
    tableTitle,
    query,
    limit,
  }: {
    tableId?: string;
    tableTitle?: string;
    query: string;
    limit?: number;
  }) => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      throw new Error('Unauthorized');
    }

    if (!tableId && !tableTitle) {
      return { success: false, message: 'Either tableId or tableTitle must be provided.' };
    }

    // Resolve target table (same fuzzy logic as addTableRows)
    let table: typeof userTables.$inferSelect | undefined;
    if (tableId) {
      const [found] = await db
        .select()
        .from(userTables)
        .where(and(eq(userTables.id, tableId), eq(userTables.userId, userId)))
        .limit(1);
      table = found;
    }
    if (!table && tableTitle) {
      const matches = await db
        .select()
        .from(userTables)
        .where(
          and(
            eq(userTables.userId, userId),
            ilike(userTables.title, `%${tableTitle.trim()}%`)
          )
        )
        .limit(5);
      const lower = tableTitle.trim().toLowerCase();
      table =
        matches.find((m) => m.title.toLowerCase() === lower) ??
        matches.find((m) => m.title.toLowerCase().startsWith(lower)) ??
        matches[0];
    }
    if (!table) {
      return {
        success: false,
        message: `Table not found. ${
          tableTitle ? `Searched for: "${tableTitle}".` : `ID: "${tableId}".`
        } Use listTables to see available tables, or createTable to make a new one.`,
      };
    }

    // Semantic search across the user's knowledge, then keep only resource-backed hits.
    const rawResults = await findRelevantContent(query, userId, {
      useHybridSearch: true,
      // Disable cache so repeated extractions always see the latest notes
      useCache: false,
      caller: 'extractToTable',
    });

    const resourceHits = rawResults.filter(
      (r: any) => r.source === 'resource' && r.sourceId
    );

    if (resourceHits.length === 0) {
      return {
        success: true,
        tableId: table.id,
        tableTitle: table.title,
        columns: table.columns,
        candidates: [],
        message: `No relevant notes found for "${query}". Tell the user there's nothing to extract.`,
      };
    }

    // Group chunks by resource, keep best (highest similarity) per resource
    const bestByResource = new Map<
      string,
      { sourceId: string; similarity: number; bestChunk: string }
    >();
    for (const hit of resourceHits as any[]) {
      const sim = typeof hit.similarity === 'number' ? hit.similarity : 0;
      const prev = bestByResource.get(hit.sourceId);
      if (!prev || sim > prev.similarity) {
        bestByResource.set(hit.sourceId, {
          sourceId: hit.sourceId,
          similarity: sim,
          bestChunk: hit.content || '',
        });
      }
    }

    const cap = Math.min(limit ?? 8, MAX_CANDIDATES);
    const topResourceIds = Array.from(bestByResource.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, cap)
      .map((x) => x.sourceId);

    // Fetch full content for the top resources (one query, scoped to this user)
    const fullResources = await db
      .select({
        id: resources.id,
        title: resources.title,
        content: resources.content,
        metadata: resources.metadata,
        createdAt: resources.createdAt,
      })
      .from(resources)
      .where(and(inArray(resources.id, topResourceIds), eq(resources.userId, userId)));

    // Preserve ranking from the similarity sort
    const byId = new Map(fullResources.map((r) => [r.id, r]));
    const candidates = topResourceIds
      .map((rid) => {
        const r = byId.get(rid);
        const best = bestByResource.get(rid)!;
        if (!r) return null;

        // Don't blow up the tool context on very long documents
        const truncated =
          r.content.length > MAX_CONTENT_CHARS
            ? r.content.slice(0, MAX_CONTENT_CHARS) + '\n…[truncated]'
            : r.content;

        // Flag if the resource is already linked to this table so the LLM can skip duplicates
        const existingLinks =
          (r.metadata as any)?.linkedRows &&
          Array.isArray((r.metadata as any).linkedRows)
            ? ((r.metadata as any).linkedRows as Array<{ tableId: string; rowId: string }>)
            : [];
        const alreadyLinkedRowIds = existingLinks
          .filter((l) => l.tableId === table!.id)
          .map((l) => l.rowId);

        return {
          resourceId: r.id,
          title: r.title ?? null,
          createdAt: r.createdAt,
          similarity: best.similarity,
          bestChunk: best.bestChunk,
          content: truncated,
          alreadyLinkedRowIds,
        };
      })
      .filter(Boolean);

    return {
      success: true,
      tableId: table.id,
      tableTitle: table.title,
      // Strip widths/defaults — model only needs name, id, type, required for mapping
      columns: (table.columns as TableColumn[]).map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        required: c.required ?? false,
      })),
      candidates,
      instructions: `Read each candidate's content, extract fields that match the columns, and then call addTableRows with sourceResourceIdsPerRow = [[candidate.resourceId], ...]. Skip candidates that are already linked (alreadyLinkedRowIds non-empty) unless the user explicitly asked to re-extract. Do not invent values that are not present in the notes.`,
    };
  },
} as const;

import { z } from 'zod';
import { getSessionOrNull } from '@/lib/utils/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq, and, or, ilike } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { extractStructuredInformation } from '@/lib/ai/information-extraction';
import { updateResource } from '@/lib/actions/resources';
import { todayFor } from '@/lib/actions/user-timezone';

export const analyzeFileTool = {
  description: `Analyze an uploaded file by resourceId or filename. Extracts key points, facts, entities.`,
  inputSchema: z.object({
    resourceId: z.string().optional().describe('The ID of the resource/file to analyze (if you know it)'),
    filename: z.string().optional().describe('The filename or title of the file to analyze (e.g., "ЧЕК-ЛИСТ – пошуку роботи.docx")'),
  }),
  execute: async ({ resourceId, filename }: { resourceId?: string; filename?: string }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    if (!resourceId && !filename) {
      return {
        success: false,
        message: 'Either resourceId or filename must be provided',
      };
    }

    let resource: typeof resources.$inferSelect | undefined;

    // Determine if resourceId is actually an ID or a filename
    const isLikelyId = resourceId && resourceId.length < 50 && !resourceId.includes('.') && !resourceId.includes('–') && !resourceId.includes(' ');

    // If resourceId is provided and looks like an ID (not a filename), search by ID
    if (resourceId && isLikelyId) {
      // Looks like an ID (nanoid is typically 21 chars, filenames are usually longer or contain dots/spaces)
      const [found] = await db
        .select()
        .from(resources)
        .where(and(
          eq(resources.id, resourceId),
          eq(resources.userId, session.user.id as any)
        ))
        .limit(1);
      resource = found;
    }

    // If not found by ID, or filename provided, or resourceId looks like a filename, search by filename/title
    const searchTerm = filename || (resourceId && !isLikelyId ? resourceId : null);
    if (!resource && searchTerm) {
      const trimmedSearchTerm = searchTerm.trim();
      const searchPattern = `%${trimmedSearchTerm}%`;

      // Search by title or metadata->>'fileName' in SQL instead of loading all resources
      const matchingResources = await db
        .select()
        .from(resources)
        .where(and(
          eq(resources.userId, session.user.id as string),
          or(
            ilike(resources.title, searchPattern),
            sql`${resources.metadata}->>'fileName' ILIKE ${searchPattern}`
          )
        ))
        .limit(10);

      // Sort by relevance: exact title match first
      matchingResources.sort((a, b) => {
        const aTitle = (a.title || '').toLowerCase();
        const bTitle = (b.title || '').toLowerCase();
        const lowerSearch = trimmedSearchTerm.toLowerCase();

        if (aTitle === lowerSearch && bTitle !== lowerSearch) return -1;
        if (bTitle === lowerSearch && aTitle !== lowerSearch) return 1;
        if (aTitle.startsWith(lowerSearch) && !bTitle.startsWith(lowerSearch)) return -1;
        if (bTitle.startsWith(lowerSearch) && !aTitle.startsWith(lowerSearch)) return 1;
        return 0;
      });

      resource = matchingResources[0];
    }

    if (!resource) {
      return {
        success: false,
        message: `File not found. ${filename ? `Searched for: "${filename}"` : `Resource ID: "${resourceId}"`}. Please check the filename or use getInformation to find the file first.`,
      };
    }

    // Check if it's a file the tool can speak to.
    //
    // Images count regardless of length: their content is a vision model's
    // description, which is routinely under the length threshold — a photo of a
    // receipt reads as three lines. Without the type check, the chat flow that
    // uploads an image and is then told to call this tool would be answered
    // with "not a document file" for the ordinary case.
    const metadata = resource.metadata as any;
    const analysable =
      metadata?.type === 'document' || metadata?.type === 'image' || resource.content.length > 1000;

    if (!analysable) {
      return {
        success: false,
        message: 'This resource is not a document or image file. Only those can be analyzed.',
      };
    }

    // Extract structured information using AI
    const userName = session?.user?.name || null;
    let extracted = await extractStructuredInformation(
      resource.content,
      userName,
      'analyzeFile',
      await todayFor(session.user.id)
    );

    if (!extracted) {
      return {
        success: false,
        message: 'Failed to analyze the file. Please try again.',
      };
    }

    // For files, keep the original content and only add structured info to metadata
    // Don't replace the file content with structured information

    // Build rich metadata from extracted information
    const updatedMetadata = {
      ...metadata,
      // An image keeps its type. `image` is assigned by the vision path from the
      // fact that bytes arrived, and `EXTRACTABLE_RESOURCE_TYPES` excludes it on
      // purpose so no model can infer it from prose — which means the extractor
      // can only ever answer something else here. Letting that win retypes a
      // photo to `note` the first time it is analysed: it drops out of the
      // Knowledge Base's Image filter, and the `analysable` check above (which
      // admits an image whatever its length, because a receipt reads as three
      // lines) stops recognising it, so a second call answers "not a document or
      // image file" for a picture that is plainly there.
      type: metadata?.type === 'image' ? 'image' : extracted.contentType,
      tags: extracted.structuredContent.tags,
      facts: extracted.facts,
      entities: extracted.entities.map(e => ({
        name: e.name,
        type: e.type,
        relationship: e.relationship,
      })),
      needs: extracted.needs,
      // A scanned certificate or a photographed invitation is exactly the kind
      // of thing whose date matters and whose text nobody rereads.
      dates: extracted.dates,
      keyPoints: extracted.structuredContent.keyPoints,
      userName: extracted.userName || userName,
      analyzed: true,
      analyzedAt: new Date().toISOString(),
      // Store structured summary in metadata for reference
      structuredSummary: {
        title: extracted.structuredContent.title,
        summary: extracted.structuredContent.summary,
      },
    };

    // Update resource metadata only, keep original content
    const updateResult = await updateResource(resource.id, {
      // Keep original content - don't replace it
      content: resource.content,
      // Update title if it's better, otherwise keep original
      title: resource.title || extracted.structuredContent.title,
      metadata: updatedMetadata,
    });

    if (!updateResult.success) {
      return {
        success: false,
        message: updateResult.message || 'Failed to update resource with analyzed information',
      };
    }

    return {
      success: true,
      message: 'File analyzed successfully',
      // The page this file opens on. It was missing while `resource.id` sat one
      // line up: asked to point at the thing it had just read, the model had no
      // address and invented one.
      resourceId: resource.id,
      url: `/resources/${resource.id}`,
      summary: {
        title: extracted.structuredContent.title,
        summary: extracted.structuredContent.summary,
        keyPoints: extracted.structuredContent.keyPoints,
        factsCount: extracted.facts.length,
        entitiesCount: extracted.entities.length,
        needsCount: extracted.needs.length,
        tags: extracted.structuredContent.tags,
      },
    };
  },
} as const;


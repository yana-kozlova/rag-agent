import { z } from 'zod';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq, and, or, ilike, sql } from 'drizzle-orm';
import { extractStructuredInformation, formatStructuredContent } from '@/lib/ai/information-extraction';
import { updateResource } from '@/lib/actions/resources';

export const analyzeFileTool = {
  description: `Analyze a file/document that was previously uploaded to extract structured information, key points, facts, entities, and needs. 
    Use this tool when the user asks to analyze a file, extract information from a document, or summarize a document.
    The tool will analyze the file content and update it with structured information for better searchability.
    You can provide either the resourceId or the filename/title of the file.`,
  inputSchema: z.object({
    resourceId: z.string().optional().describe('The ID of the resource/file to analyze (if you know it)'),
    filename: z.string().optional().describe('The filename or title of the file to analyze (e.g., "ЧЕК-ЛИСТ – пошуку роботи.docx")'),
  }),
  execute: async ({ resourceId, filename }: { resourceId?: string; filename?: string }) => {
    const session = await auth();
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
      const searchPattern = `%${searchTerm}%`;
      
      // First, get all resources for the user (to filter in JS for JSONB search)
      const allResources = await db
        .select()
        .from(resources)
        .where(eq(resources.userId, session.user.id as any));
      
      // Normalize search term: remove extension, normalize spaces/underscores
      const normalizeForSearch = (str: string) => {
        return str
          .toLowerCase()
          .replace(/\.[^.]+$/, '') // Remove extension
          .replace(/[_\s]+/g, ' ') // Replace underscores and multiple spaces with single space
          .trim();
      };
      
      const normalizedSearchTerm = normalizeForSearch(trimmedSearchTerm);
      
      // Filter by title or metadata.fileName
      const matchingResources = allResources.filter(r => {
        const meta = r.metadata as any;
        const fileName = meta?.fileName || '';
        const title = r.title || '';
        
        const normalizedFileName = normalizeForSearch(fileName);
        const normalizedTitle = normalizeForSearch(title);
        
        return (
          normalizedTitle.includes(normalizedSearchTerm) ||
          normalizedFileName.includes(normalizedSearchTerm) ||
          normalizedSearchTerm.includes(normalizedTitle) ||
          normalizedSearchTerm.includes(normalizedFileName) ||
          title.toLowerCase().includes(trimmedSearchTerm.toLowerCase()) ||
          fileName.toLowerCase().includes(trimmedSearchTerm.toLowerCase()) ||
          fileName === trimmedSearchTerm ||
          title === trimmedSearchTerm
        );
      });
      
      // Sort by relevance (exact matches first)
      matchingResources.sort((a, b) => {
        const aMeta = a.metadata as any;
        const bMeta = b.metadata as any;
        const aFileName = aMeta?.fileName || '';
        const bFileName = bMeta?.fileName || '';
        const aTitle = a.title || '';
        const bTitle = b.title || '';
        
        const normalizedAFileName = normalizeForSearch(aFileName);
        const normalizedBFileName = normalizeForSearch(bFileName);
        const normalizedATitle = normalizeForSearch(aTitle);
        const normalizedBTitle = normalizeForSearch(bTitle);
        
        // Exact match in normalized title
        if (normalizedATitle === normalizedSearchTerm && normalizedBTitle !== normalizedSearchTerm) return -1;
        if (normalizedBTitle === normalizedSearchTerm && normalizedATitle !== normalizedSearchTerm) return 1;
        
        // Exact match in normalized fileName
        if (normalizedAFileName === normalizedSearchTerm && normalizedBFileName !== normalizedSearchTerm) return -1;
        if (normalizedBFileName === normalizedSearchTerm && normalizedAFileName !== normalizedSearchTerm) return 1;
        
        // Starts with in normalized title
        if (normalizedATitle.startsWith(normalizedSearchTerm) && !normalizedBTitle.startsWith(normalizedSearchTerm)) return -1;
        if (normalizedBTitle.startsWith(normalizedSearchTerm) && !normalizedATitle.startsWith(normalizedSearchTerm)) return 1;
        
        // Starts with in normalized fileName
        if (normalizedAFileName.startsWith(normalizedSearchTerm) && !normalizedBFileName.startsWith(normalizedSearchTerm)) return -1;
        if (normalizedBFileName.startsWith(normalizedSearchTerm) && !normalizedAFileName.startsWith(normalizedSearchTerm)) return 1;
        
        // Fallback to original exact matches
        if (aTitle === trimmedSearchTerm && bTitle !== trimmedSearchTerm) return -1;
        if (bTitle === trimmedSearchTerm && aTitle !== trimmedSearchTerm) return 1;
        if (aFileName === trimmedSearchTerm && bFileName !== trimmedSearchTerm) return -1;
        if (bFileName === trimmedSearchTerm && aFileName !== trimmedSearchTerm) return 1;
        
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

    // Check if it's a document type file
    const metadata = resource.metadata as any;
    const isDocument = metadata?.type === 'document' || resource.content.length > 1000;

    if (!isDocument) {
      return {
        success: false,
        message: 'This resource is not a document file. Only document files can be analyzed.',
      };
    }

    // Extract structured information using AI
    const userName = session?.user?.name || null;
    let extracted = await extractStructuredInformation(resource.content, userName);

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
      type: extracted.contentType,
      tags: extracted.structuredContent.tags,
      facts: extracted.facts,
      entities: extracted.entities.map(e => ({
        name: e.name,
        type: e.type,
        relationship: e.relationship,
      })),
      needs: extracted.needs,
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


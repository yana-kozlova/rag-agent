import { z } from 'zod';
import { deleteResource } from '@/lib/actions/resources';
import { findRelevantContent } from '@/lib/ai/embedding';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { eq, and, inArray } from 'drizzle-orm';

export const forgetInformationTool = {
  description: `Delete or forget information from the knowledge base when the user explicitly asks to forget, delete, or remove something.
  
Use this tool when:
- User says "forget about X", "delete information about Y", "remove Z from memory"
- User wants to delete specific notes, information, or data
- User explicitly requests deletion of information

IMPORTANT:
- Only delete when user explicitly requests it
- Search for relevant resources first
- Delete resources that match the user's request
- Confirm what was deleted to the user`,
  inputSchema: z.object({
    query: z.string().describe('What information to forget/delete. Can be keywords, a description, or specific content to remove.'),
  }),
  execute: async ({ query }: { query: string }) => {
    try {
      const session = await auth();
      const userId = session?.user?.id;
      if (!userId) {
        return { success: false, message: 'Unauthorized' };
      }

      // First, find relevant resources
      const searchResults = await findRelevantContent(query, userId);
      
      if (searchResults.length === 0) {
        return { 
          success: true, 
          message: `No information found matching "${query}". Nothing to delete.`,
          deletedCount: 0 
        };
      }

      // Filter results with reasonable similarity threshold (0.4 to avoid deleting unrelated content)
      const MIN_SIMILARITY = 0.4;
      const relevantResults = searchResults.filter((r: any) => {
        const sim = typeof r.similarity === 'number' ? r.similarity : 0;
        return sim > MIN_SIMILARITY;
      });

      if (relevantResults.length === 0) {
        return { 
          success: true, 
          message: `Found information but it doesn't seem closely related to "${query}". Nothing deleted for safety.`,
          deletedCount: 0 
        };
      }

      // Get unique source IDs for resources only (not tables - they need separate handling)
      const resourceSourceIds = [...new Set(
        relevantResults
          .filter((r: any) => r.source === 'resource' || r.source === 'calendar')
          .map((r: any) => r.sourceId)
          .filter(Boolean)
      )];
      
      // Limit to top 10 resources to avoid accidental mass deletion
      const idsToDelete = resourceSourceIds.slice(0, 10);
      
      // Verify resources belong to user and get their titles for reporting
      const resourcesToDelete = await db
        .select({
          id: resources.id,
          title: resources.title,
          content: resources.content,
        })
        .from(resources)
        .where(and(
          inArray(resources.id, idsToDelete),
          eq(resources.userId, userId as any)
        ));

      if (resourcesToDelete.length === 0) {
        return { 
          success: true, 
          message: 'No resources found to delete.',
          deletedCount: 0 
        };
      }

      // Delete each resource
      const deletedItems: Array<{ id: string; title?: string; preview: string }> = [];
      let successCount = 0;
      let errorCount = 0;

      for (const resource of resourcesToDelete) {
        const result = await deleteResource(resource.id);
        if (result.success) {
          successCount++;
          deletedItems.push({
            id: resource.id,
            title: resource.title || undefined,
            preview: resource.content.substring(0, 100) + (resource.content.length > 100 ? '...' : ''),
          });
        } else {
          errorCount++;
        }
      }

      const message = successCount > 0
        ? `Successfully deleted ${successCount} item(s) related to "${query}". ${errorCount > 0 ? `(${errorCount} errors)` : ''}`
        : `Failed to delete resources. ${errorCount} error(s).`;

      return {
        success: successCount > 0,
        message,
        deletedCount: successCount,
        deletedItems: deletedItems.slice(0, 5), // Limit to 5 for display
      };
    } catch (error) {
      console.error('[forgetInformation] Error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Error deleting information',
        deletedCount: 0,
      };
    }
  },
} as const;


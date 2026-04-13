import { z } from 'zod';
import { createResource } from '@/lib/actions/resources';
import { auth } from '@/app/api/auth/auth';
import { looksLikeCalendarCommandOrScheduleOperation } from '@/lib/privacy/schedule-privacy';
import { extractStructuredInformation, formatStructuredContent } from '@/lib/ai/information-extraction';

export const addResourceTool = {
  description: `Add a resource to your knowledge base.
    If the user provides a random piece of knowledge unprompted, use this tool without asking for confirmation.
    Try to extract a meaningful title from the content if possible.`,
  inputSchema: z.object({
    content: z.string().describe('The content or resource to add to the knowledge base'),
    title: z.string().optional().describe('Optional title for the resource. If not provided, will try to extract from first line of content.'),
  }),
  execute: async ({ content, title }: { content: string; title?: string }) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    // Privacy: do not store operational calendar/schedule commands in long-term memory.
    // These should be handled via calendar tools, not via RAG storage.
    if (looksLikeCalendarCommandOrScheduleOperation(content) || (title && looksLikeCalendarCommandOrScheduleOperation(title))) {
      return {
        success: false,
        message: 'Skipped saving: looks like a calendar operation / schedule command (privacy rule).',
      };
    }
    
    // Extract structured information using AI analysis
    const isLargeText = content.length > 5000;
    let structuredContent = content;
    let extractedTitle = title;
    let contentType: 'note' | 'document' | 'schedule' | 'person' | 'project' | 'skill' | 'event' | 'learning' | 'preference' | 'need' | 'other' = 'note';
    let metadata: any = {};
    
    // For smaller texts, use structured extraction
    if (!isLargeText && content.length <= 2000) {
      try {
        const userName = session?.user?.name || null;
        const extracted = await extractStructuredInformation(content, userName, 'addResource');
        
        if (extracted) {
          // Use structured content for storage - only save extracted information, not original message
          structuredContent = formatStructuredContent(extracted, content, false); // false = don't include original
          extractedTitle = extracted.structuredContent.title;
          contentType = extracted.contentType;
          
          // Build rich metadata from extracted information
          metadata = {
            type: contentType,
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
          };
          
          console.log(`[addResource] Extracted structured information: ${extracted.facts.length} facts, ${extracted.entities.length} entities, ${extracted.needs.length} needs`);
        } else {
          // Fallback to simple extraction if AI extraction fails
          if (!extractedTitle) {
            const firstLine = content.split('\n')[0]?.trim();
            if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
              extractedTitle = firstLine;
            }
          }
          metadata = { type: contentType };
        }
      } catch (error) {
        console.error('[addResource] Error extracting structured information:', error);
        // Fallback to simple extraction
        if (!extractedTitle) {
          const firstLine = content.split('\n')[0]?.trim();
          if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
            extractedTitle = firstLine;
          }
        }
        metadata = { type: contentType };
      }
    } else {
      // For large texts, use simple extraction
      if (isLargeText) {
        contentType = 'document';
        metadata = { 
          type: contentType, 
          size: content.length, 
          chunks: Math.ceil(content.length / 800) 
        };
      } else {
        metadata = { type: contentType };
      }
      
      if (!extractedTitle) {
        const firstLine = content.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
          extractedTitle = firstLine;
        }
      }
    }
    
    return createResource({ 
      content: structuredContent, 
      userId: session.user.id,
      title: extractedTitle || undefined,
      metadata,
    });
  },
} as const;


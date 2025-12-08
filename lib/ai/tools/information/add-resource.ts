import { z } from 'zod';
import { createResource } from '@/lib/actions/resources';
import { auth } from '@/app/api/auth/auth';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '@/lib/env.mjs';

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
    
    // If title not provided, try to extract from first line
    let extractedTitle = title;
    if (!extractedTitle) {
      const firstLine = content.split('\n')[0]?.trim();
      if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
        extractedTitle = firstLine;
      }
    }
    
    // Classify content type
    let contentType = 'note';
    const isLargeText = content.length > 5000;
    
    if (isLargeText) {
      contentType = 'document';
    } else if (content.length <= 2000) {
      // Try to classify content type for smaller texts
      try {
        const typeClassificationSchema = z.object({
          type: z.enum(['note', 'document', 'schedule', 'person', 'project', 'skill', 'event', 'learning', 'other']).describe('Content type'),
          confidence: z.number().describe('Confidence level 0-1'),
        });
        
        const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
        const typeResult = await generateObject({
          model: openai(modelName),
          schema: typeClassificationSchema,
          prompt: `Classify the following content into one of these types:
- note: general notes, thoughts, ideas
- document: long-form content, articles, documents
- schedule: schedules, appointments, events with times
- person: information about a person (name, relationship, details)
- project: project information, goals, tasks
- skill: skills, abilities, learning topics
- event: specific events, experiences, memories
- learning: learning progress, study notes, educational content
- other: anything else

Content: "${content.substring(0, 1000)}"

Return the most appropriate type.`,
          temperature: 0.1,
        });
        
        if (typeResult.object.confidence > 0.5) {
          contentType = typeResult.object.type;
        }
      } catch (error) {
        // Fallback to note if classification fails
        console.error('[addResource] Error classifying content type:', error);
      }
    }
    
    return createResource({ 
      content, 
      userId: session.user.id,
      title: extractedTitle || undefined,
      metadata: { type: contentType },
    });
  },
} as const;


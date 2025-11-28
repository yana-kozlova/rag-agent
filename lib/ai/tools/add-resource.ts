import { z } from 'zod';
import { createResource } from '@/lib/actions/resources';
import { auth } from '../../../app/api/auth/auth';

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
    
    return createResource({ 
      content, 
      userId: session.user.id,
      title: extractedTitle || undefined,
    });
  },
} as const;

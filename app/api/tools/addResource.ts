import { z } from 'zod';
import { createResource } from '@/lib/actions/resources';
import { auth } from '../auth/auth';

export const addResourceTool = {
  description: `Add a resource to your knowledge base.
    If the user provides a random piece of knowledge unprompted, use this tool without asking for confirmation.`,
  inputSchema: z.object({
    content: z.string().describe('The content or resource to add to the knowledge base'),
  }),
  execute: async ({ content }: { content: string }) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }
    return createResource({ content, userId: session.user.id });
  },
} as const;

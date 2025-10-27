import { z } from 'zod';
import { findRelevantContent } from '@/lib/ai/embedding';
import { auth } from '../auth/auth';

export const getInformationTool = {
  description: 'Get information from your knowledge base to answer questions.',
  inputSchema: z.object({
    question: z.string().describe('The user\'s question'),
  }),
  execute: async ({ question }: { question: string }) => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return [];
    return findRelevantContent(question, userId);
  },
} as const;

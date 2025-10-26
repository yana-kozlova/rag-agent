import { z } from 'zod';
import { findRelevantContent } from '@/lib/ai/embedding';

export const getInformationTool = {
  description: 'Get information from your knowledge base to answer questions.',
  inputSchema: z.object({
    question: z.string().describe('The user\'s question'),
  }),
  execute: async ({ question }: { question: string }) => {
    return findRelevantContent(question);
  },
} as const;

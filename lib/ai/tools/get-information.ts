import { z } from 'zod';
import { findRelevantContent } from '@/lib/ai/embedding';
import { auth } from '../../../app/api/auth/auth';

export const getInformationTool = {
  description: `Get information from the user's knowledge base (RAG) to answer questions about them.
Use this tool when:
- User asks about themselves, their preferences, work, goals, plans, or past information
- You need context about the user to provide personalized answers
- User asks "what do you know about me" or similar questions
- You need to recall information mentioned in previous conversations

The tool searches through all saved user information using semantic similarity and returns the most relevant content.`,
  inputSchema: z.object({
    question: z.string().describe('The question or query to search for in the knowledge base. Can be a question or keywords.'),
  }),
  execute: async ({ question }: { question: string }) => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return [];
    return findRelevantContent(question, userId);
  },
} as const;

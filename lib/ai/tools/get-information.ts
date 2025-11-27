import { z } from 'zod';
import { findRelevantContent } from '@/lib/ai/embedding';
import { auth } from '../../../app/api/auth/auth';

export const getInformationTool = {
  description: `Get information from the user's comprehensive knowledge base (RAG) to answer questions.
The knowledge base contains information about:
- User's personal facts, preferences, work, goals, plans
- People in user's life (friends, family, colleagues, acquaintances)
- Things user is learning or studying
- Projects, hobbies, interests
- Events, experiences, memories
- Any context about user's life

Use this tool when:
- User asks about themselves, their preferences, work, goals, plans, or past information
- User asks about people in their life
- User asks about things they're learning or studying
- You need context about the user to provide personalized answers
- User asks "what do you know about me" or similar questions
- You need to recall information mentioned in previous conversations

The tool searches through all saved information using semantic similarity and returns the most relevant content.`,
  inputSchema: z.object({
    question: z.string().describe('The question or query to search for in the knowledge base. Can be a question or keywords.'),
  }),
  execute: async ({ question }: { question: string }) => {
    try {
      const session = await auth();
      const userId = session?.user?.id;
      if (!userId) {
        console.log('[getInformation] No userId found');
        return [];
      }
      
      // Try the original question first
      let results = await findRelevantContent(question, userId);
      
      // If no results and question is about "my name", try alternative queries
      if (results.length === 0 && /(my name|what.*name|who.*i|i am|i'm)/i.test(question)) {
        console.log(`[getInformation] Trying alternative queries for name question`);
        const alternatives = ['name', 'my name', 'I am', 'I\'m'];
        for (const alt of alternatives) {
          const altResults = await findRelevantContent(alt, userId);
          if (altResults.length > 0) {
            results = altResults;
            break;
          }
        }
      }
      
      // Format results for better AI understanding
      if (results.length === 0) {
        console.log(`[getInformation] No results found for question: "${question}"`);
        return [];
      }
      
      // Filter out very low similarity results (less than 0.3)
      const filteredResults = results.filter((r: any) => {
        const sim = typeof r.similarity === 'number' ? r.similarity : 0;
        return sim > 0.3;
      });
      
      if (filteredResults.length === 0 && results.length > 0) {
        console.log(`[getInformation] All results had low similarity, returning top result anyway`);
        // Return top result even if similarity is low, as it might still be relevant
        filteredResults.push(results[0]);
      }
      
      // Return results with similarity scores for AI to understand relevance
      return filteredResults.map((r: any) => ({
        content: r.content,
        similarity: typeof r.similarity === 'number' ? r.similarity : null,
        source: r.source,
        metadata: r.metadata,
      }));
    } catch (error) {
      console.error('[getInformation] Error:', error);
      return [];
    }
  },
} as const;

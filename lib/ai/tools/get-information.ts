import { z } from 'zod';
import { findRelevantContent } from '@/lib/ai/embedding';
import { auth } from '../../../app/api/auth/auth';

export const getInformationTool = {
  description: `Search the user's comprehensive knowledge base (RAG) to find relevant information for answering their questions.

The knowledge base contains information about:
- User's personal facts, preferences, work, goals, plans
- Notes, documents, and saved content
- People in user's life (friends, family, colleagues, acquaintances)
- Things user is learning or studying
- Projects, hobbies, interests
- Events, experiences, memories
- Any context about user's life

Use this tool when:
- User asks about themselves, their preferences, work, goals, plans, or past information
- User asks about their notes, documents, or saved content
- User asks about people in their life
- User asks about things they're learning or studying
- You need context about the user to provide personalized answers
- User asks "what do you know about me" or similar questions
- You need to recall information mentioned in previous conversations

IMPORTANT: After getting results from this tool, adapt your response based on what the user asked for:
- If user asks for SUMMARY/OVERVIEW/KEY POINTS → synthesize a brief summary of the main points
- If user asks for FULL TEXT/COMPLETE CONTENT → provide the complete text from the search results
- If user asks a specific question → extract the specific answer from the content
- The relevance score (0-1) indicates how relevant each result is - ONLY use results with relevance > 0.5 unless there are no better options
- The rank indicates the order (1 = most relevant)
- If a result has low relevance (< 0.5) and doesn't directly answer the question, IGNORE it

The tool searches using semantic similarity and returns the most relevant content chunks (max 5 results). Each chunk may be part of a larger document or note.
Only use results that are actually relevant to the user's question - don't include unrelated information.`,
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
      
      // Filter out low similarity results - use higher threshold for better relevance
      // Similarity is 0-1, where 1 is most similar
      // We want to keep only results with similarity > 0.5 (moderately relevant) or top 3 if all are lower
      const MIN_SIMILARITY = 0.5;
      const MAX_RESULTS = 5; // Limit to top 5 most relevant results
      
      let filteredResults = results.filter((r: any) => {
        const sim = typeof r.similarity === 'number' ? r.similarity : 0;
        return sim > MIN_SIMILARITY;
      });
      
      // If we have good results (similarity > 0.5), limit to top 5
      if (filteredResults.length > 0) {
        filteredResults = filteredResults.slice(0, MAX_RESULTS);
      } else if (results.length > 0) {
        // If no results meet the threshold, take top 3 results anyway (but log it)
        console.log(`[getInformation] No results with similarity > ${MIN_SIMILARITY}, returning top 3 results`);
        filteredResults = results.slice(0, 3).map((r: any) => {
          const sim = typeof r.similarity === 'number' ? r.similarity : 0;
          console.log(`[getInformation] Including result with similarity ${sim.toFixed(3)}: ${r.content?.substring(0, 50)}...`);
          return r;
        });
      }
      
      // Get full resource content for chunks that belong to resources
      // This allows AI to provide full text when requested
      const resourceIds = [...new Set(filteredResults.map((r: any) => r.resourceId).filter(Boolean))];
      let fullResources: Record<string, any> = {};
      
      if (resourceIds.length > 0) {
        try {
          const { db } = await import('@/lib/db');
          const { resources } = await import('@/lib/db/schema/resources');
          const { inArray } = await import('drizzle-orm');
          
          const fullRes = await db
            .select({
              id: resources.id,
              content: resources.content,
              metadata: resources.metadata,
            })
            .from(resources)
            .where(inArray(resources.id, resourceIds));
          
          fullRes.forEach((res: any) => {
            fullResources[res.id] = res;
          });
        } catch (err) {
          console.error('[getInformation] Error fetching full resources:', err);
        }
      }
      
      // Return results formatted for AI analysis
      // Include both chunk content and full resource content when available
      return filteredResults.map((r: any, index: number) => {
        const sim = typeof r.similarity === 'number' ? r.similarity : null;
        const fullResource = r.resourceId ? fullResources[r.resourceId] : null;
        
        return {
          // Chunk content (what matched the search)
          chunkContent: r.content,
          // Full resource content (if this chunk is part of a larger resource)
          fullContent: fullResource?.content || null,
          // Relevance score (0-1, higher is more relevant)
          relevance: sim,
          // Rank in search results (1 = most relevant)
          rank: index + 1,
          // Resource ID to identify if multiple chunks belong to same resource
          resourceId: r.resourceId || null,
          // Additional context
          source: r.source,
          metadata: r.metadata || fullResource?.metadata || null,
        };
      });
    } catch (error) {
      console.error('[getInformation] Error:', error);
      return [];
    }
  },
} as const;

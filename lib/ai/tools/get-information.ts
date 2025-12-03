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
- If user asks a specific question → extract the specific answer from the content
- The relevance score (0-1) indicates how relevant each result is - ONLY use results with relevance > 0.5 unless there are no better options
- The rank indicates the order (1 = most relevant)
- If a result has low relevance (< 0.5) and doesn't directly answer the question, IGNORE it

The tool searches using semantic similarity and returns the most relevant content (max 5 results). For resources: returns relevant chunks. For tables: returns full row data as text.
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
      
      // Enhance short queries with context for better embedding similarity
      // Short queries (single words) get lower similarity scores, so add context
      const enhancedQuery = question.trim().split(/\s+/).length <= 2 
        ? `information about ${question}` 
        : question;
      
      // Try the enhanced query first
      let results = await findRelevantContent(enhancedQuery, userId);
      
      // If enhanced query didn't help much, also try original
      if (results.length === 0 || (results.length > 0 && typeof results[0].similarity === 'number' && results[0].similarity < 0.4)) {
        const originalResults = await findRelevantContent(question, userId);
        // Use original if it gives better results
        if (originalResults.length > 0 && typeof originalResults[0].similarity === 'number') {
          const originalSim = originalResults[0].similarity;
          const enhancedSim = results.length > 0 && typeof results[0].similarity === 'number' ? results[0].similarity : 0;
          if (originalSim > enhancedSim) {
            results = originalResults;
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
      // Higher threshold ensures only truly relevant results are returned
      const MIN_SIMILARITY = 0.5; // Balanced threshold for relevance
      const MAX_RESULTS = 5; // Limit to top 5 most relevant results
      
      // Filter results by similarity threshold
      let filteredResults = results.filter((r: any) => {
        const sim = typeof r.similarity === 'number' ? r.similarity : 0;
        return sim > MIN_SIMILARITY;
      });
      
      // Filter out results that are just saying they don't have the information
      // These are false positives that don't actually contain the requested information
      filteredResults = filteredResults.filter((r: any) => {
        const content = (r.content || '').toLowerCase();
        // Filter out results that are just saying they don't have the information
        const isNegativeResponse = /(don't have|don't know|no information|not saved|not found|yet|if you share|i don't have|i don't know)/i.test(content);
        return !isNegativeResponse;
      });
      
      // If we have good results (similarity > threshold), limit to top 5
      if (filteredResults.length > 0) {
        filteredResults = filteredResults.slice(0, MAX_RESULTS);
      } else if (results.length > 0) {
        // If no results meet the threshold, take top results anyway (but log it)
        // Still filter out negative responses
        const fallbackCount = 3;
        let fallbackResults = results.slice(0, fallbackCount);
        
        // Filter out negative responses even in fallback
        fallbackResults = fallbackResults.filter((r: any) => {
          const content = (r.content || '').toLowerCase();
          const isNegativeResponse = /(don't have|don't know|no information|not saved|not found|yet|if you share|i don't have|i don't know)/i.test(content);
          return !isNegativeResponse;
        });
        
        filteredResults = fallbackResults;
      }
      
      // Return results formatted for AI analysis
      // All content comes from vector database (embeddings table)
      return filteredResults.map((r: any, index: number) => {
        const sim = typeof r.similarity === 'number' ? r.similarity : null;
        
        // Extract table info from metadata if source is table
        const tableInfo = r.source === 'table' && r.metadata ? {
          tableId: r.metadata.tableId,
          tableTitle: r.metadata.tableTitle,
        } : null;
        
        return {
          // Content from vector database (chunks for resources, full row text for tables)
          content: r.content,
          // Relevance score (0-1, higher is more relevant)
          relevance: sim,
          // Rank in search results (1 = most relevant)
          rank: index + 1,
          // Source ID (unified ID for resource/table/calendar)
          sourceId: r.sourceId || null,
          // Table metadata if from a table (from embeddings.metadata)
          tableInfo: tableInfo,
          // Additional context
          source: r.source,
          metadata: r.metadata || null,
        };
      });
    } catch (error) {
      console.error('[getInformation] Error:', error);
      return [];
    }
  },
} as const;

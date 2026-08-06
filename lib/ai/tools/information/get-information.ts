import { z } from 'zod';
import { findRelevantContent } from '@/lib/ai/embedding';
import { expandQuery } from '@/lib/ai/query-expansion';
import { getSessionOrNull } from '@/lib/utils/auth';

// Configuration constants
const MIN_SIMILARITY = 0.5; // Balanced threshold for relevance
const MAX_RESULTS = 5; // Limit to top 5 most relevant results

// Helper function to filter out negative responses
function isNegativeResponse(content: string): boolean {
  const lower = content.toLowerCase();
  const negativePatterns = [
    /don't have/i,
    /don't know/i,
    /no information/i,
    /not saved/i,
    /not found/i,
    /if you share/i,
    /i don't have/i,
    /i don't know/i,
    /yet to be/i,
    /haven't been/i,
    /hasn't been/i,
  ];
  return negativePatterns.some(pattern => pattern.test(lower));
}

// Helper function to deduplicate results by content
function deduplicateResults(results: any[]): any[] {
  const seen = new Set<string>();
  const unique: any[] = [];
  
  for (const result of results) {
    // Create a key from content (normalized)
    const contentKey = (result.content || '').trim().toLowerCase().slice(0, 200);
    if (!seen.has(contentKey) && contentKey.length > 0) {
      seen.add(contentKey);
      unique.push(result);
    }
  }
  
  return unique;
}

// Helper function to aggregate results from multiple queries
function aggregateResults(allResults: any[][]): any[] {
  // Flatten all results
  const flattened = allResults.flat();
  
  // Deduplicate by content
  const deduplicated = deduplicateResults(flattened);
  
  // Sort by similarity (descending)
  const sorted = deduplicated.sort((a, b) => {
    const simA = typeof a.similarity === 'number' ? a.similarity : 0;
    const simB = typeof b.similarity === 'number' ? b.similarity : 0;
    return simB - simA;
  });
  
  return sorted;
}

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

The tool searches using semantic similarity with multiple query variations and returns the most relevant content (max 5 results). For resources: returns relevant chunks. For tables: returns full row data as text.
Only use results that are actually relevant to the user's question - don't include unrelated information.`,
  inputSchema: z.object({
    question: z.string().describe('The question or query to search for in the knowledge base. Can be a question or keywords.'),
  }),
  execute: async ({ question }: { question: string }) => {
    const startTime = Date.now();
    let logContext: any = {
      question,
      userId: null,
      queryVariations: [],
      totalResults: 0,
      filteredResults: 0,
      finalResults: 0,
      executionTime: 0,
    };
    
    try {
      const session = await getSessionOrNull();
      const userId = session?.user?.id;
      if (!userId) {
        console.log('[getInformation] No userId found');
        return [];
      }
      
      logContext.userId = userId;
      
      // Rewrite the question into the queries actually worth searching.
      const queryVariations = await expandQuery(question, 'getInformation');
      logContext.queryVariations = queryVariations;

      console.log(`[getInformation] Searching ${queryVariations.length} queries for "${question}": ${queryVariations.slice(1).join(' | ') || '(no expansion)'}`);
      
      // Execute all queries in parallel for better performance
      const queryPromises = queryVariations.map((query, idx) =>
        findRelevantContent(query, userId, {
          caller: `getInformation[var ${idx + 1}/${queryVariations.length}]`,
        }).catch(err => {
          console.error(`[getInformation] Error searching with query "${query}":`, err);
          return [];
        })
      );
      
      const allResultsArrays = await Promise.all(queryPromises);
      logContext.totalResults = allResultsArrays.reduce((sum, arr) => sum + arr.length, 0);
      
      // Aggregate results from all queries
      const aggregatedResults = aggregateResults(allResultsArrays);
      
      if (aggregatedResults.length === 0) {
        const executionTime = Date.now() - startTime;
        logContext.executionTime = executionTime;
        console.log(`[getInformation] No results found after ${executionTime}ms. Query: "${question}", Variations: ${queryVariations.length}`);
        return [];
      }
      
      // Filter by similarity threshold
      let filteredResults = aggregatedResults.filter((r: any) => {
        const sim = typeof r.similarity === 'number' ? r.similarity : 0;
        return sim > MIN_SIMILARITY;
      });
      
      logContext.filteredResults = filteredResults.length;
      
      // Filter out negative responses
      filteredResults = filteredResults.filter((r: any) => {
        const content = r.content || '';
        return !isNegativeResponse(content);
      });
      
      // If we have good results, limit to top results
      if (filteredResults.length > 0) {
        filteredResults = filteredResults.slice(0, MAX_RESULTS);
      } else if (aggregatedResults.length > 0) {
        // Fallback: if no results meet threshold, take top results anyway
        // But still filter out negative responses
        const fallbackResults = aggregatedResults
          .filter((r: any) => {
            const content = r.content || '';
            return !isNegativeResponse(content);
          })
          .slice(0, 3); // Take top 3 in fallback
        
        filteredResults = fallbackResults;
        
        if (fallbackResults.length > 0) {
          const topSim = typeof fallbackResults[0].similarity === 'number' ? fallbackResults[0].similarity : 0;
          console.log(`[getInformation] Using fallback results (top similarity: ${topSim.toFixed(3)}). Query: "${question}"`);
        }
      }
      
      logContext.finalResults = filteredResults.length;
      
      // Format results for AI analysis
      const formattedResults = filteredResults.map((r: any, index: number) => {
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
      
      const executionTime = Date.now() - startTime;
      logContext.executionTime = executionTime;
      
      // Log summary
      if (formattedResults.length > 0) {
        const topRelevance = formattedResults[0].relevance;
        console.log(`[getInformation] Found ${formattedResults.length} results (top relevance: ${topRelevance?.toFixed(3) || 'N/A'}) in ${executionTime}ms. Query: "${question}"`);
      } else {
        console.log(`[getInformation] No relevant results found in ${executionTime}ms. Query: "${question}"`);
      }
      
      return formattedResults;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logContext.executionTime = executionTime;
      logContext.error = error instanceof Error ? error.message : 'Unknown error';
      console.error('[getInformation] Error:', error, logContext);
      return [];
    }
  },
} as const;


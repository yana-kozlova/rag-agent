import { z } from 'zod';
import { findRelevantContent, generateQueryEmbeddings } from '@/lib/ai/embedding';
import { embeddingCache } from '@/lib/ai/embedding-cache';
import { expandQuery } from '@/lib/ai/query-expansion';
import { getSessionOrNull } from '@/lib/utils/auth';

// Configuration constants
const MIN_SIMILARITY = 0.5; // Balanced threshold for relevance
const MAX_RESULTS = 5; // Limit to top 5 most relevant results

/**
 * Whether a hit is worth showing the model.
 *
 * Cosine is the right test for a chunk the vector half found and the wrong one
 * for a chunk the lexical half found. A chunk holding an invoice number, a
 * surname or a library version scores low against the question by construction
 * — the rest of the chunk is about something else, which is exactly why the
 * embedding did not rank it and exactly why full-text search was added. Judging
 * it on similarity anyway deleted every lexical-only hit before the model saw
 * one, and the second retriever paid for itself in nothing.
 */
function isRelevant(result: any): boolean {
  if (result.lexical) return true;
  const sim = typeof result.similarity === 'number' ? result.similarity : 0;
  return sim > MIN_SIMILARITY;
}

/** How many chunks of any one note or table may occupy the final answer. */
const MAX_PER_SOURCE = 2;

/**
 * The results, plus what they are.
 *
 * This tool used to return a bare array of at most `MAX_RESULTS`, and nothing
 * in it said so. A model handed five rows cannot tell "five matched" from "five
 * is all you get", and it duly answered "скільки разів Арчі прийняв апоквель"
 * with "5" over a table holding twenty-one of them — the number was the cap.
 * The same silence read an empty array as an empty table and told the user a
 * table of twenty-three rows had no records in it.
 *
 * Neither is a retrieval bug: top-k is what retrieval is for. The bug was
 * returning a sample in the shape of a complete answer, so the envelope now
 * says which it is, and where to go for the other one. Same rule as the
 * briefing's assembled lines — anything to be concluded from the numbers is
 * stated by the application, not left for the model to infer.
 */
type SearchAnswer = {
  results: unknown[];
  returned: number;
  /** Hit the cap, so there is very probably more than this. */
  capped: boolean;
  message: string;
};

/**
 * The search did not run, which is not the same as finding nothing.
 *
 * `fetchEventsBetween` returning `[]` for both "nothing scheduled" and "Google
 * refused to answer" cost this user five mornings of "календар вільний". The
 * same two states meet here, and collapsing them would have the assistant
 * report an empty knowledge base because an embedding call timed out.
 */
function searchFailed(reason: string): SearchAnswer {
  return {
    results: [],
    returned: 0,
    capped: false,
    message:
      `The search did not run: ${reason}. This is NOT an empty result — nothing was looked at. ` +
      `Say the search failed; never tell the user they have nothing saved.`,
  };
}

function answer(results: unknown[], question: string): SearchAnswer {
  const returned = results.length;
  const capped = returned >= MAX_RESULTS;

  if (returned === 0) {
    return {
      results,
      returned,
      capped: false,
      message:
        `Nothing in the knowledge base matched "${question}". That is a SEARCH result, not a census: ` +
        `it means nothing matched, never that the user has no such data. Do not tell them a table, a ` +
        `list or a topic is empty on this evidence — read the thing itself (getTableRows, getTasks, ` +
        `getTimeline, getWellbeing) before saying anything is empty.`,
    };
  }

  return {
    results,
    returned,
    capped,
    message:
      `${returned} passage(s), ranked by relevance` +
      (capped ? `, and this is the cap of ${MAX_RESULTS} — there are very likely more.` : '.') +
      ` A SAMPLE of what is stored, never the complete set: do not count from it, do not present it ` +
      `as all of anything, and do not call it a table's contents. For an exact count or a full list ` +
      `use getTableRows (a table), getTasks, getTimeline or getWellbeing.`,
  };
}

/**
 * Spread the answer over the notes it came from.
 *
 * Ranking alone is blind to where a chunk lives, and a long document is many
 * chunks about one subject: all five slots would go to five consecutive
 * paragraphs of the same book while the note that actually answers the question
 * sat sixth. Deduplication does not catch it — the chunks differ, they are
 * simply all the same source saying much the same thing.
 *
 * The cap spreads, it never shrinks: anything it holds back is used to fill the
 * remaining slots rather than returning fewer results than were asked for.
 */
function diversifyBySource(results: any[], limit: number): any[] {
  const takenFrom = new Map<string, number>();
  const picked: any[] = [];
  const heldBack: any[] = [];

  for (const result of results) {
    if (picked.length >= limit) break;
    const key = result?.sourceId ?? '';
    const taken = takenFrom.get(key) ?? 0;
    if (key && taken >= MAX_PER_SOURCE) {
      heldBack.push(result);
      continue;
    }
    takenFrom.set(key, taken + 1);
    picked.push(result);
  }

  for (const result of heldBack) {
    if (picked.length >= limit) break;
    picked.push(result);
  }

  return picked;
}

/** Cosine as a number, for the several places that have to tolerate its absence. */
function similarityOf(result: any): number {
  return typeof result?.similarity === 'number' ? result.similarity : 0;
}

/** Fusion score as a number; a result from an older shape simply scores nothing. */
function scoreOf(result: any): number {
  return typeof result?.score === 'number' ? result.score : 0;
}

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

/**
 * Drop chunks whose text repeats one already kept.
 *
 * Distinct chunks really can carry the same sentence — a fact folded into a
 * dossier often survives verbatim in the note it came from — and showing the
 * model the same claim twice spends a result slot to say nothing. Runs *after*
 * ranking, so the copy that survives is the best-scored one rather than
 * whichever arrived first.
 */
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

/** The page a hit can be opened on, or null when it has no page of its own. */
function resultUrl(result: any, tableInfo: { tableId?: string } | null): string | null {
  if (result.source === 'resource' && result.sourceId) return `/resources/${result.sourceId}`;
  if (tableInfo?.tableId) return `/tables/${tableInfo.tableId}`;
  return null;
}

/**
 * One entry per chunk, ranked by the fusion scores it earned.
 *
 * Every variant returns its own fused ranking, and those scores are on the same
 * `1/(k + rank)` scale whoever produced them — so a chunk that two variants both
 * ranked highly adds them up and rises above one that a single variant liked.
 * That is the entire reason for asking the question more than one way.
 *
 * This used to sort on `similarity`, which threw the fusion away at the last
 * step: cosine decided the final order, and the lexical retriever and the
 * recency boost could only change which chunks were available for cosine to
 * sort. Whatever ranking `findRelevantContent` computed was overwritten one
 * function later.
 */
function aggregateResults(allResults: any[][]): any[] {
  const byChunk = new Map<string, any>();

  for (const result of allResults.flat()) {
    // Chunk id where there is one; the text otherwise, so that a caller
    // returning an older shape degrades to the previous behaviour rather than
    // collapsing every result onto one key.
    const key = result?.id || (result?.content || '').trim().toLowerCase().slice(0, 200);
    if (!key) continue;

    const existing = byChunk.get(key);
    if (!existing) {
      byChunk.set(key, { ...result, score: scoreOf(result) });
      continue;
    }

    existing.score += scoreOf(result);
    // The best cosine any phrasing achieved. `similarity` describes this chunk
    // against the question, and the variant that worded it best is the truest
    // reading of that — averaging would punish a chunk for the variants that
    // missed it.
    if (similarityOf(result) > similarityOf(existing)) existing.similarity = result.similarity;
    existing.lexical = existing.lexical || result.lexical;
  }

  const ranked = [...byChunk.values()].sort((a, b) => scoreOf(b) - scoreOf(a));
  return deduplicateResults(ranked);
}

/** Internals the ranking tests reach for; not part of the tool's contract. */
export const __test = {
  aggregateResults,
  diversifyBySource,
  isRelevant,
  deduplicateResults,
  answer,
  searchFailed,
  MAX_RESULTS,
};

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
- Results arrive already ranked and already filtered. "rank" is that order (1 = best) and is the signal to trust
- "relevance" (0-1) is semantic closeness ALONE. A low number is not a bad result: a chunk kept because it matches the exact wording — a name, an invoice number, a version — scores low by construction, since the rest of it is about something else. That is often the result you want
- Judge each result on whether it answers the question, not on its relevance number, and ignore the ones that do not

The tool searches semantically and by exact wording at once, over several phrasings of the question, and returns the most relevant content (max ${MAX_RESULTS} results). For resources: returns relevant chunks. For tables: returns full row data as text.
Only use results that are actually relevant to the user's question - don't include unrelated information.

THIS IS A SAMPLE, NEVER A SET. The result is the top few matches out of everything stored, capped at ${MAX_RESULTS}. So:
- NEVER count from it. "Скільки разів...", "how many..." cannot be answered here — the number you would report is the cap, not the data.
- NEVER present it as all of something, and never as a table's contents.
- An empty result means nothing MATCHED. It never means the user has nothing: do not tell them a table, a list or a topic is empty on this evidence.
- For an exact count or a complete list, use the tool that reads the whole thing: getTableRows for a table, getTasks for tasks, getTimeline for dates, getWellbeing for check-ins.

Each result carries a "title" (what the note or table is called — use it when referring to the source) and a "url" — the page that item can be opened on. To point the user at something they saved, write a Markdown link whose target is exactly that value: [Title](/resources/abc123). Never build a link out of an id, and never link a result whose url is null.`,
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
        return searchFailed('no signed-in user');
      }
      
      logContext.userId = userId;

      // The whole answer, keyed on the question as asked.
      //
      // The cache used to sit one level down, inside `findRelevantContent` and
      // keyed per query variant — so asking the same thing twice still paid for
      // the rewrite standing in front of the searches, up to four seconds before
      // the first row was read. Any write to the knowledge base clears the
      // user's entries, so a stale answer cannot outlive the note behind it.
      const cached = embeddingCache.get(userId, question, 'answer');
      if (cached) {
        console.log(`[getInformation] Cache hit in ${Date.now() - startTime}ms for "${question}"`);
        // The cache holds the results, not the envelope: what they are is a
        // property of the results and is cheaper to restate than to store.
        return answer(cached, question);
      }

      // Rewrite the question into the queries actually worth searching.
      const queryVariations = await expandQuery(question, 'getInformation');
      logContext.queryVariations = queryVariations;

      console.log(`[getInformation] Searching ${queryVariations.length} queries for "${question}": ${queryVariations.slice(1).join(' | ') || '(no expansion)'}`);

      // Every phrasing in one embeddings request rather than one request each.
      // A failure here is not fatal: each search falls back to embedding its own
      // query, which is what all of them did before.
      const variantEmbeddings = await generateQueryEmbeddings(queryVariations, 'getInformation').catch(
        (err) => {
          console.error('[getInformation] Batched query embedding failed, embedding per query:', err);
          return [] as number[][];
        }
      );

      // Execute all queries in parallel for better performance
      const queryPromises = queryVariations.map((query, idx) =>
        findRelevantContent(query, userId, {
          caller: `getInformation[var ${idx + 1}/${queryVariations.length}]`,
          embedding: variantEmbeddings[idx],
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
        // Worth caching: "there is nothing about this" costs the same rewrite and
        // the same searches to establish as an answer does, and the agent asks
        // twice within a turn more often than it finds something on the retry.
        embeddingCache.set(userId, question, [], 'answer');
        return answer([], question);
      }
      
      // Filter by relevance: cosine for a semantic hit, admission for a lexical one
      let filteredResults = aggregatedResults.filter(isRelevant);

      logContext.filteredResults = filteredResults.length;
      
      // Filter out negative responses
      filteredResults = filteredResults.filter((r: any) => {
        const content = r.content || '';
        return !isNegativeResponse(content);
      });
      
      // If we have good results, limit to top results
      if (filteredResults.length > 0) {
        filteredResults = diversifyBySource(filteredResults, MAX_RESULTS);
      } else if (aggregatedResults.length > 0) {
        // Fallback: if no results meet threshold, take top results anyway
        // But still filter out negative responses
        const fallbackResults = diversifyBySource(
          aggregatedResults.filter((r: any) => {
            const content = r.content || '';
            return !isNegativeResponse(content);
          }),
          3 // Take top 3 in fallback
        );

        filteredResults = fallbackResults;
        
        if (fallbackResults.length > 0) {
          console.log(
            `[getInformation] Using fallback results (top similarity: ${similarityOf(fallbackResults[0]).toFixed(3)}). Query: "${question}"`
          );
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
          // What this chunk belongs to. Without it the model is judging and
          // citing a passage torn out of the middle of something it cannot name,
          // and a link it offers has no text to put in the brackets.
          title: r.title || tableInfo?.tableTitle || null,
          // Content from vector database (chunks for resources, full row text for tables)
          content: r.content,
          // Relevance score (0-1, higher is more relevant)
          relevance: sim,
          // Rank in search results (1 = most relevant)
          rank: index + 1,
          // Source ID (unified ID for resource/table/calendar)
          sourceId: r.sourceId || null,
          // Where this result lives in the app. Handed over so that a citation
          // is a real address: asked to link a note without one, the model
          // invents an anchor like `#<id>`, which renders as dead text.
          url: resultUrl(r, tableInfo),
          // Table metadata if from a table (from embeddings.metadata)
          tableInfo: tableInfo,
          // Additional context
          source: r.source,
          metadata: r.metadata || null,
        };
      });
      
      embeddingCache.set(userId, question, formattedResults, 'answer');

      const executionTime = Date.now() - startTime;
      logContext.executionTime = executionTime;

      // Log summary
      if (formattedResults.length > 0) {
        const topRelevance = formattedResults[0].relevance;
        console.log(`[getInformation] Found ${formattedResults.length} results (top relevance: ${topRelevance?.toFixed(3) || 'N/A'}) in ${executionTime}ms. Query: "${question}"`);
      } else {
        console.log(`[getInformation] No relevant results found in ${executionTime}ms. Query: "${question}"`);
      }
      
      return answer(formattedResults, question);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logContext.executionTime = executionTime;
      logContext.error = error instanceof Error ? error.message : 'Unknown error';
      console.error('[getInformation] Error:', error, logContext);
      return searchFailed(error instanceof Error ? error.message : 'unknown error');
    }
  },
} as const;


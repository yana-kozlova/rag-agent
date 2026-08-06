import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '@/lib/env.mjs';
import { db } from '../db';
import { sql, and } from 'drizzle-orm';
import { embeddings } from '@/lib/db/schema';
import { resources } from '@/lib/db/schema';
import { userTablesData, userTables } from '@/lib/db/schema';
import { logLlmUsage } from './telemetry';
import { fuseByRrf, recencyBoost, toTsQuery } from './retrieval';

const EMBED_MODEL_NAME = env.AI_EMBED_MODEL || 'text-embedding-3-small';
const embeddingModel = openai.embedding(EMBED_MODEL_NAME);

const DEFAULT_CHUNK_SIZE = env.EMBED_CHUNK_SIZE ?? 800;
const DEFAULT_CHUNK_OVERLAP = env.EMBED_CHUNK_OVERLAP ?? 200;

// Content type detection for adaptive chunking
type ContentType = 'list' | 'code' | 'heading' | 'table' | 'paragraph' | 'mixed';

function detectContentType(text: string): ContentType {
  // Check for code blocks
  if (text.includes('```') || text.match(/^\s*[{}[\](]|=>|->|::/)) {
    return 'code';
  }
  
  // Check for lists (markdown or plain)
  const listPattern = /^[\s]*[-*+]|\d+\./m;
  if (listPattern.test(text)) {
    return 'list';
  }
  
  // Check for headings
  if (text.match(/^#{1,6}\s+/m)) {
    return 'heading';
  }
  
  // Check for tables (markdown or pipe-separated)
  if (text.includes('|') && text.split('\n').filter(line => line.includes('|')).length >= 2) {
    return 'table';
  }
  
  // Check for paragraph-heavy content
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  if (paragraphs.length >= 3) {
    return 'paragraph';
  }
  
  return 'mixed';
}

// Adaptive chunk size based on content type
function getAdaptiveChunkSize(baseSize: number, contentType: ContentType): number {
  switch (contentType) {
    case 'code':
      return Math.min(baseSize * 1.5, 1200); // Code needs more context
    case 'list':
      return baseSize; // Lists are usually well-structured
    case 'heading':
      return Math.max(baseSize * 0.8, 400); // Headings with content
    case 'table':
      return baseSize * 1.2; // Tables need to stay together
    case 'paragraph':
      return baseSize;
    default:
      return baseSize;
  }
}

// Preserve context (headings, list markers) in chunks
function preserveContext(chunk: string, previousContext?: string): string {
  if (!previousContext) return chunk;
  
  // Extract heading from previous context if it exists
  const headingMatch = previousContext.match(/^(#{1,6}\s+.+)$/m);
  if (headingMatch) {
    return `${headingMatch[1]}\n\n${chunk}`;
  }
  
  // Extract list marker if chunk continues a list
  const listMarkerMatch = previousContext.match(/(^[\s]*[-*+]|\d+\.)\s+.+$/m);
  if (listMarkerMatch && chunk.match(/^[\s]*[-*+]|\d+\./m)) {
    // List continues, no need to add context
    return chunk;
  }
  
  return chunk;
}

const generateChunks = (
  input: string, 
  size = DEFAULT_CHUNK_SIZE, 
  overlap = DEFAULT_CHUNK_OVERLAP,
  preserveContextEnabled = true
): string[] => {
  const normalized = input.trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= size) return [normalized];

  const chunks: string[] = [];
  const contentType = detectContentType(normalized);
  const adaptiveSize = getAdaptiveChunkSize(size, contentType);
  
  // For code blocks, try to preserve entire blocks
  if (contentType === 'code') {
    // Match code blocks with their delimiters
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks: Array<{ text: string; index: number }> = [];
    let match;
    
    while ((match = codeBlockRegex.exec(normalized)) !== null) {
      codeBlocks.push({ text: match[0], index: match.index });
    }
    
    if (codeBlocks.length > 0) {
      // Has code blocks - preserve them
      const result: string[] = [];
      let currentChunk = '';
      let lastIndex = 0;
      
      for (const codeBlock of codeBlocks) {
        // Add text before code block
        const textBefore = normalized.slice(lastIndex, codeBlock.index);
        if (textBefore.trim().length > 0) {
          if (currentChunk.length + textBefore.length > adaptiveSize && currentChunk.length > 0) {
            result.push(currentChunk.trim());
            currentChunk = textBefore;
          } else {
            currentChunk += (currentChunk ? '\n\n' : '') + textBefore;
          }
        }
        
        // Add code block
        if (currentChunk.length + codeBlock.text.length > adaptiveSize && currentChunk.length > 0) {
          result.push(currentChunk.trim());
          currentChunk = codeBlock.text;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + codeBlock.text;
        }
        
        lastIndex = codeBlock.index + codeBlock.text.length;
      }
      
      // Add remaining text after last code block
      const textAfter = normalized.slice(lastIndex);
      if (textAfter.trim().length > 0) {
        if (currentChunk.length + textAfter.length > adaptiveSize && currentChunk.length > 0) {
          result.push(currentChunk.trim());
          currentChunk = textAfter;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + textAfter;
        }
      }
      
      if (currentChunk.trim().length > 0) {
        result.push(currentChunk.trim());
      }
      
      return result.length > 0 ? result : [normalized];
    }
  }
  
  // For lists, preserve list items together
  if (contentType === 'list') {
    const lines = normalized.split('\n');
    const result: string[] = [];
    let currentChunk = '';
    let previousContext = '';
    
    for (const line of lines) {
      const isListItem = /^[\s]*[-*+]|\d+\./.test(line);
      
      if (isListItem) {
        // If adding this item would exceed size, save current chunk
        if (currentChunk.length + line.length + 1 > adaptiveSize && currentChunk.length > 0) {
          result.push(preserveContextEnabled ? preserveContext(currentChunk.trim(), previousContext) : currentChunk.trim());
          previousContext = currentChunk;
          currentChunk = line;
        } else {
          currentChunk += (currentChunk ? '\n' : '') + line;
        }
      } else {
        // Non-list line (might be heading or paragraph)
        if (currentChunk.length + line.length + 1 > adaptiveSize && currentChunk.length > 0) {
          result.push(preserveContextEnabled ? preserveContext(currentChunk.trim(), previousContext) : currentChunk.trim());
          previousContext = currentChunk;
          currentChunk = line;
        } else {
          currentChunk += (currentChunk ? '\n' : '') + line;
        }
      }
    }
    
    if (currentChunk.trim().length > 0) {
      result.push(preserveContextEnabled ? preserveContext(currentChunk.trim(), previousContext) : currentChunk.trim());
    }
    
    return result.length > 0 ? result : [normalized];
  }
  
  // For large texts, try to split by paragraphs first, then by sentences
  const isLargeText = normalized.length > adaptiveSize * 10;
  
  if (isLargeText) {
    // Split by double newlines (paragraphs) first
    const paragraphs = normalized.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    let currentChunk = '';
    let previousContext = '';
    
    for (const para of paragraphs) {
      const paraTrimmed = para.replace(/\s+/g, ' ').trim();
      
      // If adding this paragraph would exceed size, save current chunk and start new one
      if (currentChunk.length + paraTrimmed.length + 1 > adaptiveSize && currentChunk.length > 0) {
        chunks.push(preserveContextEnabled ? preserveContext(currentChunk.trim(), previousContext) : currentChunk.trim());
        previousContext = currentChunk;
        // Start new chunk with overlap from previous
        const overlapText = currentChunk.slice(-Math.min(overlap, currentChunk.length));
        currentChunk = overlapText + ' ' + paraTrimmed;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + paraTrimmed;
      }
    }
    
    // Add remaining chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(preserveContextEnabled ? preserveContext(currentChunk.trim(), previousContext) : currentChunk.trim());
    }
    
    // If we still have very large chunks, split them by sentences
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length <= adaptiveSize) {
        finalChunks.push(chunk);
      } else {
        // Split large chunk by sentences
        const sentences = chunk.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        let sentenceChunk = '';
        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length + 1 > adaptiveSize && sentenceChunk.length > 0) {
            finalChunks.push(sentenceChunk.trim());
            sentenceChunk = sentence;
          } else {
            sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
          }
        }
        if (sentenceChunk.trim().length > 0) {
          finalChunks.push(sentenceChunk.trim());
        }
      }
    }
    return finalChunks;
  }
  
  // For smaller texts, use improved logic with context preservation
  const normalizedSpaces = normalized.replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
  let start = 0;
  let previousContext = '';
  
  while (start < normalizedSpaces.length) {
    const end = Math.min(start + adaptiveSize, normalizedSpaces.length);
    let chunk = normalizedSpaces.slice(start, end);
    
    // Try to break at sentence boundary
    if (end < normalizedSpaces.length) {
      const lastSentence = chunk.lastIndexOf('. ');
      const lastQuestion = chunk.lastIndexOf('? ');
      const lastExclamation = chunk.lastIndexOf('! ');
      const lastBreak = Math.max(lastSentence, lastQuestion, lastExclamation);
      
      if (lastBreak > adaptiveSize * 0.5) {
        chunk = chunk.slice(0, lastBreak + 1);
      }
    }
    
    const trimmed = chunk.trim();
    if (trimmed.length > 0) {
      chunks.push(preserveContextEnabled ? preserveContext(trimmed, previousContext) : trimmed);
      previousContext = trimmed;
    }
    
    if (end >= normalizedSpaces.length) break;
    start += Math.max(1, adaptiveSize - overlap);
  }
  
  return chunks;
};

/**
 * Ceilings on one embeddings request, well inside OpenAI's.
 *
 * The API rejects a request carrying more than 2048 inputs or 300k tokens, and
 * a note or a PDF never came close — but a book does. A 300-page EPUB chunks
 * into the high hundreds, so sending every chunk in one call fails outright on
 * exactly the documents this was added for. The character budget is deliberately
 * pessimistic: Cyrillic runs closer to two characters per token than four, and
 * the limit that matters is tokens.
 */
const MAX_CHUNKS_PER_BATCH = 256;
const MAX_CHARS_PER_BATCH = 150_000;

/** Split chunks into request-sized groups, respecting both ceilings. */
function batchChunks(chunks: string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let chars = 0;

  for (const chunk of chunks) {
    // A single chunk over the budget still has to go somewhere; it ships alone.
    if (batch.length > 0 && (batch.length >= MAX_CHUNKS_PER_BATCH || chars + chunk.length > MAX_CHARS_PER_BATCH)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(chunk);
    chars += chunk.length;
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}

export const generateEmbeddings = async (
  value: string,
  caller: string = 'generateEmbeddings',
): Promise<Array<{ embedding: number[]; content: string }>> => {
  const chunks = generateChunks(value);
  if (chunks.length === 0) return [];

  const batches = batchChunks(chunks);
  const embeddings: number[][] = [];

  // Sequential on purpose: a book is hundreds of chunks, and firing every batch
  // at once is the reliable way to hit a rate limit on the one upload that most
  // needs to succeed.
  for (const [index, batch] of batches.entries()) {
    const startedAt = Date.now();
    const result = await embedMany({
      model: embeddingModel,
      values: batch,
    });
    logLlmUsage({
      op: 'embedMany',
      model: EMBED_MODEL_NAME,
      caller,
      inputChars: batch.reduce((sum, c) => sum + c.length, 0),
      batchSize: batch.length,
      usage: (result as any).usage
        ? { totalTokens: (result as any).usage.tokens ?? (result as any).usage.totalTokens }
        : undefined,
      durationMs: Date.now() - startedAt,
      note: batches.length > 1 ? `batch ${index + 1}/${batches.length}` : undefined,
    });
    embeddings.push(...result.embeddings);
  }

  return embeddings.map((e, i) => ({ content: chunks[i], embedding: e }));
};

export const generateEmbedding = async (
  value: string,
  caller: string = 'generateEmbedding',
): Promise<number[]> => {
  const input = value.replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
  const startedAt = Date.now();
  const result = await embed({
    model: embeddingModel,
    value: input,
  });
  logLlmUsage({
    op: 'embed',
    model: EMBED_MODEL_NAME,
    caller,
    inputChars: input.length,
    usage: (result as any).usage
      ? { totalTokens: (result as any).usage.tokens ?? (result as any).usage.totalTokens }
      : undefined,
    durationMs: Date.now() - startedAt,
  });
  return result.embedding;
};

/**
 * How many candidates each retriever contributes before fusion.
 *
 * Wider than the number returned, and necessarily so: a document that only one
 * retriever ranks well has to appear in that retriever's list at all before
 * fusion can promote it. Cutting each list at `topK` would throw away exactly
 * the results the second retriever was added to find.
 */
const CANDIDATE_MULTIPLIER = 4;
const MIN_CANDIDATES = 24;

export const findRelevantContent = async (
  userQuery: string,
  userId: string,
  options?: {
    useCache?: boolean;
    useHybridSearch?: boolean;
    minDate?: Date;
    maxDate?: Date;
    caller?: string;
  }
) => {
  const startTime = Date.now();
  const useCache = options?.useCache !== false; // Default to true
  const useHybridSearch = options?.useHybridSearch !== false; // Default to true
  const caller = options?.caller ?? 'findRelevantContent';
  
  try {
    // Check cache first
    if (useCache) {
      const { embeddingCache } = await import('./embedding-cache');
      const cached = embeddingCache.get(userId, userQuery);
      if (cached) {
        console.log(`[RAG Search] Cache hit for query: "${userQuery}"`);
        return cached;
      }
    }

    // Generate embedding for semantic search
    const userQueryEmbedded = await generateEmbedding(userQuery, `findRelevantContent(${caller})`);

    // Validate that every embedding value is a finite number to prevent injection via sql.raw()
    for (const val of userQueryEmbedded) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error('Invalid embedding value: expected finite numbers');
      }
    }

    const vectorString = `[${userQueryEmbedded.join(',')}]`;

    // The lexical half of the pair. Null when the query holds nothing to match
    // on — punctuation, a bare emoji — in which case the vector search runs alone.
    const tsQuery = useHybridSearch ? toTsQuery(userQuery) : null;

    // Cosine distance (<=>) matches the HNSW index built with vector_cosine_ops,
    // which lets Postgres use the index for ORDER BY instead of a sequential scan.
    // cosine_distance = 1 - cosine_similarity, so similarity = 1 - distance.
    const distance = sql<number>`${embeddings.embedding} <=> ${sql.raw(`'${vectorString}'::vector`)}`;
    const similarity = sql<number>`1 - (${embeddings.embedding} <=> ${sql.raw(`'${vectorString}'::vector`)})`;
    const topK = env.RAG_TOP_K ?? 8;

    // Build where clause
    let whereClause: any = sql`(
      (${embeddings.source} = 'resource' AND ${resources.userId} = ${userId}) OR
      (${embeddings.source} = 'table' AND ${userTables.userId} = ${userId})
    )`;
    
    // Add date filters if provided (only for resources, not tables)
    if (options?.minDate || options?.maxDate) {
      const dateConditions: any[] = [];
      if (options?.minDate) {
        dateConditions.push(sql`${resources.createdAt} >= ${sql.raw(`'${options.minDate.toISOString()}'::timestamp`)}`);
      }
      if (options?.maxDate) {
        dateConditions.push(sql`${resources.createdAt} <= ${sql.raw(`'${options.maxDate.toISOString()}'::timestamp`)}`);
      }
      
      // Apply date filters only to resources, not tables
      const dateFilter = dateConditions.length === 1 
        ? dateConditions[0]
        : dateConditions.length > 1
        ? and(...dateConditions)
        : null;
      
      if (dateFilter) {
        whereClause = and(
          whereClause,
          sql`(${embeddings.source} != 'table' AND ${dateFilter}) OR ${embeddings.source} = 'table'`
        );
      }
    }
    
    const candidateLimit = Math.max(topK * CANDIDATE_MULTIPLIER, MIN_CANDIDATES);

    // Both retrievers select the same shape, so fusion can treat their rows
    // interchangeably. `similarity` is computed on the lexical side too: a row
    // found only by keyword still needs a real cosine score, because callers
    // threshold on it.
    const selection = {
      id: embeddings.id,
      content: embeddings.content,
      similarity,
      source: embeddings.source,
      sourceId: embeddings.sourceId,
      resourceMetadata: resources.metadata,
      embeddingMetadata: embeddings.metadata,
      createdAt: resources.createdAt,
      updatedAt: resources.updatedAt,
    };

    const withOwnershipJoins = (query: any) =>
      query
        .from(embeddings)
        .leftJoin(resources, sql`${resources.id} = ${embeddings.sourceId} AND ${embeddings.source} = 'resource'`)
        .leftJoin(userTablesData, sql`${userTablesData.id} = ${embeddings.sourceId} AND ${embeddings.source} = 'table'`)
        .leftJoin(userTables, sql`${userTables.id} = ${userTablesData.userTableId}`);

    const vectorSearch = withOwnershipJoins(db.select(selection))
      .where(whereClause)
      .orderBy(distance)
      .limit(candidateLimit);

    // `content_tsv` is a generated column (migration 0015) and is not modelled
    // in the Drizzle schema, so it is referenced by name. `to_tsquery` takes
    // the query as a bound parameter — never interpolated text.
    const lexicalSearch = tsQuery
      ? withOwnershipJoins(
          db.select({
            ...selection,
            lexicalRank: sql<number>`ts_rank_cd(${embeddings}.content_tsv, to_tsquery('simple', ${tsQuery}))`,
          })
        )
          .where(and(whereClause, sql`${embeddings}.content_tsv @@ to_tsquery('simple', ${tsQuery})`))
          .orderBy(sql`ts_rank_cd(${embeddings}.content_tsv, to_tsquery('simple', ${tsQuery})) DESC`)
          .limit(candidateLimit)
      : Promise.resolve([] as any[]);

    // Independent queries against different indexes; there is nothing to
    // serialise them for. A lexical failure must not take the search down with
    // it — the vector half alone is the old behaviour, which is still useful.
    const [vectorRows, lexicalRows] = await Promise.all([
      vectorSearch,
      Promise.resolve(lexicalSearch).catch((err) => {
        console.error('[RAG Search] Lexical search failed, falling back to vector only:', err);
        return [] as any[];
      }),
    ]);

    const fused = fuseByRrf<any>([vectorRows, lexicalRows], (row) => row.id);

    // One row object per chunk, whichever list it arrived in.
    const byId = new Map<string, any>();
    for (const row of [...vectorRows, ...lexicalRows]) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }

    const now = new Date();
    const ranked = [...byId.values()]
      .map((row) => ({
        row,
        score: (fused.get(row.id) ?? 0) + recencyBoost(row.createdAt, now),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // `similarity` stays what its name says — cosine similarity, 0 to 1 — so
    // that the thresholds callers apply to it keep meaning something. The
    // fusion score rides alongside as `score`; it is a rank-derived number and
    // is not comparable across queries.
    const formattedResults = ranked.map(({ row, score }) => ({
      content: row.content,
      similarity: row.similarity,
      score,
      source: row.source,
      sourceId: row.sourceId,
      metadata: row.embeddingMetadata || row.resourceMetadata || null,
    }));

    // Cache results
    if (useCache) {
      const { embeddingCache } = await import('./embedding-cache');
      embeddingCache.set(userId, userQuery, formattedResults);
    }

    const executionTime = Date.now() - startTime;
    console.log(
      `[RAG Search] ${formattedResults.length} results in ${executionTime}ms ` +
        `(vector ${vectorRows.length}, lexical ${lexicalRows.length}${tsQuery ? '' : ' — no lexical terms'})`
    );

    return formattedResults;
  } catch (error) {
    console.error('[RAG Search] Error finding relevant content:', error);
    return [];
  }
};
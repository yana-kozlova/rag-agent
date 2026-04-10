import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '@/lib/env.mjs';
import { db } from '../db';
import { sql, and } from 'drizzle-orm';
import { embeddings } from '@/lib/db/schema';
import { resources } from '@/lib/db/schema';
import { userTablesData, userTables } from '@/lib/db/schema';

const embeddingModel = openai.embedding(env.AI_EMBED_MODEL || 'text-embedding-3-small');

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

export const generateEmbeddings = async (
  value: string,
): Promise<Array<{ embedding: number[]; content: string }>> => {
  const chunks = generateChunks(value);
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: chunks,
  });
  return embeddings.map((e, i) => ({ content: chunks[i], embedding: e }));
};

export const generateEmbedding = async (value: string): Promise<number[]> => {
  const input = value.replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
  const { embedding } = await embed({
    model: embeddingModel,
    value: input,
  });
  return embedding;
};

// Helper function to extract keywords from query for text search
function extractKeywords(query: string): string[] {
  const commonWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'when', 'where', 'who', 'why', 'how', 'about', 'my', 'me', 'i', 'you', 'your', 'this', 'that', 'these', 'those']);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.has(word))
    .slice(0, 5); // Limit to 5 keywords
}

// Helper function to calculate keyword match score
function calculateKeywordScore(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  
  const lowerContent = content.toLowerCase();
  let matches = 0;
  for (const keyword of keywords) {
    if (lowerContent.includes(keyword)) {
      matches++;
    }
  }
  return matches / keywords.length; // Normalize to 0-1
}

// Helper function to combine semantic and keyword scores
function combineScores(semanticScore: number, keywordScore: number, semanticWeight = 0.7, keywordWeight = 0.3): number {
  return semanticScore * semanticWeight + keywordScore * keywordWeight;
}

export const findRelevantContent = async (
  userQuery: string, 
  userId: string,
  options?: {
    useCache?: boolean;
    useHybridSearch?: boolean;
    minDate?: Date;
    maxDate?: Date;
  }
) => {
  const startTime = Date.now();
  const useCache = options?.useCache !== false; // Default to true
  const useHybridSearch = options?.useHybridSearch !== false; // Default to true
  
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
    const userQueryEmbedded = await generateEmbedding(userQuery);

    // Validate that every embedding value is a finite number to prevent injection via sql.raw()
    for (const val of userQueryEmbedded) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error('Invalid embedding value: expected finite numbers');
      }
    }

    const vectorString = `[${userQueryEmbedded.join(',')}]`;

    // Extract keywords for hybrid search
    const keywords = useHybridSearch ? extractKeywords(userQuery) : [];

    // Cosine distance (<=>) matches the HNSW index built with vector_cosine_ops,
    // which lets Postgres use the index for ORDER BY instead of a sequential scan.
    // cosine_distance = 1 - cosine_similarity, so similarity = 1 - distance.
    const distance = sql<number>`${embeddings.embedding} <=> ${sql.raw(`'${vectorString}'::vector`)}`;
    const similarity = sql<number>`1 - (${embeddings.embedding} <=> ${sql.raw(`'${vectorString}'::vector`)})`;
    const topK = env.RAG_TOP_K ?? 8;
    
    // Build where clause
    let whereClause: any = sql`(
      (${embeddings.source} IN ('resource', 'calendar') AND ${resources.userId} = ${userId}) OR
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
      
      // Apply date filters only to resources/calendar, not tables
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
    
    // Fetch more results than needed for hybrid ranking
    const fetchLimit = useHybridSearch ? topK * 2 : topK;
    
    const rows = await db
      .select({
        content: embeddings.content,
        similarity,
        source: embeddings.source,
        sourceId: embeddings.sourceId,
        googleEventId: resources.googleEventId,
        resourceMetadata: resources.metadata,
        embeddingMetadata: embeddings.metadata,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
      })
      .from(embeddings)
      .leftJoin(resources, sql`${resources.id} = ${embeddings.sourceId} AND ${embeddings.source} IN ('resource', 'calendar')`)
      .leftJoin(userTablesData, sql`${userTablesData.id} = ${embeddings.sourceId} AND ${embeddings.source} = 'table'`)
      .leftJoin(userTables, sql`${userTables.id} = ${userTablesData.userTableId}`)
      .where(whereClause)
      .orderBy(distance)
      .limit(fetchLimit);
    
    // Apply hybrid search ranking if enabled
    let rankedResults = rows;
    if (useHybridSearch && keywords.length > 0) {
      rankedResults = rows.map(row => {
        const semanticScore = typeof row.similarity === 'number' ? row.similarity : 0;
        const keywordScore = calculateKeywordScore(row.content || '', keywords);
        const combinedScore = combineScores(semanticScore, keywordScore);
        
        return {
          ...row,
          similarity: combinedScore,
          semanticScore,
          keywordScore,
        };
      }).sort((a, b) => {
        const scoreA = typeof a.similarity === 'number' ? a.similarity : 0;
        const scoreB = typeof b.similarity === 'number' ? b.similarity : 0;
        return scoreB - scoreA;
      });
    }
    
    // Take top K results
    const topResults = rankedResults.slice(0, topK);
    
    // Format results to match expected structure
    const formattedResults = topResults.map(row => ({
      content: row.content,
      similarity: row.similarity,
      source: row.source,
      sourceId: row.sourceId,
      googleEventId: row.googleEventId,
      metadata: row.embeddingMetadata || row.resourceMetadata || null,
    }));
    
    // Cache results
    if (useCache) {
      const { embeddingCache } = await import('./embedding-cache');
      embeddingCache.set(userId, userQuery, formattedResults);
    }
    
    const executionTime = Date.now() - startTime;
    if (useHybridSearch && keywords.length > 0) {
      console.log(`[RAG Search] Found ${formattedResults.length} results using hybrid search (keywords: ${keywords.join(', ')}) in ${executionTime}ms`);
    } else {
      console.log(`[RAG Search] Found ${formattedResults.length} results in ${executionTime}ms`);
    }
    
    return formattedResults;
  } catch (error) {
    console.error('[RAG Search] Error finding relevant content:', error);
    return [];
  }
};
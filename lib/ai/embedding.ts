import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '@/lib/env.mjs';
import { db } from '../db';
import { cosineDistance, sql, eq, and, or } from 'drizzle-orm';
import { embeddings } from '../db/schema/embeddings';
import { resources } from '../db/schema/resources';
import { userTablesData, userTables } from '../db/schema/user-tables';

const embeddingModel = openai.embedding(env.AI_EMBED_MODEL || 'text-embedding-3-small');

const DEFAULT_CHUNK_SIZE = env.EMBED_CHUNK_SIZE ?? 800;
const DEFAULT_CHUNK_OVERLAP = env.EMBED_CHUNK_OVERLAP ?? 200;

const generateChunks = (input: string, size = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] => {
  // For very large texts, preserve paragraph structure better
  const normalized = input.trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= size) return [normalized];

  const chunks: string[] = [];
  
  // For large texts, try to split by paragraphs first, then by sentences
  const isLargeText = normalized.length > size * 10; // More than 10 chunks worth
  
  if (isLargeText) {
    // Split by double newlines (paragraphs) first
    const paragraphs = normalized.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    let currentChunk = '';
    
    for (const para of paragraphs) {
      const paraTrimmed = para.replace(/\s+/g, ' ').trim();
      
      // If adding this paragraph would exceed size, save current chunk and start new one
      if (currentChunk.length + paraTrimmed.length + 1 > size && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        // Start new chunk with overlap from previous
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + ' ' + paraTrimmed;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + paraTrimmed;
      }
    }
    
    // Add remaining chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }
    
    // If we still have very large chunks, split them by sentences
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length <= size) {
        finalChunks.push(chunk);
      } else {
        // Split large chunk by sentences
        const sentences = chunk.split(/[.!?]+\s+/).filter(s => s.trim().length > 0);
        let sentenceChunk = '';
        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length + 1 > size && sentenceChunk.length > 0) {
            finalChunks.push(sentenceChunk.trim());
            sentenceChunk = sentence;
          } else {
            sentenceChunk += (sentenceChunk ? '. ' : '') + sentence;
          }
        }
        if (sentenceChunk.trim().length > 0) {
          finalChunks.push(sentenceChunk.trim());
        }
      }
    }
    return finalChunks;
  }
  
  // For smaller texts, use original logic
  const normalizedSpaces = normalized.replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
  let start = 0;
  while (start < normalizedSpaces.length) {
    const end = Math.min(start + size, normalizedSpaces.length);
    let chunk = normalizedSpaces.slice(start, end);
    if (end < normalizedSpaces.length) {
      const lastSentence = chunk.lastIndexOf('. ');
      if (lastSentence > size * 0.5) {
        chunk = chunk.slice(0, lastSentence + 1);
      }
    }
    const trimmed = chunk.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
    if (end >= normalizedSpaces.length) break;
    start += Math.max(1, size - overlap);
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

export const findRelevantContent = async (userQuery: string, userId: string) => {
  try {
    const userQueryEmbedded = await generateEmbedding(userQuery);
    // Convert JavaScript array to PostgreSQL vector format: '[1,2,3]'::vector
    const vectorString = `[${userQueryEmbedded.join(',')}]`;
    
    // Use cosine similarity operator (<=>) which returns 1 for identical, 0 for orthogonal, -1 for opposite
    // For pgvector, cosine similarity is normalized to 0-1 range (1 = most similar, 0 = least similar)
    // Using <=> gives us similarity directly without conversion
    const distance = sql<number>`${embeddings.embedding} <-> ${sql.raw(`'${vectorString}'::vector`)}`;
    // Use 1 - cosine_distance for similarity (pgvector cosine distance is 0-2, so 1 - distance/2 = similarity)
    // But let's also try using inner product which might be better for short queries
    const similarity = sql<number>`1 - ((${embeddings.embedding} <-> ${sql.raw(`'${vectorString}'::vector`)}) / 2.0)`;
    const topK = env.RAG_TOP_K ?? 8;
    
    const rows = await db
      .select({
        content: embeddings.content,
        similarity,
        source: embeddings.source,
        sourceId: embeddings.sourceId,
        googleEventId: resources.googleEventId,
        resourceMetadata: resources.metadata,
        embeddingMetadata: embeddings.metadata,
      })
      .from(embeddings)
      .leftJoin(resources, sql`${resources.id} = ${embeddings.sourceId} AND ${embeddings.source} IN ('resource', 'calendar')`)
      .leftJoin(userTablesData, sql`${userTablesData.id} = ${embeddings.sourceId} AND ${embeddings.source} = 'table'`)
      .leftJoin(userTables, sql`${userTables.id} = ${userTablesData.userTableId}`)
      .where(
        sql`(
          (${embeddings.source} IN ('resource', 'calendar') AND ${resources.userId} = ${userId}) OR
          (${embeddings.source} = 'table' AND ${userTables.userId} = ${userId})
        )`
      )
      .orderBy(distance)
      .limit(topK);
    
    // Format results to match expected structure
    return rows.map(row => ({
      content: row.content,
      similarity: row.similarity,
      source: row.source,
      sourceId: row.sourceId,
      googleEventId: row.googleEventId,
      metadata: row.embeddingMetadata || row.resourceMetadata || null,
    }));
  } catch (error) {
    console.error('[RAG Search] Error finding relevant content:', error);
    return [];
  }
};
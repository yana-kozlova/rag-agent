import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { db } from '../db';
import { cosineDistance, sql } from 'drizzle-orm';
import { embeddings } from '../db/schema/embeddings';
import { resources } from '../db/schema/resources';

const embeddingModel = openai.embedding('text-embedding-3-small');

const generateChunks = (input: string, size = 800, overlap = 200): string[] => {
  const normalized = input.replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= size) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + size, normalized.length);
    let chunk = normalized.slice(start, end);
    if (end < normalized.length) {
      const lastSentence = chunk.lastIndexOf('. ');
      if (lastSentence > size * 0.5) {
        chunk = chunk.slice(0, lastSentence + 1);
      }
    }
    const trimmed = chunk.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
    if (end >= normalized.length) break;
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
  const userQueryEmbedded = await generateEmbedding(userQuery);
  const similarity = sql<number>`1 - (${cosineDistance(
    embeddings.embedding,
    userQueryEmbedded,
  )})`;
  const distance = sql<number>`(${embeddings.embedding}) <-> ${userQueryEmbedded}`;
  const rows = await db
    .select({
      content: embeddings.content,
      similarity,
      source: embeddings.source,
      resourceId: embeddings.resourceId,
      googleEventId: resources.googleEventId,
      metadata: resources.metadata,
    })
    .from(embeddings)
    .leftJoin(resources, sql`${resources.id} = ${embeddings.resourceId}`)
    .where(sql`${resources.userId} = ${userId}`)
    .orderBy(distance)
    .limit(8);
  return rows;
};
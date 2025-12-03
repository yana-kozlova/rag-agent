import { nanoid } from '@/lib/utils';
import { index, jsonb, pgEnum, pgTable, text, varchar, vector } from 'drizzle-orm/pg-core';

export const embeddingSourceEnum = pgEnum('embedding_source', ['resource', 'calendar', 'table']);

export const embeddings = pgTable(
  'embeddings',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    sourceId: varchar('source_id', { length: 191 }).notNull(), // Unified ID for resource/table/calendar
    source: embeddingSourceEnum('source').default('resource'),
    googleEventId: text('google_event_id'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    metadata: jsonb('metadata'), // Additional context: tableId, tableTitle, resource metadata, etc.
  },
  table => ({
    embeddingIndex: index('embeddingIndex').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    embeddingsSourceIdIdx: index('embeddings_source_id_idx').on(table.sourceId),
    embeddingsSourceIdx: index('embeddings_source_idx').on(table.source),
  }),
);
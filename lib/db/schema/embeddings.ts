import { nanoid } from '@/lib/utils';
import { index, pgEnum, pgTable, text, varchar, vector } from 'drizzle-orm/pg-core';
import { jsonb } from '../jsonb';

/*
 * Calendar events are not indexed. A `'calendar'` member lived here from an
 * early sync that copied Google events into the base; the sync is long gone and
 * nothing has written such a row since, while the value kept the retrieval query
 * carrying a branch for a source that could not occur. Events are answered live
 * by the getEvents tool, which is the truthful place for them — a vector copy of
 * a calendar is stale the moment anything moves.
 */
export const embeddingSourceEnum = pgEnum('embedding_source', ['resource', 'table']);

export const embeddings = pgTable(
  'embeddings',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    sourceId: varchar('source_id', { length: 191 }).notNull(), // Unified ID for resource/table row
    source: embeddingSourceEnum('source').default('resource'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    metadata: jsonb('metadata'), // Additional context: tableId, tableTitle, resource metadata, etc.
    /*
     * There is one more column on this table: `content_tsv`, a generated
     * tsvector over `content` with a GIN index, added in migration
     * 0015_lexical_search and used by the lexical half of hybrid search.
     *
     * It is deliberately not modelled here. Drizzle has no tsvector type and
     * cannot express GENERATED ALWAYS AS, so declaring it would make
     * `drizzle-kit generate` try to recreate it as an ordinary column on the
     * next run. Postgres maintains it; `findRelevantContent` refers to it by
     * name; nothing needs to read it as a value.
     */
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
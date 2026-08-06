-- The lexical half of hybrid search.
--
-- Retrieval used to be vector-only: the top rows came back by cosine distance
-- and a keyword score was then applied to those rows in JS. A chunk holding an
-- exact match — a name, an invoice number, a rare term — that did not make the
-- vector shortlist could therefore never surface at all.
--
-- 'simple' rather than a language config on purpose: the base is Ukrainian and
-- English mixed in one column, Postgres ships no Ukrainian dictionary, and
-- 'english' would stem the English half while mangling nothing useful in the
-- other. 'simple' just lowercases and keeps every token, which is what a
-- multilingual base needs; inflection is handled at query time with prefix
-- matching instead of a stemmer.
ALTER TABLE "embeddings"
  ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_content_tsv_idx" ON "embeddings" USING gin ("content_tsv");

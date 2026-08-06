-- Removing the calendar branch from the knowledge base.
--
-- An early version of this app synced Google events into `resources` and
-- embedded them. That sync was deleted long ago; its shape stayed behind — a
-- 'calendar' member on both source enums, a `google_event_id` on two tables,
-- and an index over a column nothing had written since. Retrieval carried a
-- join branch for a source that could not occur, and the system prompt promised
-- the model a calendar search that did not exist. Events are answered live by
-- the getEvents tool, which is the truthful place for them: a vector copy of a
-- calendar is stale the moment anything moves.
--
-- Postgres cannot drop a value from an enum, so both types are recreated. The
-- UPDATE ahead of the swap is a safety net for any deployment still holding
-- legacy rows: such an embedding points at a real resource row, so it belongs
-- with the others rather than being deleted.
UPDATE "embeddings" SET "source" = 'resource' WHERE "source" = 'calendar';
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "source" DROP DEFAULT;
--> statement-breakpoint
ALTER TYPE "embedding_source" RENAME TO "embedding_source_old";
--> statement-breakpoint
CREATE TYPE "embedding_source" AS ENUM('resource', 'table');
--> statement-breakpoint
-- Rebuilds "embeddings_source_idx" along with the column.
ALTER TABLE "embeddings" ALTER COLUMN "source" TYPE "embedding_source" USING "source"::text::"embedding_source";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "source" SET DEFAULT 'resource';
--> statement-breakpoint
DROP TYPE "embedding_source_old";
--> statement-breakpoint
ALTER TABLE "embeddings" DROP COLUMN IF EXISTS "google_event_id";
--> statement-breakpoint
-- `resources.source` only ever distinguished a synced event from a note, and
-- `google_event_id` only ever pointed back at Google. Both go with the sync.
DROP INDEX IF EXISTS "resources_google_event_idx";
--> statement-breakpoint
ALTER TABLE "resources" DROP COLUMN IF EXISTS "google_event_id";
--> statement-breakpoint
ALTER TABLE "resources" DROP COLUMN IF EXISTS "source";
--> statement-breakpoint
DROP TYPE IF EXISTS "resource_source";

-- Add unified source_id column
ALTER TABLE "embeddings" ADD COLUMN "source_id" varchar(191);--> statement-breakpoint

-- Migrate data from resourceId and tableRowId to sourceId
UPDATE "embeddings" SET "source_id" = "resource_id" WHERE "resource_id" IS NOT NULL;--> statement-breakpoint
UPDATE "embeddings" SET "source_id" = "table_row_id" WHERE "table_row_id" IS NOT NULL;--> statement-breakpoint

-- Make source_id NOT NULL after data migration
ALTER TABLE "embeddings" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint

-- Create index on source_id
CREATE INDEX IF NOT EXISTS "embeddings_source_id_idx" ON "embeddings" USING btree ("source_id");--> statement-breakpoint

-- Create index on source
CREATE INDEX IF NOT EXISTS "embeddings_source_idx" ON "embeddings" USING btree ("source");--> statement-breakpoint

-- Drop old columns and foreign keys
ALTER TABLE "embeddings" DROP CONSTRAINT IF EXISTS "embeddings_resource_id_resources_id_fk";--> statement-breakpoint
ALTER TABLE "embeddings" DROP CONSTRAINT IF EXISTS "embeddings_table_row_id_user_tables_data_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "embeddings_resource_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "embeddings_table_row_id_idx";--> statement-breakpoint
ALTER TABLE "embeddings" DROP COLUMN IF EXISTS "resource_id";--> statement-breakpoint
ALTER TABLE "embeddings" DROP COLUMN IF EXISTS "table_row_id";


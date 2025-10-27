DO $$ BEGIN
 CREATE TYPE "public"."embedding_source" AS ENUM('resource', 'calendar');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP TABLE "calendar_events";--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN "source" "embedding_source" DEFAULT 'resource';--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN "metadata" jsonb;
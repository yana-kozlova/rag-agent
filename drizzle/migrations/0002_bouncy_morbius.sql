DO $$ BEGIN
 CREATE TYPE "public"."resource_source" AS ENUM('resource', 'calendar');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "source" "resource_source" DEFAULT 'resource';--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resources_google_event_idx" ON "resources" USING btree ("google_event_id");
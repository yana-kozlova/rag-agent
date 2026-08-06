ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "retro_hour" integer DEFAULT 19 NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "retro_enabled" boolean DEFAULT true NOT NULL;

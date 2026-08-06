ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "proactive_enabled" boolean DEFAULT false NOT NULL;

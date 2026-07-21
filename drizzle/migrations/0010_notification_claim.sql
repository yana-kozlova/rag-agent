ALTER TABLE "notification_queue" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "telegram_link_code" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "telegram_link_expires_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_telegram_chat_id_unique" ON "user" ("telegram_chat_id");

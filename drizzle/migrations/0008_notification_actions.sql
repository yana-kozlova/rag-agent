ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "event_reminders_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "quiet_hours_start" integer;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "quiet_hours_end" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notify_at" timestamp NOT NULL,
	"payload" jsonb NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" text DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_queue" ADD CONSTRAINT "notification_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_queue_due_idx" ON "notification_queue" USING btree ("status","notify_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_queue_user_idx" ON "notification_queue" USING btree ("user_id");

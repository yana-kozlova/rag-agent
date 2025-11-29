CREATE TABLE IF NOT EXISTS "user_tables" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"columns" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"settings" jsonb,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_tables" ADD CONSTRAINT "user_tables_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tables_user_idx" ON "user_tables" USING btree ("user_id");
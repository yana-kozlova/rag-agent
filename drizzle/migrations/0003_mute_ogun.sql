CREATE TABLE IF NOT EXISTS "user_tables_data" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"user_table_id" varchar(191) NOT NULL,
	"row_data" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_tables_data" ADD CONSTRAINT "user_tables_data_user_table_id_user_tables_id_fk" FOREIGN KEY ("user_table_id") REFERENCES "public"."user_tables"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tables_data_table_idx" ON "user_tables_data" USING btree ("user_table_id");--> statement-breakpoint
ALTER TABLE "user_tables" DROP COLUMN IF EXISTS "data";
ALTER TYPE "embedding_source" ADD VALUE 'table';--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN "table_row_id" varchar(191);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_table_row_id_user_tables_data_id_fk" FOREIGN KEY ("table_row_id") REFERENCES "public"."user_tables_data"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_table_row_id_idx" ON "embeddings" USING btree ("table_row_id");
ALTER TABLE "resources" ADD COLUMN "user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resources_user_idx" ON "resources" USING btree ("user_id");
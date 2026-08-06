CREATE TABLE IF NOT EXISTS "entities" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"type" text NOT NULL,
	"relationship" text,
	"attributes" jsonb,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_mentions" (
	"entity_id" varchar(191) NOT NULL REFERENCES "entities"("id") ON DELETE cascade,
	"resource_id" varchar(191) NOT NULL REFERENCES "resources"("id") ON DELETE cascade,
	"context" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_mentions_entity_id_resource_id_pk" PRIMARY KEY("entity_id","resource_id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entities_identity_unique" ON "entities" ("user_id","normalized_name","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_user_idx" ON "entities" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_type_idx" ON "entities" ("user_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_mentions_resource_idx" ON "entity_mentions" ("resource_id");

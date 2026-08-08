-- Names decided not to be nodes at all.
--
-- The mirror of entity_aliases. `entities` is a projection of every note's
-- metadata.entities, rebuilt by syncEntitiesForResource, so deleting a row on
-- its own lasts until the next note mentions the name and then silently comes
-- back. An alias says "this spelling means that node"; an exclusion says "this
-- spelling means nothing", and both are read before the upsert.
--
-- Deliberately does NOT reference entities: the row has to outlive the node it
-- buried.
CREATE TABLE IF NOT EXISTS "entity_exclusions" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "type" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Same triple as entities.identity: an exclusion covers one name of one type.
CREATE UNIQUE INDEX IF NOT EXISTS "entity_exclusions_identity_unique"
  ON "entity_exclusions" ("user_id", "normalized_name", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_exclusions_user_idx"
  ON "entity_exclusions" ("user_id");

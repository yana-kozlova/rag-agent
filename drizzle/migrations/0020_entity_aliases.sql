-- Names already decided to mean an existing entity.
--
-- Merging two nodes does not survive on its own: identity is
-- (user_id, normalized_name, type), so the next note spelling the person
-- "Яна" would upsert a new node and the merge would have to be repeated
-- forever. An alias makes one decision permanent.
CREATE TABLE IF NOT EXISTS "entity_aliases" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "entity_id" varchar(191) NOT NULL REFERENCES "entities"("id") ON DELETE CASCADE,
  "normalized_alias" text NOT NULL,
  "type" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Same triple as entities.identity, so an alias can never point two ways.
CREATE UNIQUE INDEX IF NOT EXISTS "entity_aliases_identity_unique"
  ON "entity_aliases" ("user_id", "normalized_alias", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_aliases_entity_idx"
  ON "entity_aliases" ("entity_id");

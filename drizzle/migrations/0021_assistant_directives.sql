-- Standing instructions about how the assistant should respond.
--
-- Preferences were already storable as resources with metadata.type
-- 'preference', but a resource is only ever seen when getInformation goes
-- looking for it, and nothing goes looking before answering an ordinary
-- question. These are not retrieved — they are prepended to every prompt on
-- every surface, which is why they need a bounded, listable home of their own.
CREATE TABLE IF NOT EXISTS "assistant_directives" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  -- 'user' (they said it) | 'inferred' (read off a repeated correction).
  "source" text DEFAULT 'user' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  -- Mirrors the zod cap. A directive is a rule, not a paragraph: the limit is
  -- what keeps this list from becoming a second system prompt, so a caller that
  -- bypasses the action layer must not be able to widen it.
  CONSTRAINT "assistant_directives_text_len" CHECK (char_length("text") BETWEEN 1 AND 200)
);
--> statement-breakpoint
-- The only read there is: every directive for one user, oldest first.
CREATE INDEX IF NOT EXISTS "assistant_directives_user_idx"
  ON "assistant_directives" ("user_id", "created_at");

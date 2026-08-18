-- A button that writes one table row, with no model in the loop.
--
-- Both existing ways to write a row read a sentence first — right for a fact
-- stated once, wrong for a thing done daily. Recording "Арчі прийняв ліки" cost
-- a chat completion and a tool round-trip to store six characters that never
-- vary. A quick action stores the invariant part and asks only for what
-- actually changes.
CREATE TABLE IF NOT EXISTS "quick_actions" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- Cascades: a button onto a deleted table has nowhere to write, and one that
  -- fails on every press is worse than one that is gone with the table.
  "table_id" varchar(191) NOT NULL REFERENCES "user_tables"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "icon" text,
  -- Array of QuickField: { columnId, kind: fixed|today|now|ask, value?, prompt? }
  "fields" jsonb NOT NULL,
  -- Answers "did I already do this today?" on the button itself.
  "last_used_at" timestamp,
  "use_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  -- Mirrors the zod cap, on the wellbeing/directives precedent: a caller that
  -- skips the action layer must not be able to widen it.
  CONSTRAINT "quick_actions_label_len" CHECK (char_length("label") BETWEEN 1 AND 40)
);
--> statement-breakpoint
-- Creation order, deliberately, not most-recently-used: a button pressed every
-- morning should be in the same place every morning, and a list that reshuffles
-- under a thumb is how the wrong row gets written.
CREATE INDEX IF NOT EXISTS "quick_actions_user_idx"
  ON "quick_actions" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_actions_table_idx"
  ON "quick_actions" ("table_id");
--> statement-breakpoint
-- The label is the identity the user sees, so it is the identity everywhere:
-- it stops the assistant creating a second "Арчі — ліки" it cannot tell from
-- the first, and it is what a Telegram reply is matched back to — the bot's
-- prompt quotes the label, and two buttons wearing one name would make that
-- lookup a coin toss. Case-folded because a repeat is a repeat.
CREATE UNIQUE INDEX IF NOT EXISTS "quick_actions_user_label_idx"
  ON "quick_actions" ("user_id", lower(btrim("label")));

-- One conversation per user, and a total order over its messages.
--
-- Two defects with one cause: nothing ever said, in the schema, what "the
-- user's conversation" or "the next message" actually is, so three call sites
-- guessed and the guesses disagreed.
--
-- 1. `conversations` had no unique key on user_id, and all three places that
--    needed one did "select ... limit 1, else insert". Two concurrent first
--    messages — the web chat and Telegram deliberately share one row — create
--    two conversations, and from then on `limit 1` without an ORDER BY may
--    return either. The reader and the writer then disagree about which thread
--    is the thread, and half the history disappears from view.
--
-- 2. `persistTurn` writes the user and assistant messages in ONE insert, so
--    both rows get the same `now()`. Ordering by created_at alone is therefore
--    undefined within a turn (the answer can render above the question), and a
--    keyset cursor on `created_at` skips whichever sibling shares the boundary
--    timestamp. `seq` gives the total order the table always assumed it had.

-- Collapse any conversations that already split. The oldest row survives, since
-- that is the one whose id has been handed out longest; the rest donate their
-- messages to it rather than being deleted with them.
WITH keep AS (
  SELECT DISTINCT ON (user_id) user_id, id
  FROM conversations
  ORDER BY user_id, created_at ASC, id ASC
)
UPDATE messages m
SET conversation_id = keep.id
FROM conversations c
JOIN keep ON keep.user_id = c.user_id
WHERE m.conversation_id = c.id
  AND c.id <> keep.id;
--> statement-breakpoint
DELETE FROM conversations c
WHERE NOT EXISTS (
  SELECT 1
  FROM (
    SELECT DISTINCT ON (user_id) id
    FROM conversations
    ORDER BY user_id, created_at ASC, id ASC
  ) keep
  WHERE keep.id = c.id
);
--> statement-breakpoint
-- What "get or create the user's conversation" now means, enforced rather than
-- assumed: the insert races itself into a conflict instead of a second row.
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_user_unique"
  ON "conversations" ("user_id");
--> statement-breakpoint
-- Added as a plain bigint and backfilled in chronological order, because
-- ADD COLUMN ... bigserial numbers existing rows in physical order, which for a
-- table that has been updated is not the order they were written in.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "seq" bigint;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "messages_seq_seq";
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM messages
)
UPDATE messages m
SET seq = ordered.rn
FROM ordered
WHERE m.id = ordered.id
  AND m.seq IS NULL;
--> statement-breakpoint
SELECT setval('messages_seq_seq', COALESCE((SELECT max(seq) FROM messages), 0) + 1, false);
--> statement-breakpoint
ALTER SEQUENCE "messages_seq_seq" OWNED BY "messages"."seq";
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "seq" SET DEFAULT nextval('messages_seq_seq');
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "seq" SET NOT NULL;
--> statement-breakpoint
-- Unique so it can serve as a keyset cursor with no tiebreak of its own.
CREATE UNIQUE INDEX IF NOT EXISTS "messages_seq_unique" ON "messages" ("seq");
--> statement-breakpoint
-- The shape every history read has: one conversation, newest first.
CREATE INDEX IF NOT EXISTS "messages_conversation_seq_idx"
  ON "messages" ("conversation_id", "seq" DESC);

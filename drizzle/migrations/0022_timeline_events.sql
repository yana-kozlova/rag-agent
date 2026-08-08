-- The dates a life is measured by, on one axis.
--
-- The knowledge base could already hold "Артем народився 12 березня 2019" as
-- searchable prose. What it could not do is put it in order: nothing answered
-- "what happened in 2022?", and nothing knew a birthday was three days out.
-- Same reasoning as wellbeing_entries — a paragraph cannot be sorted by when.
CREATE TABLE IF NOT EXISTS "timeline_events" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,

  -- Always a real calendar date even when only part of it was said; "precision"
  -- is what says how much of it may be printed back.
  "occurred_on" date NOT NULL,
  "precision" text DEFAULT 'day' NOT NULL,
  "recurrence" text DEFAULT 'none' NOT NULL,

  "title" text NOT NULL,
  "kind" text DEFAULT 'other' NOT NULL,
  "note" text,

  "subject" text,
  -- Part of the identity index below, so it cannot be null: Postgres treats
  -- NULLs as distinct, and two subjectless events on one day would both insert.
  "subject_key" text DEFAULT '' NOT NULL,

  -- The person this is about, when the subject resolves to a graph node. SET
  -- NULL, not CASCADE: losing the node is no reason to forget the date.
  "entity_id" varchar(191) REFERENCES "entities"("id") ON DELETE SET NULL,

  -- The note it was read out of. CASCADE, because the note is the evidence.
  -- Null for dates added by hand or through the tool, which is what keeps those
  -- alive no matter what happens in the knowledge base.
  "resource_id" varchar(191) REFERENCES "resources"("id") ON DELETE CASCADE,

  -- extraction | tool | manual | backfill. All four are read identically; this
  -- is so someone puzzled by a date they never typed can see where it came from.
  "source" text DEFAULT 'extraction' NOT NULL,

  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,

  -- Mirrors the zod enums. A precision outside this list is not a bad label, it
  -- is a date the renderer cannot print without inventing a component.
  CONSTRAINT "timeline_events_precision_check"
    CHECK ("precision" IN ('day', 'month', 'year', 'day-month')),
  CONSTRAINT "timeline_events_recurrence_check"
    CHECK ("recurrence" IN ('none', 'annual')),
  -- A date with no year of its own has nothing to recur from and nothing to
  -- place on the axis; annual is the only reading of it that means anything.
  CONSTRAINT "timeline_events_day_month_recurs"
    CHECK ("precision" <> 'day-month' OR "recurrence" = 'annual'),
  -- Caps mirror the zod schema, on the assistant_directives precedent: a caller
  -- that bypasses the action layer must not be able to widen them.
  CONSTRAINT "timeline_events_title_len" CHECK (char_length("title") BETWEEN 1 AND 120),
  CONSTRAINT "timeline_events_note_len" CHECK ("note" IS NULL OR char_length("note") <= 500)
);
--> statement-breakpoint
-- Every read is "this user, in date order": the axis, the upcoming list, the
-- briefing.
CREATE INDEX IF NOT EXISTS "timeline_user_date_idx"
  ON "timeline_events" ("user_id", "occurred_on");
--> statement-breakpoint
-- Re-syncing one note replaces exactly its own rows.
CREATE INDEX IF NOT EXISTS "timeline_resource_idx" ON "timeline_events" ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timeline_entity_idx" ON "timeline_events" ("entity_id");
--> statement-breakpoint
-- Same day, same subject, same kind, same words is the same event however many
-- notes mention it. Deliberately conservative: it will not catch "Артем
-- народився" against "народження Артема", and that is the safer direction to
-- fail — a visible duplicate can be deleted, a silently swallowed second event
-- on the same day cannot be recovered.
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_events_identity_unique"
  ON "timeline_events" ("user_id", "occurred_on", "kind", "subject_key", lower(btrim("title")));

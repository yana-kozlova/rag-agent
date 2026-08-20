-- The things that have to be done.
--
-- `metadata.needs` has been extracting exactly this shape out of every note for
-- months with nothing reading it, and the date extraction rules had to refuse
-- deadlines outright to keep them off the timeline — where they would have made
-- the axis a worse to-do list. This is the layer both were waiting for.
--
-- Two dates, and the design turns on their being separate: "due_on" is the last
-- acceptable day and never reaches Google, "scheduled_for" is the day the user
-- committed to doing it and is what puts an event on the calendar.
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,

  "title" text NOT NULL,
  "note" text,
  "status" text DEFAULT 'open' NOT NULL,

  -- The deadline. Never written to a calendar: it is not an appointment, and
  -- putting it there claims a day the user never agreed to spend.
  "due_on" date,

  -- The day of work, which may be any day at or before the deadline. This is
  -- the one that creates the event.
  "scheduled_for" date,
  -- Kept as text, not timestamp: these carry a real UTC offset and a timestamp
  -- column would drop it, which is the bug scheduleEvent rejects "Z" to prevent.
  "scheduled_start" text,
  "scheduled_end" text,

  -- One-way. An event edited or deleted in Google does not report back, and
  -- unscheduleTask tolerates an id that no longer resolves.
  "google_event_id" text,
  "google_calendar_id" text,

  "priority" text,
  "area" text,

  "recurrence" text DEFAULT 'none' NOT NULL,
  "recurrence_interval" integer DEFAULT 1 NOT NULL,

  "completed_at" timestamp,

  -- The note it was read out of. CASCADE, because the note is the evidence —
  -- same contract timeline_events has. Null for a task the user typed.
  "resource_id" varchar(191) REFERENCES "resources"("id") ON DELETE CASCADE,

  -- user | extraction | telegram. Read identically; shown for provenance.
  "source" text DEFAULT 'user' NOT NULL,

  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,

  -- Mirrors the zod enums. NOT NULL on status matters beyond tidiness: it is the
  -- predicate of the partial index below, and a NULL would escape it silently.
  CONSTRAINT "tasks_status_check" CHECK ("status" IN ('open', 'done', 'dropped')),
  CONSTRAINT "tasks_priority_check"
    CHECK ("priority" IS NULL OR "priority" IN ('high', 'medium', 'low')),
  CONSTRAINT "tasks_recurrence_check"
    CHECK ("recurrence" IN ('none', 'daily', 'weekly', 'monthly', 'annual')),
  -- Zero would roll forward forever; the ceiling is the same one the pure module
  -- clamps to, so a caller bypassing the action layer cannot widen it.
  CONSTRAINT "tasks_recurrence_interval_check"
    CHECK ("recurrence_interval" BETWEEN 1 AND 365),
  -- A scheduled time without a scheduled day is a plan for no day at all, and
  -- would write an event this app could never find again.
  CONSTRAINT "tasks_scheduled_start_needs_day"
    CHECK ("scheduled_start" IS NULL OR "scheduled_for" IS NOT NULL),
  -- Caps mirror the zod schema, on the assistant_directives precedent.
  CONSTRAINT "tasks_title_len" CHECK (char_length("title") BETWEEN 1 AND 200),
  CONSTRAINT "tasks_note_len" CHECK ("note" IS NULL OR char_length("note") <= 1000),
  CONSTRAINT "tasks_area_len" CHECK ("area" IS NULL OR char_length("area") <= 60)
);
--> statement-breakpoint
-- Every read is "this user's open tasks".
CREATE INDEX IF NOT EXISTS "tasks_user_status_idx" ON "tasks" ("user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_user_due_idx" ON "tasks" ("user_id", "due_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_user_scheduled_idx" ON "tasks" ("user_id", "scheduled_for");
--> statement-breakpoint
-- Re-syncing one note replaces exactly its own rows.
CREATE INDEX IF NOT EXISTS "tasks_resource_idx" ON "tasks" ("resource_id");
--> statement-breakpoint
-- Same words, same deadline, still open is the same task however many times it
-- is mentioned. Partial on purpose: a task done in March and raised again in
-- August is a new one, and refusing it would be indistinguishable from the save
-- silently failing.
--
-- Deliberately conservative in the other direction too — it will not catch
-- "купити форму" against "форму купити", which is the safer way to fail: a
-- visible duplicate can be deleted, a silently swallowed task cannot be
-- recovered because nobody knows it was ever asked for.
--
-- coalesce, because Postgres treats NULLs as distinct and two undated "подзвонити
-- в садок" would otherwise both insert. The DATE cast keeps the expression
-- unambiguously immutable, which an index requires.
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_open_identity_unique"
  ON "tasks" ("user_id", lower(btrim("title")), coalesce("due_on", DATE '1970-01-01'))
  WHERE "status" = 'open';
--> statement-breakpoint
-- One closing of one occurrence, so a recurring task has a past.
CREATE TABLE IF NOT EXISTS "task_completions" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "task_id" varchar(191) NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,

  -- The user's local day, denormalised for grouping: re-deriving it from a UTC
  -- instant applies today's offset to a row written before a DST change.
  "completed_on" date NOT NULL,
  -- Which occurrence this closed. Null for a task that never had a deadline.
  "due_on" date,

  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_completions_task_idx" ON "task_completions" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_completions_user_day_idx"
  ON "task_completions" ("user_id", "completed_on");
--> statement-breakpoint
-- The guard against a double press. Telegram's clearReplyMarkup is best-effort
-- — call() swallows its failures — so the same button can be pressed twice, and
-- a recurring task would roll forward twice and skip an occurrence. This has to
-- be in the database, because the thing that would otherwise prevent it is a UI
-- edit that is allowed to fail silently.
CREATE UNIQUE INDEX IF NOT EXISTS "task_completions_once_per_day"
  ON "task_completions" ("task_id", "completed_on");
--> statement-breakpoint
-- Needs already dealt with, so the same one is never proposed twice. The mirror
-- of entity_exclusions: the suggestions themselves have no rows, being computed
-- from every note's metadata.needs minus this table.
CREATE TABLE IF NOT EXISTS "task_suggestions" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "resource_id" varchar(191) NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,

  -- needKey() of the need text: lowercased, punctuation stripped, spaces
  -- collapsed. Crude on purpose — it only has to recognise the same string from
  -- the same note, never two needs across a whole base.
  "need_key" text NOT NULL,

  -- accepted | dismissed. Both mean handled; only provenance differs.
  "reason" text NOT NULL,
  "task_id" varchar(191) REFERENCES "tasks"("id") ON DELETE SET NULL,

  "created_at" timestamp DEFAULT now() NOT NULL,

  CONSTRAINT "task_suggestions_reason_check" CHECK ("reason" IN ('accepted', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_suggestions_user_resource_idx"
  ON "task_suggestions" ("user_id", "resource_id");
--> statement-breakpoint
-- One decision per need per note. A second dismissal is not an error, it is the
-- same answer arriving twice, so the writers use ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS "task_suggestions_identity_unique"
  ON "task_suggestions" ("user_id", "resource_id", "need_key");

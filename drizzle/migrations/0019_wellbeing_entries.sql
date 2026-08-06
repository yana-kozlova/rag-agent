-- The wellbeing tracker: state as numbers, so it can be charted.
--
-- Separate from `resources` because that table holds prose for retrieval, and
-- no amount of embedding turns a paragraph into a trend line. The two are
-- linked by `resource_id`: the numbers live here, the user's own words stay
-- searchable over there.
--
-- One row per check-in, never one per day. "Зранку добре, після обіду
-- розболілась голова" is two measurements, and the time between them is the
-- part worth seeing.
CREATE TABLE IF NOT EXISTS "wellbeing_entries" (
  "id" varchar(191) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  -- When the state was, not when it was typed: backdating "вчора спала 5 годин"
  -- has to land on yesterday or the chart is wrong on both days.
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- recorded_at as YYYY-MM-DD in the user's zone at the time of writing.
  -- Denormalised because re-deriving it on read applies today's UTC offset to
  -- an entry made before a DST change.
  "local_date" text NOT NULL,
  "mood" integer,
  "energy" integer,
  -- Minutes: an exact integer of what was said. Hours as a float turns
  -- "7 год 20 хв" into 7.333… and back out as something else.
  "sleep_minutes" integer,
  "symptoms" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "note" text,
  "resource_id" varchar(191),
  "source" text DEFAULT 'web' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "wellbeing_entries"
  ADD CONSTRAINT "wellbeing_entries_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;

--> statement-breakpoint
-- SET NULL, not CASCADE: deleting the indexed note must not delete the
-- measurement it was attached to.
ALTER TABLE "wellbeing_entries"
  ADD CONSTRAINT "wellbeing_entries_resource_id_fk"
  FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE set null;

--> statement-breakpoint
-- The scale is enforced here as well as in zod. drizzle-orm 0.31 cannot express
-- a CHECK in the schema file, and the scale is the one thing that must hold for
-- every writer: a 7 on a 1-5 axis is not a bad reading, it is a broken chart.
ALTER TABLE "wellbeing_entries"
  ADD CONSTRAINT "wellbeing_entries_mood_scale" CHECK ("mood" IS NULL OR ("mood" BETWEEN 1 AND 5));

--> statement-breakpoint
ALTER TABLE "wellbeing_entries"
  ADD CONSTRAINT "wellbeing_entries_energy_scale" CHECK ("energy" IS NULL OR ("energy" BETWEEN 1 AND 5));

--> statement-breakpoint
ALTER TABLE "wellbeing_entries"
  ADD CONSTRAINT "wellbeing_entries_sleep_range" CHECK ("sleep_minutes" IS NULL OR ("sleep_minutes" BETWEEN 0 AND 1440));

--> statement-breakpoint
-- Every read is "this user, this date range, in order".
CREATE INDEX IF NOT EXISTS "wellbeing_user_date_idx" ON "wellbeing_entries" ("user_id","local_date");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellbeing_user_recorded_idx" ON "wellbeing_entries" ("user_id","recorded_at");

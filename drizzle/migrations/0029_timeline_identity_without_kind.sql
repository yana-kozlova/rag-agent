-- What a date is called is not part of which date it is.
--
-- The identity index keyed on `kind`, and `kind` is the least stable thing on
-- the row: a glyph the model picks fresh on every read, and a default the form
-- fills in when nobody chooses. So "День народження Артема" typed by hand
-- (`milestone`) and "день народження Артема" read out of a note a month later
-- (`birth`) — same day, same person, same words — were two events as far as the
-- index was concerned, and the upcoming list announced one birthday twice under
-- two icons. Every other part of the key is something the note *said*; this one
-- was something a classifier *guessed*, and a guess in a uniqueness key is a
-- duplicate waiting for the second guess to differ.
--
-- Still deliberately conservative in the direction 0022 chose: different
-- wording is still a different row, because a visible duplicate can be deleted
-- and a silently swallowed second event cannot be recovered.
--
-- The rows the old index let through have to go before the new one can be
-- built. Kept, in order: a row the user corrected by hand, then one they stated
-- themselves (form or tool) over one a model read off a note, then the oldest.
-- The note behind a dropped `extraction` row is untouched — its `metadata.dates`
-- still holds the entry, and the next sync of that note now conflicts with the
-- survivor and writes nothing.
DELETE FROM "timeline_events"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "user_id", "occurred_on", "subject_key", lower(btrim("title"))
        ORDER BY
          ("edited_at" IS NULL),
          ("source" NOT IN ('manual', 'tool')),
          "created_at",
          "id"
      ) AS "position"
    FROM "timeline_events"
  ) AS "ranked"
  WHERE "position" > 1
);
--> statement-breakpoint
DROP INDEX IF EXISTS "timeline_events_identity_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_events_identity_unique"
  ON "timeline_events" ("user_id", "occurred_on", "subject_key", lower(btrim("title")));

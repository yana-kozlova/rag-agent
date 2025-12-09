-- Add a JSONB array column to store followed calendars per user
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "followed_calendars" jsonb NOT NULL DEFAULT '[]'::jsonb;



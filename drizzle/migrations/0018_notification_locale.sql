-- Language for briefings, insights and the weekly retrospective.
--
-- Defaulting to 'uk' rather than 'en' deliberately: the bot's own voice is
-- Ukrainian everywhere else, and the English copy this replaces was a leftover
-- of writing for a browser notification. Existing rows therefore switch over
-- without anyone having to open settings.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'uk';

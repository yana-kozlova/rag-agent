DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'user' AND column_name = 'followed_calendars') THEN
    ALTER TABLE "user" ADD COLUMN "followed_calendars" jsonb DEFAULT '[]'::jsonb NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'resources' AND column_name = 'title') THEN
    ALTER TABLE "resources" ADD COLUMN "title" text;
  END IF;
END $$;
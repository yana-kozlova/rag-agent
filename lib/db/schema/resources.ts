import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, varchar, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { nanoid } from "@/lib/utils";
import { users } from "./auth";

export const resources = pgTable("resources", {
  id: varchar("id", { length: 191 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  content: text("content").notNull(),
  source: pgEnum('resource_source', ['resource', 'calendar'])("source").default('resource'),
  googleEventId: text('google_event_id'),
  metadata: jsonb('metadata'),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`now()`),
}, (table) => ({
  resourcesGoogleEventIdx: index('resources_google_event_idx').on(table.googleEventId),
  resourcesUserIdx: index('resources_user_idx').on(table.userId),
}));

// Schema for resources - used to validate API requests
export const insertResourceSchema = createInsertSchema(resources).pick({ content: true, userId: true });

// Type for resources - used to type API request params and within Components
export type NewResourceParams = z.infer<typeof insertResourceSchema>;
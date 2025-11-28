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
  title: text("title"),
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

// Metadata schema for content types
export const resourceMetadataSchema = z.object({
  type: z.enum(['note', 'document', 'schedule', 'person', 'project', 'skill', 'event', 'learning', 'other']).optional(),
  items: z.array(z.object({
    title: z.string().optional(),
    time: z.string().optional(),
  })).optional(),
  size: z.number().optional(),
  chunks: z.number().optional(),
  // Additional metadata for different content types
  personName: z.string().optional(),
  projectName: z.string().optional(),
  skillName: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();

// Schema for resources - used to validate API requests
export const insertResourceSchema = createInsertSchema(resources, {
  title: z.string().optional(),
  metadata: resourceMetadataSchema.optional(),
}).pick({ content: true, userId: true, title: true, metadata: true });

// Update schema for resources
export const updateResourceSchema = createInsertSchema(resources, {
  title: z.string().optional(),
  metadata: resourceMetadataSchema.optional(),
}).pick({ content: true, title: true, metadata: true }).partial();

// Type for resources - used to type API request params and within Components
export type NewResourceParams = z.infer<typeof insertResourceSchema>;
export type UpdateResourceParams = z.infer<typeof updateResourceSchema>;
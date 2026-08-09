import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, varchar, uuid } from "drizzle-orm/pg-core";
import { jsonb } from "../jsonb";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { nanoid } from "@/lib/utils";
import { RESOURCE_TYPES } from "@/lib/utils/resource-types";
import { users } from "./auth";

export const resources = pgTable("resources", {
  id: varchar("id", { length: 191 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  title: text("title"),
  content: text("content").notNull(),
  metadata: jsonb('metadata'),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`now()`),
}, (table) => ({
  resourcesUserIdx: index('resources_user_idx').on(table.userId),
}));

/**
 * The extractor answers `null` — not a missing key — for anything it had
 * nothing to say about: `informationExtractionSchema` defaults every optional
 * branch to null so a partial answer still validates (see the note there). A
 * plain `.optional()` rejects that, and a single fact with no `context` failed
 * validation for the whole resource, so a note the model had read perfectly
 * well was never saved at all. Take the null and drop it: what reaches the
 * column is still only the keys that carry a value.
 */
const extractedText = z.string().nullish().transform((v) => v ?? undefined);

// Metadata schema for content types
export const resourceMetadataSchema = z.object({
  type: z.enum(RESOURCE_TYPES).optional(),
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
  category: z.string().optional(), // Category for grouping resources (e.g., "work", "personal", "learning")
  // Structured information extraction fields
  facts: z.array(z.object({
    subject: z.string(),
    predicate: z.string(),
    object: z.string(),
    context: extractedText,
  })).optional(),
  entities: z.array(z.object({
    name: z.string(),
    type: z.string(),
    relationship: extractedText,
  })).optional(),
  needs: z.array(z.object({
    need: z.string(),
    priority: z.enum(['high', 'medium', 'low']).nullish().transform((v) => v ?? undefined),
    context: extractedText,
  })).optional(),
  keyPoints: z.array(z.string()).optional(),
  /**
   * Dates this note records, as extraction read them. The note's own copy —
   * `timeline_events` is the projection of every note's into one ordered axis,
   * exactly as `entities` is the projection of every note's `entities`.
   */
  dates: z.array(z.object({
    date: z.string(),
    title: z.string(),
    kind: extractedText,
    subject: extractedText,
    note: extractedText,
    recurring: z.boolean().nullish().transform((v) => v ?? undefined),
  })).optional(),
  userName: extractedText,
  // Images. `content` holds the vision model's description — these point back
  // at the picture it describes, so the UI can show the thing itself.
  // `imageUrl` is absent when the blob store was unconfigured or unreachable:
  // the image was still read and indexed, it just cannot be displayed.
  imageUrl: z.string().optional(),
  /**
   * Blob's own path. Nothing reads it today — deletion goes through `imageUrl`,
   * which is what `del()` takes — but it is the only durable handle on the
   * object if a URL is ever lost, so it is recorded rather than recomputed.
   */
  imagePathname: z.string().optional(),
  /** What the user wrote alongside the image, if anything. */
  caption: z.string().optional(),
  // Bi-directional link: rows in user tables that were derived from this resource.
  // Written by createTableRowsBulk when sourceResourceIds is passed.
  linkedRows: z.array(z.object({
    tableId: z.string(),
    rowId: z.string(),
    tableTitle: z.string().optional(),
    linkedAt: z.string().optional(), // ISO timestamp
  })).optional(),
}).passthrough();

/**
 * What a caller may say about a new resource — deliberately not who owns it.
 *
 * `userId` used to be part of this, and `createResource` took it at its word.
 * That module is `'use server'`, so every export of it is a network-reachable
 * endpoint: an owner supplied by the caller is an owner supplied by whoever can
 * reach the endpoint, and a note written into someone else's base is a note
 * their assistant will later read back to them as fact. Every other write in
 * this codebase resolves the user from the request context; this one now does
 * too, which is why the column is absent here rather than merely ignored.
 */
export const insertResourceSchema = createInsertSchema(resources, {
  title: z.string().optional(),
  metadata: resourceMetadataSchema.optional(),
}).pick({ content: true, title: true, metadata: true });

// Update schema for resources
export const updateResourceSchema = createInsertSchema(resources, {
  title: z.string().optional(),
  metadata: resourceMetadataSchema.optional(),
}).pick({ content: true, title: true, metadata: true }).partial();

// Type for resources - used to type API request params and within Components
export type NewResourceParams = z.infer<typeof insertResourceSchema>;
export type UpdateResourceParams = z.infer<typeof updateResourceSchema>;
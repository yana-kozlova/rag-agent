import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, varchar, uuid } from "drizzle-orm/pg-core";
import { jsonb } from "../jsonb";
import { z } from "zod";

import { nanoid } from "@/lib/utils";
import { users } from "./auth";

// Table column definition schema
export const tableColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['text', 'number', 'date', 'boolean', 'email', 'url']),
  width: z.number().optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().optional(),
});

// Table row data schema (flexible - can have any keys matching column IDs)
export const tableRowSchema = z.record(z.string(), z.any());

// Table settings schema
export const tableSettingsSchema = z.object({
  sortable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  editable: z.boolean().optional(),
  pagination: z.boolean().optional(),
  pageSize: z.number().optional(),
});

// User tables - stores user-created data tables (metadata only, no data)
export const userTables = pgTable("user_tables", {
  id: varchar("id", { length: 191 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  title: text("title").notNull(),
  description: text("description"),
  columns: jsonb("columns").notNull(), // Array of tableColumnSchema
  settings: jsonb("settings"), // tableSettingsSchema
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`now()`),
}, (table) => ({
  userTablesUserIdx: index('user_tables_user_idx').on(table.userId),
}));

// User tables data - stores individual rows for each table
export const userTablesData = pgTable("user_tables_data", {
  id: varchar("id", { length: 191 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userTableId: varchar("user_table_id", { length: 191 })
    .notNull()
    .references(() => userTables.id, { onDelete: "cascade" }),
  rowData: jsonb("row_data").notNull(), // Single row data (TableRow)
  metadata: jsonb("metadata"), // Optional metadata for the row
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`now()`),
}, (table) => ({
  userTablesDataTableIdx: index('user_tables_data_table_idx').on(table.userTableId),
}));

// Schema for creating a new table (no data field - data stored separately)
export const createUserTableSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  columns: z.array(tableColumnSchema).min(1, "At least one column is required"),
  settings: tableSettingsSchema.optional(),
});

// Schema for creating a table row
export const createTableRowSchema = z.object({
  userTableId: z.string(),
  rowData: tableRowSchema,
  metadata: z.record(z.string(), z.any()).optional(),
});

// Schema for updating a table row
export const updateTableRowSchema = z.object({
  rowData: tableRowSchema.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Schema for updating a table
export const updateUserTableSchema = createUserTableSchema.partial();

// Type exports
export type TableColumn = z.infer<typeof tableColumnSchema>;
export type TableRow = z.infer<typeof tableRowSchema>;
export type TableSettings = z.infer<typeof tableSettingsSchema>;
export type CreateUserTableParams = z.infer<typeof createUserTableSchema>;
export type UpdateUserTableParams = z.infer<typeof updateUserTableSchema>;
export type CreateTableRowParams = z.infer<typeof createTableRowSchema>;
export type UpdateTableRowParams = z.infer<typeof updateTableRowSchema>;


import { pgTable, text, timestamp, jsonb, uuid, boolean, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// Enums
export const syncStatusEnum = pgEnum('sync_status', ['synced', 'pending', 'conflict']);
export const responseStatusEnum = pgEnum('response_status', ['accepted', 'declined', 'tentative', 'needsAction']);
export const eventTypeEnum = pgEnum('event_type', ['meeting', 'task', 'personal', 'travel', 'recurring']);
export const energyLevelEnum = pgEnum('energy_level', ['low', 'medium', 'high']);

export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleEventId: text('google_event_id').unique(),
  calendarId: text('calendar_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  location: text('location'),
  start: timestamp('start', { withTimezone: true }).notNull(),
  end: timestamp('end', { withTimezone: true }).notNull(),
  allDay: boolean('all_day').default(false),
  attendees: jsonb('attendees').default([]),
  recurrence: text('recurrence'),
  embedding: jsonb('embedding'),
  analyzedData: jsonb('analyzed_data'),
  syncStatus: syncStatusEnum('sync_status').default('synced'),
  lastSynced: timestamp('last_synced', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const calendarEventsRelations = relations(calendarEvents, () => ({}));

export const insertCalendarEventSchema = createInsertSchema(calendarEvents, {
  title: z.string().min(1, 'Title is required'),
  start: z.date(),
  end: z.date(),
});

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
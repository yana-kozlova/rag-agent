import { index, pgEnum, pgTable, text, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { nanoid } from '@/lib/utils';
import { users } from './auth';

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);

export const conversations = pgTable('conversations', {
  id: varchar('id', { length: 191 }).primaryKey().$defaultFn(() => nanoid()),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: varchar('id', { length: 191 }).primaryKey().$defaultFn(() => nanoid()),
  conversationId: varchar('conversation_id', { length: 191 }).notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  convoIdx: index('messages_conversation_idx').on(table.conversationId),
  createdIdx: index('messages_created_idx').on(table.createdAt),
}));



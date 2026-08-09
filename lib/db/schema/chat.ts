import { bigint, index, pgEnum, pgTable, text, timestamp, uniqueIndex, varchar, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { nanoid } from '@/lib/utils';
import { users } from './auth';

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);

export const conversations = pgTable('conversations', {
  id: varchar('id', { length: 191 }).primaryKey().$defaultFn(() => nanoid()),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  /**
   * One conversation per user, because that is what all three readers already
   * assumed. Without it, "select ... limit 1, else insert" is a race, and once
   * it has lost the race an unordered `limit 1` hands different call sites
   * different threads. See `lib/chat/conversation.ts`.
   */
  userUnique: uniqueIndex('conversations_user_unique').on(table.userId),
}));

export const messages = pgTable('messages', {
  id: varchar('id', { length: 191 }).primaryKey().$defaultFn(() => nanoid()),
  conversationId: varchar('conversation_id', { length: 191 }).notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  /**
   * The order messages were written in, and the cursor history pages on.
   *
   * `created_at` cannot do either job: `persistTurn` inserts a turn's question
   * and answer in one statement, so both carry the same `now()`. Sorting on it
   * leaves the pair's order undefined, and a keyset cursor on it drops whichever
   * of the two sits on the page boundary. Unique and monotonic, so neither
   * question has a tiebreak to get wrong.
   */
  seq: bigint('seq', { mode: 'number' }).notNull().default(sql`nextval('messages_seq_seq')`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  convoIdx: index('messages_conversation_idx').on(table.conversationId),
  createdIdx: index('messages_created_idx').on(table.createdAt),
  seqUnique: uniqueIndex('messages_seq_unique').on(table.seq),
  convoSeqIdx: index('messages_conversation_seq_idx').on(table.conversationId, table.seq),
}));



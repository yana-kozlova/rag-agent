import { pgTable, text, timestamp, uuid, index, unique } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Ledger of notifications already delivered, so a cron that runs every hour
 * doesn't re-send the same reminder on every pass.
 *
 * `dedupeKey` is caller-defined and must be stable for "the same notification":
 *   - daily briefing:  `briefing:2026-07-21`   (local date in the user's tz)
 *   - event reminder:  `event:<googleEventId>:<startISO>`
 *
 * The (userId, dedupeKey) unique constraint is what actually enforces
 * once-only delivery — an insert that conflicts means "already sent".
 */
export const sentNotifications = pgTable(
  "sent_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (table) => ({
    sentNotificationsUniq: unique("sent_notifications_user_key_uniq").on(
      table.userId,
      table.dedupeKey
    ),
    sentNotificationsUserIdx: index("sent_notifications_user_idx").on(table.userId),
    sentNotificationsSentAtIdx: index("sent_notifications_sent_at_idx").on(table.sentAt),
  })
);

import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { jsonb } from "../jsonb";
import { users } from "./auth";
import type { PushPayload } from "@/lib/push/utils";

/**
 * Notifications to deliver later.
 *
 * Serverless functions cannot hold a timer across invocations, so "remind me in
 * 10 minutes" has to be durable state that a cron drains — not a setTimeout.
 * Delivery precision is therefore bounded by the drain cron's interval.
 *
 * Also the substrate for anything else that needs to fire at a chosen instant.
 */
export const notificationQueue = pgTable(
  "notification_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Earliest instant this may be delivered. */
    notifyAt: timestamp("notify_at").notNull(),
    payload: jsonb("payload").$type<PushPayload>().notNull(),
    kind: text("kind").notNull(),
    /**
     * pending | sending | sent | failed
     *
     * `sending` is claimed-but-not-yet-delivered. Both the QStash callback for
     * this row and the periodic sweep can reach it, and the transition out of
     * `pending` is what stops them both sending the same push.
     */
    status: text("status").notNull().default("pending"),
    attempts: text("attempts").notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * When delivery was claimed — not when the row was queued.
     *
     * Staleness has to be measured from the claim: a row queued this morning
     * for tonight is not stale when it is finally picked up.
     */
    claimedAt: timestamp("claimed_at"),
    sentAt: timestamp("sent_at"),
  },
  (table) => ({
    // The drain query is "pending rows already due", so index both together.
    notificationQueueDueIdx: index("notification_queue_due_idx").on(
      table.status,
      table.notifyAt
    ),
    notificationQueueUserIdx: index("notification_queue_user_idx").on(table.userId),
  })
);

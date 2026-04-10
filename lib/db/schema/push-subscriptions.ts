import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { jsonb } from "../jsonb";
import { users } from "./auth";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pushSubscriptionsUserIdx: index("push_subscriptions_user_idx").on(table.userId),
    pushSubscriptionsEndpointIdx: index("push_subscriptions_endpoint_idx").on(table.endpoint),
  })
);


import {
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { jsonb } from "../jsonb";
import { type AdapterAccount } from "@auth/core/adapters";

export const users = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  followedCalendars: jsonb("followed_calendars").$type<Array<{ calendarId: string; summary?: string }>>().notNull().default([] as any),
  // IANA timezone (e.g. "Europe/Kyiv"), synced from the user's Google Calendar
  // settings. Cron jobs run in UTC, so this is what lets us fire notifications
  // at the right *local* hour instead of the server's hour.
  timezone: text("timezone"),
  // Local hour (0-23) at which the daily briefing is sent.
  briefingHour: integer("briefing_hour").notNull().default(9),
  briefingEnabled: boolean("briefing_enabled").notNull().default(true),
  eventRemindersEnabled: boolean("event_reminders_enabled").notNull().default(true),
  /**
   * Proactive insights — conflicts, no-break stretches, notes about people you
   * are about to meet. Off by default: it is the only notification kind that
   * interrupts at times the user never picked, so it has to be asked for.
   */
  proactiveEnabled: boolean("proactive_enabled").notNull().default(false),
  // Weekly retrospective, sent on the user's local Sunday at this local hour.
  retroHour: integer("retro_hour").notNull().default(19),
  retroEnabled: boolean("retro_enabled").notNull().default(true),
  // Quiet hours as local hours [start, end), wrapping past midnight when
  // start > end (e.g. 22 → 8). Null on either side disables the window.
  quietHoursStart: integer("quiet_hours_start"),
  quietHoursEnd: integer("quiet_hours_end"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable(
  "account",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

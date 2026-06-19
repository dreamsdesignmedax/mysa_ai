import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export const plays = pgTable("plays", {
  id:                 serial("id").primaryKey(),
  orgId:              integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId:             integer("user_id").references(() => users.id, { onDelete: "set null" }),
  name:               text("name").notNull(),
  description:        text("description"),
  status:             varchar("status", { length: 30 }).default("draft"),
  intentKeywords:     jsonb("intent_keywords").$type<string[]>().default([]),
  icpIds:             jsonb("icp_ids").$type<number[]>().default([]),
  qualificationMode:  varchar("qualification_mode", { length: 20 }).default("manual"),
  scoutDailyBudget:   integer("scout_daily_budget").default(10),
  collectPhone:       boolean("collect_phone").default(false),
  createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Play = typeof plays.$inferSelect;
export type InsertPlay = typeof plays.$inferInsert;

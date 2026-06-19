import { boolean, integer, jsonb, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { plays } from "./plays";

export const signalConfigs = pgTable("signal_configs", {
  id:                 serial("id").primaryKey(),
  playId:             integer("play_id").references(() => plays.id, { onDelete: "cascade" }),
  orgId:              integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  problemSignals:     jsonb("problem_signals").$type<string[]>().default([]),
  buyingSignals:      jsonb("buying_signals").$type<string[]>().default([]),
  competitorSignals:  jsonb("competitor_signals").$type<string[]>().default([]),
  industryKeywords:   jsonb("industry_keywords").$type<string[]>().default([]),
  targetSubreddits:   jsonb("target_subreddits").$type<string[]>().default([]),
  targetCompanies:    jsonb("target_companies").$type<string[]>().default([]),
  minScore:           integer("min_score").default(50),
  isActive:           boolean("is_active").default(true),
  createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type SignalConfig = typeof signalConfigs.$inferSelect;
export type InsertSignalConfig = typeof signalConfigs.$inferInsert;

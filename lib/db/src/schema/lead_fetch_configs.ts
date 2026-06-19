import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { icps } from "./icps";
import { organizations } from "./organizations";

export const leadFetchConfigs = pgTable("lead_fetch_configs", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").references(() => organizations.id),
  icpId:        integer("icp_id").references(() => icps.id, { onDelete: "set null" }),
  sources:      text("sources").array().notNull().default([]),
  dailyCount:   integer("daily_count").notNull().default(50),
  enabled:      boolean("enabled").notNull().default(false),
  lastRunAt:    timestamp("last_run_at", { withTimezone: true }),
  nextRunAt:    timestamp("next_run_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LeadFetchConfig = typeof leadFetchConfigs.$inferSelect;

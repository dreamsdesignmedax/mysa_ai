import { boolean, integer, jsonb, pgTable, real, serial, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

export const signalSettings = pgTable("signal_settings", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").references(() => organizations.id).notNull(),
  enabled:       boolean("enabled").notNull().default(true),
  autoAdd:       boolean("auto_add").notNull().default(false),
  confidence:    real("confidence").notNull().default(0.70),
  subreddits:    jsonb("subreddits").$type<string[]>().notNull().default([]),
  keywords:      jsonb("keywords").$type<string[]>().notNull().default([]),
  googleMapsCities: jsonb("google_maps_cities").$type<{ label: string; query: string }[]>().notNull().default([]),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SignalSettings = typeof signalSettings.$inferSelect;

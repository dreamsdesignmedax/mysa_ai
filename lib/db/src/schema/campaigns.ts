import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

export const campaigns = pgTable("campaigns", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").references(() => organizations.id),
  name:        text("name").notNull(),
  segment:     text("segment").notNull(),
  status:      text("status").notNull().default("draft"),
  template:    text("template").notNull().default(""),
  scheduledAt: timestamp("scheduled_at"),
  sent:        integer("sent").notNull().default(0),
  delivered:   integer("delivered").notNull().default(0),
  replied:     integer("replied").notNull().default(0),
  booked:      integer("booked").notNull().default(0),
  total:       integer("total").notNull().default(0),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export const automations = pgTable("automations", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").references(() => organizations.id),
  name:        text("name").notNull(),
  trigger:     text("trigger").notNull(),
  description: text("description").notNull().default(""),
  active:      boolean("active").notNull().default(false),
  runs:        integer("runs").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  steps:       jsonb("steps").notNull().default([]),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

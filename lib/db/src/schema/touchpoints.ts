import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { leads } from "./leads";

export const touchpoints = pgTable("touchpoints", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("email"),
  day: integer("day").notNull().default(1),
  subject: text("subject"),
  body: text("body").notNull().default(""),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("touchpoints_lead_id_idx").on(table.leadId),
  index("touchpoints_status_idx").on(table.status),
]);

export const insertTouchpointSchema = createInsertSchema(touchpoints).omit({ id: true, createdAt: true });
export type Touchpoint = typeof touchpoints.$inferSelect;
export type InsertTouchpoint = z.infer<typeof insertTouchpointSchema>;

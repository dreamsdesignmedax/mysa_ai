import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { leads } from "./leads";

export const proposals = pgTable("proposals", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  services: text("services").array().notNull().default([]),
  investment: integer("investment").notNull().default(0),
  roiEstimate: integer("roi_estimate"),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  content: jsonb("content"),
  followups: jsonb("followups").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("proposals_lead_id_idx").on(table.leadId),
  index("proposals_status_idx").on(table.status),
]);

export const insertProposalSchema = createInsertSchema(proposals).omit({ id: true, createdAt: true });
export type Proposal = typeof proposals.$inferSelect;
export type InsertProposal = z.infer<typeof insertProposalSchema>;

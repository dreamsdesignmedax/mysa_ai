import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { auditCategories } from "./audit_categories";
import { leads } from "./leads";

export const auditSignals = pgTable("audit_signals", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => auditCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  severity: text("severity").notNull().default("medium"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leadAudits = pgTable("lead_audits", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }).unique(),
  healthScore: integer("health_score").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  highCount: integer("high_count").notNull().default(0),
  mediumCount: integer("medium_count").notNull().default(0),
  signals: jsonb("signals").notNull().default([]),
  aiReport: text("ai_report"),
  pageSpeedScore: integer("page_speed_score"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAuditSignalSchema = createInsertSchema(auditSignals).omit({ id: true, createdAt: true });
export const insertLeadAuditSchema = createInsertSchema(leadAudits).omit({ id: true, createdAt: true, updatedAt: true });

export type AuditSignal = typeof auditSignals.$inferSelect;
export type InsertAuditSignal = z.infer<typeof insertAuditSignalSchema>;
export type LeadAudit = typeof leadAudits.$inferSelect;
export type InsertLeadAudit = z.infer<typeof insertLeadAuditSchema>;

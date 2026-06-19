import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { leads } from "./leads";
import { organizations } from "./organizations";

export const auditRuns = pgTable("audit_runs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  healthScore: integer("health_score").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  highCount: integer("high_count").notNull().default(0),
  mediumCount: integer("medium_count").notNull().default(0),
  signals: jsonb("signals").notNull().default([]),
  aiReport: text("ai_report"),
  pageSpeedScore: integer("page_speed_score"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_runs_lead_id_idx").on(table.leadId),
  index("audit_runs_created_at_idx").on(table.createdAt),
]);

export const insertAuditRunSchema = createInsertSchema(auditRuns).omit({ id: true, createdAt: true });

export type AuditRun = typeof auditRuns.$inferSelect;
export type InsertAuditRun = z.infer<typeof insertAuditRunSchema>;

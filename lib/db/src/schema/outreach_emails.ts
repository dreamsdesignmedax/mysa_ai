import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { leads } from "./leads";
import { auditRuns } from "./audit_runs";
import { organizations } from "./organizations";

export const outreachEmails = pgTable("outreach_emails", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  auditRunId: integer("audit_run_id").references(() => auditRuns.id, { onDelete: "set null" }),
  toEmail: text("to_email").notNull(),
  toName: text("to_name").notNull(),
  company: text("company").notNull(),
  country: text("country").notNull().default(""),
  currency: text("currency").notNull().default("USD"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  errorMsg: text("error_msg"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  trackingId: text("tracking_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertOutreachEmailSchema = createInsertSchema(outreachEmails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OutreachEmail = typeof outreachEmails.$inferSelect;
export type InsertOutreachEmail = z.infer<typeof insertOutreachEmailSchema>;

import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizations } from "./organizations";

export const leadBank = pgTable("lead_bank", {
  id: serial("id").primaryKey(),

  orgId:        integer("org_id").references(() => organizations.id),

  firstName:    text("first_name").notNull().default(""),
  lastName:     text("last_name").notNull().default(""),
  email:        text("email"),
  phone:        text("phone"),
  whatsapp:     text("whatsapp"),
  linkedInUrl:  text("linkedin_url"),

  company:      text("company").notNull().default(""),
  designation:  text("designation").notNull().default(""),
  industry:     text("industry").notNull().default(""),
  city:         text("city"),
  country:      text("country").notNull().default(""),
  companySize:  text("company_size"),
  website:      text("website"),
  annualRevenue: text("annual_revenue"),

  source:       text("source").notNull().default("manual"),
  tags:         text("tags").array().notNull().default([]),
  notes:        text("notes"),

  intentKeywords:   text("intent_keywords").array().notNull().default([]),
  behaviorKeywords: text("behavior_keywords").array().notNull().default([]),
  interestKeywords: text("interest_keywords").array().notNull().default([]),

  importedToLeadsAt: timestamp("imported_to_leads_at", { withTimezone: true }),
  importedLeadId:    integer("imported_lead_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("lead_bank_org_email_unique").on(table.orgId, table.email),
]);

export const insertLeadBankSchema = createInsertSchema(leadBank).omit({ id: true, createdAt: true });
export type LeadBank = typeof leadBank.$inferSelect;
export type InsertLeadBank = z.infer<typeof insertLeadBankSchema>;

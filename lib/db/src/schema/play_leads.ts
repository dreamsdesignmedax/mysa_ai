import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { plays } from "./plays";
import { leads } from "./leads";

export const playLeads = pgTable("play_leads", {
  id:             serial("id").primaryKey(),
  playId:         integer("play_id").references(() => plays.id, { onDelete: "cascade" }),
  orgId:          integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  signalPostId:   integer("signal_post_id"),
  leadId:         integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  companyName:    text("company_name"),
  intentSummary:  text("intent_summary"),
  leadScore:      integer("lead_score"),
  scoreBreakdown: jsonb("score_breakdown").$type<Record<string, unknown>>(),
  keyContacts:    jsonb("key_contacts").$type<Record<string, unknown>[]>().default([]),
  enriched:       boolean("enriched").default(false),
  creditsCharged: integer("credits_charged").default(0),
  status:         varchar("status", { length: 30 }).default("new"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type PlayLead = typeof playLeads.$inferSelect;
export type InsertPlayLead = typeof playLeads.$inferInsert;

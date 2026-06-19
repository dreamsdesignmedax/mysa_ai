import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { leads } from "./leads";
import { organizations } from "./organizations";

export const leadBrainMemory = pgTable("lead_brain_memory", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  leadId: integer("lead_id").notNull().unique().references(() => leads.id, { onDelete: "cascade" }),
  aiSummary: text("ai_summary"),
  dealInsights: text("deal_insights"),
  nextBestAction: text("next_best_action"),
  personalityProfile: text("personality_profile"),
  manualNotes: text("manual_notes"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LeadBrainMemory = typeof leadBrainMemory.$inferSelect;
export type InsertLeadBrainMemory = typeof leadBrainMemory.$inferInsert;

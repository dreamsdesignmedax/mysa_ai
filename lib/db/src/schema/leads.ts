import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { icps } from "./icps";
import { organizations } from "./organizations";
import { users } from "./users";

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  icpId: integer("icp_id").references(() => icps.id, { onDelete: "set null" }),

  // ── Contact ──────────────────────────────────────────────
  firstName:    text("first_name").notNull(),
  lastName:     text("last_name").notNull(),
  email:        text("email").notNull().unique(),
  phone:        text("phone"),
  whatsapp:     text("whatsapp"),
  linkedInUrl:  text("linkedin_url"),
  photoUrl:     text("photo_url"),

  // ── Company ───────────────────────────────────────────────
  companyLogo:  text("company_logo"),
  company:      text("company").notNull(),
  city:         text("city"),
  country:      text("country").notNull(),
  designation:  text("designation").notNull(),
  website:      text("website"),
  industry:     text("industry").notNull(),
  companySize:  text("company_size"),
  annualRevenue: text("annual_revenue"),

  // ── Classification ────────────────────────────────────────
  source:       text("source").notNull().default("manual"),
  keywords:     text("keywords").array().notNull().default([]),
  tags:         text("tags").array().notNull().default([]),
  notes:        text("notes"),

  // ── AI-enriched intent intelligence ──────────────────────
  behaviorKeywords:  text("behavior_keywords").array().notNull().default([]),
  intentKeywords:    text("intent_keywords").array().notNull().default([]),
  interestKeywords:  text("interest_keywords").array().notNull().default([]),

  // ── Sales state ───────────────────────────────────────────
  bantScore:      integer("bant_score"),
  bantBreakdown:  jsonb("bant_breakdown"),

  // ── Belief Alignment Score (BANTB 5th dimension) ─────────
  beliefScore:    integer("belief_score").notNull().default(0),
  beliefReason:   text("belief_reason"),
  beliefEvidence: text("belief_evidence"),
  beliefSignals:  jsonb("belief_signals"),   // { linkedin, aboutPage, founderStory, mission }
  bantbTotal:     integer("bantb_total").notNull().default(0),
  status:         text("status").notNull().default("new_enquiry"),
  sequenceDay:    integer("sequence_day").notNull().default(0),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  assignedToId:   integer("assigned_to_id").references(() => users.id, { onDelete: "set null" }),

  // ── Agent pipeline fields ─────────────────────────────────
  websiteStatus:       text("website_status").notNull().default("unchecked"),
  pipelineStage:       text("pipeline_stage").notNull().default("new"),
  brandAuditCompleted: integer("brand_audit_completed").notNull().default(0),
  brandAuditReport:    text("brand_audit_report"),
  agentProcessed:      integer("agent_processed").notNull().default(0),
  followUpDay:         integer("follow_up_day").notNull().default(0),
  nextFollowUpAt:      timestamp("next_follow_up_at", { withTimezone: true }),
  meetingScheduledAt:  timestamp("meeting_scheduled_at", { withTimezone: true }),
  meetingLink:         text("meeting_link"),
  hubspotContactId:    text("hubspot_contact_id"),
  hubspotDealId:       text("hubspot_deal_id"),
  agentNotes:          text("agent_notes"),
  isFake:              integer("is_fake").notNull().default(0),

  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("leads_org_id_idx").on(table.orgId),
  index("leads_status_idx").on(table.status),
  index("leads_icp_id_idx").on(table.icpId),
  index("leads_pipeline_stage_idx").on(table.pipelineStage),
  index("leads_bant_score_idx").on(table.bantScore),
  index("leads_website_status_idx").on(table.websiteStatus),
  index("leads_agent_processed_idx").on(table.agentProcessed),
  index("leads_created_at_idx").on(table.createdAt),
  index("leads_industry_idx").on(table.industry),
  index("leads_country_idx").on(table.country),
  index("leads_source_idx").on(table.source),
]);

export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, updatedAt: true });
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

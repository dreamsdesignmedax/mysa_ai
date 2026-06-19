import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const dailyReports = pgTable("daily_reports", {
  id:                    serial("id").primaryKey(),
  orgId:                 integer("org_id"),
  reportDate:            text("report_date").notNull(),
  totalLeadsProcessed:   integer("total_leads_processed").notNull().default(0),
  newLeadsToday:         integer("new_leads_today").notNull().default(0),
  emailsSent:            integer("emails_sent").notNull().default(0),
  whatsappSent:          integer("whatsapp_sent").notNull().default(0),
  linkedinSent:          integer("linkedin_sent").notNull().default(0),
  callsBooked:           integer("calls_booked").notNull().default(0),
  meetingsToday:         integer("meetings_today").notNull().default(0),
  noShows:               integer("no_shows").notNull().default(0),
  auditsGenerated:       integer("audits_generated").notNull().default(0),
  pipelineSummary:       jsonb("pipeline_summary"),
  hotLeads:              jsonb("hot_leads"),
  agentPerformance:      jsonb("agent_performance"),
  reportHtml:            text("report_html"),
  sentAt:                timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DailyReport = typeof dailyReports.$inferSelect;

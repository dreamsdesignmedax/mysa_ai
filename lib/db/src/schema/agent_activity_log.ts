import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { leads } from "./leads";

export const agentActivityLog = pgTable("agent_activity_log", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id"),
  leadId:       integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  leadName:     text("lead_name"),
  companyName:  text("company_name"),
  agentName:    text("agent_name").notNull(),
  activityType: text("activity_type").notNull(),
  detail:       jsonb("detail"),
  channel:      text("channel"),
  status:       text("status").notNull().default("success"),
  errorMessage: text("error_message"),
  executedAt:   timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("aal_org_id_idx").on(t.orgId),
  index("aal_lead_id_idx").on(t.leadId),
  index("aal_executed_at_idx").on(t.executedAt),
]);

export type AgentActivityLog = typeof agentActivityLog.$inferSelect;

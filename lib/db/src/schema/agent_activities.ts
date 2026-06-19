import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { leads } from "./leads";

export const agentActivities = pgTable("agent_activities", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id"),
  leadId:       integer("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  agentName:    text("agent_name").notNull(),
  activityType: text("activity_type").notNull(),
  channel:      text("channel"),
  status:       text("status").notNull().default("success"),
  payload:      jsonb("payload"),
  response:     jsonb("response"),
  errorMessage: text("error_message"),
  executedAt:   timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AgentActivity = typeof agentActivities.$inferSelect;

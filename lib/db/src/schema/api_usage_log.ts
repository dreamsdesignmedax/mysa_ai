import { pgTable, serial, varchar, integer, real, timestamp } from "drizzle-orm/pg-core";

export const apiUsageLog = pgTable("api_usage_log", {
  id:           serial("id").primaryKey(),
  service:      varchar("service",  { length: 32 }).notNull(),
  model:        varchar("model",    { length: 64 }),
  feature:      varchar("feature",  { length: 64 }).notNull().default("unknown"),
  inputTokens:  integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  apiCalls:     integer("api_calls").notNull().default(1),
  costUsd:      real("cost_usd").notNull().default(0),
  orgId:        integer("org_id"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type ApiUsageLog    = typeof apiUsageLog.$inferSelect;
export type NewApiUsageLog = typeof apiUsageLog.$inferInsert;

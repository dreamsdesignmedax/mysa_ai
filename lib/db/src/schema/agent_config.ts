import { pgTable, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";

export const agentConfig = pgTable("agent_config", {
  scopeKey:  varchar("scope_key", { length: 200 }).primaryKey(),
  value:     jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AgentConfig = typeof agentConfig.$inferSelect;

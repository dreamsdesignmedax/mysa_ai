import { integer, pgTable, serial, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditRuns } from "./audit_runs";
import { organizations } from "./organizations";

export const shareTokens = pgTable("share_tokens", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  token: uuid("token").defaultRandom().notNull().unique(),
  auditRunId: integer("audit_run_id").notNull().references(() => auditRuns.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ShareToken = typeof shareTokens.$inferSelect;

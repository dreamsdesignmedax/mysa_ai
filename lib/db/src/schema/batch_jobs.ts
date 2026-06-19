import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const batchJobs = pgTable("batch_jobs", {
  id:          serial("id").primaryKey(),
  batchId:     text("batch_id").notNull().unique(),
  orgId:       integer("org_id").references(() => organizations.id),
  type:        text("type").notNull(),
  status:      text("status").notNull().default("in_progress"),
  leadsCount:  integer("leads_count").notNull().default(0),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { organizations } from "./organizations";

export const outreachSequences = pgTable("outreach_sequences", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  industry: text("industry"),
  steps: jsonb("steps").notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertOutreachSequenceSchema = createInsertSchema(outreachSequences).omit({ id: true, createdAt: true });
export type OutreachSequence = typeof outreachSequences.$inferSelect;
export type InsertOutreachSequence = z.infer<typeof insertOutreachSequenceSchema>;

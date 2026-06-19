import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { organizations } from "./organizations";

export const icps = pgTable("icps", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  markets: text("markets").array().notNull().default([]),
  industries: text("industries").array().notNull().default([]),
  roles: text("roles").array().notNull().default([]),
  companySize: text("company_size").notNull().default(""),
  filters: jsonb("filters").notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("icps_org_id_idx").on(table.orgId),
]);

export const insertIcpSchema = createInsertSchema(icps).omit({ id: true, createdAt: true, updatedAt: true });
export type Icp = typeof icps.$inferSelect;
export type InsertIcp = z.infer<typeof insertIcpSchema>;

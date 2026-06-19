import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditCategories = pgTable("audit_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAuditCategorySchema = createInsertSchema(auditCategories).omit({ id: true, createdAt: true });
export type AuditCategory = typeof auditCategories.$inferSelect;
export type InsertAuditCategory = z.infer<typeof insertAuditCategorySchema>;

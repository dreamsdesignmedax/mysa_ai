import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

export const smtpSettings = pgTable("smtp_settings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  host: text("host"),
  port: integer("port").default(587),
  user: text("user"),
  password: text("password"),
  fromAddress: text("from_address"),
  secure: boolean("secure").default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SmtpSettings = typeof smtpSettings.$inferSelect;

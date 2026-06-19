import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const adminAccessLog = pgTable("admin_access_log", {
  id:          serial("id").primaryKey(),
  timestamp:   timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  path:        text("path").notNull(),
  method:      text("method").notNull(),
  ip:          text("ip").notNull(),
  status:      text("status").notNull(),
  secretHint:  text("secret_hint"),
});

export type AdminAccessLogEntry = typeof adminAccessLog.$inferSelect;

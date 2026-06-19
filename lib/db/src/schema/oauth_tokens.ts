import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

export const oauthTokens = pgTable("oauth_tokens", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  provider: varchar("provider", { length: 50 }).notNull().unique(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  email: varchar("email", { length: 255 }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type OauthToken = typeof oauthTokens.$inferSelect;

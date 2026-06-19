import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { users } from "./users";

export const inviteTokens = pgTable("invite_tokens", {
  id:          serial("id").primaryKey(),
  token:       text("token").notNull().unique(),
  email:       text("email").notNull(),
  orgId:       integer("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role:        text("role").notNull().default("member"),
  invitedById: integer("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt:  timestamp("accepted_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type InviteToken = typeof inviteTokens.$inferSelect;

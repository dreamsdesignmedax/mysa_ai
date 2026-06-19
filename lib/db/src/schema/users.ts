import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { organizations } from "./organizations";

export type UserRole = "owner" | "admin" | "member";

export const users = pgTable("users", {
  id:                serial("id").primaryKey(),
  email:             text("email").notNull().unique(),
  passwordHash:      text("password_hash").notNull(),
  hasSetPassword:    boolean("has_set_password").notNull().default(true),
  firstName:         text("first_name").notNull().default(""),
  lastName:          text("last_name").notNull().default(""),
  orgId:             integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  role:              text("role").notNull().default("owner"),
  isActive:          boolean("is_active").notNull().default(true),
  isVerified:                    boolean("is_verified").notNull().default(false),
  verificationToken:             text("verification_token"),
  verificationTokenExpiresAt:    timestamp("verification_token_expires_at", { withTimezone: true }),
  phone:             text("phone").unique(),
  phoneVerified:     boolean("phone_verified").default(false),
  pendingEmail:                  text("pending_email"),
  pendingEmailToken:             text("pending_email_token"),
  pendingEmailTokenExpiresAt:    timestamp("pending_email_token_expires_at", { withTimezone: true }),
  city:              text("city"),
  designation:       text("designation"),
  teamSize:          text("team_size"),
  businessWhy:       text("business_why"),
  creditsBalance:    integer("credits_balance").default(50),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(true),
  onboardingSteps:   jsonb("onboarding_steps").$type<Record<string, boolean>>(),
  createdAt:                     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("users_role_check", sql`${table.role} IN ('owner', 'admin', 'member')`),
]);

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

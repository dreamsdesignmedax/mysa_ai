import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

export const whatsappSettings = pgTable("whatsapp_settings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  accessToken:           text("access_token"),
  appSecret:             text("app_secret"),
  phoneNumberId:         text("phone_number_id"),
  webhookVerifyToken:    text("webhook_verify_token"),
  bookingUrl:            text("booking_url"),
  consultantName:        text("consultant_name"),
  portfolioUrl:          text("portfolio_url"),
  caseStudyUrl:          text("case_study_url"),
  companyProfileUrl:     text("company_profile_url"),
  referenceSites:        jsonb("reference_sites").$type<string[]>().default([]),
  hookTemplateName:      text("hook_template_name"),
  hookTemplateLang:      text("hook_template_lang").default("en_US"),
  n8nWebhookUrl:         text("n8n_webhook_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WhatsappSettings = typeof whatsappSettings.$inferSelect;

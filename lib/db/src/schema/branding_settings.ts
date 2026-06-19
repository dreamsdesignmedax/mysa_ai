import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

export const brandingSettings = pgTable("branding_settings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  companyName: text("company_name"),
  tagline: text("tagline"),
  contactInfo: text("contact_info"),
  website: text("website"),
  phone: text("phone"),
  brandColor: text("brand_color"),
  logoBase64: text("logo_base64"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BrandingSettings = typeof brandingSettings.$inferSelect;

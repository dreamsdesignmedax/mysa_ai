import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { leads } from "./leads";
import { organizations } from "./organizations";

export const WA_STATES = [
  "hook_sent",
  "awaiting_yes",
  "report_sent",
  "qualifying",
  "appointment_pitched",
  "appointment_booked",
  "opted_out",
] as const;

export type WaState = typeof WA_STATES[number];

export const whatsappConversations = pgTable("whatsapp_conversations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  waPhoneNumber: text("wa_phone_number").notNull(),
  state: text("state").notNull().default("hook_sent"),
  language: text("language").notNull().default("english"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("wa_conversations_lead_id_idx").on(table.leadId),
  index("wa_conversations_state_idx").on(table.state),
  index("wa_conversations_phone_idx").on(table.waPhoneNumber),
]);

export type WhatsappConversation = typeof whatsappConversations.$inferSelect;

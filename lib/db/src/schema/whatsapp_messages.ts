import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { whatsappConversations } from "./whatsapp_conversations";

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => whatsappConversations.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  content: text("content").notNull(),
  waMessageId: text("wa_message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;

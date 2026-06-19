import { pgTable, serial, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  category: varchar("category", { length: 32 }).notNull().default("general"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  page: varchar("page", { length: 128 }),
  email: varchar("email", { length: 255 }),
  status: varchar("status", { length: 32 }).notNull().default("new"),
  priority: varchar("priority", { length: 16 }).notNull().default("medium"),
  aiDiscussion: text("ai_discussion"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

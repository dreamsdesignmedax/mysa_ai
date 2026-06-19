import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { leads } from "./leads";

export const meetings = pgTable("meetings", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  duration: integer("duration").notNull().default(60),
  type: text("type").notNull().default("discovery"),
  status: text("status").notNull().default("scheduled"),
  meetingUrl: text("meeting_url"),
  googleCalendarEventId: text("google_calendar_event_id"),
  zoomMeetingId: text("zoom_meeting_id"),
  notes: text("notes"),
  painPoints: text("pain_points").array().notNull().default([]),
  nextAction: text("next_action"),
  emotionalDriver: text("emotional_driver"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("meetings_lead_id_idx").on(table.leadId),
  index("meetings_status_idx").on(table.status),
  index("meetings_scheduled_at_idx").on(table.scheduledAt),
]);

export const insertMeetingSchema = createInsertSchema(meetings).omit({ id: true, createdAt: true });
export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;

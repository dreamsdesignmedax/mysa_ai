import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  scheduledDate: varchar("scheduled_date", { length: 20 }).notNull(),
  scheduledTime: varchar("scheduled_time", { length: 10 }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(45),
  timezone: varchar("timezone", { length: 100 }).default("Asia/Kolkata"),
  location: varchar("location", { length: 50 }).default("zoom"),
  businessSummary: text("business_summary"),
  specificProblem: text("specific_problem"),
  desiredResult: text("desired_result"),
  whyCanHelp: text("why_can_help"),
  investmentWillingness: varchar("investment_willingness", { length: 100 }),
  minInvestmentConfirm: text("min_investment_confirm"),
  startSoon: text("start_soon"),
  businessPartner: text("business_partner"),
  services: text("services").array().default([]),
  otherService: text("other_service"),
  googleCalendarEventId: text("google_calendar_event_id"),
  zoomMeetingId: text("zoom_meeting_id"),
  meetingLink: text("meeting_link"),
  status: varchar("status", { length: 50 }).notNull().default("confirmed"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Appointment = typeof appointments.$inferSelect;

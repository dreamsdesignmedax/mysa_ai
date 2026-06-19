import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { meetings } from "./meetings";
import { appointments } from "./appointments";

export const meetingTranscripts = pgTable("meeting_transcripts", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  appointmentId: integer("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 30 }).default("manual"),
  rawTranscript: text("raw_transcript"),
  summary: text("summary"),
  actionItems: text("action_items"),
  sentiment: varchar("sentiment", { length: 20 }),
  nextSteps: text("next_steps"),
  proposalDraft: text("proposal_draft"),
  emailSequenceJson: text("email_sequence_json"),
  recordingUrl: text("recording_url"),
  zoomMeetingId: varchar("zoom_meeting_id", { length: 100 }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type MeetingTranscript = typeof meetingTranscripts.$inferSelect;

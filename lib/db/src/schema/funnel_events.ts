import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { plays } from "./plays";

export const funnelEvents = pgTable("funnel_events", {
  id:           serial("id").primaryKey(),
  playId:       integer("play_id").references(() => plays.id, { onDelete: "cascade" }),
  signalPostId: integer("signal_post_id"),
  stage:        varchar("stage", { length: 40 }),
  passed:       boolean("passed"),
  reason:       text("reason"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type FunnelEvent = typeof funnelEvents.$inferSelect;
export type InsertFunnelEvent = typeof funnelEvents.$inferInsert;

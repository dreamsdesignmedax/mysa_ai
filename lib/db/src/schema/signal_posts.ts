import { boolean, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { plays } from "./plays";
import { users } from "./users";

export const signalPosts = pgTable("signal_posts", {
  id:               serial("id").primaryKey(),
  postUrl:          text("post_url").notNull(),
  platform:         text("platform").notNull().default("reddit"),
  title:            text("title").notNull(),
  body:             text("body"),
  author:           text("author"),
  subreddit:        text("subreddit"),
  score:            integer("score").notNull().default(0),
  rawJson:          text("raw_json"),
  crawledAt:        timestamp("crawled_at", { withTimezone: true }).defaultNow(),
  classifiedAt:     timestamp("classified_at", { withTimezone: true }),
  intentType:       text("intent_type"),
  confidence:       numeric("confidence", { precision: 4, scale: 3 }),
  isBuyingSignal:   boolean("is_buying_signal").notNull().default(false),
  companyMentioned: text("company_mentioned"),
  industryHint:     text("industry_hint"),
  budgetHint:       text("budget_hint"),
  classifierNotes:  text("classifier_notes"),
  dismissedAt:      timestamp("dismissed_at", { withTimezone: true }),
  playId:           integer("play_id").references(() => plays.id, { onDelete: "set null" }),
  userId:           integer("user_id").references(() => users.id, { onDelete: "set null" }),
  matchedSignal:    text("matched_signal"),
  processed:        boolean("processed").default(false),
});

export type SignalPost = typeof signalPosts.$inferSelect;
export type InsertSignalPost = typeof signalPosts.$inferInsert;

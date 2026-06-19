import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const creditLedger = pgTable("credit_ledger", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  playLeadId:   integer("play_lead_id"),
  type:         varchar("type", { length: 20 }),
  amount:       integer("amount"),
  reason:       text("reason"),
  balanceAfter: integer("balance_after"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type InsertCreditLedgerEntry = typeof creditLedger.$inferInsert;

import { pgTable, serial, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const waitlist = pgTable("waitlist", {
  id:             serial("id").primaryKey(),
  name:           varchar("name", { length: 200 }).notNull(),
  email:          varchar("email", { length: 300 }).notNull().unique(),
  phone:          varchar("phone", { length: 50 }),
  company:        varchar("company", { length: 200 }),
  role:           varchar("role", { length: 200 }),
  location:       varchar("location", { length: 200 }),
  message:        text("message"),
  approved:       boolean("approved").default(false).notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

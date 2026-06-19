import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { leads } from "./leads";
import { organizations } from "./organizations";

export const leadLists = pgTable("lead_lists", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").references(() => organizations.id),
  name:        text("name").notNull(),
  description: text("description"),
  color:       text("color").default("#6366F1").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});

export const leadListItems = pgTable("lead_list_items", {
  id:      serial("id").primaryKey(),
  listId:  integer("list_id").notNull().references(() => leadLists.id, { onDelete: "cascade" }),
  leadId:  integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("lead_list_items_unique").on(table.listId, table.leadId),
]);

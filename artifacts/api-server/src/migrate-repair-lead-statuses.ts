import { db } from "@workspace/db";
import { leads } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const STATUS_MAP: Record<string, string> = {
  new:           "new_enquiry",
  nurture:       "follow_up",
  qualified:     "enquiry_qualified",
  meeting_booked: "discovery_call",
  proposal_sent: "quote_sent",
};

export interface RepairLeadStatusSummary {
  checked: number;
  updated: number;
  skipped: number;
}

export async function runRepairLeadStatuses(): Promise<RepairLeadStatusSummary> {
  let checked = 0;
  let updated = 0;
  let skipped = 0;

  const oldStatuses = Object.keys(STATUS_MAP);

  const staleLeads = await db
    .select({ id: leads.id, status: leads.status })
    .from(leads)
    .where(inArray(leads.status, oldStatuses));

  checked = staleLeads.length;

  for (const lead of staleLeads) {
    const newStatus = STATUS_MAP[lead.status];
    if (!newStatus) { skipped++; continue; }
    await db
      .update(leads)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    updated++;
  }

  return { checked, updated, skipped };
}

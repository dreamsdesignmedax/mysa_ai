import { fileURLToPath } from "url";
import { db } from "@workspace/db";
import { leadAudits, auditRuns } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { repairAiStatus, type AuditSignalRepair } from "./lib/repairAiStatus";

type AuditSignal = AuditSignalRepair;

export interface RepairAiStatusSummary {
  leadAuditsChecked: number;
  leadAuditsUpdated: number;
  auditRunsChecked: number;
  auditRunsUpdated: number;
}

export async function runRepairAiStatus(): Promise<RepairAiStatusSummary> {
  let leadAuditsChecked = 0;
  let leadAuditsUpdated = 0;
  let auditRunsChecked = 0;
  let auditRunsUpdated = 0;

  const allLeadAudits = await db.select().from(leadAudits);
  for (const row of allLeadAudits) {
    leadAuditsChecked++;
    const original = (row.signals as AuditSignal[]) ?? [];
    const repaired = repairAiStatus(original);
    const changed = repaired.some((s, i) => s.aiStatus !== original[i]?.aiStatus);
    if (changed) {
      await db
        .update(leadAudits)
        .set({ signals: repaired, updatedAt: new Date() })
        .where(eq(leadAudits.id, row.id));
      leadAuditsUpdated++;
    }
  }

  const allAuditRuns = await db.select().from(auditRuns);
  for (const row of allAuditRuns) {
    auditRunsChecked++;
    const original = (row.signals as AuditSignal[]) ?? [];
    const repaired = repairAiStatus(original);
    const changed = repaired.some((s, i) => s.aiStatus !== original[i]?.aiStatus);
    if (changed) {
      await db
        .update(auditRuns)
        .set({ signals: repaired })
        .where(eq(auditRuns.id, row.id));
      auditRunsUpdated++;
    }
  }

  return { leadAuditsChecked, leadAuditsUpdated, auditRunsChecked, auditRunsUpdated };
}

async function run() {
  console.log("Starting AI status repair migration…");
  const summary = await runRepairAiStatus();
  console.log("\nMigration complete.");
  console.log(`  lead_audits : checked=${summary.leadAuditsChecked}, updated=${summary.leadAuditsUpdated}`);
  console.log(`  audit_runs  : checked=${summary.auditRunsChecked},  updated=${summary.auditRunsUpdated}`);
  process.exit(0);
}

const selfPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] != null &&
  selfPath.includes("migrate-repair-ai-status") &&
  selfPath === process.argv[1];
if (isMain) {
  run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}

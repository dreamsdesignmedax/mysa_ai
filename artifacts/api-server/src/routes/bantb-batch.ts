import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { leads, leadAudits, batchJobs } from "@workspace/db/schema";
import { eq, and, or, isNull, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { scoreToBandKey } from "../lib/utils";
import { logger } from "../lib/logger";

const router = Router();

const ROUTING = {
  priority_believer: { action: "priority_believer", message: "PRIORITY BELIEVER (BANTB 100+, Belief 18+) — assign directly and book discovery call", nextStatus: "discovery_call" },
  qualified_believer: { action: "qualified_believer", message: "QUALIFIED BELIEVER (BANTB 80+, Belief 12+) — WHY-first email triggered", nextStatus: "enquiry_qualified" },
  qualified_standard: { action: "qualified_standard", message: "QUALIFIED STANDARD (BANT 65+) — standard outreach sequence", nextStatus: "enquiry_qualified" },
  nurture_belief: { action: "nurture_belief", message: "NURTURE — send belief-building content over 30 days", nextStatus: "follow_up" },
  cold: { action: "cold", message: "COLD — add to newsletter list only", nextStatus: "project_lost" },
} as const;

function determineBANTBRoute(bantbTotal: number, beliefScore: number, bantTotal: number) {
  if (bantbTotal >= 100 && beliefScore >= 18) return ROUTING.priority_believer;
  if (bantbTotal >= 80  && beliefScore >= 12) return ROUTING.qualified_believer;
  if (bantTotal  >= 65  && beliefScore < 12)  return ROUTING.qualified_standard;
  if (bantbTotal >= 50) return ROUTING.nurture_belief;
  return ROUTING.cold;
}

function calcMatrixBant(lead: typeof leads.$inferSelect, auditHealth: number | null) {
  const rawSize = (lead.companySize ?? "").replace(/\s/g, "").toLowerCase();
  let budget: number;
  if (/500\+|501\+|1000\+|\d{3,}-?\d{4,}/.test(rawSize)) budget = 25;
  else if (/^201-?500$|^200-?500$/.test(rawSize)) budget = 20;
  else if (/^51-?200$|^50-?200$/.test(rawSize)) budget = 15;
  else if (/^11-?50$|^10-?50$/.test(rawSize)) budget = 10;
  else if (/^1-?10$|^2-?10$/.test(rawSize)) budget = 5;
  else budget = 10;

  const desig = (lead.designation ?? "").toLowerCase();
  let authority: number;
  if (/ceo|founder|owner|president|managing director|managing partner/.test(desig)) authority = 25;
  else if (/\bvp\b|vice president|director|chief|\bcoo\b|\bcto\b|\bcmo\b|\bcfo\b/.test(desig)) authority = 20;
  else if (/head of|general manager|\bpartner\b/.test(desig)) authority = 15;
  else if (/\bmanager\b|\blead\b|supervisor/.test(desig)) authority = 10;
  else authority = 5;

  let need: number;
  if (auditHealth === null) need = 15;
  else if (auditHealth < 25) need = 25;
  else if (auditHealth < 50) need = 20;
  else if (auditHealth < 65) need = 15;
  else if (auditHealth < 80) need = 10;
  else need = 5;

  const src = (lead.source ?? "").toLowerCase();
  let timeline: number;
  if (/referral|word[- ]of[- ]mouth/.test(src)) timeline = 25;
  else if (/inbound|contact.?form|website/.test(src)) timeline = 20;
  else if (/event|conference|expo|fair|trade.?show/.test(src)) timeline = 15;
  else if (/linkedin|instagram|facebook|twitter|social/.test(src)) timeline = 10;
  else timeline = 5;

  const total = budget + authority + need + timeline;
  return { budget, authority, need, timeline, total };
}

const BatchScoreSchema = z.object({
  leadIds: z.array(z.number().int().positive()).min(1).max(500),
});

router.post("/bantb/batch", async (req: Request, res: Response): Promise<void> => {
  const parsed = BatchScoreSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { leadIds } = parsed.data;
  const orgId = req.user!.orgId;

  const rows = await db
    .select({ lead: leads, audit: leadAudits })
    .from(leads)
    .leftJoin(leadAudits, eq(leadAudits.leadId, leads.id))
    .where(and(eq(leads.orgId, orgId), inArray(leads.id, leadIds)));

  if (rows.length === 0) { res.status(404).json({ error: "No matching leads found" }); return; }

  const bantbOverrides = await fetchOrgOverrides(orgId);
  const requests = rows.map(({ lead, audit }) => {
    const auditHealth = audit?.healthScore ?? null;
    const matrix = calcMatrixBant(lead, auditHealth);
    const beliefScore = lead.beliefScore ?? 0;

    const prompt = `You are a B2B sales qualification expert for Dreamsdesign. The BANT scores are pre-calculated. Write a 1-sentence reason for each dimension.
Lead: ${lead.firstName} ${lead.lastName}, ${lead.designation ?? "?"} at ${lead.company} (${lead.industry ?? "?"}, ${lead.country ?? "?"})
BANT: Budget ${matrix.budget}/25, Authority ${matrix.authority}/25, Need ${matrix.need}/25, Timeline ${matrix.timeline}/25, Total ${matrix.total}/100
Return ONLY valid JSON: {"budget":{"score":${matrix.budget},"reason":"..."},"authority":{"score":${matrix.authority},"reason":"..."},"need":{"score":${matrix.need},"reason":"..."},"timeline":{"score":${matrix.timeline},"reason":"..."},"totalScore":${matrix.total}}`;

    return {
      custom_id: String(lead.id),
      params: {
        model: getModel("bantb_scoring", bantbOverrides),
        max_tokens: 400,
        messages: [{ role: "user" as const, content: prompt }],
      },
    };
  });

  let batchId: string;
  try {
    const batch = await anthropic.beta.messages.batches.create({ requests });
    batchId = batch.id;
  } catch (err) {
    logger.error({ err }, "BANTB Batch: failed to create Anthropic batch");
    res.status(502).json({ error: "Failed to submit batch to Anthropic" });
    return;
  }

  const [job] = await db.insert(batchJobs).values({
    batchId,
    orgId,
    type: "bantb_scoring",
    status: "in_progress",
    leadsCount: rows.length,
  }).returning();

  res.json({ batchId, jobId: job.id, leadsCount: rows.length, status: "in_progress", message: "Batch scoring submitted. Poll GET /api/bantb/batch/:batchId for results." });
});

router.get("/bantb/batch/:batchId", async (req: Request, res: Response): Promise<void> => {
  const batchId = String(req.params.batchId);
  const orgId = req.user!.orgId;

  const [job] = await db.select().from(batchJobs)
    .where(and(eq(batchJobs.batchId, batchId), eq(batchJobs.orgId, orgId)))
    .limit(1);

  if (!job) { res.status(404).json({ error: "Batch job not found" }); return; }

  if (job.status === "complete") {
    res.json({ batchId, status: "complete", leadsCount: job.leadsCount, completedAt: job.completedAt });
    return;
  }

  let anthropicBatch: { processing_status: string };
  try {
    anthropicBatch = await anthropic.beta.messages.batches.retrieve(batchId);
  } catch (err) {
    logger.error({ err, batchId }, "BANTB Batch: failed to retrieve batch status");
    res.status(502).json({ error: "Failed to retrieve batch status from Anthropic" });
    return;
  }

  if (anthropicBatch.processing_status !== "ended") {
    res.json({ batchId, status: "in_progress", leadsCount: job.leadsCount, processingStatus: anthropicBatch.processing_status });
    return;
  }

  let scored = 0;
  try {
    for await (const result of await anthropic.beta.messages.batches.results(batchId)) {
      const leadId = Number(result.custom_id);
      if (isNaN(leadId)) continue;
      if (result.result.type !== "succeeded") continue;

      const content = result.result.message.content[0];
      if (!content || content.type !== "text") continue;

      const match = content.text.match(/\{[\s\S]*\}/);
      if (!match) continue;

      try {
        const parsed = JSON.parse(match[0]) as {
          budget?: { score: number; reason: string };
          authority?: { score: number; reason: string };
          need?: { score: number; reason: string };
          timeline?: { score: number; reason: string };
          totalScore?: number;
        };

        const [row] = await db.select({ lead: leads, audit: leadAudits })
          .from(leads)
          .leftJoin(leadAudits, eq(leadAudits.leadId, leads.id))
          .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
          .limit(1);

        if (!row) continue;

        const { lead, audit } = row;
        const matrix = calcMatrixBant(lead, audit?.healthScore ?? null);
        const beliefScore = lead.beliefScore ?? 0;
        const bantbTotalVal = matrix.total + beliefScore;
        const routing = determineBANTBRoute(bantbTotalVal, beliefScore, matrix.total);

        const breakdown = {
          budget: matrix.budget,
          authority: matrix.authority,
          need: matrix.need,
          timeline: matrix.timeline,
          reasoning: {
            budget:    parsed.budget?.reason    ?? "",
            authority: parsed.authority?.reason ?? "",
            need:      parsed.need?.reason      ?? "",
            timeline:  parsed.timeline?.reason  ?? "",
          },
        };

        await db.update(leads).set({
          bantScore:    matrix.total,
          bantBreakdown: breakdown,
          bantbTotal:   bantbTotalVal,
          status:       routing.nextStatus,
          updatedAt:    new Date(),
        }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

        scored++;
      } catch { /* skip malformed result */ }
    }

    await db.update(batchJobs).set({ status: "complete", completedAt: new Date() })
      .where(eq(batchJobs.batchId, batchId));

  } catch (err) {
    logger.error({ err, batchId }, "BANTB Batch: error processing results");
    res.status(502).json({ error: "Error processing batch results" });
    return;
  }

  res.json({ batchId, status: "complete", leadsCount: job.leadsCount, scored, completedAt: new Date().toISOString() });
});

export default router;

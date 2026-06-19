import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { leads, leadAudits } from "@workspace/db/schema";
import { eq, or, isNull, desc, sql, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { logAnthropicUsage } from "../lib/logApiUsage";
import { scoreToBandKey } from "../lib/utils";

const router = Router();

const BantScoreSchema = z.object({
  budget: z.number().min(0).max(25),
  authority: z.number().min(0).max(25),
  need: z.number().min(0).max(25),
  timeline: z.number().min(0).max(25),
  beliefScore: z.number().min(0).max(25).optional(),
  beliefReason: z.string().optional(),
  beliefEvidence: z.string().optional(),
  beliefSignals: z.object({
    linkedin: z.boolean(),
    aboutPage: z.boolean(),
    founderStory: z.boolean(),
    mission: z.boolean(),
  }).optional(),
  reasoning: z.object({
    budget: z.string().optional(),
    authority: z.string().optional(),
    need: z.string().optional(),
    timeline: z.string().optional(),
  }).optional(),
});

// ── BANTB routing — 5-tier belief-aware classification ────────────────────────
const ROUTING = {
  priority_believer: {
    action: "priority_believer",
    message: "PRIORITY BELIEVER (BANTB 100+, Belief 18+) — assign directly and book discovery call",
    nextStatus: "discovery_call",
    color: "#D97706",
    bg: "rgba(217,119,6,0.12)",
  },
  qualified_believer: {
    action: "qualified_believer",
    message: "QUALIFIED BELIEVER (BANTB 80+, Belief 12+) — WHY-first email triggered",
    nextStatus: "enquiry_qualified",
    color: "#0D9488",
    bg: "rgba(13,148,136,0.12)",
  },
  qualified_standard: {
    action: "qualified_standard",
    message: "QUALIFIED STANDARD (BANT 65+) — standard outreach sequence",
    nextStatus: "enquiry_qualified",
    color: "#3B82F6",
    bg: "rgba(59,130,246,0.12)",
  },
  nurture_belief: {
    action: "nurture_belief",
    message: "NURTURE — send belief-building content over 30 days",
    nextStatus: "follow_up",
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.12)",
  },
  cold: {
    action: "cold",
    message: "COLD — add to newsletter list only",
    nextStatus: "project_lost",
    color: "#6B7280",
    bg: "rgba(107,114,128,0.12)",
  },
} as const;

function determineBANTBRoute(bantbTotal: number, beliefScore: number, bantTotal: number) {
  if (bantbTotal >= 100 && beliefScore >= 18) return ROUTING.priority_believer;
  if (bantbTotal >= 80 && beliefScore >= 12) return ROUTING.qualified_believer;
  if (bantTotal >= 65 && beliefScore < 12) return ROUTING.qualified_standard;
  if (bantbTotal >= 50) return ROUTING.nurture_belief;
  return ROUTING.cold;
}

router.get("/qualify/queue", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const queue = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      company: leads.company,
      designation: leads.designation,
      industry: leads.industry,
      country: leads.country,
      companySize: leads.companySize,
      website: leads.website,
      source: leads.source,
      bantScore: leads.bantScore,
      bantBreakdown: leads.bantBreakdown,
      beliefScore: leads.beliefScore,
      beliefReason: leads.beliefReason,
      beliefEvidence: leads.beliefEvidence,
      beliefSignals: leads.beliefSignals,
      bantbTotal: leads.bantbTotal,
      status: leads.status,
      tags: leads.tags,
      notes: leads.notes,
      sequenceDay: leads.sequenceDay,
      lastContactedAt: leads.lastContactedAt,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      auditHealthScore: leadAudits.healthScore,
    })
    .from(leads)
    .leftJoin(leadAudits, eq(leadAudits.leadId, leads.id))
    .where(and(
      eq(leads.orgId, orgId),
      or(
        eq(leads.status, "new_enquiry"),
        eq(leads.status, "enquiry_qualified"),
        eq(leads.status, "follow_up"),
        isNull(leads.bantScore),
      ),
    ))
    .orderBy(
      desc(sql`COALESCE(${leadAudits.healthScore}, -1)`),
      desc(leads.createdAt),
    );
  res.json(queue);
});

router.post("/qualify/:leadId/score", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const parsed = BantScoreSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { budget, authority, need, timeline, beliefScore = 0, beliefReason, beliefEvidence, beliefSignals, reasoning } = parsed.data;
  const bantTotal = budget + authority + need + timeline;
  const bantbTotalVal = bantTotal + beliefScore;
  const breakdown = {
    budget,
    authority,
    need,
    timeline,
    ...(reasoning ? { reasoning } : {}),
  };

  const routing = determineBANTBRoute(bantbTotalVal, beliefScore, bantTotal);

  const orgId = req.user!.orgId;
  const [updated] = await db
    .update(leads)
    .set({
      bantScore: bantTotal,
      bantBreakdown: breakdown,
      beliefScore,
      beliefReason: beliefReason ?? null,
      beliefEvidence: beliefEvidence ?? null,
      beliefSignals: beliefSignals ?? null,
      bantbTotal: bantbTotalVal,
      status: routing.nextStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json({ ...updated, routing });
});

// ── Deterministic BANT matrix ─────────────────────────────────────────────────
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

router.post("/qualify/:leadId/ai", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const orgId = req.user!.orgId;
  const rows = await db
    .select({ lead: leads, audit: leadAudits })
    .from(leads)
    .leftJoin(leadAudits, eq(leadAudits.leadId, leads.id))
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

  if (!rows.length) { res.status(404).json({ error: "Lead not found" }); return; }
  const { lead, audit } = rows[0]!;

  if (lead.bantScore !== null && !req.query.force) {
    res.status(409).json({ error: "ALREADY_SCORED" });
    return;
  }

  const auditHealth = audit?.healthScore ?? null;
  const matrix = calcMatrixBant(lead, auditHealth);
  const existingBelief = lead.beliefScore ?? 0;
  const bantbTotalVal = matrix.total + existingBelief;

  const prompt = `You are a B2B sales qualification expert for Dreamsdesign, a premium design agency.

The lead's BANT scores have been pre-calculated using a deterministic scoring matrix:
- Budget: ${matrix.budget}/25 (based on company size: ${lead.companySize ?? "unknown"})
- Authority: ${matrix.authority}/25 (based on designation: ${lead.designation})
- Need: ${matrix.need}/25 (based on audit health score: ${auditHealth !== null ? `${auditHealth}/100` : "no audit run yet"})
- Timeline: ${matrix.timeline}/25 (based on lead source: ${lead.source})
- Total: ${matrix.total}/100

Lead Profile:
- Name: ${lead.firstName} ${lead.lastName}
- Company: ${lead.company}
- Industry: ${lead.industry}
- Country: ${lead.country}
- Notes: ${lead.notes ?? "none"}
${auditHealth !== null ? `\nBrand Audit Score: ${auditHealth}/100 — this measures gaps in their current digital/brand presence.` : ""}

Write a 1-sentence reason for each BANT dimension explaining why this score makes sense for this lead.
Return ONLY valid JSON (no markdown):
{
  "budget": { "score": ${matrix.budget}, "reason": "1-sentence reason" },
  "authority": { "score": ${matrix.authority}, "reason": "1-sentence reason" },
  "need": { "score": ${matrix.need}, "reason": "1-sentence reason" },
  "timeline": { "score": ${matrix.timeline}, "reason": "1-sentence reason" },
  "totalScore": ${matrix.total}
}`;

  const overrides = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("bantb_scoring", overrides),
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  void logAnthropicUsage({ model: getModel("bantb_scoring", overrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "bantb_scoring", orgId });
  const match = raw.match(/\{[\s\S]*\}/);

  const fallback = {
    budget: { score: matrix.budget, reason: `Company size ${lead.companySize ?? "unknown"} indicates this budget capacity.` },
    authority: { score: matrix.authority, reason: `As ${lead.designation}, they have this level of decision-making authority.` },
    need: { score: matrix.need, reason: auditHealth !== null ? `Audit health of ${auditHealth}/100 reveals significant gaps in their digital presence.` : "No audit run yet; moderate need assumed from industry profile." },
    timeline: { score: matrix.timeline, reason: `Lead source (${lead.source}) suggests this urgency level.` },
    totalScore: matrix.total,
  };

  const routing = determineBANTBRoute(bantbTotalVal, existingBelief, matrix.total);

  try {
    if (match) {
      const aiParsed = JSON.parse(match[0]);
      const budgetReason = aiParsed.budget?.reason ?? fallback.budget.reason;
      const authorityReason = aiParsed.authority?.reason ?? fallback.authority.reason;
      const needReason = aiParsed.need?.reason ?? fallback.need.reason;
      const timelineReason = aiParsed.timeline?.reason ?? fallback.timeline.reason;
      const reasoning = `Budget: ${budgetReason} Authority: ${authorityReason} Need: ${needReason} Timeline: ${timelineReason}`;

      const breakdownWithReasoning = {
        budget: matrix.budget,
        authority: matrix.authority,
        need: matrix.need,
        timeline: matrix.timeline,
        reasoning: { budget: budgetReason, authority: authorityReason, need: needReason, timeline: timelineReason },
      };

      await db
        .update(leads)
        .set({ bantScore: matrix.total, bantBreakdown: breakdownWithReasoning, bantbTotal: bantbTotalVal, status: routing.nextStatus, updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

      res.json({
        budget: { score: matrix.budget, reason: budgetReason },
        authority: { score: matrix.authority, reason: authorityReason },
        need: { score: matrix.need, reason: needReason },
        timeline: { score: matrix.timeline, reason: timelineReason },
        totalScore: matrix.total,
        bantbTotal: bantbTotalVal,
        reasoning,
        band: scoreToBandKey(matrix.total),
        routing,
      });
      return;
    }
  } catch { /* use fallback */ }

  const fbReasoning = `Budget: ${fallback.budget.reason} Authority: ${fallback.authority.reason} Need: ${fallback.need.reason} Timeline: ${fallback.timeline.reason}`;
  const fbBreakdown = {
    budget: matrix.budget, authority: matrix.authority, need: matrix.need, timeline: matrix.timeline,
    reasoning: { budget: fallback.budget.reason, authority: fallback.authority.reason, need: fallback.need.reason, timeline: fallback.timeline.reason },
  };

  await db
    .update(leads)
    .set({ bantScore: matrix.total, bantBreakdown: fbBreakdown, bantbTotal: bantbTotalVal, status: routing.nextStatus, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

  res.json({ ...fallback, bantbTotal: bantbTotalVal, reasoning: fbReasoning, band: scoreToBandKey(matrix.total), routing });
});

// ── AI Belief Scorer ─────────────────────────────────────────────────────────
router.post("/qualify/:leadId/belief", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const orgId = req.user!.orgId;
  const rows = await db
    .select({ lead: leads })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

  if (!rows.length) { res.status(404).json({ error: "Lead not found" }); return; }
  const { lead } = rows[0]!;

  const prompt = `You are a belief alignment analyst. MysaAI's WHY is:
"We believe every B2B founder deserves a sales engine that works as hard as they do."

Score this prospect 0-25 for belief alignment with that mission.

Scoring guide:
18-25: Clear mission, explains WHY they started, talks about customer outcomes, takes principled stands
9-17:  Some purpose language, mostly feature-focused
0-8:   Purely transactional, no mission visible

Prospect information:
- Name: ${lead.firstName} ${lead.lastName}
- Company: ${lead.company}
- Designation: ${lead.designation}
- Industry: ${lead.industry}
- Website: ${lead.website ?? "not provided"}
- LinkedIn: ${lead.linkedInUrl ?? "not provided"}
- Notes: ${lead.notes ?? "none"}
- Company Size: ${lead.companySize ?? "unknown"}

Based on the designation, company type, and any available signals, assess their likely belief alignment.
If LinkedIn or website data is not provided, infer from the designation and company context.

Return ONLY valid JSON (no markdown, no explanation):
{
  "beliefScore": <integer 0-25>,
  "beliefReason": "<one sentence explanation>",
  "beliefEvidence": "<specific quote, signal found, or 'Inferred from role and company type'>",
  "beliefSignals": {
    "linkedin": <true if they likely post thought leadership / opinions>,
    "aboutPage": <true if their company likely has a mission-driven about page>,
    "founderStory": <true if there is a genuine founder story visible>,
    "mission": <true if there is a clear mission statement beyond profit>
  }
}`;

  const fallback = {
    beliefScore: 8,
    beliefReason: "Insufficient public signals to determine belief alignment — defaulting to low.",
    beliefEvidence: "No LinkedIn or website data available for analysis.",
    beliefSignals: { linkedin: false, aboutPage: false, founderStory: false, mission: false },
  };

  let result = fallback;

  const beliefOverrides = await fetchOrgOverrides(orgId);
  try {
    const msg = await anthropic.messages.create({
      model: getModel("belief_scoring", beliefOverrides),
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    void logAnthropicUsage({ model: getModel("belief_scoring", beliefOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "belief_scoring", orgId });
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const aiParsed = JSON.parse(match[0]);
      result = {
        beliefScore: Math.min(25, Math.max(0, Math.round(aiParsed.beliefScore ?? 8))),
        beliefReason: aiParsed.beliefReason ?? fallback.beliefReason,
        beliefEvidence: aiParsed.beliefEvidence ?? fallback.beliefEvidence,
        beliefSignals: {
          linkedin: Boolean(aiParsed.beliefSignals?.linkedin),
          aboutPage: Boolean(aiParsed.beliefSignals?.aboutPage),
          founderStory: Boolean(aiParsed.beliefSignals?.founderStory),
          mission: Boolean(aiParsed.beliefSignals?.mission),
        },
      };
    }
  } catch { /* use fallback */ }

  const bantTotal = lead.bantScore ?? 0;
  const bantbTotalVal = bantTotal + result.beliefScore;

  await db
    .update(leads)
    .set({
      beliefScore: result.beliefScore,
      beliefReason: result.beliefReason,
      beliefEvidence: result.beliefEvidence,
      beliefSignals: result.beliefSignals,
      bantbTotal: bantbTotalVal,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

  res.json({ ...result, bantbTotal: bantbTotalVal });
});

router.post("/qualify/:leadId/explain", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const orgId = req.user!.orgId;
  const rows = await db
    .select({ lead: leads, audit: leadAudits })
    .from(leads)
    .leftJoin(leadAudits, eq(leadAudits.leadId, leads.id))
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

  if (!rows.length) { res.status(404).json({ error: "Lead not found" }); return; }
  const { lead, audit } = rows[0]!;

  const bd = lead.bantBreakdown as Record<string, unknown> | null;
  if (!bd || typeof bd.budget !== "number") {
    res.status(400).json({ error: "Lead has no BANT scores to explain" }); return;
  }

  const existingScores = {
    budget: typeof bd.budget === "number" && isFinite(bd.budget) ? bd.budget : 0,
    authority: typeof bd.authority === "number" && isFinite(bd.authority) ? bd.authority : 0,
    need: typeof bd.need === "number" && isFinite(bd.need) ? bd.need : 0,
    timeline: typeof bd.timeline === "number" && isFinite(bd.timeline) ? bd.timeline : 0,
  };
  const total = existingScores.budget + existingScores.authority + existingScores.need + existingScores.timeline;
  const auditHealth = audit?.healthScore ?? null;

  const prompt = `You are a B2B sales qualification expert for Dreamsdesign, a premium design agency.

A lead was previously scored using a deterministic BANT matrix. The scores are fixed — your job is only to explain them.

BANT Scores:
- Budget: ${existingScores.budget}/25 (based on company size: ${lead.companySize ?? "unknown"})
- Authority: ${existingScores.authority}/25 (based on designation: ${lead.designation})
- Need: ${existingScores.need}/25 (based on audit health score: ${auditHealth !== null ? `${auditHealth}/100` : "no audit run yet"})
- Timeline: ${existingScores.timeline}/25 (based on lead source: ${lead.source})
- Total: ${total}/100

Lead Profile:
- Name: ${lead.firstName} ${lead.lastName}
- Company: ${lead.company}
- Industry: ${lead.industry}
- Country: ${lead.country}
- Notes: ${lead.notes ?? "none"}
${auditHealth !== null ? `\nBrand Audit Score: ${auditHealth}/100 — measures gaps in their digital/brand presence.` : ""}

Write a 1-sentence reason for each BANT dimension.
Return ONLY valid JSON (no markdown):
{
  "budget": { "score": ${existingScores.budget}, "reason": "1-sentence reason" },
  "authority": { "score": ${existingScores.authority}, "reason": "1-sentence reason" },
  "need": { "score": ${existingScores.need}, "reason": "1-sentence reason" },
  "timeline": { "score": ${existingScores.timeline}, "reason": "1-sentence reason" },
  "totalScore": ${total}
}`;

  const fallback = {
    budget: { score: existingScores.budget, reason: `Company size ${lead.companySize ?? "unknown"} indicates this budget capacity.` },
    authority: { score: existingScores.authority, reason: `As ${lead.designation ?? "unknown role"}, they have this level of decision-making authority.` },
    need: { score: existingScores.need, reason: auditHealth !== null ? `Audit health of ${auditHealth}/100 reveals this level of need for design services.` : "No audit run yet; need estimated from company profile." },
    timeline: { score: existingScores.timeline, reason: `Lead source (${lead.source ?? "unknown"}) suggests this urgency level.` },
    totalScore: total,
  };

  let aiResult = fallback;

  const batchOverrides = await fetchOrgOverrides(orgId);
  try {
    const msg = await anthropic.messages.create({
      model: getModel("bantb_scoring", batchOverrides),
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    void logAnthropicUsage({ model: getModel("bantb_scoring", batchOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "bantb_scoring", orgId });
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const aiParsed = JSON.parse(match[0]);
      aiResult = {
        budget: { score: existingScores.budget, reason: aiParsed.budget?.reason ?? fallback.budget.reason },
        authority: { score: existingScores.authority, reason: aiParsed.authority?.reason ?? fallback.authority.reason },
        need: { score: existingScores.need, reason: aiParsed.need?.reason ?? fallback.need.reason },
        timeline: { score: existingScores.timeline, reason: aiParsed.timeline?.reason ?? fallback.timeline.reason },
        totalScore: total,
      };
    }
  } catch { /* use fallback */ }

  const updatedBreakdown = {
    ...existingScores,
    reasoning: {
      budget: aiResult.budget.reason,
      authority: aiResult.authority.reason,
      need: aiResult.need.reason,
      timeline: aiResult.timeline.reason,
    },
  };

  await db
    .update(leads)
    .set({ bantBreakdown: updatedBreakdown, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

  const reasoning = `Budget: ${aiResult.budget.reason} Authority: ${aiResult.authority.reason} Need: ${aiResult.need.reason} Timeline: ${aiResult.timeline.reason}`;
  res.json({ ...aiResult, reasoning });
});

router.post("/qualify/bulk-score", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const pendingLeads = await db
    .select({ lead: leads, audit: leadAudits })
    .from(leads)
    .leftJoin(leadAudits, eq(leadAudits.leadId, leads.id))
    .where(and(eq(leads.orgId, orgId), or(eq(leads.status, "new_enquiry"), eq(leads.status, "enquiry_qualified"), eq(leads.status, "follow_up"), isNull(leads.bantScore))));

  const results: { leadId: number; total: number; band: string; routing: string }[] = [];

  for (const { lead, audit } of pendingLeads) {
    const auditHealth = audit?.healthScore ?? null;
    const matrix = calcMatrixBant(lead, auditHealth);
    const beliefScore = lead.beliefScore ?? 0;
    const bantbTotalVal = matrix.total + beliefScore;

    const routing = determineBANTBRoute(bantbTotalVal, beliefScore, matrix.total);
    const breakdown = {
      budget: matrix.budget,
      authority: matrix.authority,
      need: matrix.need,
      timeline: matrix.timeline,
      reasoning: {
        budget: `Company size ${lead.companySize ?? "unknown"} indicates this budget capacity.`,
        authority: `As ${lead.designation ?? "unknown role"}, they have this level of decision-making authority.`,
        need: auditHealth !== null
          ? `Audit health of ${auditHealth}/100 reveals this level of need for design services.`
          : "No audit run yet; moderate need assumed from industry profile.",
        timeline: `Lead source (${lead.source ?? "unknown"}) suggests this urgency level.`,
      },
    };

    await db.update(leads).set({ bantScore: matrix.total, bantBreakdown: breakdown, bantbTotal: bantbTotalVal, status: routing.nextStatus, updatedAt: new Date() }).where(and(eq(leads.id, lead.id), eq(leads.orgId, orgId)));
    results.push({ leadId: lead.id, total: matrix.total, band: scoreToBandKey(matrix.total) ?? "disqualify", routing: routing.message });
  }

  res.json({ scored: results.length, results });
});

export default router;

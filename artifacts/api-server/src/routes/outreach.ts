import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { outreachSequences, touchpoints, leads } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { logAnthropicUsage } from "../lib/logApiUsage";

const router = Router();

const CHANNELS = ["email", "linkedin", "whatsapp", "call"] as const;

const CreateSequenceSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional().nullable(),
  steps: z.array(z.object({
    day: z.number().int().min(1),
    channel: z.enum(CHANNELS),
    subject: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
  })).optional(),
  active: z.boolean().optional(),
});

const UpdateSequenceSchema = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().optional().nullable(),
  steps: z.array(z.unknown()).optional(),
  active: z.boolean().optional(),
});

const GenerateOutreachSchema = z.object({
  leadId: z.number().int().positive(),
  sequenceDay: z.number().int().min(1),
  channel: z.enum(CHANNELS),
});

const UpdateTouchpointSchema = z.object({
  body: z.string().optional(),
  subject: z.string().optional().nullable(),
  status: z.enum(["pending", "sent", "skipped"]).optional(),
  sentAt: z.string().datetime().optional().nullable(),
});

router.get("/outreach/sequences", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const seqs = await db.select().from(outreachSequences).where(eq(outreachSequences.orgId, orgId)).orderBy(outreachSequences.id);
  res.json(seqs);
});

router.post("/outreach/sequences", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateSequenceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const { name, industry, steps, active } = parsed.data;
  const orgId = req.user!.orgId;
  const [created] = await db.insert(outreachSequences).values({ orgId, name, industry: industry ?? null, steps: steps ?? [], active: active ?? true }).returning();
  res.status(201).json(created);
});

router.patch("/outreach/sequences/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = UpdateSequenceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const orgId = req.user!.orgId;
  const updates: Record<string, unknown> = {};
  const data = parsed.data;
  if (data.name !== undefined) updates.name = data.name;
  if (data.industry !== undefined) updates.industry = data.industry;
  if (data.steps !== undefined) updates.steps = data.steps;
  if (data.active !== undefined) updates.active = data.active;
  const [updated] = await db.update(outreachSequences).set(updates).where(and(eq(outreachSequences.id, id), eq(outreachSequences.orgId, orgId))).returning();
  if (!updated) { res.status(404).json({ error: "Sequence not found" }); return; }
  res.json(updated);
});

router.get("/outreach/queue", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const pending = await db
    .select({ tp: touchpoints, lead: leads })
    .from(touchpoints)
    .innerJoin(leads, and(eq(touchpoints.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(touchpoints.status, "pending"));

  const result = pending.map(({ tp, lead }) => ({
    ...tp,
    leadName: `${lead.firstName} ${lead.lastName}`,
    company: lead.company,
  }));

  res.json(result);
});

async function generatePersonalizedMessage(lead: typeof leads.$inferSelect, day: number, channel: string): Promise<{ subject: string | null; body: string }> {
  const prompt = `You are an expert B2B sales copywriter for Dreamsdesign, a premium design agency.

Generate a personalized ${channel} outreach message for day ${day} of the sequence.

Lead Details:
- Name: ${lead.firstName} ${lead.lastName}
- Company: ${lead.company}
- Title: ${lead.designation}
- Industry: ${lead.industry}
- Country: ${lead.country}
- Company Size: ${lead.companySize ?? "unknown"}
- Website: ${lead.website ?? "unknown"}

Rules:
- Be specific to their industry and role
- Reference their company by name
- Focus on ROI and business outcomes
- Keep email under 150 words
- WhatsApp messages under 50 words
- LinkedIn messages under 300 characters
- Day 1: First touch, introduce value proposition
- Day 3: Follow-up with a case study angle
- Day 7+: Break-up or final value message

Return JSON: { "subject": "email subject or null", "body": "message body" }`;

  const overrides = await fetchOrgOverrides(lead.orgId ?? 0);
  const msg = await anthropic.messages.create({
    model: getModel("outreach_email", overrides),
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  void logAnthropicUsage({ model: getModel("outreach_email", overrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "outreach_email", orgId: lead.orgId });
  const match = raw.match(/\{[\s\S]*\}/);

  try {
    if (match) return JSON.parse(match[0]);
  } catch { /* use fallback */ }

  return {
    subject: channel === "email" ? `Quick thought for ${lead.company}` : null,
    body: `Hi ${lead.firstName}, I noticed ${lead.company} might benefit from our design services. Would love to connect!`,
  };
}

router.post("/outreach/generate", async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateOutreachSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const { leadId, sequenceDay, channel } = parsed.data;
  const orgId = req.user!.orgId;
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const generated = await generatePersonalizedMessage(lead, sequenceDay, channel);

  res.json({
    touchpointId: null,
    subject: generated.subject,
    body: generated.body,
    channel,
    leadId,
  });
});

router.post("/outreach/bulk-generate", async (req: Request, res: Response): Promise<void> => {
  const { touchpointIds } = req.body;
  const orgId = req.user!.orgId;
  const tps = await db.select({ tp: touchpoints, lead: leads })
    .from(touchpoints)
    .innerJoin(leads, and(eq(touchpoints.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(inArray(touchpoints.id, touchpointIds));

  const results = await Promise.all(
    tps.map(async ({ tp, lead }) => {
      const generated = await generatePersonalizedMessage(lead, tp.day, tp.channel);
      await db.update(touchpoints).set({ body: generated.body, subject: generated.subject, aiGenerated: true }).where(eq(touchpoints.id, tp.id));
      return {
        touchpointId: tp.id,
        subject: generated.subject,
        body: generated.body,
        channel: tp.channel,
        leadId: tp.leadId,
      };
    }),
  );

  res.json(results);
});

router.patch("/outreach/touchpoints/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = UpdateTouchpointSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const orgId = req.user!.orgId;

  // Verify touchpoint belongs to org via lead
  const [ownership] = await db
    .select({ id: touchpoints.id })
    .from(touchpoints)
    .innerJoin(leads, and(eq(touchpoints.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(touchpoints.id, id));
  if (!ownership) { res.status(404).json({ error: "Touchpoint not found" }); return; }

  const updates: Record<string, unknown> = {};
  const data = parsed.data;
  if (data.body !== undefined) updates.body = data.body;
  if (data.subject !== undefined) updates.subject = data.subject;
  if (data.status !== undefined) updates.status = data.status;
  if (data.sentAt !== undefined) updates.sentAt = data.sentAt ? new Date(data.sentAt) : null;
  const [updated] = await db.update(touchpoints).set(updates).where(eq(touchpoints.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Touchpoint not found" }); return; }
  res.json(updated);
});

export default router;

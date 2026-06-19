import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { proposals, leads } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { logAnthropicUsage } from "../lib/logApiUsage";
import { sendViaBrevo } from "../lib/brevo";

const router = Router();

const MAX_TOKENS = 1500;

const CreateProposalSchema = z.object({
  leadId: z.number().int().positive(),
  title: z.string().min(1),
  services: z.array(z.string()).default([]),
  investment: z.number().min(0),
  roiEstimate: z.number().min(0).optional().nullable(),
});

const UpdateProposalStatusSchema = z.object({
  status: z.enum(["draft", "sent", "viewed", "negotiating", "closed_won", "closed_lost"]),
});

const UpdateProposalSchema = z.object({
  title: z.string().min(1).optional(),
  services: z.array(z.string()).optional(),
  investment: z.number().min(0).optional(),
  roiEstimate: z.number().min(0).optional().nullable(),
  content: z.record(z.unknown()).optional().nullable(),
});

router.get("/proposals", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const rows = await db.select({ proposal: proposals, lead: leads }).from(proposals)
    .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId)))
    .orderBy(proposals.createdAt);
  res.json(rows.map(({ proposal, lead }) => ({ ...proposal, lead })));
});

router.post("/proposals", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateProposalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { leadId, title, services, investment, roiEstimate } = parsed.data;
  const orgId = req.user!.orgId;

  // Verify lead belongs to this org
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [created] = await db.insert(proposals).values({ leadId, title, services, investment, roiEstimate: roiEstimate ?? null, followups: [] }).returning();
  await db.update(leads).set({ status: "quote_sent", updatedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  res.status(201).json(created);
});

router.get("/proposals/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;
  const [row] = await db.select({ proposal: proposals, lead: leads }).from(proposals)
    .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(proposals.id, id));
  if (!row) { res.status(404).json({ error: "Proposal not found" }); return; }
  res.json({ ...row.proposal, lead: row.lead });
});

router.patch("/proposals/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateProposalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const updates: Record<string, unknown> = {};
  const data = parsed.data;
  if (data.title !== undefined) updates.title = data.title;
  if (data.services !== undefined) updates.services = data.services;
  if (data.investment !== undefined) updates.investment = data.investment;
  if (data.roiEstimate !== undefined) updates.roiEstimate = data.roiEstimate;
  if (data.content !== undefined) updates.content = data.content;

  const orgId = req.user!.orgId;
  // Verify ownership first
  const [ownership] = await db.select({ id: proposals.id }).from(proposals)
    .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(proposals.id, id));
  if (!ownership) { res.status(404).json({ error: "Proposal not found" }); return; }

  const [updated] = await db.update(proposals).set(updates).where(eq(proposals.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Proposal not found" }); return; }
  res.json(updated);
});

router.post("/proposals/:id/generate", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const orgId = req.user!.orgId;
  const [row] = await db.select({ proposal: proposals, lead: leads }).from(proposals)
    .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(proposals.id, id));
  if (!row) { res.status(404).json({ error: "Proposal not found" }); return; }

  const { proposal, lead } = row;
  const prompt = `You are an expert B2B proposal writer for Dreamsdesign, a premium design agency.

Generate a compelling 333 Proposal for:
Client: ${lead.firstName} ${lead.lastName}, ${lead.designation} at ${lead.company}
Industry: ${lead.industry} | Country: ${lead.country}
Services: ${(proposal.services ?? []).join(", ")}
Investment: $${proposal.investment}
ROI Estimate: ${proposal.roiEstimate ? `$${proposal.roiEstimate}` : "to be determined"}

The 333 framework:
- 3 Pain Points (mirrored back)
- 3 Cost of Inaction points
- 3 Solution pillars

Return JSON (no markdown):
{
  "mirror": "paragraph reflecting their pain points back",
  "costOfInaction": "paragraph about cost of not acting",
  "solutionBlueprint": "3 solution pillars paragraph",
  "process": "our 3-phase delivery process",
  "proof": "3 relevant proof points/case studies",
  "roi": "ROI calculation and justification",
  "investment": "investment summary and what is included",
  "nextStep": "clear single next step CTA"
}`;

  const overrides = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("sales_brain_query", overrides),
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  void logAnthropicUsage({ model: getModel("sales_brain_query", overrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "proposal_generate", orgId });
  const match = raw.match(/\{[\s\S]*\}/);

  let content = {
    mirror: "We understand your brand challenges...",
    costOfInaction: "Every day without strong branding costs you...",
    solutionBlueprint: "Our three-pillar approach...",
    process: "Discovery → Design → Delivery",
    proof: "We've helped 50+ companies transform their brands.",
    roi: `With an investment of $${proposal.investment}, expect 3x returns.`,
    investment: `Total investment: $${proposal.investment}`,
    nextStep: "Let's schedule a kick-off call this week.",
  };

  try {
    if (match) content = JSON.parse(match[0]);
  } catch { /* use defaults */ }

  await db.update(proposals).set({ content }).where(eq(proposals.id, id));
  res.json(content);
});

router.patch("/proposals/:id/status", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateProposalStatusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { status } = parsed.data;
  const updates: Record<string, unknown> = { status };
  if (status === "sent") updates.sentAt = new Date();

  const orgId = req.user!.orgId;
  // Verify ownership
  const [ownership] = await db.select({ id: proposals.id }).from(proposals)
    .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(proposals.id, id));
  if (!ownership) { res.status(404).json({ error: "Proposal not found" }); return; }

  const [updated] = await db.update(proposals).set(updates).where(eq(proposals.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Proposal not found" }); return; }

  if (status === "closed_won") {
    await db.update(leads).set({ status: "project_won", updatedAt: new Date() }).where(and(eq(leads.id, updated.leadId), eq(leads.orgId, orgId)));
  } else if (status === "closed_lost") {
    await db.update(leads).set({ status: "project_lost", updatedAt: new Date() }).where(and(eq(leads.id, updated.leadId), eq(leads.orgId, orgId)));
  }
  res.json(updated);
});

router.get("/proposals/:id/followups", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const orgId = req.user!.orgId;
  const [ownership] = await db.select({ id: proposals.id }).from(proposals)
    .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(proposals.id, id));
  if (!ownership) { res.status(404).json({ error: "Proposal not found" }); return; }

  const [proposal] = await db.select().from(proposals).where(eq(proposals.id, id));
  if (!proposal) { res.status(404).json({ error: "Proposal not found" }); return; }

  const defaultFollowups = [
    { timing: "2hr", channel: "whatsapp", message: null, status: "pending", label: "2 hours after send — WhatsApp confirmation" },
    { timing: "24hr", channel: "email", message: null, status: "pending", label: "24 hours — any questions email" },
    { timing: "48hr", channel: "linkedin", message: null, status: "pending", label: "48 hours — LinkedIn touchpoint" },
    { timing: "72hr", channel: "email", message: null, status: "pending", label: "72 hours — final follow-up" },
  ];

  const saved = (proposal.followups as unknown[]) ?? [];
  res.json(saved.length ? saved : defaultFollowups);
});

router.post("/proposals/:id/followups", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { day, channel } = z.object({ day: z.number().int(), channel: z.string() }).parse(req.body);

  const orgId2 = req.user!.orgId;
  const [row] = await db.select({ proposal: proposals, lead: leads }).from(proposals)
    .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId2)))
    .where(eq(proposals.id, id));
  if (!row) { res.status(404).json({ error: "Proposal not found" }); return; }

  const prompt = `Write a day ${day} ${channel} follow-up message for a proposal sent to ${row.lead.firstName} ${row.lead.lastName} at ${row.lead.company}.
Return JSON (no markdown): { "subject": "subject or null", "body": "message" }`;

  const followupOverrides = await fetchOrgOverrides(orgId2);
  const msg = await anthropic.messages.create({
    model: getModel("sales_brain_query", followupOverrides),
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  void logAnthropicUsage({ model: getModel("sales_brain_query", followupOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "proposal_followup", orgId: orgId2 });
  const match = raw.match(/\{[\s\S]*\}/);
  let result: { subject: string | null; body: string } = { subject: null, body: `Hi ${row.lead.firstName}, just checking in on the proposal.` };

  try {
    if (match) result = JSON.parse(match[0]);
  } catch { /* use defaults */ }

  res.json({ touchpointId: null, subject: result.subject, body: result.body, channel, leadId: row.lead.id });
});

const SendEmailSchema = z.object({
  subject: z.string().optional(),
  message: z.string().optional(),
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

router.post("/proposals/:id/send-email", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = SendEmailSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const orgId3 = req.user!.orgId;
  const [row] = await db.select({ proposal: proposals, lead: leads }).from(proposals)
    .innerJoin(leads, and(eq(proposals.leadId, leads.id), eq(leads.orgId, orgId3)))
    .where(eq(proposals.id, id));
  if (!row) { res.status(404).json({ error: "Proposal not found" }); return; }

  const { proposal, lead } = row;
  const toEmail = lead.email ?? "";
  const subject = escapeHtml(parsed.data.subject ?? `Proposal: ${proposal.title}`);

  const contentSections = proposal.content
    ? Object.entries(proposal.content as Record<string, string>)
        .map(([k, v]) => `<h3>${escapeHtml(k.replace(/([A-Z])/g, " $1").trim())}</h3><p>${escapeHtml(v)}</p>`)
        .join("")
    : "<p>Please find our proposal attached.</p>";

  const personalMessage = parsed.data.message ? escapeHtml(parsed.data.message) : null;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: #1A7A45; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px;">${escapeHtml(proposal.title)}</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">Prepared for ${escapeHtml(lead.firstName)} ${escapeHtml(lead.lastName)} — ${escapeHtml(lead.company)}</p>
      </div>
      <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        ${personalMessage ? `<p style="font-size: 14px; margin-bottom: 20px;">${personalMessage}</p><hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">` : ""}
        ${contentSections}
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
          <p style="font-size: 13px; color: #6b7280;">Investment: <strong style="color: #F59E0B;">$${escapeHtml(String(proposal.investment?.toLocaleString() ?? 0))}</strong></p>
        </div>
      </div>
    </div>
  `;

  const preview: string | undefined = undefined;
  const deliveryMode: "brevo" = "brevo";

  if (!toEmail) {
    res.status(400).json({ error: "Recipient email is required to send a proposal." });
    return;
  }

  await sendViaBrevo({
    senderName: "Dreamsdesign Sales",
    senderEmail: "info@dreamsdesign.ca",
    to: [{ email: toEmail }],
    bcc: [{ email: "sales@dreamsdesign.co" }],
    replyTo: "info@dreamsdesign.ca",
    subject,
    htmlContent: htmlBody,
  });

  // Auto-update proposal status to "sent" and lead status to "quote_sent"
  await Promise.all([
    db.update(proposals).set({ status: "sent", sentAt: new Date() }).where(eq(proposals.id, id)),
    db.update(leads).set({ status: "quote_sent", updatedAt: new Date() }).where(eq(leads.id, lead.id)),
  ]);

  res.json({ sent: true, to: toEmail, subject, deliveryMode, preview });
});

export default router;

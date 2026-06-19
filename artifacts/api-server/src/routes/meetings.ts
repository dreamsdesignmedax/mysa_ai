import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { meetings, leads } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";

const router = Router();

const MAX_TOKENS = 1500;

const CreateMeetingSchema = z.object({
  leadId: z.number().int().positive(),
  scheduledAt: z.string().datetime(),
  duration: z.number().int().min(15).max(480).optional().default(60),
  type: z.enum(["discovery", "demo", "proposal", "follow_up", "closing"]).optional().default("discovery"),
  meetingUrl: z.string().min(1).optional().nullable(),
});

const UpdateMeetingSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  duration: z.number().int().min(15).max(480).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  meetingUrl: z.string().min(1).optional().nullable(),
  notes: z.string().optional().nullable(),
  painPoints: z.array(z.string()).optional(),
  nextAction: z.string().optional().nullable(),
  emotionalDriver: z.string().optional().nullable(),
});

router.get("/meetings", async (req: Request, res: Response): Promise<void> => {
  const { status } = req.query;
  const orgId = req.user!.orgId;
  const baseWhere = eq(leads.orgId, orgId);
  const where = status ? and(baseWhere, eq(meetings.status, String(status))) : baseWhere;
  const rows = await db
    .select({ meeting: meetings, lead: leads })
    .from(meetings)
    .innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(where);
  res.json(rows.map(({ meeting, lead }) => ({ ...meeting, lead })));
});

router.post("/meetings", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateMeetingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { leadId, scheduledAt, duration, type, meetingUrl } = parsed.data;
  const orgId = req.user!.orgId;

  // Verify lead belongs to this org
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [created] = await db
    .insert(meetings)
    .values({ leadId, scheduledAt: new Date(scheduledAt), duration, type, meetingUrl: meetingUrl ?? null, painPoints: [] })
    .returning();
  await db.update(leads).set({ status: "discovery_call", updatedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

  const [leadRow] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (leadRow) {
    const { syncMeetingToCalendar } = await import("../lib/calendar-sync");
    syncMeetingToCalendar(created, leadRow).then(async (eventId) => {
      if (eventId) await db.update(meetings).set({ googleCalendarEventId: eventId }).where(eq(meetings.id, created.id));
    }).catch(() => {});
  }

  res.status(201).json(created);
});

router.get("/meetings/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;
  const [row] = await db.select({ meeting: meetings, lead: leads }).from(meetings).innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId))).where(eq(meetings.id, id));
  if (!row) { res.status(404).json({ error: "Meeting not found" }); return; }
  res.json({ ...row.meeting, lead: row.lead });
});

router.patch("/meetings/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateMeetingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const updates: Record<string, unknown> = {};
  const data = parsed.data;
  if (data.scheduledAt !== undefined) updates.scheduledAt = new Date(data.scheduledAt);
  if (data.duration !== undefined) updates.duration = data.duration;
  if (data.type !== undefined) updates.type = data.type;
  if (data.status !== undefined) updates.status = data.status;
  if (data.meetingUrl !== undefined) updates.meetingUrl = data.meetingUrl;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.painPoints !== undefined) updates.painPoints = data.painPoints;
  if (data.nextAction !== undefined) updates.nextAction = data.nextAction;
  if (data.emotionalDriver !== undefined) updates.emotionalDriver = data.emotionalDriver;

  const orgId = req.user!.orgId;
  // Verify ownership via leads table before updating
  const [ownership] = await db.select({ id: meetings.id }).from(meetings)
    .innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(meetings.id, id));
  if (!ownership) { res.status(404).json({ error: "Meeting not found" }); return; }

  const [updated] = await db.update(meetings).set(updates).where(eq(meetings.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Meeting not found" }); return; }
  res.json(updated);
});

router.delete("/meetings/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;
  // Verify ownership via lead
  const [row] = await db.select({ id: meetings.id }).from(meetings).innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId))).where(eq(meetings.id, id));
  if (!row) { res.status(404).json({ error: "Meeting not found" }); return; }
  await db.delete(meetings).where(eq(meetings.id, id));
  res.status(204).end();
});

router.post("/meetings/:id/prep", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;
  const [row] = await db.select({ meeting: meetings, lead: leads }).from(meetings).innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId))).where(eq(meetings.id, id));
  if (!row) { res.status(404).json({ error: "Meeting not found" }); return; }

  const { lead, meeting } = row;
  const prompt = `You are an expert B2B sales coach for Dreamsdesign design agency.

Generate pre-call preparation materials for this meeting:

Lead: ${lead.firstName} ${lead.lastName}, ${lead.designation} at ${lead.company}
Industry: ${lead.industry} | Country: ${lead.country}
Meeting Type: ${meeting.type} | Duration: ${meeting.duration} mins
Scheduled: ${meeting.scheduledAt}

Return JSON (no markdown):
{
  "leadSummary": "2-3 sentence company snapshot",
  "topPainSignals": ["pain1", "pain2", "pain3"],
  "openingQuestion": "powerful opening question",
  "phaseGuides": [
    { "phase": "Connect (5 min)", "guide": "rapport and tone-setting opener" },
    { "phase": "Discover (15 min)", "guide": "open pain-point questions" },
    { "phase": "Diagnose (10 min)", "guide": "quantify the business impact of the problem" },
    { "phase": "Present (15 min)", "guide": "solution, relevant case study, ROI frame" },
    { "phase": "Close (15 min)", "guide": "next step ask, commitment question, handle objections" }
  ],
  "bookingEmail": "confirmation email body",
  "whatsappReminder": "short whatsapp reminder message"
}`;

  const overrides = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("sales_brain_query", overrides),
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);

  let result = {
    meetingId: id,
    leadSummary: `${lead.company} is a ${lead.industry} company.`,
    topPainSignals: ["Brand inconsistency", "Low digital presence", "No clear messaging"],
    openingQuestion: `What's the biggest challenge facing ${lead.company}'s brand right now?`,
    phaseGuides: [],
    bookingEmail: `Hi ${lead.firstName}, confirming our call on ${meeting.scheduledAt}. Looking forward to it!`,
    whatsappReminder: `Hi ${lead.firstName}! Reminder for our call today. See you soon!`,
  };

  try {
    if (match) result = { meetingId: id, ...JSON.parse(match[0]) };
  } catch { /* use defaults */ }

  res.json(result);
});

router.post("/meetings/:id/summary", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;
  const [row] = await db.select({ meeting: meetings, lead: leads }).from(meetings).innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId))).where(eq(meetings.id, id));
  if (!row) { res.status(404).json({ error: "Meeting not found" }); return; }

  const { lead, meeting } = row;
  const prompt = `Write a professional post-call summary email from Dreamsdesign to ${lead.firstName}.

Meeting context:
- Type: ${meeting.type}
- Notes: ${meeting.notes ?? "none"}
- Pain Points discussed: ${(meeting.painPoints ?? []).join(", ") || "not recorded"}
- Next Action: ${meeting.nextAction ?? "TBD"}
- Emotional Driver: ${meeting.emotionalDriver ?? "growth"}

Write a warm, professional follow-up email.
Return JSON (no markdown): { "subject": "email subject", "body": "full email body" }`;

  const overrides2 = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("sales_brain_query", overrides2),
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);

  let result = {
    subject: `Great connecting with you, ${lead.firstName}!`,
    body: `Hi ${lead.firstName},\n\nThank you for taking the time to speak with us today. We really enjoyed learning about ${lead.company} and your vision.\n\nBest regards,\nDreamsdesign Team`,
  };

  try {
    if (match) result = JSON.parse(match[0]);
  } catch { /* use defaults */ }

  res.json(result);
});

export default router;

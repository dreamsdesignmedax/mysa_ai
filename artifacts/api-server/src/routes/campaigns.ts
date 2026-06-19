import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { campaigns, automations } from "@workspace/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

// ── Seed initial data for org 1 (Dreamsdesign) if empty ──────────────────────
async function seedIfEmpty() {
  try {
    const [cRow] = await db.select({ n: sql<number>`count(*)::int` }).from(campaigns).where(eq(campaigns.orgId, 1));
    if ((cRow?.n ?? 0) === 0) {
      await db.insert(campaigns).values([
        { orgId: 1, name: "Q2 New Lead Welcome", segment: "new_leads", status: "active", template: "WhatsApp Welcome + Brand Audit Offer", scheduledAt: new Date("2026-04-20T09:00:00"), sent: 148, delivered: 141, replied: 62, booked: 18, total: 148 },
        { orgId: 1, name: "April Reactivation Blast", segment: "old_leads", status: "active", template: "Reactivation — 30-Day No Response", scheduledAt: new Date("2026-04-22T10:00:00"), sent: 93, delivered: 88, replied: 31, booked: 7, total: 93 },
        { orgId: 1, name: "Proposal Follow-Up D3", segment: "proposal_sent", status: "paused", template: "Proposal Reminder — Day 3", scheduledAt: new Date("2026-04-25T11:00:00"), sent: 34, delivered: 34, replied: 14, booked: 5, total: 34 },
        { orgId: 1, name: "Client Success Stories", segment: "won_customers", status: "completed", template: "Testimonial Request — Post-Win", scheduledAt: new Date("2026-04-10T14:00:00"), sent: 27, delivered: 25, replied: 19, booked: 0, total: 27 },
        { orgId: 1, name: "Cold Ghost Reactivation", segment: "no_response", status: "draft", template: "Re-engagement — 60-Day Silence", scheduledAt: new Date("2026-05-01T09:00:00"), sent: 0, delivered: 0, replied: 0, booked: 0, total: 0 },
      ]);
    }
    const [aRow] = await db.select({ n: sql<number>`count(*)::int` }).from(automations).where(eq(automations.orgId, 1));
    if ((aRow?.n ?? 0) === 0) {
      await db.insert(automations).values([
        { orgId: 1, name: "New Meta Ad Lead — Instant Engage", trigger: "new_lead_meta_ad", description: "Instantly message new Meta ad leads, qualify via BANT, and send booking link", active: true, runs: 312, conversions: 47, steps: [{ id: "s1", type: "trigger", label: "Trigger: New Meta Ad Lead", detail: "Lead captured from Facebook/Instagram ad form", icon: "Tag", color: "#4F35A8" }, { id: "s2", type: "delay", label: "Wait 2 minutes", detail: "Short delay to prevent spam flag", icon: "Clock", color: "#9CA3AF" }, { id: "s3", type: "action", label: "Send WhatsApp Greeting", detail: "Hi {{name}}, I just saw you enquired about our services!", icon: "MessageCircle", color: "#25D366" }, { id: "s4", type: "condition", label: "Did they reply?", detail: "Check for reply within 30 minutes", icon: "GitBranch", color: "#F59E0B" }, { id: "s5", type: "action", label: "AI BANT Qualification", detail: "Sales Brain qualifies Budget, Authority, Need, Timeline", icon: "Zap", color: "#4F35A8" }, { id: "s6", type: "condition", label: "BANT Score ≥ 60?", detail: "High-fit leads proceed to booking", icon: "Filter", color: "#F59E0B" }, { id: "s7", type: "action", label: "Send Booking Link", detail: "Share Calendly link + brief pitch", icon: "Calendar", color: "#059669" }] },
        { orgId: 1, name: "Missed Booking Recovery", trigger: "missed_booking", description: "Automatically follow up with leads who missed their discovery call", active: true, runs: 89, conversions: 21, steps: [{ id: "s1", type: "trigger", label: "Trigger: Booking Missed", detail: "Lead didn't show up for scheduled call", icon: "AlertCircle", color: "#EF4444" }, { id: "s2", type: "delay", label: "Wait 6 hours", detail: "Give them time to respond on their own", icon: "Clock", color: "#9CA3AF" }, { id: "s3", type: "action", label: "Send Soft Follow-Up", detail: "Hey {{name}}, we missed you on the call! Want to reschedule?", icon: "MessageCircle", color: "#25D366" }, { id: "s4", type: "condition", label: "Rescheduled within 24h?", detail: "If yes → exit. If no → Day 3 nudge", icon: "GitBranch", color: "#F59E0B" }, { id: "s5", type: "delay", label: "Wait 2 more days", detail: "Final follow-up window", icon: "Clock", color: "#9CA3AF" }, { id: "s6", type: "action", label: "Send Final Nudge", detail: "Last attempt: share a quick case study", icon: "Send", color: "#8B5CF6" }] },
        { orgId: 1, name: "No-Response 5-Day Drip", trigger: "no_response", description: "5-day follow-up drip for leads who haven't replied to initial contact", active: true, runs: 204, conversions: 28, steps: [{ id: "s1", type: "trigger", label: "Trigger: No Response", detail: "Lead hasn't replied in 48 hours", icon: "RotateCcw", color: "#F59E0B" }, { id: "s2", type: "action", label: "Day 2 — Value Message", detail: "Share a relevant tip, resource, or insight for their industry", icon: "Send", color: "#8B5CF6" }, { id: "s3", type: "delay", label: "Wait 2 days", detail: "Breathing room between touches", icon: "Clock", color: "#9CA3AF" }, { id: "s4", type: "action", label: "Day 4 — Social Proof", detail: "Share a testimonial or case study from a similar business", icon: "Star", color: "#F59E0B" }, { id: "s5", type: "delay", label: "Wait 1 day", detail: "Final nudge timing", icon: "Clock", color: "#9CA3AF" }, { id: "s6", type: "action", label: "Day 5 — Last Reach Out", detail: "Final WhatsApp — offer a 15-min no-commitment chat", icon: "MessageCircle", color: "#25D366" }] },
        { orgId: 1, name: "Discovery Call Booked — Pre-Call Warm-Up", trigger: "call_booked", description: "Prepare the lead before the discovery call with useful content and a reminder", active: true, runs: 156, conversions: 83, steps: [{ id: "s1", type: "trigger", label: "Trigger: Call Booked", detail: "Lead confirmed a discovery call slot", icon: "Calendar", color: "#3B82F6" }, { id: "s2", type: "action", label: "Send Confirmation Message", detail: "Great! Your call is confirmed for {{date}} at {{time}}. Here's the Zoom link.", icon: "CheckCircle2", color: "#059669" }, { id: "s3", type: "delay", label: "Wait until 24h before", detail: "Send reminder 24 hours before call", icon: "Clock", color: "#9CA3AF" }, { id: "s4", type: "action", label: "Send 24h Reminder", detail: "Hey {{name}}, just a reminder — your call is tomorrow. See you soon!", icon: "Bell", color: "#3B82F6" }, { id: "s5", type: "action", label: "Send Portfolio Link", detail: "Share Dreamsdesign portfolio and case studies ahead of the call", icon: "ArrowRight", color: "#8B5CF6" }] },
        { orgId: 1, name: "Proposal Sent — 3-Day Follow-Up", trigger: "proposal_sent", description: "Follow up after a proposal is sent to keep the deal warm", active: true, runs: 67, conversions: 19, steps: [{ id: "s1", type: "trigger", label: "Trigger: Proposal Sent", detail: "Proposal PDF or link shared with lead", icon: "Send", color: "#8B5CF6" }, { id: "s2", type: "delay", label: "Wait 3 days", detail: "Give them time to review", icon: "Clock", color: "#9CA3AF" }, { id: "s3", type: "action", label: "Day 3 Check-In", detail: "Hey {{name}}, did you get a chance to review the proposal? Happy to answer any questions.", icon: "MessageCircle", color: "#25D366" }, { id: "s4", type: "condition", label: "Responded?", detail: "If yes → mark as engaged. If no → Day 7 follow-up", icon: "GitBranch", color: "#F59E0B" }, { id: "s5", type: "delay", label: "Wait 4 more days", detail: "Day 7 from initial send", icon: "Clock", color: "#9CA3AF" }, { id: "s6", type: "action", label: "Day 7 Final Nudge", detail: "Last message: offer a quick call to walk through the proposal together", icon: "Calendar", color: "#059669" }] },
        { orgId: 1, name: "Lead Lost — 90-Day Reactivation", trigger: "lead_lost", description: "Re-engage lost or cold leads after 90 days with a fresh angle", active: false, runs: 41, conversions: 3, steps: [{ id: "s1", type: "trigger", label: "Trigger: Lead Marked Lost/Cold", detail: "Lead status changed to lost or no movement for 90 days", icon: "Star", color: "#6B7280" }, { id: "s2", type: "delay", label: "Wait 90 days", detail: "Long enough that the outreach feels fresh", icon: "Clock", color: "#9CA3AF" }, { id: "s3", type: "action", label: "Send Re-engagement Message", detail: "Hey {{name}}, it's been a while! We've worked on some exciting projects since — thought you might find this interesting.", icon: "RotateCcw", color: "#6B7280" }, { id: "s4", type: "condition", label: "Replied?", detail: "If yes → back to active. If no → mark as permanently closed.", icon: "GitBranch", color: "#F59E0B" }] },
      ]);
    }
  } catch (err) {
    logger.warn({ err }, "Failed to seed campaigns/automations");
  }
}

// Run once on startup (non-blocking)
seedIfEmpty().catch(() => {});

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const;
const CAMPAIGN_SEGMENTS = ["new_leads", "no_response", "proposal_sent", "won_customers", "old_leads"] as const;

const CreateCampaignSchema = z.object({
  name:        z.string().min(1).max(200),
  segment:     z.enum(CAMPAIGN_SEGMENTS),
  template:    z.string().min(1).max(500),
  scheduledAt: z.string().datetime().optional().nullable(),
  total:       z.number().int().nonnegative().optional().default(0),
});

const UpdateCampaignSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  segment:     z.enum(CAMPAIGN_SEGMENTS).optional(),
  status:      z.enum(CAMPAIGN_STATUSES).optional(),
  template:    z.string().min(1).max(500).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  sent:        z.number().int().nonnegative().optional(),
  delivered:   z.number().int().nonnegative().optional(),
  replied:     z.number().int().nonnegative().optional(),
  booked:      z.number().int().nonnegative().optional(),
  total:       z.number().int().nonnegative().optional(),
});

router.get("/campaigns", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.select().from(campaigns).where(eq(campaigns.orgId, req.user!.orgId)).orderBy(desc(campaigns.createdAt));
    res.json({ campaigns: rows });
  } catch (err) {
    logger.error({ err }, "GET /campaigns failed");
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

router.post("/campaigns", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  try {
    const { name, segment, template, scheduledAt, total } = parsed.data;
    const [row] = await db.insert(campaigns).values({
      orgId: req.user!.orgId,
      name,
      segment,
      template,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      total: total ?? 0,
      status: "draft",
    }).returning();
    res.status(201).json({ campaign: row });
  } catch (err) {
    logger.error({ err }, "POST /campaigns failed");
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

router.patch("/campaigns/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  try {
    const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.scheduledAt !== undefined) {
      updates.scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
    }
    const [row] = await db.update(campaigns).set(updates).where(and(eq(campaigns.id, id), eq(campaigns.orgId, req.user!.orgId))).returning();
    if (!row) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ campaign: row });
  } catch (err) {
    logger.error({ err }, "PATCH /campaigns/:id failed");
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

router.delete("/campaigns/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const [deleted] = await db.delete(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.orgId, req.user!.orgId))).returning({ id: campaigns.id });
    if (!deleted) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /campaigns/:id failed");
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

// Analytics summary across all campaigns
router.get("/campaigns/analytics", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.select().from(campaigns).where(eq(campaigns.orgId, req.user!.orgId));
    const total = rows.reduce((a, r) => a + r.sent, 0);
    const delivered = rows.reduce((a, r) => a + r.delivered, 0);
    const replied = rows.reduce((a, r) => a + r.replied, 0);
    const booked = rows.reduce((a, r) => a + r.booked, 0);
    const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
    const replyRate = delivered > 0 ? Math.round((replied / delivered) * 100) : 0;
    const bookingRate = replied > 0 ? Math.round((booked / replied) * 100) : 0;
    res.json({ total, delivered, replied, booked, deliveryRate, replyRate, bookingRate });
  } catch (err) {
    logger.error({ err }, "GET /campaigns/analytics failed");
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// ── AUTOMATIONS ───────────────────────────────────────────────────────────────

const TRIGGER_TYPES = ["new_lead_meta_ad", "missed_booking", "no_response", "call_booked", "proposal_sent", "lead_lost"] as const;

const CreateAutomationSchema = z.object({
  name:        z.string().min(1).max(200),
  trigger:     z.enum(TRIGGER_TYPES),
  description: z.string().max(500).optional().default(""),
  steps:       z.array(z.object({
    id:     z.string(),
    type:   z.enum(["trigger", "condition", "action", "delay"]),
    label:  z.string(),
    detail: z.string(),
    icon:   z.string(),
    color:  z.string(),
  })).optional().default([]),
});

const UpdateAutomationSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  trigger:     z.enum(TRIGGER_TYPES).optional(),
  description: z.string().max(500).optional(),
  active:      z.boolean().optional(),
  runs:        z.number().int().nonnegative().optional(),
  conversions: z.number().int().nonnegative().optional(),
  steps:       z.array(z.object({
    id:     z.string(),
    type:   z.enum(["trigger", "condition", "action", "delay"]),
    label:  z.string(),
    detail: z.string(),
    icon:   z.string(),
    color:  z.string(),
  })).optional(),
});

router.get("/automations", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  try {
    const rows = await db.select().from(automations).where(eq(automations.orgId, orgId)).orderBy(desc(automations.createdAt));
    res.json({ automations: rows });
  } catch (err) {
    logger.error({ err }, "GET /automations failed");
    res.status(500).json({ error: "Failed to fetch automations" });
  }
});

router.post("/automations", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const parsed = CreateAutomationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  try {
    const [row] = await db.insert(automations).values({
      orgId,
      name:        parsed.data.name,
      trigger:     parsed.data.trigger,
      description: parsed.data.description ?? "",
      steps:       parsed.data.steps ?? [],
      active:      false,
      runs:        0,
      conversions: 0,
    }).returning();
    res.status(201).json({ automation: row });
  } catch (err) {
    logger.error({ err }, "POST /automations failed");
    res.status(500).json({ error: "Failed to create automation" });
  }
});

router.patch("/automations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateAutomationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  try {
    const [row] = await db.update(automations).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(automations.id, id), eq(automations.orgId, orgId))).returning();
    if (!row) { res.status(404).json({ error: "Automation not found" }); return; }
    res.json({ automation: row });
  } catch (err) {
    logger.error({ err }, "PATCH /automations/:id failed");
    res.status(500).json({ error: "Failed to update automation" });
  }
});

router.delete("/automations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const [deleted] = await db.delete(automations).where(and(eq(automations.id, id), eq(automations.orgId, orgId))).returning({ id: automations.id });
    if (!deleted) { res.status(404).json({ error: "Automation not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /automations/:id failed");
    res.status(500).json({ error: "Failed to delete automation" });
  }
});

export default router;

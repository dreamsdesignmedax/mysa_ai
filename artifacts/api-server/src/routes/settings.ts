import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { smtpSettings, brandingSettings, whatsappSettings, signalSettings, organizations, apiUsageLog } from "@workspace/db/schema";
import { and, eq, gte, lt, sum } from "drizzle-orm";
import { encrypt } from "../lib/crypto";
import { sendOrgEmail } from "../lib/sendOrgEmail";
import { MODEL_ROUTING, MODELS, OPERATION_LABELS, type ModelTier } from "../config/modelRouting";

const router = Router();

const SmtpSettingsSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  fromAddress: z.string().optional(),
  secure: z.boolean().optional(),
});

async function getOrCreateSettings(orgId: number) {
  const [existing] = await db.select().from(smtpSettings).where(eq(smtpSettings.orgId, orgId));
  if (existing) return existing;
  const [created] = await db.insert(smtpSettings).values({ orgId }).returning();
  return created;
}

router.get("/settings/smtp", async (req: Request, res: Response): Promise<void> => {
  const settings = await getOrCreateSettings(req.user!.orgId);
  const { password: _pw, ...safe } = settings as typeof settings & { password?: string | null };
  res.json(safe);
});

router.put("/settings/smtp", async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== "owner" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can update SMTP settings" });
    return;
  }

  const parsed = SmtpSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.host !== undefined) updates.host = d.host || null;
  if (d.port !== undefined) updates.port = d.port;
  if (d.user !== undefined) updates.user = d.user || null;
  if (d.password !== undefined) updates.password = d.password ? encrypt(d.password) : null;
  if (d.fromAddress !== undefined) updates.fromAddress = d.fromAddress || null;
  if (d.secure !== undefined) updates.secure = d.secure;

  const orgId = req.user!.orgId;
  const existing = await getOrCreateSettings(orgId);
  const [updated] = await db.update(smtpSettings).set(updates).where(eq(smtpSettings.id, existing.id)).returning();
  const { password: _pw, ...safe } = updated as typeof updated & { password?: string | null };
  res.json(safe);
});

const TestEmailSchema = z.object({
  toEmail: z.string().email(),
});

router.post("/settings/smtp/test", async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== "owner" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can send test emails" });
    return;
  }

  const parsed = TestEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ success: false, message: "A valid recipient email address is required." });
    return;
  }

  const orgId = req.user!.orgId;
  const ok = await sendOrgEmail(orgId, {
    to:      parsed.data.toEmail,
    subject: "MysaAI — Email Delivery Test",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <div style="background:linear-gradient(135deg,#1A3D2B,#5C1A8C);padding:20px 24px;border-radius:8px 8px 0 0;">
          <h2 style="color:#fff;margin:0;font-size:18px;">Email Delivery Test ✓</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
          <p style="color:#333;margin:0 0 12px;">This test email was sent using <strong>your configured SMTP settings</strong>.</p>
          <p style="color:#555;margin:0;font-size:13px;">If you received this, your SMTP is working correctly and emails will be sent from your address.</p>
        </div>
      </div>`,
    text: "This test email was sent using your configured SMTP settings. If you received this, everything is working correctly.",
  });
  if (ok) {
    res.json({ success: true, message: `Test email sent successfully to ${parsed.data.toEmail}` });
  } else {
    res.json({ success: false, message: "Send failed — check your SMTP settings (host, port, user, password, from address)." });
  }
});

// ── Branding Settings ─────────────────────────────────────────────────────────

const BrandingSettingsSchema = z.object({
  companyName: z.string().optional(),
  tagline: z.string().optional(),
  contactInfo: z.string().optional(),
  website: z.string().url().or(z.literal("")).nullish(),
  phone: z.string().max(50).optional(),
  brandColor: z.string().optional(),
  logoBase64: z.string().optional(),
});

async function getOrCreateBrandingSettings(orgId: number) {
  const [existing] = await db.select().from(brandingSettings).where(eq(brandingSettings.orgId, orgId));
  if (existing) return existing;
  const [created] = await db.insert(brandingSettings).values({ orgId }).returning();
  return created;
}

router.get("/settings/branding", async (req: Request, res: Response): Promise<void> => {
  const settings = await getOrCreateBrandingSettings(req.user!.orgId);
  res.json(settings);
});

router.put("/settings/branding", async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== "owner" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can update branding settings" });
    return;
  }

  const parsed = BrandingSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.companyName !== undefined) updates.companyName = d.companyName || null;
  if (d.tagline !== undefined) updates.tagline = d.tagline || null;
  if (d.contactInfo !== undefined) updates.contactInfo = d.contactInfo || null;
  if (d.website !== undefined) updates.website = d.website || null;
  if (d.phone !== undefined) updates.phone = d.phone || null;
  if (d.brandColor !== undefined) updates.brandColor = d.brandColor || null;
  if (d.logoBase64 !== undefined) updates.logoBase64 = d.logoBase64 || null;

  const orgId = req.user!.orgId;
  const existing = await getOrCreateBrandingSettings(orgId);
  const [updated] = await db.update(brandingSettings).set(updates).where(eq(brandingSettings.id, existing.id)).returning();
  res.json(updated);
});

// ── WhatsApp Settings ─────────────────────────────────────────────────────────

const WhatsAppSettingsSchema = z.object({
  accessToken:        z.string().optional(),
  appSecret:          z.string().optional(),
  phoneNumberId:      z.string().optional(),
  webhookVerifyToken: z.string().optional(),
  bookingUrl:         z.string().optional(),
  consultantName:     z.string().optional(),
  portfolioUrl:       z.string().optional(),
  caseStudyUrl:       z.string().optional(),
  companyProfileUrl:  z.string().optional(),
  hookTemplateName:   z.string().optional(),
  hookTemplateLang:   z.string().optional(),
});

async function getOrCreateWhatsAppSettings(orgId: number) {
  const [existing] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.orgId, orgId));
  if (existing) return existing;
  const [created] = await db.insert(whatsappSettings).values({ orgId }).returning();
  return created;
}

router.get("/settings/whatsapp", async (req: Request, res: Response): Promise<void> => {
  const settings = await getOrCreateWhatsAppSettings(req.user!.orgId);
  const { accessToken, appSecret, ...safe } = settings;
  res.json({
    ...safe,
    hasAccessToken: Boolean(accessToken),
    hasAppSecret:   Boolean(appSecret),
  });
});

router.put("/settings/whatsapp", async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== "owner" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can update WhatsApp settings" });
    return;
  }

  const parsed = WhatsAppSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.accessToken        !== undefined) updates.accessToken        = d.accessToken        || null;
  if (d.appSecret          !== undefined) updates.appSecret          = d.appSecret          || null;
  if (d.phoneNumberId      !== undefined) updates.phoneNumberId      = d.phoneNumberId      || null;
  if (d.webhookVerifyToken !== undefined) updates.webhookVerifyToken = d.webhookVerifyToken || null;
  if (d.bookingUrl         !== undefined) updates.bookingUrl         = d.bookingUrl         || null;
  if (d.consultantName     !== undefined) updates.consultantName     = d.consultantName     || null;
  if (d.portfolioUrl       !== undefined) updates.portfolioUrl       = d.portfolioUrl       || null;
  if (d.caseStudyUrl       !== undefined) updates.caseStudyUrl       = d.caseStudyUrl       || null;
  if (d.companyProfileUrl  !== undefined) updates.companyProfileUrl  = d.companyProfileUrl  || null;
  if (d.hookTemplateName   !== undefined) updates.hookTemplateName   = d.hookTemplateName   || null;
  if (d.hookTemplateLang   !== undefined) updates.hookTemplateLang   = d.hookTemplateLang   || "en_US";

  const orgId = req.user!.orgId;
  const existing = await getOrCreateWhatsAppSettings(orgId);
  const [updated] = await db.update(whatsappSettings).set(updates).where(eq(whatsappSettings.id, existing.id)).returning();
  res.json(updated);
});

// ── Signal Settings ────────────────────────────────────────────────────────────

const GoogleMapsPresetSchema = z.object({
  label: z.string().min(1).max(200),
  query: z.string().min(1).max(500),
});

const SignalSettingsSchema = z.object({
  enabled:          z.boolean().optional(),
  autoAdd:          z.boolean().optional(),
  confidence:       z.number().min(0.5).max(1).optional(),
  subreddits:       z.array(z.string().max(100)).optional(),
  keywords:         z.array(z.string().max(200)).optional(),
  googleMapsCities: z.array(GoogleMapsPresetSchema).optional(),
});

async function getOrCreateSignalSettings(orgId: number) {
  const [existing] = await db.select().from(signalSettings).where(eq(signalSettings.orgId, orgId));
  if (existing) return existing;
  const [created] = await db.insert(signalSettings).values({ orgId }).returning();
  return created;
}

router.get("/settings/signal", async (req: Request, res: Response): Promise<void> => {
  const settings = await getOrCreateSignalSettings(req.user!.orgId);
  res.json(settings);
});

router.put("/settings/signal", async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== "owner" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can update signal settings" });
    return;
  }

  const parsed = SignalSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.enabled          !== undefined) updates.enabled          = d.enabled;
  if (d.autoAdd          !== undefined) updates.autoAdd          = d.autoAdd;
  if (d.confidence       !== undefined) updates.confidence       = d.confidence;
  if (d.subreddits       !== undefined) updates.subreddits       = d.subreddits;
  if (d.keywords         !== undefined) updates.keywords         = d.keywords;
  if (d.googleMapsCities !== undefined) updates.googleMapsCities = d.googleMapsCities;

  const orgId = req.user!.orgId;
  const existing = await getOrCreateSignalSettings(orgId);
  const [updated] = await db.update(signalSettings).set(updates).where(eq(signalSettings.id, existing.id)).returning();
  res.json(updated);
});

// ── Model Routing Settings ──────────────────────────────────────────────────────

const ModelRoutingOverridesSchema = z.object({
  overrides: z.record(z.string(), z.enum(["FAST", "SMART"])),
});

router.get("/settings/model-routing", async (req: Request, res: Response): Promise<void> => {
  const [org] = await db
    .select({ modelRoutingOverrides: organizations.modelRoutingOverrides })
    .from(organizations)
    .where(eq(organizations.id, req.user!.orgId));
  res.json({
    defaults: MODEL_ROUTING,
    overrides: org?.modelRoutingOverrides ?? {},
    operationLabels: OPERATION_LABELS,
    tiers: Object.keys(MODELS),
  });
});

router.put("/settings/model-routing", async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== "owner") {
    res.status(403).json({ error: "Only org owners can update model routing settings" });
    return;
  }

  const parsed = ModelRoutingOverridesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const validOps = new Set(Object.keys(MODEL_ROUTING));
  const sanitized: Record<string, ModelTier> = {};
  for (const [op, tier] of Object.entries(parsed.data.overrides)) {
    if (validOps.has(op) && (tier === "FAST" || tier === "SMART")) {
      sanitized[op] = tier;
    }
  }

  await db
    .update(organizations)
    .set({ modelRoutingOverrides: sanitized, updatedAt: new Date() })
    .where(eq(organizations.id, req.user!.orgId));

  res.json({ overrides: sanitized });
});

// ── AI Spend Threshold Settings ───────────────────────────────────────────────

const AiSpendThresholdSchema = z.object({
  limitUsd: z.number().min(0).nullable(),
});

router.get("/settings/ai-spend-threshold", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;

  const [org] = await db
    .select({
      limitUsd:    organizations.aiSpendDailyLimitUsd,
      alertSentAt: organizations.aiSpendAlertSentAt,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  const spendRows = await db
    .select({ total: sum(apiUsageLog.costUsd) })
    .from(apiUsageLog)
    .where(
      and(
        eq(apiUsageLog.orgId, orgId),
        gte(apiUsageLog.createdAt, todayStart),
        lt(apiUsageLog.createdAt, todayEnd),
      )
    );

  const todaySpendUsd = Number(spendRows[0]?.total ?? 0);

  res.json({
    limitUsd:      org?.limitUsd ?? null,
    todaySpendUsd,
    alertSentAt:   org?.alertSentAt ?? null,
  });
});

router.put("/settings/ai-spend-threshold", async (req: Request, res: Response): Promise<void> => {
  if (req.user!.role !== "owner") {
    res.status(403).json({ error: "Only org owners can update the AI spend threshold" });
    return;
  }

  const parsed = AiSpendThresholdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  await db
    .update(organizations)
    .set({
      aiSpendDailyLimitUsd: parsed.data.limitUsd ?? null,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, req.user!.orgId));

  res.json({ limitUsd: parsed.data.limitUsd });
});

export default router;

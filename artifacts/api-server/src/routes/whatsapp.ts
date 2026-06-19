import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import {
  whatsappConversations,
  whatsappMessages,
  leads,
} from "@workspace/db/schema";
import { eq, and, desc, sql, inArray, or } from "drizzle-orm";
import { featureGuard } from "../middlewares/planGuard";
import {
  getWaSettings,
  getOrCreateSettings,
  saveWaSettings,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  testWhatsAppConnection,
  normalizePhone,
  validatePhoneFormat,
  verifyWebhookSignature,
  isSafeForwardUrl,
  resolveHostnameSafe,
  getOrgIdByPhoneNumberId,
  getOrgIdByVerifyToken,
} from "../lib/whatsapp";
import { processInboundMessage, detectLanguage } from "../lib/whatsapp-ai";
import { logger } from "../lib/logger";

const router = Router();

// ── Webhook verification (GET) — public, no auth ───────────────────────────────
router.get("/whatsapp/webhook", async (req: Request, res: Response): Promise<void> => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = req.query["hub.verify_token"];

  if (typeof verifyToken !== "string" || !verifyToken) {
    res.status(403).json({ error: "Missing verify token" });
    return;
  }

  try {
    const orgId = await getOrgIdByVerifyToken(verifyToken);
    if (!orgId) {
      res.status(403).json({ error: "Forbidden — unknown verify token" });
      return;
    }
    if (mode === "subscribe") {
      res.status(200).send(String(challenge));
    } else {
      res.status(403).json({ error: "Forbidden — unexpected mode" });
    }
  } catch {
    res.status(500).send("error");
  }
});

// ── Webhook receiver (POST) — public, no auth ─────────────────────────────────
router.post("/whatsapp/webhook", async (req: Request & { rawBody?: Buffer }, res: Response): Promise<void> => {
  const body = req.body as {
    entry?: Array<{
      id?: string;
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: Array<{
            id: string;
            from: string;
            type: string;
            text?: { body: string };
            timestamp: string;
          }>;
        };
      }>;
    }>;
  };

  // Determine which org this webhook belongs to via phone_number_id
  const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  const orgId = phoneNumberId ? await getOrgIdByPhoneNumberId(phoneNumberId) : null;

  // Signature verification using the org's configured appSecret (fall back to legacy id=1 row)
  try {
    const settings = orgId
      ? await getOrCreateSettings(orgId)
      : await getOrCreateSettings();
    let appSecret: string | null = null;
    if (settings.appSecret) {
      const { decrypt } = await import("../lib/crypto");
      try { appSecret = decrypt(settings.appSecret); } catch { appSecret = settings.appSecret; }
    }
    const sigHeader = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifyWebhookSignature(req.rawBody ?? Buffer.alloc(0), sigHeader, appSecret)) {
      res.status(403).json({ error: "Webhook signature verification failed" });
      return;
    }
  } catch (e) {
    logger.error({ err: e }, "Webhook signature check error");
    res.status(500).send("error");
    return;
  }

  // Always acknowledge immediately to Meta (must respond within 20s)
  res.status(200).json({ status: "ok" });

  // Forward raw payload to n8n webhook if configured (fire-and-forget)
  void (async () => {
    try {
      const orgSettings = orgId
        ? await getOrCreateSettings(orgId)
        : await getOrCreateSettings();
      const n8nUrl = orgSettings?.n8nWebhookUrl;
      if (n8nUrl && isSafeForwardUrl(n8nUrl)) {
        // DNS-level check at forward time to catch DNS-rebinding between save and use
        let forwardParsed: URL;
        try { forwardParsed = new URL(n8nUrl); } catch { forwardParsed = null as unknown as URL; }
        const dnsOk = forwardParsed ? await resolveHostnameSafe(forwardParsed.hostname) : false;
        if (dnsOk) {
          await fetch(n8nUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
            redirect: "error",
          });
        } else {
          logger.warn({ n8nUrl }, "n8n webhook forward skipped — hostname DNS check failed at forward time");
        }
      } else if (n8nUrl) {
        logger.warn({ n8nUrl }, "n8n webhook forward skipped — URL failed SSRF safety check");
      }
    } catch (e) {
      logger.warn({ err: e }, "n8n webhook forward failed");
    }
  })();

  // If we cannot resolve the org, log and bail — no cross-org processing
  if (!orgId) {
    logger.warn({ phoneNumberId }, "Webhook received for unknown phoneNumberId — skipping");
    return;
  }

  try {
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

    for (const msg of messages) {
      if (msg.type !== "text" || !msg.text?.body) continue;
      const fromPhone = normalizePhone(msg.from);
      const textBody = msg.text.body.trim();

      // Try to find an existing conversation scoped to this org
      let [existingConv] = await db
        .select()
        .from(whatsappConversations)
        .where(and(eq(whatsappConversations.waPhoneNumber, fromPhone), eq(whatsappConversations.orgId, orgId)))
        .orderBy(desc(whatsappConversations.updatedAt))
        .limit(1);

      // If no conversation, try to match a lead within this org and create one
      if (!existingConv) {
        const [matchedLead] = await db
          .select()
          .from(leads)
          .where(
            and(
              eq(leads.orgId, orgId),
              or(
                eq(sql`regexp_replace(${leads.phone}, '[^0-9]', '', 'g')`, fromPhone),
                eq(sql`regexp_replace(${leads.whatsapp}, '[^0-9]', '', 'g')`, fromPhone),
              ),
            ),
          )
          .limit(1);

        if (matchedLead) {
          if (!matchedLead.whatsapp) {
            await db.update(leads)
              .set({ whatsapp: fromPhone, updatedAt: new Date() })
              .where(and(eq(leads.id, matchedLead.id), eq(leads.orgId, orgId)));
          }
          const [newConv] = await db.insert(whatsappConversations).values({
            orgId,
            leadId: matchedLead.id,
            waPhoneNumber: fromPhone,
            state: "hook_sent",
            language: "english",
            metadata: {},
          }).returning();
          existingConv = newConv;
        }
      }

      if (!existingConv) continue;

      // Auto-detect language on first inbound if still default
      if (existingConv.language === "english") {
        const detectedLang = await detectLanguage(textBody);
        if (detectedLang !== "english") {
          await db.update(whatsappConversations)
            .set({ language: detectedLang })
            .where(eq(whatsappConversations.id, existingConv.id));
        }
      }

      await db.insert(whatsappMessages).values({
        conversationId: existingConv.id,
        direction: "inbound",
        content: textBody,
        waMessageId: msg.id,
      });

      processInboundMessage(existingConv.id).catch(e =>
        logger.error({ err: e, conversationId: existingConv.id }, "AI pipeline error"),
      );
    }
  } catch (e) {
    logger.error({ err: e }, "WhatsApp webhook processing error");
  }
});

// ── Initiate conversation for a single lead ───────────────────────────────────
router.post("/whatsapp/initiate/:leadId", featureGuard("whatsapp_api"), async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }
  const orgId = req.user!.orgId;

  const settings = await getWaSettings(orgId);
  if (!settings) {
    res.status(400).json({ error: "WhatsApp settings not configured. Please add your Meta API token and Phone Number ID in Settings." });
    return;
  }

  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const rawPhone = lead.whatsapp ?? lead.phone ?? "";
  if (!rawPhone) { res.status(400).json({ error: "Lead has no phone or WhatsApp number" }); return; }

  const validation = validatePhoneFormat(rawPhone);
  if (!validation.valid) {
    res.status(422).json({ error: `Phone validation failed: ${validation.reason}` });
    return;
  }
  const phone = validation.normalizedPhone;

  const [existingConv] = await db
    .select()
    .from(whatsappConversations)
    .where(and(eq(whatsappConversations.waPhoneNumber, phone), eq(whatsappConversations.orgId, orgId)))
    .limit(1);

  if (existingConv) {
    res.status(200).json({ success: true, conversationId: existingConv.id, message: "Conversation already exists" });
    return;
  }

  // Create conversation record before sending
  const [conv] = await db.insert(whatsappConversations).values({
    leadId,
    orgId,
    waPhoneNumber: phone,
    state: "hook_sent",
    language: "english",
    metadata: {},
  }).returning();

  const hookText = buildHookText(lead.firstName, lead.company);

  // Store outbound record before sending
  const [outboundRecord] = await db.insert(whatsappMessages).values({
    conversationId: conv.id,
    direction: "outbound",
    content: hookText,
    waMessageId: null,
  }).returning();

  // Send via template if configured, otherwise fall back to free-form text
  let sendResult;
  if (settings.hookTemplateName) {
    sendResult = await sendWhatsAppTemplate(
      settings,
      phone,
      settings.hookTemplateName,
      settings.hookTemplateLang,
      [lead.firstName, lead.company],
    );
  } else {
    sendResult = await sendWhatsAppMessage(settings, phone, hookText);
  }

  if (sendResult.waMessageId) {
    await db.update(whatsappMessages)
      .set({ waMessageId: sendResult.waMessageId })
      .where(eq(whatsappMessages.id, outboundRecord.id));
    if (lead.whatsapp !== phone) {
      await db.update(leads).set({ whatsapp: phone, updatedAt: new Date() }).where(eq(leads.id, leadId));
    }
    res.status(201).json({ success: true, conversationId: conv.id, message: `Hook message sent to ${phone}` });
  } else {
    // Rollback on hard send failure
    await db.delete(whatsappMessages).where(eq(whatsappMessages.id, outboundRecord.id));
    await db.delete(whatsappConversations).where(eq(whatsappConversations.id, conv.id));
    res.status(502).json({
      error: `Failed to send WhatsApp message: ${sendResult.errorMessage ?? "unknown error"}`,
      errorCode: sendResult.errorCode,
      hint: sendResult.errorCode
        ? "If the error code indicates the number is not on WhatsApp (131026), check the lead's phone number."
        : undefined,
    });
  }
});

// ── Bulk initiate ─────────────────────────────────────────────────────────────
const BulkInitiateSchema = z.object({ leadIds: z.array(z.number().int().positive()).min(1).max(100) });

router.post("/whatsapp/initiate-bulk", featureGuard("whatsapp_api"), async (req: Request, res: Response): Promise<void> => {
  const parsed = BulkInitiateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const orgId = req.user!.orgId;

  const settings = await getWaSettings(orgId);
  if (!settings) { res.status(400).json({ error: "WhatsApp settings not configured" }); return; }

  const allLeads = await db.select().from(leads).where(and(inArray(leads.id, parsed.data.leadIds), eq(leads.orgId, orgId)));
  const results: { leadId: number; success: boolean; message: string }[] = [];

  for (const lead of allLeads) {
    const rawPhone = lead.whatsapp ?? lead.phone ?? "";
    if (!rawPhone) {
      results.push({ leadId: lead.id, success: false, message: "No phone number" });
      continue;
    }

    const validation = validatePhoneFormat(rawPhone);
    if (!validation.valid) {
      results.push({ leadId: lead.id, success: false, message: `Invalid phone: ${validation.reason}` });
      continue;
    }
    const phone = validation.normalizedPhone;

    const [existingConv] = await db.select().from(whatsappConversations)
      .where(and(eq(whatsappConversations.waPhoneNumber, phone), eq(whatsappConversations.orgId, orgId))).limit(1);
    if (existingConv) {
      results.push({ leadId: lead.id, success: true, message: "Already initiated" });
      continue;
    }

    const hookText = buildHookText(lead.firstName, lead.company);

    const [conv] = await db.insert(whatsappConversations).values({
      leadId: lead.id,
      orgId,
      waPhoneNumber: phone,
      state: "hook_sent",
      language: "english",
      metadata: {},
    }).returning();

    const [outboundRecord] = await db.insert(whatsappMessages).values({
      conversationId: conv.id,
      direction: "outbound",
      content: hookText,
      waMessageId: null,
    }).returning();

    let sendResult;
    if (settings.hookTemplateName) {
      sendResult = await sendWhatsAppTemplate(
        settings,
        phone,
        settings.hookTemplateName,
        settings.hookTemplateLang,
        [lead.firstName, lead.company],
      );
    } else {
      sendResult = await sendWhatsAppMessage(settings, phone, hookText);
    }

    if (sendResult.waMessageId) {
      await db.update(whatsappMessages)
        .set({ waMessageId: sendResult.waMessageId })
        .where(eq(whatsappMessages.id, outboundRecord.id));
      // Backfill canonical WA number on lead (parity with single initiate)
      if (lead.whatsapp !== phone) {
        await db.update(leads).set({ whatsapp: phone, updatedAt: new Date() }).where(eq(leads.id, lead.id));
      }
      results.push({ leadId: lead.id, success: true, message: `Sent to ${phone}` });
    } else {
      await db.delete(whatsappMessages).where(eq(whatsappMessages.id, outboundRecord.id));
      await db.delete(whatsappConversations).where(eq(whatsappConversations.id, conv.id));
      results.push({ leadId: lead.id, success: false, message: sendResult.errorMessage ?? "Send failed" });
    }

    await new Promise(r => setTimeout(r, 500));
  }

  const succeeded = results.filter(r => r.success).length;
  res.json({ results, succeeded, failed: results.length - succeeded });
});

// ── List conversations ────────────────────────────────────────────────────────
router.get("/whatsapp/conversations", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const rows = await db
    .select({
      conv: whatsappConversations,
      lead: {
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        company: leads.company,
        designation: leads.designation,
        photoUrl: leads.photoUrl,
      },
    })
    .from(whatsappConversations)
    .leftJoin(leads, eq(whatsappConversations.leadId, leads.id))
    .where(eq(whatsappConversations.orgId, orgId))
    .orderBy(desc(whatsappConversations.updatedAt));

  const convIds = rows.map(r => r.conv.id);
  const lastMsgMap: Record<number, string> = {};

  if (convIds.length > 0) {
    const lastMsgs = await db
      .select({ conversationId: whatsappMessages.conversationId, content: whatsappMessages.content })
      .from(whatsappMessages)
      .where(inArray(whatsappMessages.conversationId, convIds))
      .orderBy(desc(whatsappMessages.sentAt));

    const seen = new Set<number>();
    for (const m of lastMsgs) {
      if (!seen.has(m.conversationId)) {
        lastMsgMap[m.conversationId] = m.content;
        seen.add(m.conversationId);
      }
    }
  }

  res.json(rows.map(r => ({ ...r.conv, lead: r.lead, lastMessage: lastMsgMap[r.conv.id] ?? "" })));
});

// ── Get messages for a conversation ──────────────────────────────────────────
router.get("/whatsapp/conversations/:id/messages", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const [conv] = await db.select().from(whatsappConversations).where(and(eq(whatsappConversations.id, id), eq(whatsappConversations.orgId, orgId)));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const msgs = await db.select().from(whatsappMessages)
    .where(eq(whatsappMessages.conversationId, id))
    .orderBy(whatsappMessages.sentAt);

  const [lead] = await db.select().from(leads).where(and(eq(leads.id, conv.leadId), eq(leads.orgId, orgId)));
  res.json({ conversation: conv, lead: lead ?? null, messages: msgs });
});

// ── Settings GET ──────────────────────────────────────────────────────────────
router.get("/whatsapp/settings", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const settings = await getOrCreateSettings(orgId);
  const { accessToken: _tok, appSecret: _sec, ...safe } = settings;
  res.json({ ...safe, hasToken: Boolean(_tok), hasAppSecret: Boolean(_sec) });
});

// ── Settings PUT ──────────────────────────────────────────────────────────────
const WaSettingsSchema = z.object({
  accessToken: z.string().optional(),
  appSecret: z.string().optional(),
  phoneNumberId: z.string().optional(),
  webhookVerifyToken: z.string().optional(),
  bookingUrl: z.string().url().nullable().optional(),
  consultantName: z.string().nullable().optional(),
  portfolioUrl: z.string().url().nullable().optional(),
  caseStudyUrl: z.string().url().nullable().optional(),
  companyProfileUrl: z.string().url().nullable().optional(),
  referenceSites: z.array(z.string().url()).optional(),
  hookTemplateName: z.string().nullable().optional(),
  hookTemplateLang: z.string().optional(),
  n8nWebhookUrl: z.string().url().nullable().optional()
    .refine(v => isSafeForwardUrl(v ?? null), {
      message: "Webhook URL must use https and must not target internal or private network addresses",
    }),
});

router.put("/whatsapp/settings", async (req: Request, res: Response): Promise<void> => {
  // Only org owners and admins may change org-wide WhatsApp settings
  if (req.user!.role !== "owner" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Only owners and admins can update WhatsApp settings" });
    return;
  }

  const parsed = WaSettingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const orgId = req.user!.orgId;

  // DNS-level SSRF check for the forwarding URL (defends against DNS-rebinding / CNAME tricks)
  const newForwardUrl = parsed.data.n8nWebhookUrl;
  if (newForwardUrl) {
    let parsedUrl: URL;
    try { parsedUrl = new URL(newForwardUrl); } catch {
      res.status(400).json({ error: "Invalid webhook URL" });
      return;
    }
    const dnsOk = await resolveHostnameSafe(parsedUrl.hostname);
    if (!dnsOk) {
      res.status(400).json({ error: "Webhook URL hostname resolves to a private or internal address and cannot be used as a forwarding target" });
      return;
    }
  }

  const updated = await saveWaSettings(parsed.data, orgId);
  const { accessToken: _tok, appSecret: _sec, ...safe } = updated;
  res.json({ ...safe, hasToken: Boolean(_tok), hasAppSecret: Boolean(_sec) });
});

// ── Test connection ───────────────────────────────────────────────────────────
router.post("/whatsapp/test-connection", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const settings = await getWaSettings(orgId);
  if (!settings) { res.json({ ok: false, detail: "No API token or Phone Number ID configured" }); return; }
  const result = await testWhatsAppConnection(settings);
  res.json(result);
});

// ── Analytics ─────────────────────────────────────────────────────────────────
router.get("/whatsapp/analytics", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const orgFilter = eq(whatsappConversations.orgId, orgId);
  const [totals] = await db.select({ total: sql<number>`count(*)` }).from(whatsappConversations).where(orgFilter);
  const [yesCount] = await db.select({ count: sql<number>`count(*)` }).from(whatsappConversations)
    .where(and(orgFilter, sql`state NOT IN ('hook_sent', 'opted_out')`));
  const [reportCount] = await db.select({ count: sql<number>`count(*)` }).from(whatsappConversations)
    .where(and(orgFilter, sql`state IN ('report_sent','qualifying','appointment_pitched','appointment_booked')`));
  const [bookedCount] = await db.select({ count: sql<number>`count(*)` }).from(whatsappConversations)
    .where(and(orgFilter, eq(whatsappConversations.state, "appointment_booked")));
  const [optedOutCount] = await db.select({ count: sql<number>`count(*)` }).from(whatsappConversations)
    .where(and(orgFilter, eq(whatsappConversations.state, "opted_out")));

  const total = Number(totals?.total ?? 0);
  res.json({
    totalInitiated: total,
    yesRate: total > 0 ? Math.round((Number(yesCount?.count ?? 0) / total) * 100) : 0,
    reportsSent: Number(reportCount?.count ?? 0),
    appointmentsBooked: Number(bookedCount?.count ?? 0),
    optedOut: Number(optedOutCount?.count ?? 0),
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────
function buildHookText(firstName: string, company: string): string {
  return `Hi ${firstName}! 👋\n\nI'm Mysa — the AI Sales Advisor from *Dreamsdesign* (founded by Krishna Puranik, Vadodara).\n\nWe've served *4,500+ businesses* across India, UAE, UK, and USA and we ran a quick growth audit on *${company}*.\n\nWe found some real opportunities — and a few things holding you back from consistent leads.\n\nWant to receive your *free audit report*? Just reply *YES* 👇\n\n— Mysa AI | Dreamsdesign`;
}

export default router;

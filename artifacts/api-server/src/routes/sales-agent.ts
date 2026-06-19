import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { leads, agentActivities, agentActivityLog, dailyReports, meetings, auditRuns, shareTokens, agentConfig, outreachEmails } from "@workspace/db/schema";
import { eq, and, lt, or, sql, gte, ne, isNull } from "drizzle-orm";
import { sendOrgEmail } from "../lib/sendOrgEmail";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { requireOwnerOrAdmin } from "../middleware";
import { logger } from "../lib/logger";
import { getWaSettings, sendWhatsAppMessage, normalizePhone } from "../lib/whatsapp";
import { logAnthropicUsage } from "../lib/logApiUsage";

const router = Router();

const BOOKING_LINK = process.env["BOOKING_LINK"] ?? "https://calendly.com/krishnapuranik/discovery";
const REPORT_EMAIL = process.env["REPORT_EMAIL"] ?? "dreamsdesign.in@gmail.com";
const KRISHNA_NAME = "Krishna Puranik";
const KRISHNA_PHONE = normalizePhone(process.env["KRISHNA_PHONE"] ?? "919377756660");

async function sendKrishnaAlert(text: string, orgId?: number): Promise<void> {
  try {
    const waSettings = await getWaSettings(orgId);
    if (!waSettings) return;
    await sendWhatsAppMessage(waSettings, KRISHNA_PHONE, text);
  } catch { /* fire-and-forget alert, non-fatal */ }
}

// ── Consecutive email failure spike detection ─────────────────────────────────

const EMAIL_FAILURE_THRESHOLD = 3;
const EMAIL_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

type EmailFailureState = {
  consecutiveFailures: number;
  lastFailureError: string;
  lastAlertSentAt: number; // epoch ms, 0 = never alerted
};

const emailFailureState = new Map<number, EmailFailureState>();

const EMAIL_FAILURE_STATE_KEY = "global:email_failure_state";

type PersistedEmailFailureState = Record<string, EmailFailureState>;

async function saveEmailFailureState(): Promise<void> {
  try {
    const obj: PersistedEmailFailureState = {};
    for (const [orgId, state] of emailFailureState.entries()) {
      obj[String(orgId)] = state;
    }
    await db.insert(agentConfig)
      .values({ scopeKey: EMAIL_FAILURE_STATE_KEY, value: obj as unknown as Record<string, unknown> })
      .onConflictDoUpdate({ target: agentConfig.scopeKey, set: { value: obj as unknown as Record<string, unknown>, updatedAt: new Date() } });
  } catch (err) {
    logger.warn({ err }, "Agent Hub: could not save email failure state to DB (non-fatal)");
  }
}

export async function initEmailFailureState(): Promise<void> {
  try {
    const [row] = await db.select().from(agentConfig).where(eq(agentConfig.scopeKey, EMAIL_FAILURE_STATE_KEY)).limit(1);
    if (!row) return;
    const saved = row.value as unknown as PersistedEmailFailureState;
    for (const [orgIdStr, state] of Object.entries(saved)) {
      const orgId = Number(orgIdStr);
      if (
        typeof state.consecutiveFailures === "number" &&
        typeof state.lastFailureError === "string" &&
        typeof state.lastAlertSentAt === "number"
      ) {
        emailFailureState.set(orgId, state);
      }
    }
    logger.info("Agent Hub: email failure state restored from DB");
  } catch (err) {
    logger.warn({ err }, "Agent Hub: could not load email failure state from DB (non-fatal)");
  }
}

export function getEmailFailureState(orgId: number): EmailFailureState | null {
  return emailFailureState.get(orgId) ?? null;
}

export async function resetEmailFailureState(orgId: number): Promise<void> {
  emailFailureState.delete(orgId);
  await saveEmailFailureState();
}

function recordEmailSuccess(orgId: number): void {
  const state = emailFailureState.get(orgId);
  if (state) {
    state.consecutiveFailures = 0;
    saveEmailFailureState().catch(() => { /* non-fatal */ });
  }
}

function recordEmailFailure(orgId: number, errorMessage?: string): void {
  const existing = emailFailureState.get(orgId);
  const state: EmailFailureState = existing ?? { consecutiveFailures: 0, lastFailureError: "", lastAlertSentAt: 0 };
  state.consecutiveFailures++;
  state.lastFailureError = errorMessage ?? "Email delivery failed";
  emailFailureState.set(orgId, state);
  saveEmailFailureState().catch(() => { /* non-fatal */ });
}

async function maybeAlertEmailFailureSpike(orgId: number): Promise<void> {
  const state = emailFailureState.get(orgId);
  if (!state) return;
  if (state.consecutiveFailures < EMAIL_FAILURE_THRESHOLD) return;
  const now = Date.now();
  if (now - state.lastAlertSentAt < EMAIL_ALERT_COOLDOWN_MS) return;

  state.lastAlertSentAt = now;
  await saveEmailFailureState();
  const alertText = `[Mysa] Email failure spike detected — ${state.consecutiveFailures} consecutive emails have failed to send.\nLast error: ${state.lastFailureError}\nCheck Gmail credentials or quota in the Agent Hub.`;
  await sendKrishnaAlert(alertText, orgId);
  logger.warn({ orgId, consecutiveFailures: state.consecutiveFailures, lastError: state.lastFailureError }, "Email failure spike alert sent to Krishna");
}

// ── In-memory orchestrator state ─────────────────────────────────────────────

export type OrchestratorStatus = {
  scoutActive:          boolean;
  salesActive:          boolean;
  followupActive:       boolean;
  brainActive:          boolean;
  autopilotEmailPaused: boolean;
  lastScoutRun:         string | null;
  lastSalesRun:    string | null;
  lastFollowupRun: string | null;
  lastBrainTick:   string | null;
  lastReportSent:  string | null;
  totalAuditsSent: number;
  totalFollowupsSent: number;
  errors: string[];
};

// Per-org orchestrator state overrides (so one org can't affect another's toggles)
const perOrgOrchestratorState = new Map<number, Partial<Pick<OrchestratorStatus, "scoutActive" | "salesActive" | "followupActive" | "brainActive" | "autopilotEmailPaused">>>();

export function getOrgOrchestratorStatus(orgId: number): OrchestratorStatus {
  const override = perOrgOrchestratorState.get(orgId) ?? {};
  return { ...orchestratorStatus, ...override };
}

export async function toggleOrgAgent(orgId: number, agent: string): Promise<OrchestratorStatus> {
  const current = getOrgOrchestratorStatus(orgId);
  const patch: Partial<Pick<OrchestratorStatus, "scoutActive" | "salesActive" | "followupActive" | "brainActive">> = {};
  if (agent === "scout")    patch.scoutActive    = !current.scoutActive;
  if (agent === "sales")    patch.salesActive    = !current.salesActive;
  if (agent === "followup") patch.followupActive = !current.followupActive;
  if (agent === "brain")    patch.brainActive    = !current.brainActive;
  perOrgOrchestratorState.set(orgId, { ...perOrgOrchestratorState.get(orgId), ...patch });
  await saveOrchestratorState();
  return getOrgOrchestratorStatus(orgId);
}

export async function setAutopilotEmailPaused(orgId: number, paused: boolean): Promise<OrchestratorStatus> {
  // Update global default so all orgs see the change, then persist
  orchestratorStatus.autopilotEmailPaused = paused;
  const override = perOrgOrchestratorState.get(orgId) ?? {};
  perOrgOrchestratorState.set(orgId, { ...override, autopilotEmailPaused: paused });
  await saveOrchestratorState();
  return getOrgOrchestratorStatus(orgId);
}

export const orchestratorStatus: OrchestratorStatus = {
  scoutActive:          true,
  salesActive:          true,
  followupActive:       true,
  brainActive:          true,
  autopilotEmailPaused: true,
  lastScoutRun:         null,
  lastSalesRun:    null,
  lastFollowupRun: null,
  lastBrainTick:   null,
  lastReportSent:  null,
  totalAuditsSent: 0,
  totalFollowupsSent: 0,
  errors: [],
};

const ORCHESTRATOR_SCOPE_KEY = "global:orchestrator_status";

type PersistedOrchestratorState = Pick<OrchestratorStatus,
  "scoutActive" | "salesActive" | "followupActive" | "brainActive" | "autopilotEmailPaused" |
  "totalAuditsSent" | "totalFollowupsSent" | "errors"
> & { perOrgState?: Record<string, Partial<Pick<OrchestratorStatus, "scoutActive" | "salesActive" | "followupActive" | "brainActive" | "autopilotEmailPaused">>> };

export async function initOrchestratorState(): Promise<void> {
  try {
    const [row] = await db.select().from(agentConfig).where(eq(agentConfig.scopeKey, ORCHESTRATOR_SCOPE_KEY)).limit(1);
    if (!row) return;
    const saved = row.value as unknown as PersistedOrchestratorState;
    if (typeof saved.scoutActive          === "boolean") orchestratorStatus.scoutActive          = saved.scoutActive;
    if (typeof saved.salesActive          === "boolean") orchestratorStatus.salesActive          = saved.salesActive;
    if (typeof saved.followupActive       === "boolean") orchestratorStatus.followupActive       = saved.followupActive;
    if (typeof saved.brainActive          === "boolean") orchestratorStatus.brainActive          = saved.brainActive;
    if (typeof saved.autopilotEmailPaused === "boolean") orchestratorStatus.autopilotEmailPaused = saved.autopilotEmailPaused;
    if (typeof saved.totalAuditsSent    === "number") orchestratorStatus.totalAuditsSent    = saved.totalAuditsSent;
    if (typeof saved.totalFollowupsSent === "number") orchestratorStatus.totalFollowupsSent = saved.totalFollowupsSent;
    if (Array.isArray(saved.errors)) orchestratorStatus.errors = saved.errors.slice(-50);
    if (saved.perOrgState) {
      for (const [orgIdStr, patch] of Object.entries(saved.perOrgState)) {
        perOrgOrchestratorState.set(Number(orgIdStr), patch);
      }
    }
    logger.info("Agent Hub: orchestrator state restored from DB");
  } catch (err) {
    logger.warn({ err }, "Agent Hub: could not load orchestrator state from DB (non-fatal)");
  }
}

export async function saveOrchestratorState(): Promise<void> {
  try {
    const perOrgObj: Record<string, Partial<Pick<OrchestratorStatus, "scoutActive" | "salesActive" | "followupActive" | "brainActive">>> = {};
    for (const [orgId, patch] of perOrgOrchestratorState.entries()) {
      perOrgObj[String(orgId)] = patch;
    }
    const value: PersistedOrchestratorState = {
      scoutActive:          orchestratorStatus.scoutActive,
      salesActive:          orchestratorStatus.salesActive,
      followupActive:       orchestratorStatus.followupActive,
      brainActive:          orchestratorStatus.brainActive,
      autopilotEmailPaused: orchestratorStatus.autopilotEmailPaused,
      totalAuditsSent:      orchestratorStatus.totalAuditsSent,
      totalFollowupsSent:   orchestratorStatus.totalFollowupsSent,
      errors:               orchestratorStatus.errors.slice(-50),
      perOrgState:          perOrgObj,
    };
    await db.insert(agentConfig)
      .values({ scopeKey: ORCHESTRATOR_SCOPE_KEY, value: value as unknown as Record<string, unknown> })
      .onConflictDoUpdate({ target: agentConfig.scopeKey, set: { value: value as unknown as Record<string, unknown>, updatedAt: new Date() } });
  } catch (err) {
    logger.warn({ err }, "Agent Hub: could not save orchestrator state to DB (non-fatal)");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function logActivity(opts: {
  orgId?: number;
  leadId?: number;
  leadName?: string;
  companyName?: string;
  agentName: string;
  activityType: string;
  channel?: string;
  status?: string;
  detail?: Record<string, unknown>;
  payload?: unknown;
  response?: unknown;
  errorMessage?: string;
  userId?: number;
  userName?: string;
}) {
  try {
    let leadName    = opts.leadName;
    let companyName = opts.companyName;
    // Auto-populate leadName/companyName when leadId is given
    if (opts.leadId && (!leadName || !companyName)) {
      const [lead] = await db
        .select({ firstName: leads.firstName, lastName: leads.lastName, company: leads.company })
        .from(leads).where(eq(leads.id, opts.leadId)).limit(1);
      if (lead) {
        leadName    = leadName    ?? `${lead.firstName} ${lead.lastName}`.trim();
        companyName = companyName ?? lead.company ?? undefined;
      }
    }
    const baseDetail = (opts.detail ?? opts.payload ?? null) as Record<string, unknown> | null;
    const detail: Record<string, unknown> | null = (opts.userId != null || opts.userName != null)
      ? { ...(baseDetail ?? {}), ...(opts.userId != null ? { userId: opts.userId } : {}), ...(opts.userName ? { userName: opts.userName } : {}) }
      : baseDetail;

    // Write to primary structured activity log
    await db.insert(agentActivityLog).values({
      orgId:        opts.orgId        ?? null,
      leadId:       opts.leadId       ?? null,
      leadName:     leadName          ?? null,
      companyName:  companyName       ?? null,
      agentName:    opts.agentName,
      activityType: opts.activityType,
      detail,
      channel:      opts.channel      ?? null,
      status:       opts.status       ?? "success",
      errorMessage: opts.errorMessage ?? null,
    });
    // Also write to legacy table for backward compat (super-admin dashboard)
    await db.insert(agentActivities).values({
      orgId:        opts.orgId        ?? null,
      leadId:       opts.leadId       ?? null,
      agentName:    opts.agentName,
      activityType: opts.activityType,
      channel:      opts.channel      ?? null,
      status:       opts.status       ?? "success",
      payload:      detail,
      response:     (opts.response as Record<string, unknown>) ?? null,
      errorMessage: opts.errorMessage ?? null,
    });
  } catch { /* never crash on logging */ }
}

// sendGmailEmail is imported from ../lib/gmail

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86400000);
}

// ── Pipeline stage helper ─────────────────────────────────────────────────────

const STAGE_ORDER = [
  "new", "new_lead", "scout_checked", "contacted", "audit_sent",
  "follow_up_1", "follow_up_2", "follow_up_3", "engaged",
  "discovery_call", "call_booked",
  "show_up_confirmed", "no_show", "proposal_sent", "won", "lost",
] as const;
type PipelineStage = typeof STAGE_ORDER[number];

async function advancePipelineStage(leadId: number, toStage: PipelineStage): Promise<void> {
  try {
    await db.update(leads)
      .set({ pipelineStage: toStage, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
  } catch { /* non-fatal */ }
}

// ── SCOUT AGENT — Website Status Check ───────────────────────────────────────

async function checkWebsiteStatus(url: string): Promise<"live" | "down" | "no_website"> {
  if (!url || url.trim() === "") return "no_website";
  try {
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(fullUrl, { method: "HEAD", signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    return res.ok || res.status < 400 ? "live" : "down";
  } catch {
    try {
      const fullUrl = url.startsWith("http") ? url : `http://${url}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(fullUrl, { method: "HEAD", signal: ctrl.signal, redirect: "follow" });
      clearTimeout(timer);
      return res.ok || res.status < 400 ? "live" : "down";
    } catch {
      return "down";
    }
  }
}

export async function runScoutAgent(limit = 20, orgId?: number): Promise<number> {
  orchestratorStatus.lastScoutRun = new Date().toISOString();
  let processed = 0;

  const unscanned = await db
    .select()
    .from(leads)
    .where(orgId !== undefined
      ? and(eq(leads.websiteStatus, "unchecked"), eq(leads.orgId, orgId))
      : eq(leads.websiteStatus, "unchecked"))
    .limit(limit);

  for (const lead of unscanned) {
    try {
      const status = await checkWebsiteStatus(lead.website ?? "");
      await db.update(leads)
        .set({ websiteStatus: status, updatedAt: new Date() })
        .where(eq(leads.id, lead.id));

      if (status === "live") await advancePipelineStage(lead.id, "scout_checked");

      await logActivity({
        orgId: lead.orgId ?? undefined,
        leadId: lead.id,
        agentName: "scout",
        activityType: "website_checked",
        channel: "web",
        status: "success",
        detail: { url: lead.website, websiteStatus: status },
      });

      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      orchestratorStatus.errors.push(`Scout: ${lead.email} — ${msg}`);
    }
  }

  await logActivity({ orgId, agentName: "scout", activityType: "scout_batch_done", status: "success",
    detail: { processed } });

  return processed;
}

// ── SALES AGENT — Brand Audit + Plain-Text Email ──────────────────────────────

async function generateBrandAudit(lead: typeof leads.$inferSelect): Promise<string> {
  const prompt = `You are the Lead Brand Auditor for Dreamsdesign, a premium digital marketing agency in India led by Krishna Puranik. You conduct professional brand audits that reveal real gaps in a company's digital presence and set the stage for a discovery call.

Company: ${lead.company}
Website: ${lead.website ?? "Not provided"}
Industry: ${lead.industry}
Contact: ${lead.firstName} ${lead.lastName} (${lead.designation})
Country: ${lead.country}

Write a professional Brand Audit Report in plain text (no HTML, no markdown, just clean readable text) with these sections:
1. Digital Presence Score (score /100 with sub-scores: Website Quality, SEO Readiness, Social Media, Content Strategy, Brand Consistency, Mobile Experience)
2. Top 3 Strengths
3. Top 5 Critical Gaps (be specific and data-driven)
4. Missed Growth Opportunities (how to 2-3x their leads)
5. Dreamsdesign's Recommendation
6. Next Step

Tone: Professional, authoritative, helpful — like a trusted advisor. Address ${lead.firstName} by name.
Keep it concise — 300-400 words total. Return ONLY the plain text report.`;

  const brandAuditOverrides = await fetchOrgOverrides(lead.orgId ?? 0);
  const msg = await anthropic.messages.create({
    model: getModel("brand_audit_report", brandAuditOverrides),
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  void logAnthropicUsage({ model: getModel("brand_audit_report", brandAuditOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "sales_agent_brand_audit", orgId: lead.orgId ?? null });
  const ct = msg.content[0];
  if (ct.type === "text") return ct.text;
  return "Brand audit completed. Please contact us for your full report.";
}

function buildAuditEmailText(lead: typeof leads.$inferSelect, auditText: string, shareUrl?: string): string {
  const auditLinkLine = shareUrl
    ? `\nView your full brand audit report here: ${shareUrl}\n`
    : "";
  return `Hi ${lead.firstName},

I personally reviewed ${lead.company}'s digital presence — and I have some important findings to share.

${auditText}
${auditLinkLine}
---

I'd love to walk you through these findings on a free 20-minute discovery call. No pitch, no pressure — just a straight conversation about what we found.

Book your call here: ${BOOKING_LINK}

Best,
${KRISHNA_NAME}
CEO & MD, Dreamsdesign
+91 9377756660
dreamsdesign.in`;
}

async function createAuditShareLink(lead: typeof leads.$inferSelect, auditText: string): Promise<string | null> {
  try {
    const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
    if (!domain) return null;
    // Upsert an auditRuns record for this lead (summary only — detailed signals handled by UI audit flow)
    const [run] = await db.insert(auditRuns).values({
      leadId:    lead.id,
      orgId:     lead.orgId,
      healthScore: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      signals:   [],
      aiReport:  auditText,
    }).returning();
    if (!run) return null;
    // Create share token
    const [tokenRow] = await db.insert(shareTokens).values({ auditRunId: run.id }).returning();
    if (!tokenRow) return null;
    return `https://${domain}/audit/share/${tokenRow.token}`;
  } catch {
    return null;
  }
}

export async function runSalesAgent(limit = 10, orgId?: number): Promise<number> {
  orchestratorStatus.lastSalesRun = new Date().toISOString();
  let processed = 0;

  const queue = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.websiteStatus, "live"),
        eq(leads.brandAuditCompleted, 0),
        eq(leads.agentProcessed, 0),
        ...(orgId !== undefined ? [eq(leads.orgId, orgId)] : []),
      )
    )
    .limit(limit);

  for (const lead of queue) {
    try {
      // 1. Generate brand audit (plain text) + create shareable audit link
      await logActivity({ orgId: lead.orgId ?? undefined, leadId: lead.id, agentName: "sales", activityType: "audit_started", status: "pending" });
      const auditText = await generateBrandAudit(lead);
      await logActivity({ orgId: lead.orgId ?? undefined, leadId: lead.id, agentName: "sales", activityType: "audit_completed", status: "success" });
      const shareUrl  = await createAuditShareLink(lead, auditText);
      const emailText = buildAuditEmailText(lead, auditText, shareUrl ?? undefined);

      // 2. Send email — skip if autopilot email sending is paused
      if (getOrgOrchestratorStatus(lead.orgId ?? 1).autopilotEmailPaused) {
        await logActivity({
          orgId: lead.orgId ?? undefined, leadId: lead.id, agentName: "sales",
          activityType: "email_paused", channel: "email", status: "skipped",
          detail: { reason: "autopilot_email_paused", subject: `Brand Audit — ${lead.company}` },
        });
        processed++;
        continue;
      }
      const emailSent = await sendOrgEmail(lead.orgId ?? 1, {
        to:      lead.email,
        toName:  `${lead.firstName} ${lead.lastName}`,
        subject: `Your Brand Audit is Ready — ${lead.company}`,
        text:    emailText,
      });

      // 3. Update lead record — advance pipeline to audit_sent ONLY on successful delivery
      if (emailSent) {
        recordEmailSuccess(lead.orgId ?? 1);
        const auditSubject = `Your Brand Audit is Ready — ${lead.company}`;
        await db.update(leads).set({
          brandAuditCompleted: 1,
          brandAuditReport:    auditText,
          agentProcessed:      1,
          pipelineStage:       "audit_sent",
          followUpDay:         0,
          nextFollowUpAt:      daysFromNow(2),
          lastContactedAt:     new Date(),
          updatedAt:           new Date(),
        }).where(eq(leads.id, lead.id));

        // Record in outreach engine so it shows up in Sent Emails
        await db.insert(outreachEmails).values({
          orgId:    lead.orgId ?? null,
          leadId:   lead.id,
          toEmail:  lead.email,
          toName:   `${lead.firstName} ${lead.lastName}`,
          company:  lead.company,
          country:  lead.country ?? "",
          subject:  auditSubject,
          body:     emailText,
          status:   "sent",
          sentAt:   new Date(),
        });

        await logActivity({
          orgId: lead.orgId ?? undefined,
          leadId: lead.id,
          agentName: "sales",
          activityType: "email_sent",
          channel: "email",
          status: "success",
          detail: { subject: `Brand Audit — ${lead.company}`, to: lead.email },
        });
      } else {
        // Email failed — do NOT update any lead fields; keep brandAuditCompleted=0
        // so the sales queue selects this lead again on the next tick for retry
        // Mark as fake lead — email bounced/undeliverable
        await db.update(leads).set({ isFake: 1, updatedAt: new Date() }).where(eq(leads.id, lead.id));
        await logActivity({
          orgId: lead.orgId ?? undefined,
          leadId: lead.id,
          agentName: "sales",
          activityType: "email_failed",
          channel: "email",
          status: "failed",
          detail: { subject: `Brand Audit — ${lead.company}`, to: lead.email },
          errorMessage: "Email delivery failed",
        });
        recordEmailFailure(lead.orgId ?? 1, "Email delivery failed");
        await maybeAlertEmailFailureSpike(lead.orgId ?? 1);
      }

      // 4. WhatsApp outreach — only after successful Gmail (ordered step per spec)
      if (emailSent && lead.phone) {
        try {
          const waSettings = await getWaSettings(lead.orgId ?? undefined);
          if (waSettings) {
            const phoneNorm = normalizePhone(lead.phone);
            if (phoneNorm.length >= 7) {
              const waText = shareUrl
                ? `Hi ${lead.firstName}! I just sent you a brand audit for ${lead.company}. View it here: ${shareUrl}\n\nBook a free discovery call: ${BOOKING_LINK}`
                : `Hi ${lead.firstName}! I just sent you a brand audit report for ${lead.company} — check your inbox. Book a free discovery call: ${BOOKING_LINK}`;
              const waResult = await sendWhatsAppMessage(waSettings, phoneNorm, waText);
              const waOk = Boolean(waResult.waMessageId);
              await logActivity({
                orgId: lead.orgId ?? undefined,
                leadId: lead.id,
                agentName: "sales",
                activityType: waOk ? "whatsapp_sent" : "whatsapp_failed",
                channel: "whatsapp",
                status: waOk ? "success" : "failed",
                detail: { to: phoneNorm, waMessageId: waResult.waMessageId },
                errorMessage: waResult.errorMessage,
              });
            }
          }
        } catch { /* WhatsApp is fire-and-forget, non-fatal */ }
      }

      // 5. Sync to HubSpot (fire-and-forget)
      if (emailSent) syncLeadToHubSpot(lead.id, auditText).catch(() => {});

      // 6. Alert Krishna on WhatsApp when audit email is successfully sent
      if (emailSent) {
        await sendKrishnaAlert(
          `[Mysa] Audit email sent to ${lead.firstName} ${lead.lastName} (${lead.company}) — ${lead.email}`,
          lead.orgId ?? undefined,
        );
      }

      if (emailSent) orchestratorStatus.totalAuditsSent++;
      processed++;
      // Pacing: small delay between sends to avoid rate limits
      await new Promise(r => setTimeout(r, 600));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      await logActivity({
        orgId: lead.orgId ?? undefined,
        leadId: lead.id, agentName: "sales", activityType: "email_failed",
        status: "failed", errorMessage: msg,
      });
      orchestratorStatus.errors.push(`Sales: ${lead.email} — ${msg}`);
      // Do NOT call recordEmailFailure here — the exception may be from AI
      // generation, DB writes, or audit creation, not from email delivery itself.
      // True send failures are tracked in the emailSent === false branch above.
      // Do NOT set agentProcessed=1 on exception — transient AI/network
      // failures should allow the lead to be retried on the next tick
    }
  }

  return processed;
}

// ── HubSpot Sync ──────────────────────────────────────────────────────────────

async function syncLeadToHubSpot(leadId: number, _auditText?: string): Promise<void> {
  const HUBSPOT_TOKEN = process.env["HUBSPOT_ACCESS_TOKEN"] ?? "";
  if (!HUBSPOT_TOKEN) return;

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;

  try {
    const contactRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          firstname: lead.firstName,
          lastname:  lead.lastName,
          email:     lead.email,
          phone:     lead.phone ?? "",
          company:   lead.company,
          jobtitle:  lead.designation,
          website:   lead.website ?? "",
          hs_lead_status: "IN_PROGRESS",
          notes_last_contacted: new Date().toISOString(),
          notes_last_activity: `Brand audit sent by Mysa AI Sales Agent — ${new Date().toLocaleDateString("en-IN")}`,
        },
      }),
    });

    if (contactRes.ok) {
      const contactData = await contactRes.json() as { id?: string };
      const hubspotContactId = contactData.id ?? null;
      if (hubspotContactId) {
        await db.update(leads).set({ hubspotContactId, updatedAt: new Date() }).where(eq(leads.id, leadId));
      }

      const dealRes = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
        method: "POST",
        headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: {
            dealname: `${lead.company} — Brand Audit → Discovery`,
            pipeline: "default",
            dealstage: "appointmentscheduled",
            amount: "",
            closedate: daysFromNow(30).toISOString(),
          },
        }),
      });

      if (dealRes.ok) {
        const dealData = await dealRes.json() as { id?: string };
        if (dealData.id && hubspotContactId) {
          await db.update(leads)
            .set({ hubspotDealId: dealData.id, updatedAt: new Date() })
            .where(eq(leads.id, leadId));
          await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealData.id}/associations/contacts/${hubspotContactId}/deal_to_contact`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
          }).catch(() => {});
        }
      }
    }

    await logActivity({ orgId: lead.orgId ?? undefined, leadId, agentName: "sales", activityType: "hubspot_synced", channel: "hubspot", status: "success" });
  } catch (err) {
    await logActivity({ orgId: lead.orgId ?? undefined, leadId, agentName: "sales", activityType: "hubspot_synced", status: "failed", errorMessage: String(err) });
  }
}

// ── FOLLOW-UP AGENT (plain text, meeting-aware) ───────────────────────────────

function buildFollowUpEmailText(lead: typeof leads.$inferSelect, day: number): { subject: string; text: string } {
  const subjects: Record<number, string> = {
    2:  `Did you get a chance to look at your ${lead.company} brand audit?`,
    7:  `One insight from your brand audit — ${lead.company}`,
    10: `Last follow-up from me — ${lead.company}`,
  };

  const bodies: Record<number, string> = {
    2: `Hi ${lead.firstName},

I sent over ${lead.company}'s brand audit a couple of days ago and wanted to check in — did you get a chance to look at it?

There are a few specific gaps I found that are directly affecting your lead flow right now. The good news is they're fixable quickly.

I'd love to walk you through it on a quick 20-minute call — no cost, no pressure.

Book here: ${BOOKING_LINK}

Best,
${KRISHNA_NAME}
Dreamsdesign | +91 9377756660`,

    7: `Hi ${lead.firstName},

Following up on the brand audit I sent for ${lead.company}.

One thing I noticed that most businesses in the ${lead.industry} space miss — your content strategy is likely leaving significant organic traffic on the table. It's a quick fix once you know where to look.

If you haven't booked a call yet, now's a good time: ${BOOKING_LINK}

Best,
${KRISHNA_NAME}
Dreamsdesign | +91 9377756660`,

    10: `Hi ${lead.firstName},

This is my last message — I don't want to clutter your inbox.

But I genuinely believe the findings in your brand audit could change how ${lead.company} grows in the next 6 months. If the timing wasn't right before, feel free to reach out whenever it is.

You can always book a call here: ${BOOKING_LINK}

All the best,
${KRISHNA_NAME}
Dreamsdesign | +91 9377756660`,
  };

  const subject = subjects[day] ?? `Following up — ${lead.company}`;
  const text = bodies[day] ?? `Hi ${lead.firstName},\n\nFollowing up on the brand audit I sent for ${lead.company}.\n\nBook a call: ${BOOKING_LINK}\n\nBest,\n${KRISHNA_NAME}`;
  return { subject, text };
}

export async function runFollowUpAgent(orgId?: number): Promise<number> {
  orchestratorStatus.lastFollowupRun = new Date().toISOString();
  let sent = 0;
  const now = new Date();

  const dueLeads = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.agentProcessed, 1),
        or(
          eq(leads.pipelineStage, "audit_sent"),
          eq(leads.pipelineStage, "contacted"),
          eq(leads.pipelineStage, "engaged"),
          eq(leads.pipelineStage, "follow_up_1"),
          eq(leads.pipelineStage, "follow_up_2"),
          eq(leads.pipelineStage, "follow_up_3"),
        ),
        lt(leads.nextFollowUpAt, now),
        ...(orgId !== undefined ? [eq(leads.orgId, orgId)] : []),
      )
    )
    .limit(30);

  const FOLLOW_UP_DAYS = [2, 7, 10] as const;

  for (const lead of dueLeads) {
    // Skip if lead already has an upcoming meeting
    const upcomingMeetings = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(
        and(
          eq(meetings.leadId, lead.id),
          ne(meetings.status, "cancelled"),
        )
      )
      .limit(1);

    if (upcomingMeetings.length > 0) {
      // Lead already has a meeting booked — advance stage, clear follow-up schedule, skip
      await advancePipelineStage(lead.id, "discovery_call");
      await db.update(leads).set({ nextFollowUpAt: null }).where(eq(leads.id, lead.id));
      await logActivity({
        orgId: lead.orgId ?? undefined,
        leadId: lead.id,
        agentName: "followup",
        activityType: "followup_skipped_meeting_booked",
        status: "skipped",
        detail: { reason: "meeting_already_booked" },
      });
      // Alert Krishna: lead has a meeting booked
      await sendKrishnaAlert(
        `[Mysa] Meeting booked! ${lead.firstName} ${lead.lastName} (${lead.company}) has a discovery call scheduled. Follow-up paused.`,
        lead.orgId ?? undefined,
      );
      continue;
    }

    const nextDay = FOLLOW_UP_DAYS.find(d => d > (lead.followUpDay ?? 0));

    if (!nextDay) {
      // Sequence exhausted → mark lost
      await db.update(leads).set({
        pipelineStage: "lost",
        agentNotes: (lead.agentNotes ?? "") + `\n[${new Date().toLocaleDateString()}] Follow-up sequence completed — no response. Marked LOST.`,
        nextFollowUpAt: null,
        updatedAt: new Date(),
      }).where(eq(leads.id, lead.id));

      await logActivity({
        orgId: lead.orgId ?? undefined,
        leadId: lead.id,
        agentName: "followup",
        activityType: "lead_marked_lost",
        status: "success",
        detail: { reason: "sequence_exhausted", stage: "lost" },
      });
      continue;
    }

    try {
      const { subject, text } = buildFollowUpEmailText(lead, nextDay);

      // Check autopilot email kill switch before sending
      if (getOrgOrchestratorStatus(lead.orgId ?? 1).autopilotEmailPaused) {
        await logActivity({
          orgId: lead.orgId ?? undefined, leadId: lead.id, agentName: "followup",
          activityType: "email_paused", channel: "email", status: "skipped",
          detail: { reason: "autopilot_email_paused", day: nextDay },
        });
        continue;
      }

      const ok = await sendOrgEmail(lead.orgId ?? 1, {
        to:     lead.email,
        toName: `${lead.firstName} ${lead.lastName}`,
        subject,
        text,
      });

      const dayIdxCurrent = FOLLOW_UP_DAYS.indexOf(nextDay);
      const nextDayValue = FOLLOW_UP_DAYS[dayIdxCurrent + 1];
      // After the final follow-up, schedule a 1-day check so the agent
      // can pick up the lead again and mark it lost (nextDay becomes undefined)
      const nextScheduled = nextDayValue != null
        ? daysFromNow(nextDayValue - nextDay)
        : daysFromNow(1);

      const followUpStage: PipelineStage = dayIdxCurrent === 0 ? "follow_up_1" : dayIdxCurrent === 1 ? "follow_up_2" : "follow_up_3";

      if (ok) {
        recordEmailSuccess(lead.orgId ?? 1);
        // Only advance stage and schedule next follow-up when delivery succeeds
        await db.update(leads).set({
          followUpDay:     nextDay,
          nextFollowUpAt:  nextScheduled,
          lastContactedAt: new Date(),
          pipelineStage:   followUpStage,
          updatedAt:       new Date(),
        }).where(eq(leads.id, lead.id));

        // Record in outreach engine so it shows up in Sent Emails
        await db.insert(outreachEmails).values({
          orgId:   lead.orgId ?? null,
          leadId:  lead.id,
          toEmail: lead.email,
          toName:  `${lead.firstName} ${lead.lastName}`,
          company: lead.company,
          country: lead.country ?? "",
          subject,
          body:    text,
          status:  "sent",
          sentAt:  new Date(),
        });

        await logActivity({
          orgId: lead.orgId ?? undefined,
          leadId: lead.id, agentName: "followup", activityType: "followup_sent",
          channel: "email", status: "success",
          detail: { day: nextDay, subject },
        });

        orchestratorStatus.totalFollowupsSent++;
        sent++;
      } else {
        // Delivery failed — do not advance state; lead retries on next tick
        await logActivity({
          orgId: lead.orgId ?? undefined,
          leadId: lead.id, agentName: "followup", activityType: "followup_failed",
          channel: "email", status: "failed",
          detail: { day: nextDay, subject },
          errorMessage: "Email delivery failed",
        });
        recordEmailFailure(lead.orgId ?? 1, "Email delivery failed");
        await maybeAlertEmailFailureSpike(lead.orgId ?? 1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      orchestratorStatus.errors.push(`Follow-up: ${lead.email} — ${msg}`);
      await logActivity({
        orgId: lead.orgId ?? undefined,
        leadId: lead.id,
        agentName: "followup",
        activityType: "followup_failed",
        status: "failed",
        errorMessage: msg,
      });
      // Do NOT call recordEmailFailure here — the exception may be from DB writes
      // or other non-send paths. True send failures are tracked in the ok === false
      // branch above which is the authoritative email delivery failure signal.
    }
  }

  return sent;
}

// ── SALES BRAIN ORCHESTRATOR TICK ─────────────────────────────────────────────

// ── BANT SCORING STEP — scores new leads before the sales agent processes them ─

async function runBANTScoringStep(limit = 15, orgId?: number): Promise<number> {
  const unscored = await db
    .select()
    .from(leads)
    .where(
      and(
        ...(orgId !== undefined ? [eq(leads.orgId, orgId)] : []),
        eq(leads.agentProcessed, 0),
        or(eq(leads.bantScore, 0), isNull(leads.bantScore)),
      )
    )
    .limit(limit);

  const bantStepOverrides = await fetchOrgOverrides(orgId ?? 0);
  let scored = 0;
  for (const lead of unscored) {
    try {
      let bantScore = 50; // default mid-range
      try {
        const msg = await anthropic.messages.create({
          model: getModel("bantb_scoring", bantStepOverrides),
          max_tokens: 64,
          messages: [{
            role: "user",
            content: `BANT-score 0-100 for a design/branding agency prospect: ${lead.firstName} ${lead.lastName}, ${lead.designation ?? "?"} at ${lead.company} (${lead.industry ?? "?"}). Reply ONLY JSON: {"score":65,"note":"one sentence"}`,
          }],
        });
        void logAnthropicUsage({ model: getModel("bantb_scoring", bantStepOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "sales_agent_bant_scoring", orgId: lead.orgId ?? null });
        const ct = msg.content[0];
        if (ct.type === "text") {
          const p = JSON.parse(ct.text.trim()) as { score?: number };
          bantScore = Number(p.score) || bantScore;
        }
      } catch { /* keep default */ }

      await db.update(leads).set({ bantScore, updatedAt: new Date() }).where(eq(leads.id, lead.id));
      await logActivity({
        orgId: lead.orgId ?? undefined,
        leadId: lead.id,
        agentName: "brain",
        activityType: "bant_scored",
        status: "success",
        detail: { bantScore },
      });
      scored++;
    } catch { /* non-fatal */ }
  }
  return scored;
}

export async function runOrchestratorTick(orgId?: number): Promise<{ bant: number; scout: number; sales: number; followup: number }> {
  orchestratorStatus.lastBrainTick = new Date().toISOString();
  const result = { bant: 0, scout: 0, sales: 0, followup: 0 };

  // Use per-org state when scoped, fall back to global
  const state = orgId !== undefined ? getOrgOrchestratorStatus(orgId) : orchestratorStatus;

  await logActivity({ orgId, agentName: "brain", activityType: "tick_started", status: "success" });

  result.bant = await runBANTScoringStep(15, orgId);
  if (state.scoutActive)    result.scout   = await runScoutAgent(20, orgId);
  if (state.salesActive)    result.sales   = await runSalesAgent(5, orgId);
  if (state.followupActive) result.followup = await runFollowUpAgent(orgId);

  await logActivity({ orgId, agentName: "brain", activityType: "tick_completed", status: "success",
    detail: { bant: result.bant, scout: result.scout, sales: result.sales, followup: result.followup } });

  if (orchestratorStatus.errors.length > 50) {
    orchestratorStatus.errors = orchestratorStatus.errors.slice(-50);
  }

  await saveOrchestratorState();

  return result;
}

// ── DAILY REPORT (plain text via Gmail) ───────────────────────────────────────

export async function sendDailyReport(orgId?: number): Promise<boolean> {
  try {
    const today = new Date();
    const todayStr = today.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const yesterday = new Date(today.getTime() - 86400000);

    const allLeads = orgId !== undefined
      ? await db.select().from(leads).where(eq(leads.orgId, orgId))
      : await db.select().from(leads);

    const stageCount: Record<string, number> = {};
    for (const l of allLeads) {
      stageCount[l.pipelineStage] = (stageCount[l.pipelineStage] ?? 0) + 1;
    }

    const yesterdayLeads = allLeads.filter(l => l.lastContactedAt && l.lastContactedAt >= yesterday);

    const todayMeetings = allLeads.filter(l =>
      l.meetingScheduledAt &&
      l.meetingScheduledAt >= today &&
      l.meetingScheduledAt < new Date(today.getTime() + 86400000)
    );

    const yesterdayActivities = await db
      .select()
      .from(agentActivityLog)
      .where(and(
        ...(orgId !== undefined ? [eq(agentActivityLog.orgId, orgId)] : []),
        lt(agentActivityLog.executedAt, today),
        gte(agentActivityLog.executedAt, yesterday),
      ))
      .limit(500);

    const emailsSent    = yesterdayActivities.filter(a => a.activityType === "email_sent"    && a.status === "success").length;
    const auditsSent    = yesterdayActivities.filter(a => a.activityType === "audit_completed" && a.status === "success").length;
    const followupsSent = yesterdayActivities.filter(a => a.activityType === "followup_sent" && a.status === "success").length;

    const dailyReportOverrides = await fetchOrgOverrides(orgId ?? 0);
    let motivationalLine = "Every lead is a potential story of transformation. Keep pushing — today is another opportunity to make an impact.";
    try {
      const msg = await anthropic.messages.create({
        model: getModel("followup_email", dailyReportOverrides),
        max_tokens: 80,
        messages: [{ role: "user", content: "Write a short, powerful, one-sentence sales motivational line for an entrepreneur starting their morning. No quotes, just the sentence." }],
      });
      void logAnthropicUsage({ model: getModel("followup_email", dailyReportOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "sales_agent_daily_report", orgId: orgId ?? null });
      const ct = msg.content[0];
      if (ct.type === "text") motivationalLine = ct.text.trim();
    } catch { /* keep default */ }

    const pipelineLines = Object.entries(stageCount)
      .map(([stage, count]) => `  ${stage.padEnd(22)} ${count}`)
      .join("\n");

    const meetingLines = todayMeetings.length > 0
      ? todayMeetings.map(l => `  - ${l.firstName} ${l.lastName} (${l.company}) — ${l.meetingScheduledAt?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) ?? "TBD"}${l.meetingLink ? ` — ${l.meetingLink}` : ""}`).join("\n")
      : "  No meetings scheduled today.";

    const reportText = `DREAMSDESIGN SALES REPORT — ${todayStr}
Generated by Mysa AI Sales Brain
${"─".repeat(60)}

"${motivationalLine}"

${"─".repeat(60)}
TODAY'S MEETINGS (${todayMeetings.length})
${"─".repeat(60)}
${meetingLines}

${"─".repeat(60)}
YESTERDAY'S PERFORMANCE
${"─".repeat(60)}
  Leads Touched         ${yesterdayLeads.length}
  Emails Sent           ${emailsSent}
  Audits Generated      ${auditsSent}
  Follow-Ups Sent       ${followupsSent}

${"─".repeat(60)}
PIPELINE STATUS
${"─".repeat(60)}
  Stage                  Count
${pipelineLines}
  ${"─".repeat(30)}
  TOTAL                  ${allLeads.length}

${"─".repeat(60)}
AGENT STATUS
${"─".repeat(60)}
  Scout Agent            ${orchestratorStatus.scoutActive ? "ACTIVE" : "PAUSED"}
  Sales Agent            ${orchestratorStatus.salesActive ? "ACTIVE" : "PAUSED"}
  Follow-Up Agent        ${orchestratorStatus.followupActive ? "ACTIVE" : "PAUSED"}
  Sales Brain            ${orchestratorStatus.brainActive ? "ACTIVE" : "PAUSED"}
  Total Audits Sent      ${orchestratorStatus.totalAuditsSent}
  Total Follow-Ups Sent  ${orchestratorStatus.totalFollowupsSent}

${"─".repeat(60)}
Booking link: ${BOOKING_LINK}
dreamsdesign.in`;

    const ok = await sendOrgEmail(orgId ?? 1, {
      to:      REPORT_EMAIL,
      toName:  "Krishna Puranik",
      subject: `Dreamsdesign Sales Report — ${todayStr} | ${todayMeetings.length} Meetings Today`,
      text:    reportText,
    });

    await db.insert(dailyReports).values({
      orgId:               orgId ?? null,
      reportDate:          today.toISOString().split("T")[0]!,
      totalLeadsProcessed: allLeads.length,
      newLeadsToday:       yesterdayLeads.length,
      emailsSent,
      whatsappSent:        0,
      linkedinSent:        0,
      callsBooked:         stageCount["call_booked"] ?? 0,
      meetingsToday:       todayMeetings.length,
      noShows:             stageCount["no_show"] ?? 0,
      auditsGenerated:     auditsSent,
      pipelineSummary:     stageCount as Record<string, unknown>,
      hotLeads:            null,
      agentPerformance:    null,
      reportHtml:          reportText,
    });

    orchestratorStatus.lastReportSent = new Date().toISOString();
    return ok;
  } catch (err) {
    orchestratorStatus.errors.push(`Report: ${err instanceof Error ? err.message : "Unknown"}`);
    return false;
  }
}

// ── REST API Endpoints ─────────────────────────────────────────────────────────

// GET /api/agents/orchestrator/status
router.get("/agents/orchestrator/status", requireOwnerOrAdmin, (_req: Request, res: Response) => {
  res.json(orchestratorStatus);
});

const ORCHESTRATOR_AGENTS = new Set(["scout", "sales", "followup", "brain"]);

// POST /api/agents/orchestrator/toggle
router.post("/agents/orchestrator/toggle", requireOwnerOrAdmin, async (req: Request, res: Response) => {
  const { agent } = req.body as { agent?: string };

  if (!agent || !ORCHESTRATOR_AGENTS.has(agent)) {
    res.status(400).json({ error: `Invalid agent: "${agent ?? ""}". Valid values: scout, sales, followup, brain` });
    return;
  }

  if (agent === "scout")    orchestratorStatus.scoutActive    = !orchestratorStatus.scoutActive;
  if (agent === "sales")    orchestratorStatus.salesActive    = !orchestratorStatus.salesActive;
  if (agent === "followup") orchestratorStatus.followupActive = !orchestratorStatus.followupActive;
  if (agent === "brain")    orchestratorStatus.brainActive    = !orchestratorStatus.brainActive;
  await saveOrchestratorState();

  const newActive = agent === "scout" ? orchestratorStatus.scoutActive
    : agent === "sales" ? orchestratorStatus.salesActive
    : agent === "followup" ? orchestratorStatus.followupActive
    : orchestratorStatus.brainActive;

  await logActivity({
    orgId:    req.user?.orgId,
    agentName: agent,
    activityType: "agent_toggled",
    status: "success",
    detail: { active: newActive },
    userId:   req.user?.userId,
    userName: req.user?.email,
  });

  res.json(orchestratorStatus);
});

// POST /api/agents/orchestrator/tick — manual trigger
router.post("/agents/orchestrator/tick", requireOwnerOrAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await runOrchestratorTick();
    res.json({ ok: true, result });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/agents/scout/run
router.post("/agents/scout/run", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const n = await runScoutAgent(30, orgId);
  res.json({ ok: true, processed: n });
});

// POST /api/agents/sales/run
router.post("/agents/sales/run", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const n = await runSalesAgent(10, orgId);
  res.json({ ok: true, processed: n });
});

// POST /api/agents/followup/run
router.post("/agents/followup/run", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const n = await runFollowUpAgent(orgId);
  res.json({ ok: true, sent: n });
});

// POST /api/agents/report/send
router.post("/agents/report/send", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const ok = await sendDailyReport(orgId);
  res.json({ ok, email: REPORT_EMAIL });
});

// GET /api/agents/activities
router.get("/agents/activities", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const limit = Math.min(Number(req.query["limit"] ?? 100), 200);
  const rows = await db
    .select()
    .from(agentActivities)
    .where(eq(agentActivities.orgId, orgId))
    .orderBy(sql`${agentActivities.executedAt} DESC`)
    .limit(limit);
  res.json(rows);
});

// GET /api/agents/reports
router.get("/agents/reports", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const rows = await db
    .select({
      id:         dailyReports.id,
      reportDate: dailyReports.reportDate,
      emailsSent: dailyReports.emailsSent,
      callsBooked: dailyReports.callsBooked,
      totalLeadsProcessed: dailyReports.totalLeadsProcessed,
      meetingsToday: dailyReports.meetingsToday,
      sentAt: dailyReports.sentAt,
    })
    .from(dailyReports)
    .where(eq(dailyReports.orgId, orgId))
    .orderBy(sql`${dailyReports.sentAt} DESC`)
    .limit(30);
  res.json(rows);
});

// GET /api/agents/reports/:id
router.get("/agents/reports/:id", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const orgId = req.user!.orgId;
  const [row] = await db.select().from(dailyReports).where(and(eq(dailyReports.id, id), eq(dailyReports.orgId, orgId))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// GET /api/agents/pipeline-stats
router.get("/agents/pipeline-stats", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const all = await db.select({ pipelineStage: leads.pipelineStage, websiteStatus: leads.websiteStatus }).from(leads).where(eq(leads.orgId, orgId));
  const stageCount: Record<string, number> = {};
  const statusCount: Record<string, number> = {};
  for (const l of all) {
    stageCount[l.pipelineStage]  = (stageCount[l.pipelineStage]  ?? 0) + 1;
    statusCount[l.websiteStatus] = (statusCount[l.websiteStatus]  ?? 0) + 1;
  }
  res.json({ total: all.length, stageCount, statusCount });
});

// ── Composer helpers (public API matching task spec) ──────────────────────────

export function composeOutreachEmail(
  lead: typeof leads.$inferSelect,
  auditSummary: string,
  auditLink?: string,
  bookingLink?: string,
  senderName?: string,
  _senderPhone?: string,
): { subject: string; text: string } {
  const text = buildAuditEmailText(lead, auditSummary, auditLink);
  const subject = `${lead.company} — Website & Brand Audit${senderName ? ` from ${senderName}` : ""}`;
  const footer = bookingLink
    ? `\n\nBook your free discovery call: ${bookingLink}`
    : "";
  return { subject, text: text + footer };
}

export function composeFollowUp(
  lead: typeof leads.$inferSelect,
  day: number,
  bookingLink?: string,
  senderName?: string,
): { subject: string; text: string } {
  const result = buildFollowUpEmailText(lead, day);
  const footer = bookingLink ? `\n\n${bookingLink}` : "";
  const signoff = senderName ? result.text.replace(KRISHNA_NAME, senderName) : result.text;
  return { subject: result.subject, text: signoff + footer };
}

export default router;

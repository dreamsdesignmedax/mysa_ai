import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { agentActivityLog, meetings as meetingsTable, leads, organizations } from "@workspace/db/schema";
import { eq, and, gte, sql, lt, ne } from "drizzle-orm";
import { requireOwnerOrAdmin } from "../middleware";
import { getLimits } from "../config/planLimits";
import {
  logActivity,
  getOrgOrchestratorStatus,
  toggleOrgAgent,
  setAutopilotEmailPaused,
  runScoutAgent,
  runSalesAgent,
  runFollowUpAgent,
  runOrchestratorTick,
  getEmailFailureState,
  resetEmailFailureState,
} from "./sales-agent";
import { getLeadHunterStatusForOrg, toggleLeadHunterForOrg, runLeadHunterNightly } from "./agents";

const router = Router();

// GET /api/agent-hub/status — combined orchestrator + lead hunter + today metrics
router.get("/agent-hub/status", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayActivities = await db
    .select({ activityType: agentActivityLog.activityType, status: agentActivityLog.status })
    .from(agentActivityLog)
    .where(
      and(
        eq(agentActivityLog.orgId, orgId),
        gte(agentActivityLog.executedAt, todayStart),
      )
    );

  // Meetings booked today — use meetings table joined via leads (same source follow-up agent checks)
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const [meetRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(meetingsTable)
    .innerJoin(leads, eq(meetingsTable.leadId, leads.id))
    .where(
      and(
        eq(leads.orgId, orgId),
        gte(meetingsTable.createdAt, todayStart),
        lt(meetingsTable.createdAt, tomorrowStart),
        ne(meetingsTable.status, "cancelled"),
      )
    );

  const emailsSentToday    = todayActivities.filter(a => (a.activityType === "email_sent" || a.activityType === "followup_sent") && a.status === "success").length;
  const emailsFailedToday  = todayActivities.filter(a => (a.activityType === "email_failed" || a.activityType === "followup_failed") && a.status === "failed").length;
  const GMAIL_DAILY_LIMIT  = 500;

  const today = {
    leadsHuntedToday:    todayActivities.filter(a => a.activityType === "lead_fetched"           && a.status === "success").length,
    meetingsBookedToday: Number(meetRow?.count ?? 0),
    emailsSent:          todayActivities.filter(a => a.activityType === "email_sent"             && a.status === "success").length,
    followupsSent:       todayActivities.filter(a => a.activityType === "followup_sent"          && a.status === "success").length,
    auditsGenerated:     todayActivities.filter(a => a.activityType === "audit_completed"        && a.status === "success").length,
    whatsappSent:        todayActivities.filter(a => a.activityType === "whatsapp_sent"          && a.status === "success").length,
    websitesScanned:     todayActivities.filter(a => a.activityType === "website_checked"        && a.status === "success").length,
    errors:              todayActivities.filter(a => a.status === "failed").length,
  };

  const emailHealth = {
    sentToday:       emailsSentToday,
    failedToday:     emailsFailedToday,
    gmailDailyLimit: GMAIL_DAILY_LIMIT,
    limitWarning:    emailsSentToday > 400,
    limitCritical:   emailsSentToday >= GMAIL_DAILY_LIMIT,
    usagePct:        Math.min(Math.round((emailsSentToday / GMAIL_DAILY_LIMIT) * 100), 100),
  };

  const leadHunter = await getLeadHunterStatusForOrg(orgId);

  res.json({
    orchestrator: getOrgOrchestratorStatus(orgId),
    leadHunter,
    today,
    emailHealth,
  });
});

// GET /api/agent-hub/email-health/history — 7-day delivered vs failed email counts per day
router.get("/agent-hub/email-health/history", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;

  // Cutoff = IST midnight of 6 days ago, keeping timezone consistent with grouping
  // (CURRENT_DATE - 6) AT TIME ZONE 'Asia/Kolkata' yields a timestamptz at IST midnight
  const rows = await db
    .select({
      day:         sql<string>`to_char(${agentActivityLog.executedAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`,
      activityType: agentActivityLog.activityType,
      status:      agentActivityLog.status,
      cnt:         sql<number>`count(*)::int`,
    })
    .from(agentActivityLog)
    .where(
      and(
        eq(agentActivityLog.orgId, orgId),
        sql`${agentActivityLog.executedAt} >= (CURRENT_DATE - INTERVAL '6 days') AT TIME ZONE 'Asia/Kolkata'`,
      )
    )
    .groupBy(
      sql`to_char(${agentActivityLog.executedAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`,
      agentActivityLog.activityType,
      agentActivityLog.status,
    )
    .orderBy(sql`to_char(${agentActivityLog.executedAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`);

  // Build a map keyed by IST YYYY-MM-DD; pre-fill all 7 days so gaps show as zero
  const byDay = new Map<string, { day: string; dayLabel: string; delivered: number; failed: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    const key   = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d.setDate(d.getDate() - i) && d);
    const label = new Intl.DateTimeFormat("en-US",  { timeZone: "Asia/Kolkata", month: "short", day: "numeric" }).format(d);
    byDay.set(key, { day: key, dayLabel: label, delivered: 0, failed: 0 });
  }

  for (const row of rows) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    const isDelivered = (row.activityType === "email_sent" || row.activityType === "followup_sent") && row.status === "success";
    const isFailed    = (row.activityType === "email_failed" || row.activityType === "followup_failed") && row.status === "failed";
    if (isDelivered) entry.delivered += row.cnt;
    if (isFailed)    entry.failed    += row.cnt;
  }

  res.json([...byDay.values()]);
});

// GET /api/agent-hub/activity — activity log with optional ?agent= filter
router.get("/agent-hub/activity", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const agent  = typeof req.query["agent"] === "string" ? req.query["agent"] : null;
  const limit  = Math.min(Number(req.query["limit"] ?? 100), 200);

  let rows;
  if (agent && agent !== "all") {
    rows = await db
      .select()
      .from(agentActivityLog)
      .where(and(
        eq(agentActivityLog.orgId, orgId),
        eq(agentActivityLog.agentName, agent),
      ))
      .orderBy(sql`${agentActivityLog.executedAt} DESC`)
      .limit(limit);
  } else {
    rows = await db
      .select()
      .from(agentActivityLog)
      .where(eq(agentActivityLog.orgId, orgId))
      .orderBy(sql`${agentActivityLog.executedAt} DESC`)
      .limit(limit);
  }

  res.json(rows);
});

// GET /api/agent-hub/toggle-history — recent agent toggle events (who toggled what and when)
router.get("/agent-hub/toggle-history", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

  const rows = await db
    .select()
    .from(agentActivityLog)
    .where(
      and(
        eq(agentActivityLog.orgId, orgId),
        eq(agentActivityLog.activityType, "agent_toggled"),
      )
    )
    .orderBy(sql`${agentActivityLog.executedAt} DESC`)
    .limit(limit);

  res.json(rows);
});

// GET /api/agent-hub/email-failure-health — consecutive email failure state for this org
router.get("/agent-hub/email-failure-health", requireOwnerOrAdmin, (req: Request, res: Response): void => {
  const orgId = req.user!.orgId;
  const state = getEmailFailureState(orgId);
  res.json({
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    lastFailureError:    state?.lastFailureError    ?? null,
    lastAlertSentAt:     state?.lastAlertSentAt     ?? 0,
    threshold:           3,
    fetchedAt:           new Date().toISOString(),
  });
});

// POST /api/agent-hub/email-failure-health/reset — clear failure counter for this org
router.post("/agent-hub/email-failure-health/reset", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId    = req.user!.orgId;
  const userId   = req.user!.userId;
  const userName = req.user!.email;
  await resetEmailFailureState(orgId);
  await logActivity({ orgId, agentName: "sales", activityType: "email_failure_counter_reset", status: "success",
    detail: { resetBy: userName }, userId, userName });
  res.json({ ok: true, message: "Email failure counter cleared" });
});

const VALID_AGENTS = new Set(["scout", "sales", "followup", "brain", "lead_hunter", "autopilot_email"]);

// POST /api/agent-hub/:agent/toggle — toggle any agent
router.post("/agent-hub/:agent/toggle", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId    = req.user!.orgId;
  const userId   = req.user!.userId;
  const userName = req.user!.email;
  const agent = String(req.params["agent"]);

  if (!VALID_AGENTS.has(agent)) {
    res.status(400).json({ error: `Unknown agent: ${agent}. Valid agents: ${[...VALID_AGENTS].join(", ")}` });
    return;
  }

  // ── Feature gate: sales_brain for scout/sales/followup/brain/lead_hunter; autopilot for autopilot_email ──
  {
    const requiresFeature = agent === "autopilot_email" ? "autopilot" : "sales_brain";
    const [orgRow] = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const lims = getLimits(orgRow?.plan ?? "trial");
    if (!lims[requiresFeature]) {
      res.status(403).json({
        error: "PLAN_LIMIT",
        feature: requiresFeature,
        message: `This feature is not available on your current plan. Upgrade to Growth or Agency to unlock it.`,
        upgrade_url: "/billing",
      });
      return;
    }
  }

  if (agent === "autopilot_email") {
    const current = getOrgOrchestratorStatus(orgId);
    const paused = !current.autopilotEmailPaused;
    const newStatus = await setAutopilotEmailPaused(orgId, paused);
    await logActivity({ orgId, agentName: "autopilot_email", activityType: "agent_toggled", status: "success",
      detail: { paused }, userId, userName });
    res.json({ agent, autopilotEmailPaused: paused, orchestrator: newStatus });
    return;
  }

  if (agent === "lead_hunter") {
    const active = await toggleLeadHunterForOrg(orgId);
    await logActivity({ orgId, agentName: "lead_hunter", activityType: "agent_toggled", status: "success",
      detail: { active }, userId, userName });
    res.json({ agent, active });
    return;
  }

  // Orchestrator agents — toggled per-org to avoid cross-tenant mutation
  const newStatus = await toggleOrgAgent(orgId, agent);
  const newActive = agent === "scout" ? newStatus.scoutActive
    : agent === "sales" ? newStatus.salesActive
    : agent === "followup" ? newStatus.followupActive
    : newStatus.brainActive;

  await logActivity({ orgId, agentName: agent, activityType: "agent_toggled", status: "success",
    detail: { active: newActive }, userId, userName });

  res.json({ agent, orchestrator: newStatus });
});

// POST /api/agent-hub/:agent/run-now — trigger an agent immediately
router.post("/agent-hub/:agent/run-now", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const { agent } = req.params;

  if (agent === "scout") {
    const n = await runScoutAgent(30, orgId);
    res.json({ ok: true, agent, processed: n });
    return;
  }
  if (agent === "sales") {
    const n = await runSalesAgent(10, orgId);
    res.json({ ok: true, agent, processed: n });
    return;
  }
  if (agent === "followup") {
    const n = await runFollowUpAgent(orgId);
    res.json({ ok: true, agent, sent: n });
    return;
  }
  if (agent === "brain") {
    const result = await runOrchestratorTick(orgId);
    res.json({ ok: true, agent, result });
    return;
  }
  if (agent === "lead_hunter") {
    const result = await runLeadHunterNightly(orgId);
    res.json({ ok: true, agent, orgsRun: result.orgsRun, totalAdded: result.totalAdded });
    return;
  }

  res.status(400).json({ error: `Unknown agent: ${agent}` });
});

export default router;

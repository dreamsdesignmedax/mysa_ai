import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "../lib/db";
import { organizations, users, waitlist, leads, agentActivities, dailyReports, adminAccessLog, apiUsageLog, auditRuns, outreachEmails, leadBank } from "@workspace/db/schema";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { verifyToken } from "./auth";

const router = Router();

const ADMIN_SECRET = process.env["ADMIN_SECRET"] ?? "";
const ADMIN_EMAIL  = "dreamsdesign.in@gmail.com";
const COOKIE_NAME  = "mysa_token";

const ACCESS_LOG_LIMIT = 500;

export type AccessLogEntry = {
  timestamp: string;
  path: string;
  method: string;
  ip: string;
  status: "success" | "forbidden";
  secret?: "wrong" | "missing";
};

async function pushAccessLog(entry: AccessLogEntry): Promise<void> {
  try {
    await db.insert(adminAccessLog).values({
      timestamp: new Date(entry.timestamp),
      path: entry.path,
      method: entry.method,
      ip: entry.ip,
      status: entry.status,
      secretHint: entry.secret ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to persist access log entry to database");
  }
}

const ACCESS_LOG_SELF_PATH = "/saas/access-log";

router.use((_req: Request, res: Response, next: NextFunction): void => {
  if (!_req.path.startsWith("/saas")) { next(); return; }

  const provided = _req.headers["x-admin-secret"];
  const isSelfRead = _req.path === ACCESS_LOG_SELF_PATH && _req.method === "GET";

  // Accept x-admin-secret header
  const secretOk = ADMIN_SECRET && typeof provided === "string" && provided === ADMIN_SECRET;

  // Also accept admin users authenticated via JWT cookie
  const cookie = _req.cookies?.[COOKIE_NAME] as string | undefined;
  const tokenData = cookie ? verifyToken(cookie) : null;
  // Only grant cookie-based access to the platform org owner (orgId === 1)
  // or the designated admin email — prevents other orgs' owners from accessing
  // platform-level admin routes.
  const cookieOk =
    (tokenData?.role === "owner" && tokenData?.orgId === 1) ||
    tokenData?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  if (!secretOk && !cookieOk) {
    const secret = provided ? "wrong" : "missing";
    logger.warn({
      event: "admin.super-admin.forbidden",
      path: _req.originalUrl,
      method: _req.method,
      secret,
      ip: _req.ip ?? _req.socket?.remoteAddress ?? "unknown",
    }, "Super-admin route rejected: invalid or missing secret");
    if (!isSelfRead) {
      void pushAccessLog({
        timestamp: new Date().toISOString(),
        path: _req.originalUrl,
        method: _req.method,
        ip: _req.ip ?? _req.socket?.remoteAddress ?? "unknown",
        status: "forbidden",
        secret,
      });
    }
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  logger.info({
    event: "admin.super-admin.access",
    path: _req.originalUrl,
    method: _req.method,
    ip: _req.ip ?? _req.socket?.remoteAddress ?? "unknown",
  }, "Super-admin route accessed");
  if (!isSelfRead) {
    void pushAccessLog({
      timestamp: new Date().toISOString(),
      path: _req.originalUrl,
      method: _req.method,
      ip: _req.ip ?? _req.socket?.remoteAddress ?? "unknown",
      status: "success",
    });
  }
  next();
});

// ── GET /api/saas/dashboard ────────────────────────────────────────────────────
router.get("/saas/dashboard", async (_req: Request, res: Response) => {
  try {
    const [allOrgs, allWaitlist, allLeads, recentActivities] = await Promise.all([
      db.select().from(organizations).orderBy(desc(organizations.createdAt)),
      db.select().from(waitlist).orderBy(desc(waitlist.createdAt)),
      db.select({ pipelineStage: leads.pipelineStage, createdAt: leads.createdAt }).from(leads),
      db.select().from(agentActivities).orderBy(desc(agentActivities.executedAt)).limit(20),
    ]);

    const activeOrgs   = allOrgs.filter(o => o.subscriptionStatus === "active");
    const trialOrgs    = allOrgs.filter(o => o.subscriptionStatus === "trialing");
    const canceledOrgs = allOrgs.filter(o => o.subscriptionStatus === "canceled");
    const pendingInvite = allWaitlist.filter(w => !w.approved);

    // Plan distribution
    const planCounts = allOrgs.reduce<Record<string, number>>((acc, o) => {
      acc[o.plan] = (acc[o.plan] ?? 0) + 1;
      return acc;
    }, {});

    // Estimate MRR (plan prices in USD)
    const PLAN_PRICES: Record<string, number> = { starter: 49, growth: 149, pro: 299 };
    const mrr = activeOrgs.reduce((sum, o) => sum + (PLAN_PRICES[o.plan] ?? 0), 0);

    // Pipeline stage breakdown
    const stageCount = allLeads.reduce<Record<string, number>>((acc, l) => {
      acc[l.pipelineStage] = (acc[l.pipelineStage] ?? 0) + 1;
      return acc;
    }, {});

    // Last 12 days signups
    const last12days: Array<{ date: string; count: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split("T")[0]!;
      const count = allOrgs.filter(o => o.createdAt.toISOString().startsWith(ds)).length;
      last12days.push({ date: ds, count });
    }

    res.json({
      summary: {
        totalOrgs:    allOrgs.length,
        activeOrgs:   activeOrgs.length,
        trialOrgs:    trialOrgs.length,
        canceledOrgs: canceledOrgs.length,
        pendingInvite: pendingInvite.length,
        totalWaitlist: allWaitlist.length,
        totalLeads:    allLeads.length,
        mrr,
        arr: mrr * 12,
      },
      planCounts,
      stageCount,
      signupTrend: last12days,
      recentOrgs: allOrgs.slice(0, 10),
      pendingWaitlist: pendingInvite.slice(0, 10),
      recentActivities,
    });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/saas/organizations ───────────────────────────────────────────────
router.get("/saas/organizations", async (_req: Request, res: Response) => {
  const orgs = await storage.listOrganizations();
  res.json(orgs);
});

// ── POST /api/saas/organizations ──────────────────────────────────────────────
router.post("/saas/organizations", async (req: Request, res: Response) => {
  try {
    const { email, name, ownerName, plan, phone, website, notes } = req.body as {
      email: string; name: string; ownerName?: string; plan?: string;
      phone?: string; website?: string; notes?: string;
    };
    if (!email || !name) { res.status(400).json({ error: "email + name required" }); return; }

    const [org] = await db.insert(organizations).values({
      email, name,
      ownerName: ownerName ?? null,
      plan: plan ?? "trial",
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(Date.now() + 7 * 86400000),
      phone: phone ?? null,
      website: website ?? null,
      notes: notes ?? null,
    }).returning();

    res.json(org);
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/saas/organizations/:id ────────────────────────────────────────
router.patch("/saas/organizations/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const org = await storage.updateOrganization(id, req.body as Partial<typeof organizations.$inferInsert>);
    if (!org) { res.status(404).json({ error: "Not found" }); return; }
    res.json(org);
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/saas/organizations/:id/suspend ──────────────────────────────────
router.post("/saas/organizations/:id/suspend", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const org = await storage.getOrganization(id);
    if (!org) { res.status(404).json({ error: "Not found" }); return; }
    const updated = await storage.updateOrganization(id, { isSuspended: !org.isSuspended });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/saas/organizations/:id ───────────────────────────────────────
router.delete("/saas/organizations/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await storage.updateOrganization(id, { isActive: false });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/saas/users ───────────────────────────────────────────────────────
router.get("/saas/users", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id:                 users.id,
        firstName:          users.firstName,
        lastName:           users.lastName,
        email:              users.email,
        role:               users.role,
        isActive:           users.isActive,
        isVerified:         users.isVerified,
        phone:              users.phone,
        phoneVerified:      users.phoneVerified,
        createdAt:          users.createdAt,
        orgId:              organizations.id,
        orgName:            organizations.name,
        orgEmail:           organizations.email,
        orgPhone:           organizations.phone,
        orgWebsite:         organizations.website,
        orgPlan:            organizations.plan,
        orgSubscriptionStatus: organizations.subscriptionStatus,
        orgIsActive:        organizations.isActive,
        orgIsSuspended:     organizations.isSuspended,
        orgTrialEndsAt:     organizations.trialEndsAt,
        orgCreatedAt:       organizations.createdAt,
      })
      .from(users)
      .leftJoin(organizations, eq(users.orgId, organizations.id))
      .orderBy(desc(users.createdAt));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/saas/waitlist ────────────────────────────────────────────────────
router.get("/saas/waitlist", async (_req: Request, res: Response) => {
  const entries = await db.select().from(waitlist).orderBy(desc(waitlist.createdAt));
  res.json(entries);
});

// ── GET /api/saas/access-log ──────────────────────────────────────────────────
router.get("/saas/access-log", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(adminAccessLog)
      .orderBy(desc(adminAccessLog.timestamp), desc(adminAccessLog.id))
      .limit(ACCESS_LOG_LIMIT);

    rows.reverse();

    const entries: AccessLogEntry[] = rows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      path: r.path,
      method: r.method,
      ip: r.ip,
      status: r.status as "success" | "forbidden",
      ...(r.secretHint ? { secret: r.secretHint as "wrong" | "missing" } : {}),
    }));

    res.json(entries);
  } catch (err) {
    logger.error({ err }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/saas/api-usage", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalRow] = await db
      .select({
        totalCostUsd:      sql<number>`coalesce(sum(${apiUsageLog.costUsd}), 0)`,
        totalInputTokens:  sql<number>`coalesce(sum(${apiUsageLog.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${apiUsageLog.outputTokens}), 0)`,
        totalApiCalls:     sql<number>`coalesce(sum(${apiUsageLog.apiCalls}), 0)`,
      })
      .from(apiUsageLog);

    // Per-org today's spend vs threshold
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

    const orgList = await db
      .select({
        id:           organizations.id,
        name:         organizations.name,
        email:        organizations.email,
        limitUsd:     organizations.aiSpendDailyLimitUsd,
        alertSentAt:  organizations.aiSpendAlertSentAt,
      })
      .from(organizations)
      .where(eq(organizations.isActive, true));

    const todayOrgSpendRows = await db
      .select({
        orgId:   apiUsageLog.orgId,
        total:   sql<number>`coalesce(sum(${apiUsageLog.costUsd}), 0)`,
      })
      .from(apiUsageLog)
      .where(
        and(
          gte(apiUsageLog.createdAt, todayStart),
          sql`${apiUsageLog.createdAt} < ${todayEnd}`,
        )
      )
      .groupBy(apiUsageLog.orgId);

    const spendByOrg = new Map(todayOrgSpendRows.map(r => [r.orgId, Number(r.total)]));

    const perOrgToday = orgList.map(org => ({
      id:          org.id,
      name:        org.name,
      email:       org.email,
      limitUsd:    org.limitUsd ?? null,
      todaySpend:  spendByOrg.get(org.id) ?? 0,
      alertSentAt: org.alertSentAt ?? null,
    }));


    const byServiceAndFeature = await db
      .select({
        service:           apiUsageLog.service,
        model:             apiUsageLog.model,
        feature:           apiUsageLog.feature,
        totalCalls:        sql<number>`sum(${apiUsageLog.apiCalls})`,
        totalInputTokens:  sql<number>`sum(${apiUsageLog.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${apiUsageLog.outputTokens})`,
        totalCostUsd:      sql<number>`sum(${apiUsageLog.costUsd})`,
      })
      .from(apiUsageLog)
      .groupBy(apiUsageLog.service, apiUsageLog.model, apiUsageLog.feature)
      .orderBy(sql`sum(${apiUsageLog.costUsd}) desc`);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const daily = await db
      .select({
        date:         sql<string>`date(${apiUsageLog.createdAt})`,
        service:      apiUsageLog.service,
        totalCostUsd: sql<number>`sum(${apiUsageLog.costUsd})`,
        totalCalls:   sql<number>`sum(${apiUsageLog.apiCalls})`,
      })
      .from(apiUsageLog)
      .where(gte(apiUsageLog.createdAt, thirtyDaysAgo))
      .groupBy(sql`date(${apiUsageLog.createdAt})`, apiUsageLog.service)
      .orderBy(sql`date(${apiUsageLog.createdAt}) asc`);

    const recent = await db
      .select()
      .from(apiUsageLog)
      .orderBy(desc(apiUsageLog.createdAt))
      .limit(100);

    // Platform activity counters
    const [
      auditRunsCount,
      outreachEmailsCount,
      leadsCount,
      leadBankCount,
      apolloEnrichmentsCount,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(auditRuns),
      db.select({ count: sql<number>`count(*)` }).from(outreachEmails),
      db.select({ count: sql<number>`count(*)` }).from(leads),
      db.select({ count: sql<number>`count(*)` }).from(leadBank),
      db.select({ total: sql<number>`coalesce(sum(${apiUsageLog.apiCalls}), 0)` })
        .from(apiUsageLog)
        .where(eq(apiUsageLog.service, "apollo")),
    ]);

    res.json({
      summary: totalRow ?? { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalApiCalls: 0 },
      byServiceAndFeature,
      daily,
      recent,
      perOrgToday,
      platformStats: {
        auditsDone:          Number(auditRunsCount[0]?.count)         || 0,
        reportsGenerated:    Number(outreachEmailsCount[0]?.count)    || 0,
        leadsFetched:        Number(leadsCount[0]?.count)             || 0,
        leadBankSize:        Number(leadBankCount[0]?.count)          || 0,
        leadsEnrichedViaApi: Number(apolloEnrichmentsCount[0]?.total) || 0,
      },
    });
  } catch (err) {
    logger.error({ err }, "api-usage endpoint error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

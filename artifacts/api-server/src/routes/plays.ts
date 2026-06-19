/**
 * Plays API Routes — mounted at /plays in routes/index.ts
 * GET    /api/plays             — list all plays for authenticated org
 * POST   /api/plays             — create a new play
 * GET    /api/plays/:id         — get single play
 * PATCH  /api/plays/:id         — update a play
 * POST   /api/plays/:id/archive — archive a play (set status = archived)
 * DELETE /api/plays/:id         — delete a play
 * GET    /api/plays/:id/stats   — lead count + funnel stats for a play
 */

import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { plays, signalConfigs, icps } from "@workspace/db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { draftPlayFromIntent, suggestSignalPhrases } from "../lib/playDrafter";
import { runSinglePlay } from "../lib/signal/crawlOrchestrator";

const router = Router();

// ── GET /api/plays ─────────────────────────────────────────────────────────────
router.get("/plays", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const status = (req.query.status as string | undefined) ?? null;

  try {
    const conditions = [eq(plays.orgId, orgId)];
    if (status) conditions.push(eq(plays.status, status));

    const rows = await db
      .select()
      .from(plays)
      .where(and(...conditions))
      .orderBy(desc(plays.createdAt));

    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, "[PLAYS] list failed");
    res.status(500).json({ error: "Failed to fetch plays" });
  }
});

// ── POST /api/plays ────────────────────────────────────────────────────────────
router.post("/plays", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const userId = req.user!.userId;

  const {
    name,
    description,
    intentKeywords,
    icpIds,
    qualificationMode,
    scoutDailyBudget,
    collectPhone,
  } = req.body as {
    name?:               string;
    description?:        string;
    intentKeywords?:     string[];
    icpIds?:             number[];
    qualificationMode?:  string;
    scoutDailyBudget?:   number;
    collectPhone?:       boolean;
  };

  if (!name || !name.trim()) {
    res.status(400).json({ error: "Play name is required" });
    return;
  }

  try {
    const [play] = await db.insert(plays).values({
      orgId,
      userId,
      name:               name.trim(),
      description:        description ?? null,
      status:             "draft",
      intentKeywords:     intentKeywords ?? [],
      icpIds:             icpIds ?? [],
      qualificationMode:  qualificationMode ?? "manual",
      scoutDailyBudget:   scoutDailyBudget ?? 10,
      collectPhone:       collectPhone ?? false,
    }).returning();

    res.status(201).json({ success: true, data: play });
  } catch (err) {
    logger.error({ err }, "[PLAYS] create failed");
    res.status(500).json({ error: "Failed to create play" });
  }
});

// ── POST /api/plays/draft ──────────────────────────────────────────────────────
// Calls Claude Haiku to draft a Play from a one-sentence intent. Does NOT save.
router.post("/plays/draft", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const userId = req.user!.userId;
  const { intent } = req.body as { intent?: string };

  if (!intent || !intent.trim()) {
    res.status(400).json({ error: "intent is required" });
    return;
  }

  try {
    const existingIcps = await db
      .select({
        id:          icps.id,
        name:        icps.name,
        markets:     icps.markets,
        industries:  icps.industries,
        roles:       icps.roles,
        companySize: icps.companySize,
      })
      .from(icps)
      .where(and(eq(icps.orgId, orgId), eq(icps.active, true)));

    const draft = await draftPlayFromIntent(intent.trim(), existingIcps, orgId);
    void userId; // available if needed for future audit logging

    res.json({ success: true, draft });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Draft failed";
    logger.error({ err }, "[PLAYS/DRAFT] draft failed");
    res.status(422).json({ error: msg });
  }
});

// ── POST /api/plays/draft/create ───────────────────────────────────────────────
// Creates a play row + signal_configs in one transaction.
// Optionally creates a new ICP first if createNewIcp=true and suggestedNewIcp is set.
router.post("/plays/draft/create", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const userId = req.user!.userId;

  const {
    name,
    description,
    intentKeywords,
    icpIds,
    qualificationMode,
    scoutDailyBudget,
    collectPhone,
    minScore,
    problemSignals,
    buyingSignals,
    competitorSignals,
    industryKeywords,
    targetSubreddits,
    createNewIcp,
    suggestedNewIcp,
  } = req.body as {
    name?:              string;
    description?:       string;
    intentKeywords?:    string[];
    icpIds?:            number[];
    qualificationMode?: string;
    scoutDailyBudget?:  number;
    collectPhone?:      boolean;
    minScore?:          number;
    problemSignals?:    string[];
    buyingSignals?:     string[];
    competitorSignals?: string[];
    industryKeywords?:  string[];
    targetSubreddits?:  string[];
    createNewIcp?:      boolean;
    suggestedNewIcp?:   {
      name: string; markets: string[]; industries: string[]; roles: string[]; companySize: string;
    } | null;
  };

  if (!name || !name.trim()) {
    res.status(400).json({ error: "Play name is required" });
    return;
  }

  try {
    const playId = await db.transaction(async (tx) => {
      let finalIcpIds = Array.isArray(icpIds) ? icpIds : [];

      if (createNewIcp && suggestedNewIcp?.name) {
        const [newIcp] = await tx
          .insert(icps)
          .values({
            orgId,
            name:        suggestedNewIcp.name,
            markets:     suggestedNewIcp.markets     ?? [],
            industries:  suggestedNewIcp.industries  ?? [],
            roles:       suggestedNewIcp.roles        ?? [],
            companySize: suggestedNewIcp.companySize  ?? "",
            filters:     {},
            active:      true,
          })
          .returning({ id: icps.id });

        if (newIcp) finalIcpIds = [...finalIcpIds, newIcp.id];
      }

      const [play] = await tx
        .insert(plays)
        .values({
          orgId,
          userId,
          name:               name.trim(),
          description:        description ?? null,
          status:             "draft",
          intentKeywords:     intentKeywords     ?? [],
          icpIds:             finalIcpIds,
          qualificationMode:  qualificationMode  ?? "manual",
          scoutDailyBudget:   scoutDailyBudget   ?? 10,
          collectPhone:       collectPhone        ?? false,
        })
        .returning({ id: plays.id });

      await tx
        .insert(signalConfigs)
        .values({
          playId:           play.id,
          orgId,
          minScore:         minScore          ?? 50,
          problemSignals:   problemSignals    ?? [],
          buyingSignals:    buyingSignals     ?? [],
          competitorSignals: competitorSignals ?? [],
          industryKeywords: industryKeywords  ?? [],
          targetSubreddits: targetSubreddits  ?? [],
        });

      return play.id;
    });

    res.status(201).json({ success: true, data: { playId } });
  } catch (err) {
    logger.error({ err }, "[PLAYS/DRAFT] create failed");
    res.status(500).json({ error: "Failed to create play" });
  }
});

// ── GET /api/plays/:id ─────────────────────────────────────────────────────────
router.get("/plays/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) {
    res.status(400).json({ error: "Invalid play ID" });
    return;
  }

  try {
    const [play] = await db
      .select()
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!play) {
      res.status(404).json({ error: "Play not found" });
      return;
    }

    res.json({ success: true, data: play });
  } catch (err) {
    logger.error({ err }, "[PLAYS] get failed");
    res.status(500).json({ error: "Failed to fetch play" });
  }
});

// ── PATCH /api/plays/:id ───────────────────────────────────────────────────────
router.patch("/plays/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) {
    res.status(400).json({ error: "Invalid play ID" });
    return;
  }

  const {
    name,
    description,
    status,
    intentKeywords,
    icpIds,
    qualificationMode,
    scoutDailyBudget,
    collectPhone,
  } = req.body as {
    name?:               string;
    description?:        string;
    status?:             string;
    intentKeywords?:     string[];
    icpIds?:             number[];
    qualificationMode?:  string;
    scoutDailyBudget?:   number;
    collectPhone?:       boolean;
  };

  if (name !== undefined && !name.trim()) {
    res.status(400).json({ error: "Play name cannot be empty" });
    return;
  }

  const updates: Partial<typeof plays.$inferInsert> = { updatedAt: new Date() };
  if (name              !== undefined) updates.name               = name.trim();
  if (description       !== undefined) updates.description        = description;
  if (status            !== undefined) updates.status             = status;
  if (intentKeywords    !== undefined) updates.intentKeywords     = intentKeywords;
  if (icpIds            !== undefined) updates.icpIds             = icpIds;
  if (qualificationMode !== undefined) updates.qualificationMode  = qualificationMode;
  if (scoutDailyBudget  !== undefined) updates.scoutDailyBudget   = scoutDailyBudget;
  if (collectPhone      !== undefined) updates.collectPhone        = collectPhone;

  try {
    const [play] = await db
      .update(plays)
      .set(updates)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .returning();

    if (!play) {
      res.status(404).json({ error: "Play not found" });
      return;
    }

    res.json({ success: true, data: play });
  } catch (err) {
    logger.error({ err }, "[PLAYS] update failed");
    res.status(500).json({ error: "Failed to update play" });
  }
});

// ── POST /api/plays/:id/archive ────────────────────────────────────────────────
router.post("/plays/:id/archive", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) {
    res.status(400).json({ error: "Invalid play ID" });
    return;
  }

  try {
    const [play] = await db
      .update(plays)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .returning();

    if (!play) {
      res.status(404).json({ error: "Play not found" });
      return;
    }

    res.json({ success: true, data: play });
  } catch (err) {
    logger.error({ err }, "[PLAYS] archive failed");
    res.status(500).json({ error: "Failed to archive play" });
  }
});

// ── DELETE /api/plays/:id ──────────────────────────────────────────────────────
router.delete("/plays/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) {
    res.status(400).json({ error: "Invalid play ID" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .returning({ id: plays.id });

    if (!deleted) {
      res.status(404).json({ error: "Play not found" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[PLAYS] delete failed");
    res.status(500).json({ error: "Failed to delete play" });
  }
});

// ── GET /api/plays/:id/stats ───────────────────────────────────────────────────
router.get("/plays/:id/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) {
    res.status(400).json({ error: "Invalid play ID" });
    return;
  }

  try {
    const [playRow] = await db
      .select({ id: plays.id })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!playRow) {
      res.status(404).json({ error: "Play not found" });
      return;
    }

    const statsRows = await db.execute(sql`
      SELECT
        COUNT(*)::int                                                           AS total_leads,
        COUNT(*) FILTER (WHERE status = 'contacted')::int                      AS contacted,
        COUNT(*) FILTER (WHERE status = 'qualified')::int                      AS qualified,
        COUNT(*) FILTER (WHERE status = 'meeting_booked')::int                 AS meetings
      FROM play_leads
      WHERE play_id = ${playId}
    `);

    const stats = ((statsRows as unknown as { rows: Record<string, number>[] }).rows)[0] ?? {};

    res.json({
      success:    true,
      data: {
        totalLeads: stats.total_leads ?? 0,
        contacted:  stats.contacted   ?? 0,
        qualified:  stats.qualified   ?? 0,
        meetings:   stats.meetings    ?? 0,
      },
    });
  } catch (err) {
    logger.error({ err }, "[PLAYS] stats failed");
    res.status(500).json({ error: "Failed to fetch play stats" });
  }
});

// ── GET /api/plays/:id/full ────────────────────────────────────────────────────
router.get("/plays/:id/full", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) {
    res.status(400).json({ error: "Invalid play ID" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [play] = await tx
        .select()
        .from(plays)
        .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
        .limit(1);

      if (!play) return null;

      let [sc] = await tx
        .select()
        .from(signalConfigs)
        .where(eq(signalConfigs.playId, playId))
        .limit(1);

      if (!sc) {
        [sc] = await tx
          .insert(signalConfigs)
          .values({ playId, orgId })
          .returning();
      }

      return { play, signalConfig: sc };
    });

    if (!result) {
      res.status(404).json({ error: "Play not found" });
      return;
    }

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, "[PLAYS] full get failed");
    res.status(500).json({ error: "Failed to fetch play" });
  }
});

// ── PUT /api/plays/:id/config ──────────────────────────────────────────────────
router.put("/plays/:id/config", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) {
    res.status(400).json({ error: "Invalid play ID" });
    return;
  }

  const {
    name,
    description,
    intentKeywords,
    icpIds,
    qualificationMode,
    scoutDailyBudget,
    collectPhone,
    minScore,
  } = req.body as {
    name?:               string;
    description?:        string;
    intentKeywords?:     string[];
    icpIds?:             number[];
    qualificationMode?:  string;
    scoutDailyBudget?:   number;
    collectPhone?:       boolean;
    minScore?:           number;
  };

  if (name !== undefined && !name.trim()) {
    res.status(400).json({ error: "Play name cannot be empty" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const playUpdates: Partial<typeof plays.$inferInsert> = { updatedAt: new Date() };
      if (name              !== undefined) playUpdates.name              = name.trim();
      if (description       !== undefined) playUpdates.description       = description;
      if (intentKeywords    !== undefined) playUpdates.intentKeywords    = intentKeywords;
      if (icpIds            !== undefined) playUpdates.icpIds            = icpIds;
      if (qualificationMode !== undefined) playUpdates.qualificationMode = qualificationMode;
      if (scoutDailyBudget  !== undefined) playUpdates.scoutDailyBudget  = scoutDailyBudget;
      if (collectPhone      !== undefined) playUpdates.collectPhone       = collectPhone;

      const [play] = await tx
        .update(plays)
        .set(playUpdates)
        .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
        .returning();

      if (!play) return null;

      let [sc] = await tx
        .select()
        .from(signalConfigs)
        .where(eq(signalConfigs.playId, playId))
        .limit(1);

      const scUpdates: Partial<typeof signalConfigs.$inferInsert> = {};
      if (minScore !== undefined) scUpdates.minScore = minScore;

      if (sc) {
        if (Object.keys(scUpdates).length > 0) {
          [sc] = await tx
            .update(signalConfigs)
            .set(scUpdates)
            .where(eq(signalConfigs.id, sc.id))
            .returning();
        }
      } else {
        [sc] = await tx
          .insert(signalConfigs)
          .values({ playId, orgId, ...scUpdates })
          .returning();
      }

      return { play, signalConfig: sc };
    });

    if (!result) {
      res.status(404).json({ error: "Play not found" });
      return;
    }

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, "[PLAYS] config update failed");
    res.status(500).json({ error: "Failed to update play config" });
  }
});

// ── POST /api/plays/:id/launch ─────────────────────────────────────────────────
router.post("/plays/:id/launch", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) {
    res.status(400).json({ error: "Invalid play ID" });
    return;
  }

  try {
    const [play] = await db
      .select()
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!play) {
      res.status(404).json({ error: "Play not found" });
      return;
    }

    const missing: string[] = [];
    if (!play.name || !play.name.trim()) missing.push("name");
    if (!play.icpIds || (play.icpIds as number[]).length === 0) missing.push("icp");
    if (!play.qualificationMode) missing.push("qualification");

    const [signalRow] = await db
      .select({ problemSignals: signalConfigs.problemSignals, buyingSignals: signalConfigs.buyingSignals })
      .from(signalConfigs)
      .where(eq(signalConfigs.playId, playId))
      .limit(1);

    const detectionCount =
      ((signalRow?.problemSignals as string[]) ?? []).length +
      ((signalRow?.buyingSignals  as string[]) ?? []).length;

    if (detectionCount === 0) missing.push("signals");

    if (missing.length > 0) {
      res.status(422).json({ error: "Incomplete play", missing });
      return;
    }

    const [launched] = await db
      .update(plays)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .returning();

    res.json({ success: true, data: launched });
  } catch (err) {
    logger.error({ err }, "[PLAYS] launch failed");
    res.status(500).json({ error: "Failed to launch play" });
  }
});

// ── GET /api/plays/:id/signals ─────────────────────────────────────────────────
router.get("/plays/:id/signals", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }

  try {
    const [play] = await db
      .select({ id: plays.id })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!play) { res.status(404).json({ error: "Play not found" }); return; }

    let [sc] = await db
      .select()
      .from(signalConfigs)
      .where(eq(signalConfigs.playId, playId))
      .limit(1);

    if (!sc) {
      [sc] = await db.insert(signalConfigs).values({ playId, orgId }).returning();
    }

    res.json({ success: true, data: sc });
  } catch (err) {
    logger.error({ err }, "[PLAYS] signals get failed");
    res.status(500).json({ error: "Failed to fetch signals" });
  }
});

// ── PUT /api/plays/:id/signals ─────────────────────────────────────────────────
router.put("/plays/:id/signals", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }

  const {
    problemSignals,
    buyingSignals,
    competitorSignals,
    industryKeywords,
    targetSubreddits,
    targetCompanies,
    minScore,
  } = req.body as Record<string, unknown>;

  function normalise(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return [...new Set((v as unknown[]).map(x => String(x).trim()).filter(Boolean))].slice(0, 50);
  }

  try {
    const [play] = await db
      .select({ id: plays.id })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!play) { res.status(404).json({ error: "Play not found" }); return; }

    const updates: Partial<typeof signalConfigs.$inferInsert> = {};
    if (problemSignals    !== undefined) updates.problemSignals    = normalise(problemSignals);
    if (buyingSignals     !== undefined) updates.buyingSignals     = normalise(buyingSignals);
    if (competitorSignals !== undefined) updates.competitorSignals = normalise(competitorSignals);
    if (industryKeywords  !== undefined) updates.industryKeywords  = normalise(industryKeywords);
    if (targetSubreddits  !== undefined) updates.targetSubreddits  = normalise(targetSubreddits);
    if (targetCompanies   !== undefined) updates.targetCompanies   = normalise(targetCompanies);
    if (minScore !== undefined && typeof minScore === "number") {
      updates.minScore = Math.max(0, Math.min(100, minScore));
    }

    const [existing] = await db
      .select({ id: signalConfigs.id })
      .from(signalConfigs)
      .where(eq(signalConfigs.playId, playId))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db
        .update(signalConfigs)
        .set(updates)
        .where(eq(signalConfigs.id, existing.id))
        .returning();
    } else {
      [result] = await db
        .insert(signalConfigs)
        .values({ playId, orgId, ...updates })
        .returning();
    }

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, "[PLAYS] signals save failed");
    res.status(500).json({ error: "Failed to save signals" });
  }
});

// ── POST /api/plays/:id/crawl/run ──────────────────────────────────────────────
router.post("/plays/:id/crawl/run", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const userId = req.user!.userId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }

  try {
    const [play] = await db
      .select({ id: plays.id, status: plays.status })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!play) { res.status(404).json({ error: "Play not found" }); return; }
    if (play.status !== "active") {
      res.status(422).json({ error: "Only active plays can be crawled" });
      return;
    }

    // Fire-and-forget — returns immediately
    void runSinglePlay(playId, orgId).catch(err =>
      logger.warn({ err, playId, userId }, "[PLAYS] background crawl error")
    );

    res.json({ success: true, message: "Crawl started" });
  } catch (err) {
    logger.error({ err }, "[PLAYS] crawl/run failed");
    res.status(500).json({ error: "Failed to start crawl" });
  }
});

// ── GET /api/plays/:id/signals/stats ───────────────────────────────────────────
router.get("/plays/:id/signals/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }

  try {
    const [playRow] = await db
      .select({ id: plays.id })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!playRow) { res.status(404).json({ error: "Play not found" }); return; }

    const statsResult = await db.execute(sql`
      SELECT
        COUNT(*)::int                                                            AS total,
        COUNT(*) FILTER (WHERE crawled_at >= NOW() - INTERVAL '24 hours')::int  AS last_24h,
        COUNT(*) FILTER (WHERE platform = 'reddit')::int                        AS reddit,
        COUNT(*) FILTER (WHERE platform = 'linkedin')::int                      AS linkedin,
        COUNT(*) FILTER (WHERE platform IN ('indeed','naukri'))::int             AS jobs,
        COUNT(*) FILTER (WHERE processed = true)::int                           AS processed,
        COUNT(*) FILTER (WHERE processed = false)::int                          AS unprocessed,
        MAX(crawled_at)                                                          AS last_crawled_at
      FROM signal_posts
      WHERE play_id = ${playId}
    `);

    const row = ((statsResult as unknown as { rows: Record<string, unknown>[] }).rows)[0] ?? {};

    res.json({
      success: true,
      data: {
        total:          Number(row.total          ?? 0),
        last24h:        Number(row.last_24h       ?? 0),
        bySource: {
          reddit:   Number(row.reddit   ?? 0),
          linkedin: Number(row.linkedin ?? 0),
          jobs:     Number(row.jobs     ?? 0),
        },
        processed:      Number(row.processed      ?? 0),
        unprocessed:    Number(row.unprocessed    ?? 0),
        lastCrawledAt:  row.last_crawled_at ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "[PLAYS] signals/stats failed");
    res.status(500).json({ error: "Failed to fetch signal stats" });
  }
});

// ── POST /api/plays/:id/funnel/process ────────────────────────────────────────
router.post("/plays/:id/funnel/process", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);
  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }

  try {
    const [play] = await db
      .select({ id: plays.id, status: plays.status })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!play) { res.status(404).json({ error: "Play not found" }); return; }

    const { processPendingSignals } = await import("../lib/signal/playFunnelProcessor");
    void processPendingSignals(25, playId).catch(err =>
      logger.warn({ err, playId }, "[PLAYS] background funnel error")
    );

    res.json({ success: true, message: "Funnel processing started" });
  } catch (err) {
    logger.error({ err }, "[PLAYS] funnel/process failed");
    res.status(500).json({ error: "Failed to start funnel" });
  }
});

// ── GET /api/plays/:id/funnel/stats ───────────────────────────────────────────
router.get("/plays/:id/funnel/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);
  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }

  try {
    const [playRow] = await db
      .select({ id: plays.id })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);
    if (!playRow) { res.status(404).json({ error: "Play not found" }); return; }

    const [stageStats, summary] = await Promise.all([
      db.execute(sql`
        SELECT stage,
               COUNT(*) FILTER (WHERE passed = true)::int  AS passed,
               COUNT(*) FILTER (WHERE passed = false)::int AS failed
        FROM funnel_events
        WHERE play_id = ${playId}
        GROUP BY stage
        ORDER BY MIN(created_at)
      `),
      db.execute(sql`
        SELECT
          COUNT(*)::int                                          AS total_leads,
          COUNT(*) FILTER (WHERE status = 'new')::int           AS new_leads,
          COUNT(*) FILTER (WHERE status = 'contacted')::int     AS contacted,
          COUNT(*) FILTER (WHERE enriched = true)::int          AS enriched,
          ROUND(AVG(lead_score))::int                           AS avg_score,
          MAX(created_at)                                        AS last_created_at
        FROM play_leads
        WHERE play_id = ${playId} AND org_id = ${orgId}
      `),
    ]);

    const rawStages = ((stageStats as unknown as { rows: { stage: string; passed: number; failed: number }[] }).rows) ?? [];
    const sum       = ((summary    as unknown as { rows: Record<string, unknown>[]                            }).rows)[0] ?? {};

    // Ordered stage list for conversion % calculation
    const STAGE_ORDER = [
      "qualified_intent",
      "org_identified",
      "org_found",
      "non_competitor",
      "icp_matched",
      "lead_created",
    ];

    // Build a map from stage name → row
    const stageMap = new Map(rawStages.map(s => [s.stage, s]));

    // Compute conversion %: passed[N] / passed[N-1] * 100
    const stages = STAGE_ORDER.map((stageName, idx) => {
      const s       = stageMap.get(stageName);
      const passed  = s ? Number(s.passed) : 0;
      const failed  = s ? Number(s.failed) : 0;
      const total   = passed + failed;

      // conversion = how many of the previous stage's passed leads also passed this stage
      let conversionPct = 0;
      if (idx === 0) {
        conversionPct = total > 0 ? Math.round((passed / total) * 100) : 0;
      } else {
        const prevName   = STAGE_ORDER[idx - 1]!;
        const prevPassed = stageMap.get(prevName);
        const prevCount  = prevPassed ? Number(prevPassed.passed) : 0;
        conversionPct = prevCount > 0 ? Math.round((passed / prevCount) * 100) : 0;
      }

      return { stage: stageName, passed, failed, total, conversionPct };
    }).filter(s => s.total > 0 || STAGE_ORDER.indexOf(s.stage) === 0);

    res.json({
      success: true,
      data: {
        stages,
        totalLeads:    Number(sum.total_leads   ?? 0),
        newLeads:      Number(sum.new_leads     ?? 0),
        contacted:     Number(sum.contacted     ?? 0),
        enriched:      Number(sum.enriched      ?? 0),
        avgScore:      Number(sum.avg_score     ?? 0),
        lastCreatedAt: sum.last_created_at ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "[PLAYS] funnel/stats failed");
    res.status(500).json({ error: "Failed to fetch funnel stats" });
  }
});

// ── GET /api/plays/:id/leads ──────────────────────────────────────────────────
router.get("/plays/:id/leads", async (req: Request, res: Response): Promise<void> => {
  const orgId   = req.user!.orgId;
  const playId  = Number(req.params.id);
  const limit   = Math.min(50, Number(req.query.limit  ?? 20));
  const offset  = Math.max(0,  Number(req.query.offset ?? 0));

  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }

  try {
    const [playRow] = await db
      .select({ id: plays.id })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);
    if (!playRow) { res.status(404).json({ error: "Play not found" }); return; }

    const rows = await db.execute(sql`
      SELECT
        pl.id,
        pl.company_name,
        pl.intent_summary,
        pl.lead_score,
        pl.score_breakdown,
        pl.key_contacts,
        pl.enriched,
        pl.status,
        pl.created_at,
        sp.post_url,
        sp.platform,
        sp.key_phrase,
        l.id        AS lead_id,
        l.first_name,
        l.last_name,
        l.email,
        l.website
      FROM play_leads pl
      LEFT JOIN signal_posts sp ON sp.id = pl.signal_post_id
      LEFT JOIN leads        l  ON l.id  = pl.lead_id
      WHERE pl.play_id = ${playId} AND pl.org_id = ${orgId}
      ORDER BY pl.lead_score DESC, pl.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRes = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM play_leads WHERE play_id = ${playId} AND org_id = ${orgId}
    `);
    const total = Number(((countRes as unknown as { rows: { total: number }[] }).rows)[0]?.total ?? 0);

    res.json({
      success: true,
      data:    (rows as unknown as { rows: unknown[] }).rows ?? [],
      total,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err }, "[PLAYS] leads list failed");
    res.status(500).json({ error: "Failed to fetch play leads" });
  }
});

// ── GET /api/plays/:id/leads/:leadId — single lead with full summary ──────────
router.get("/plays/:id/leads/:leadId", async (req: Request, res: Response): Promise<void> => {
  const orgId   = req.user!.orgId;
  const playId  = Number(req.params.id);
  const leadId  = Number(req.params.leadId);

  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }
  if (!leadId || isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  try {
    const [playRow] = await db
      .select({ id: plays.id })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);
    if (!playRow) { res.status(404).json({ error: "Play not found" }); return; }

    const rows = await db.execute(sql`
      SELECT
        pl.*,
        sp.body          AS post_body,
        sp.post_url,
        sp.platform,
        sp.matched_signal,
        sp.intent_type,
        sp.key_phrase,
        l.first_name,
        l.last_name,
        l.email,
        l.industry,
        l.company_size,
        l.website,
        i.name           AS icp_name
      FROM play_leads pl
      LEFT JOIN signal_posts sp ON sp.id = pl.signal_post_id
      LEFT JOIN leads         l  ON l.id  = pl.lead_id
      LEFT JOIN plays         p  ON p.id  = pl.play_id
      LEFT JOIN icps          i  ON i.id  = (pl.score_breakdown->>'matched_icp')::int
      WHERE pl.id = ${leadId} AND pl.play_id = ${playId} AND pl.org_id = ${orgId}
      LIMIT 1
    `);

    const lead = ((rows as unknown as { rows: unknown[] }).rows)[0];
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    res.json({ success: true, data: lead });
  } catch (err) {
    logger.error({ err }, "[PLAYS] single lead fetch failed");
    res.status(500).json({ error: "Failed to fetch play lead" });
  }
});

// ── POST /api/plays/:id/leads/:leadId/summary — regenerate on demand ──────────
router.post("/plays/:id/leads/:leadId/summary", async (req: Request, res: Response): Promise<void> => {
  const orgId   = req.user!.orgId;
  const playId  = Number(req.params.id);
  const leadId  = Number(req.params.leadId);

  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }
  if (!leadId || isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  try {
    // Verify play ownership
    const [playRow] = await db
      .select({ id: plays.id })
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);
    if (!playRow) { res.status(404).json({ error: "Play not found" }); return; }

    // Verify lead belongs to this play + org
    const checkRes = await db.execute(sql`
      SELECT id FROM play_leads WHERE id = ${leadId} AND play_id = ${playId} AND org_id = ${orgId} LIMIT 1
    `);
    const exists = ((checkRes as unknown as { rows: { id: number }[] }).rows)[0];
    if (!exists) { res.status(404).json({ error: "Lead not found" }); return; }

    // Lazy import to avoid circular deps at startup
    const { generateIntentSummary } = await import("../lib/signal/intentSummaryService");
    await generateIntentSummary(leadId);

    // Re-fetch updated lead with full context
    const rows = await db.execute(sql`
      SELECT
        pl.*,
        sp.body          AS post_body,
        sp.post_url,
        sp.platform,
        sp.matched_signal,
        sp.intent_type,
        sp.key_phrase,
        l.first_name,
        l.last_name,
        l.email,
        l.industry,
        l.company_size,
        l.website,
        i.name           AS icp_name
      FROM play_leads pl
      LEFT JOIN signal_posts sp ON sp.id = pl.signal_post_id
      LEFT JOIN leads         l  ON l.id  = pl.lead_id
      LEFT JOIN plays         p  ON p.id  = pl.play_id
      LEFT JOIN icps          i  ON i.id  = (pl.score_breakdown->>'matched_icp')::int
      WHERE pl.id = ${leadId} AND pl.play_id = ${playId} AND pl.org_id = ${orgId}
      LIMIT 1
    `);

    const lead = ((rows as unknown as { rows: unknown[] }).rows)[0];
    res.json({ success: true, data: lead });
  } catch (err) {
    logger.error({ err }, "[PLAYS] summary regenerate failed");
    res.status(500).json({ error: "Failed to regenerate summary" });
  }
});

// ── POST /api/plays/:id/signals/suggest ────────────────────────────────────────
router.post("/plays/:id/signals/suggest", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.user!.orgId;
  const playId = Number(req.params.id);

  if (!playId || isNaN(playId)) { res.status(400).json({ error: "Invalid play ID" }); return; }

  const { bucket } = req.body as { bucket?: string };
  const validBuckets = ["problem", "buying", "competitor", "keyword", "subreddit"] as const;
  type BucketType = typeof validBuckets[number];

  if (!bucket || !validBuckets.includes(bucket as BucketType)) {
    res.status(400).json({ error: "bucket must be one of: problem, buying, competitor, keyword, subreddit" });
    return;
  }

  try {
    const [play] = await db
      .select()
      .from(plays)
      .where(and(eq(plays.id, playId), eq(plays.orgId, orgId)))
      .limit(1);

    if (!play) { res.status(404).json({ error: "Play not found" }); return; }

    const icpRows = (play.icpIds as number[]).length > 0
      ? await db.select({ name: icps.name }).from(icps).where(inArray(icps.id, play.icpIds as number[]))
      : [];
    const icpNames = icpRows.map(r => r.name);

    const [sc] = await db
      .select()
      .from(signalConfigs)
      .where(eq(signalConfigs.playId, playId))
      .limit(1);

    const bucketFieldMap: Record<BucketType, keyof typeof sc> = {
      problem:    "problemSignals",
      buying:     "buyingSignals",
      competitor: "competitorSignals",
      keyword:    "industryKeywords",
      subreddit:  "targetSubreddits",
    };
    const existing = sc ? ((sc[bucketFieldMap[bucket as BucketType]] as string[]) ?? []) : [];

    const suggestions = await suggestSignalPhrases({
      play:     { name: play.name, description: play.description, intentKeywords: (play.intentKeywords as string[]) ?? [] },
      icpNames,
      bucket:   bucket as BucketType,
      existing,
      orgId,
    });

    res.json({ success: true, data: suggestions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Suggest failed";
    logger.error({ err }, "[PLAYS] signal suggest failed");
    res.status(422).json({ error: msg });
  }
});

export default router;


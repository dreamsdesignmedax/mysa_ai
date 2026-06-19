/**
 * Signal Feed API Routes — mounted at /signal-feed in routes/index.ts
 * GET  /                              — list classified signal posts
 * GET  /stats                         — counts by intent type, platform
 * POST /:id/add-to-pipeline           — promote signal post to lead (quota-guarded)
 * POST /:id/dismiss                   — mark signal as dismissed
 * GET  /google-maps-leads             — list google_maps platform signals
 * POST /google-maps-leads/import-all  — import google maps signals as leads (quota-guarded)
 * POST /run-google-maps               — trigger a fresh Google Maps scrape
 */

import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { leads, organizations } from "@workspace/db/schema";
import { sql, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { resourceLimitGuard } from "../middlewares/planGuard";
import { runDailyGoogleMapsScrape } from "../lib/signal/apifyService";

const router = Router();

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response): Promise<void> => {
  const q         = req.query as Record<string, string | undefined>;
  const page      = Math.max(1, Number(q.page ?? 1));
  const limit     = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
  const offset    = (page - 1) * limit;
  const platform  = q.platform    ?? null;
  const intent    = q.intent_type ?? null;
  const minConf   = Number(q.min_confidence ?? 0);
  const dismissed = q.dismissed === "true";

  const buyingFilter    = dismissed ? sql.raw("") : sql.raw("AND is_buying_signal = true");
  const dismissedFilter = dismissed
    ? sql.raw("AND dismissed_at IS NOT NULL")
    : sql.raw("AND dismissed_at IS NULL");
  const platformFilter  = platform ? sql`AND platform = ${platform}`   : sql.raw("");
  const intentFilter    = intent   ? sql`AND intent_type = ${intent}`  : sql.raw("");
  const confFilter      = minConf  ? sql`AND confidence >= ${minConf}` : sql.raw("");

  const [countRows, dataRows] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS total FROM signal_posts
      WHERE classified_at IS NOT NULL
      ${buyingFilter} ${dismissedFilter} ${platformFilter} ${intentFilter} ${confFilter}
    `),
    db.execute(sql`
      SELECT sp.id, sp.post_url, sp.platform, sp.title, sp.body, sp.author, sp.subreddit,
             sp.intent_type, sp.confidence, sp.is_buying_signal,
             sp.company_mentioned, sp.industry_hint, sp.budget_hint,
             sp.classifier_notes, sp.dismissed_at, sp.crawled_at, sp.classified_at,
             eq.status           AS entity_status,
             eq.resolved_email   AS entity_email,
             eq.resolved_role    AS entity_role,
             eq.resolved_location AS entity_location,
             eq.resolved_website AS entity_website,
             eq.resolved_name    AS entity_name
      FROM signal_posts sp
      LEFT JOIN signal_entity_queue eq ON eq.signal_post_id = sp.id
      WHERE sp.classified_at IS NOT NULL
      ${buyingFilter} ${dismissedFilter} ${platformFilter} ${intentFilter} ${confFilter}
      ORDER BY sp.confidence DESC, sp.crawled_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
  ]);

  const total = ((countRows as unknown as { rows: { total: number }[] }).rows)[0]?.total ?? 0;
  const data  = (dataRows  as unknown as { rows: unknown[] }).rows ?? [];

  res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// ── GET /stats ────────────────────────────────────────────────────────────────
router.get("/stats", async (_req: Request, res: Response): Promise<void> => {
  const [byIntent, byPlatform, totals, queueRow] = await Promise.all([
    db.execute(sql`
      SELECT intent_type, COUNT(*)::int AS count
      FROM signal_posts WHERE is_buying_signal = true AND dismissed_at IS NULL
      GROUP BY intent_type ORDER BY count DESC
    `),
    db.execute(sql`
      SELECT platform, COUNT(*)::int AS count
      FROM signal_posts GROUP BY platform ORDER BY count DESC
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int                                                   AS total_crawled,
        COUNT(*) FILTER (WHERE is_buying_signal = true)::int           AS total_signals,
        COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL)::int          AS dismissed,
        COUNT(*) FILTER (WHERE classified_at IS NULL)::int             AS pending_classification
      FROM signal_posts
    `),
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int  AS pending,
        COUNT(*) FILTER (WHERE status = 'done')::int     AS done,
        COUNT(*) FILTER (WHERE status = 'failed')::int   AS failed
      FROM signal_entity_queue
    `),
  ]);

  const intentRows   = (byIntent   as unknown as { rows: unknown[] }).rows ?? [];
  const platformRows = (byPlatform as unknown as { rows: unknown[] }).rows ?? [];
  const totalRow     = ((totals    as unknown as { rows: Record<string, number>[] }).rows)[0] ?? {};
  const queue        = ((queueRow  as unknown as { rows: Record<string, number>[] }).rows)[0] ?? {};

  res.json({
    totalCrawled:          totalRow.total_crawled          ?? 0,
    totalSignals:          totalRow.total_signals          ?? 0,
    dismissed:             totalRow.dismissed              ?? 0,
    pendingClassification: totalRow.pending_classification ?? 0,
    byIntentType:          intentRows,
    byPlatform:            platformRows,
    entityQueue:           queue,
  });
});

// ── GET /google-maps-leads ────────────────────────────────────────────────────
router.get("/google-maps-leads", async (req: Request, res: Response): Promise<void> => {
  const q      = req.query as Record<string, string | undefined>;
  const page   = Math.max(1, Number(q.page ?? 1));
  const limit  = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
  const offset = (page - 1) * limit;

  const [countRows, dataRows] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS total FROM signal_posts WHERE platform = 'google_maps'`),
    db.execute(sql`
      SELECT id, title, body, post_url, raw_json, subreddit AS search_query, crawled_at, dismissed_at
      FROM signal_posts
      WHERE platform = 'google_maps'
      ORDER BY crawled_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
  ]);

  const total = ((countRows as unknown as { rows: { total: number }[] }).rows)[0]?.total ?? 0;
  const data  = (dataRows  as unknown as { rows: unknown[] }).rows ?? [];

  res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// ── POST /google-maps-leads/import-all ───────────────────────────────────────
router.post("/google-maps-leads/import-all", resourceLimitGuard("leads"), async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;

  const rows = await db.execute(sql`
    SELECT id, title, body, post_url, raw_json, confidence
    FROM signal_posts
    WHERE platform = 'google_maps' AND dismissed_at IS NULL
    ORDER BY crawled_at DESC
    LIMIT 100
  `);

  const posts = (rows as unknown as { rows: Record<string, string | number | null>[] }).rows ?? [];
  let imported = 0;
  let skipped  = 0;

  for (const post of posts) {
    let parsed: Record<string, string | number | undefined> = {};
    try { parsed = JSON.parse(String(post.raw_json ?? "{}")) as Record<string, string | number | undefined>; } catch { /* ok */ }

    const company  = String(post.title ?? "Unknown");
    const email    = `gmaps.${String(post.id)}.${Date.now()}@noemail.mysa.internal`;
    const postUrl  = String(post.post_url ?? "");
    const strength = Math.round(Number(post.confidence ?? 0) * 100);

    try {
      await db.transaction(async (tx) => {
        const [created] = await tx.insert(leads).values({
          orgId,
          firstName:   "Google Maps",
          lastName:    "Lead",
          email,
          company,
          country:     "",
          designation: String(parsed.category ?? ""),
          industry:    "",
          website:     parsed.website ? String(parsed.website) : undefined,
          phone:       parsed.phone   ? String(parsed.phone)   : undefined,
          source:      "signal_detection",
          notes:       `Discovered via Google Maps. Address: ${String(parsed.address ?? "")}. Rating: ${String(parsed.rating ?? "")}.`,
          tags:        [],
        }).returning({ id: leads.id });

        if (created?.id) {
          await tx.execute(sql`
            UPDATE leads SET
              signal_type        = 'google_maps',
              signal_strength    = ${strength},
              original_post_url  = ${postUrl},
              original_post_text = ${String(post.body ?? "").slice(0, 1000)},
              signal_detected_at = NOW()
            WHERE id = ${created.id}
          `);
        }
      });

      await db.execute(sql`UPDATE signal_posts SET dismissed_at = NOW() WHERE id = ${Number(post.id)}`);
      imported++;
    } catch {
      skipped++;
    }
  }

  if (imported > 0) {
    void db.update(organizations)
      .set({ leadsUsedThisMonth: sql`leads_used_this_month + ${imported}` })
      .where(eq(organizations.id, orgId))
      .execute()
      .catch(() => {});
  }

  res.json({ imported, skipped });
});

// ── POST /run-google-maps ─────────────────────────────────────────────────────
router.post("/run-google-maps", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;

  // Agency-only: Google Maps scraping is a high-cost data-fetch feature
  const orgRows = await db.select({ plan: organizations.plan })
    .from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const plan = orgRows[0]?.plan ?? "trial";
  if (plan !== "agency") {
    res.status(403).json({
      error: "PLAN_LIMIT",
      message: "Google Maps scraping requires an Agency plan.",
      upgrade_url: "/billing",
    });
    return;
  }

  res.json({ ok: true, message: "Google Maps scrape triggered in background" });

  runDailyGoogleMapsScrape()
    .then((result) => logger.info(result, "[SIGNAL FEED] Manual Google Maps scrape complete"))
    .catch((err)   => logger.error({ err }, "[SIGNAL FEED] Manual Google Maps scrape failed"));
});

// ── POST /:id/add-to-pipeline ─────────────────────────────────────────────────
router.post("/:id/add-to-pipeline", resourceLimitGuard("leads"), async (req: Request, res: Response): Promise<void> => {
  const postId = Number(req.params.id);
  const orgId  = req.user!.orgId;

  if (!postId || isNaN(postId)) { res.status(400).json({ error: "Invalid signal post ID" }); return; }

  const postRows = await db.execute(sql`
    SELECT id, title, body, post_url, company_mentioned, industry_hint, platform, intent_type, confidence
    FROM signal_posts WHERE id = ${postId} LIMIT 1
  `);
  const post = ((postRows as unknown as { rows: Record<string, string | number | null>[] }).rows)[0];
  if (!post) { res.status(404).json({ error: "Signal post not found" }); return; }

  const { firstName, lastName, email, company } = req.body as {
    firstName?: string; lastName?: string; email?: string; company?: string;
  };

  const resolvedCompany   = company   ?? String(post.company_mentioned ?? "Unknown Company");
  const resolvedFirstName = firstName ?? "Signal";
  const resolvedLastName  = lastName  ?? "Lead";
  const resolvedEmail     = email     ?? `signal.${postId}.${Date.now()}@noemail.mysa.internal`;
  const platform          = String(post.platform  ?? "reddit");
  const intentType        = String(post.intent_type ?? "other");
  const confidence        = Number(post.confidence ?? 0);
  const strength          = Math.round(confidence * 100);
  const postUrl           = String(post.post_url ?? "");
  const postBody          = String(post.body     ?? "").slice(0, 1000);

  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(leads).values({
        orgId,
        firstName:   resolvedFirstName,
        lastName:    resolvedLastName,
        email:       resolvedEmail,
        company:     resolvedCompany,
        country:     "",
        designation: "",
        industry:    String(post.industry_hint ?? ""),
        source:      "signal_detection",
        notes:       `Signal from ${platform}. Source: ${postUrl}.\n${postBody}`,
        tags:        [],
      }).returning();

      if (row?.id) {
        await tx.execute(sql`
          UPDATE leads SET
            signal_type        = ${intentType},
            signal_strength    = ${strength},
            original_post_url  = ${postUrl},
            original_post_text = ${postBody},
            signal_detected_at = NOW()
          WHERE id = ${row.id}
        `);
      }
      return row;
    });

    void db.update(organizations)
      .set({ leadsUsedThisMonth: sql`leads_used_this_month + 1` })
      .where(eq(organizations.id, orgId))
      .execute()
      .catch(() => {});

    await db.execute(sql`UPDATE signal_posts SET dismissed_at = NOW() WHERE id = ${postId}`);
    res.json({ ok: true, lead: created });
  } catch (err) {
    logger.error({ err }, "[SIGNAL FEED] add-to-pipeline failed");
    res.status(500).json({ error: "Failed to create lead from signal" });
  }
});

// ── POST /:id/dismiss ─────────────────────────────────────────────────────────
router.post("/:id/dismiss", async (req: Request, res: Response): Promise<void> => {
  const postId = Number(req.params.id);
  if (!postId || isNaN(postId)) { res.status(400).json({ error: "Invalid signal post ID" }); return; }

  await db.execute(sql`UPDATE signal_posts SET dismissed_at = NOW() WHERE id = ${postId}`);
  res.json({ ok: true });
});

export default router;

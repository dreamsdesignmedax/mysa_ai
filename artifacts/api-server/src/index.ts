import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { runOrchestratorTick, sendDailyReport, getOrgOrchestratorStatus, initOrchestratorState, initEmailFailureState } from "./routes/sales-agent";
import { runLeadHunterNightly } from "./routes/agents";
import { db } from "./lib/db";
import { icps, organizations } from "@workspace/db/schema";
import { eq, isNotNull, and as dbAnd, lt, sql as drizzleSql, inArray, isNull, gt } from "drizzle-orm";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { sendTrialExpiredEmail, sendTrialNudgeEmail } from "./lib/trialEmail";
import { runRepairAiStatus } from "./migrate-repair-ai-status";
import { runRepairLeadStatuses } from "./migrate-repair-lead-statuses";
import { runSyncMissingLeads } from "./migrate-sync-missing-leads";
import { runBackfillVerifiedUsers } from "./migrate-backfill-verified-users";
import { runSchemaColumnMigrations } from "./migrate-schema-columns";
import { runSeedDreamsdesignAccount } from "./migrate-seed-dreamsdesign";
import { crawlReddit } from "./lib/signal/redditCrawler";
import { classifyPendingSignals } from "./lib/signal/signalClassifier";
import { runDailyGoogleMapsScrape, scrapeJobBoards } from "./lib/signal/apifyService";
import { processEntityQueue } from "./lib/signal/entityResolver";
import { runAllActivePlays } from "./lib/signal/crawlOrchestrator";
import { processPendingSignals } from "./lib/signal/playFunnelProcessor";
import { generatePendingSummaries } from "./lib/signal/intentSummaryService";
import { checkAllOrgsAiSpendThresholds } from "./lib/logApiUsage";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// ── Process-level safety net ──────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

// ── Optional Stripe initialization ───────────────────────────────────────────
async function initStripe() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) { logger.warn("DATABASE_URL not set — skipping Stripe init"); return; }
  try {
    logger.info("Stripe: running migrations…");
    await runMigrations({ databaseUrl, schema: "stripe" } as Parameters<typeof runMigrations>[0]);
    logger.info("Stripe: schema ready");

    const stripeSync = await getStripeSync();
    const webhookBaseUrl = `https://${(process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]}`;
    await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);
    logger.info("Stripe: webhook configured");

    stripeSync.syncBackfill()
      .then(() => logger.info("Stripe: backfill complete"))
      .catch((err) => logger.warn({ err }, "Stripe: backfill failed (non-fatal)"));
  } catch (err) {
    logger.warn({ err }, "Stripe: initialization skipped (connect via Integrations tab)");
  }
}

app.listen(port, async (err) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }
  logger.info({ port }, "Server listening");

  // ── Schema column migrations (MUST run first, raw SQL, idempotent) ─────────
  try {
    const schemaMigResult = await runSchemaColumnMigrations();
    logger.info(schemaMigResult, "Schema column migrations complete");
  } catch (err) {
    logger.error({ err }, "Schema column migrations failed — server may be unstable");
  }

  // ── Restore persisted agent state ─────────────────────────────────────────
  try {
    await initOrchestratorState();
  } catch (err) {
    logger.warn({ err }, "Agent Hub: orchestrator state restore failed (non-fatal)");
  }
  try {
    await initEmailFailureState();
  } catch (err) {
    logger.warn({ err }, "Agent Hub: email failure state restore failed (non-fatal)");
  }

  // ── One-time seed: Dreamsdesign account → production (idempotent) ───────────
  try {
    const seedResult = await runSeedDreamsdesignAccount();
    logger.info(seedResult, "Dreamsdesign account seed");
  } catch (err) {
    logger.warn({ err }, "Dreamsdesign account seed failed (non-fatal)");
  }

  // Stripe init (non-fatal if not connected)
  await initStripe();

  // ── Backfill isVerified for pre-verification-era accounts (idempotent) ────
  runBackfillVerifiedUsers()
    .then((summary) => {
      logger.info(summary, "Email verification backfill complete");
    })
    .catch((err) => {
      logger.warn({ err }, "Email verification backfill failed (non-fatal)");
    });

  // ── AI Status Repair (idempotent, runs in background) ────────────────────
  runRepairAiStatus()
    .then((summary) => {
      logger.info(summary, "AI status repair complete");
    })
    .catch((err) => {
      logger.warn({ err }, "AI status repair failed (non-fatal)");
    });

  // ── Lead Status Migration (old status names → new names, idempotent) ─────
  runRepairLeadStatuses()
    .then((summary) => {
      logger.info(summary, "Lead status migration complete");
    })
    .catch((err) => {
      logger.warn({ err }, "Lead status migration failed (non-fatal)");
    });

  // ── Sync missing leads from dev snapshot → production (idempotent) ────────
  runSyncMissingLeads()
    .then((summary) => {
      logger.info(summary, "Lead sync complete");
    })
    .catch((err) => {
      logger.warn({ err }, "Lead sync failed (non-fatal)");
    });

  // ── Autonomous Agent Cron Jobs ────────────────────────────────────────────
  // Run orchestrator tick every 30 minutes — one tick per active org to honour per-org toggles
  cron.schedule("*/30 * * * *", async () => {
    logger.info("Sales Brain: orchestrator tick starting");
    try {
      const activeOrgs = await db
        .selectDistinct({ orgId: icps.orgId })
        .from(icps)
        .where(dbAnd(eq(icps.active, true), isNotNull(icps.orgId)));

      for (const { orgId } of activeOrgs) {
        if (!orgId) continue;
        const state = getOrgOrchestratorStatus(orgId);
        if (!state.brainActive) {
          logger.info({ orgId }, "Sales Brain: tick skipped (brain disabled for org)");
          continue;
        }
        const result = await runOrchestratorTick(orgId);
        logger.info({ orgId, ...result }, "Sales Brain: orchestrator tick complete");
      }
    } catch (err) {
      logger.error({ err }, "Sales Brain: orchestrator tick failed");
    }
  });

  // Lead Hunter nightly at 19:30 UTC = 01:00 AM IST
  cron.schedule("30 19 * * *", async () => {
    logger.info("Lead Hunter: nightly auto-hunt starting");
    try {
      const result = await runLeadHunterNightly();
      logger.info(result, "Lead Hunter: nightly auto-hunt complete");
    } catch (err) {
      logger.error({ err }, "Lead Hunter: nightly auto-hunt failed");
    }
  });

  // Daily report at 03:00 UTC = 08:30 AM IST
  cron.schedule("0 3 * * *", async () => {
    logger.info("Sales Brain: sending daily report");
    try {
      const ok = await sendDailyReport();
      logger.info({ ok }, "Sales Brain: daily report sent");
    } catch (err) {
      logger.error({ err }, "Sales Brain: daily report failed");
    }
  });

  logger.info("Sales Brain: cron jobs scheduled (30-min tick + 01:00 IST Lead Hunter + 08:30 IST daily report)");

  // ── Trial expiry checker — runs daily at 22:30 UTC = 04:00 AM IST ─────────
  cron.schedule("30 22 * * *", async () => {
    logger.info("Billing: checking trial expirations");
    try {
      const now = new Date();
      const expiredOrgs = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(
          dbAnd(
            eq(organizations.plan, "trial"),
            eq(organizations.trialExpired, false),
            lt(organizations.trialEndsAt, now),
          )
        );

      for (const org of expiredOrgs) {
        try {
          await db.update(organizations)
            .set({ trialExpired: true, updatedAt: drizzleSql`now()` })
            .where(eq(organizations.id, org.id));

          // Notify the org owner
          const ownerResult = await db.execute(drizzleSql`
            SELECT email, first_name FROM users WHERE org_id = ${org.id} AND role = 'owner' LIMIT 1
          `);
          const ownerRow = ownerResult.rows?.[0] ?? (Array.isArray(ownerResult) ? (ownerResult as unknown[])[0] : undefined);
          const owner = ownerRow as { email?: string; first_name?: string } | undefined;
          if (owner?.email) {
            const leadsCountResult = await db.execute(drizzleSql`SELECT COUNT(*)::int AS count FROM leads WHERE org_id = ${org.id}`);
            const leadsCountRow = leadsCountResult.rows?.[0] ?? (Array.isArray(leadsCountResult) ? (leadsCountResult as unknown[])[0] : undefined);
            const leadsCount = (leadsCountRow as { count?: number })?.count ?? 0;
            await sendTrialExpiredEmail(owner.email, owner.first_name ?? "there", leadsCount).catch(() => {});
          }

          logger.info({ orgId: org.id }, "Billing: trial expired — marked + notified");
        } catch (orgErr) {
          logger.warn({ orgErr, orgId: org.id }, "Billing: failed to process trial expiry for org");
        }
      }

      logger.info({ count: expiredOrgs.length }, "Billing: trial expiry check complete");
    } catch (err) {
      logger.error({ err }, "Billing: trial expiry cron failed");
    }
  });

  // ── Trial day-5 nudge — runs daily at 22:45 UTC = 04:15 AM IST ───────────
  // Fires once per org when 1–3 days remain (trialNudgeSentAt IS NULL guards duplicates)
  cron.schedule("45 22 * * *", async () => {
    logger.info("Billing: checking for trial day-5 nudge candidates");
    try {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

      const nudgeCandidates = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(
          dbAnd(
            eq(organizations.plan, "trial"),
            eq(organizations.trialExpired, false),
            isNull(organizations.trialNudgeSentAt),
            gt(organizations.trialEndsAt, in24h),
            lt(organizations.trialEndsAt, in72h),
          )
        );

      for (const org of nudgeCandidates) {
        try {
          const ownerResult = await db.execute(drizzleSql`
            SELECT email, first_name FROM users WHERE org_id = ${org.id} AND role = 'owner' LIMIT 1
          `);
          const ownerRow = ownerResult.rows?.[0] ?? (Array.isArray(ownerResult) ? (ownerResult as unknown[])[0] : undefined);
          const owner = ownerRow as { email?: string; first_name?: string } | undefined;

          if (owner?.email) {
            const leadsCountResult = await db.execute(drizzleSql`SELECT COUNT(*)::int AS count FROM leads WHERE org_id = ${org.id}`);
            const leadsCountRow = leadsCountResult.rows?.[0] ?? (Array.isArray(leadsCountResult) ? (leadsCountResult as unknown[])[0] : undefined);
            const leadsCount = (leadsCountRow as { count?: number })?.count ?? 0;
            await sendTrialNudgeEmail(owner.email, owner.first_name ?? "there", leadsCount);
          }

          await db.update(organizations)
            .set({ trialNudgeSentAt: new Date(), updatedAt: drizzleSql`now()` })
            .where(eq(organizations.id, org.id));

          logger.info({ orgId: org.id }, "Billing: trial day-5 nudge sent");
        } catch (orgErr) {
          logger.warn({ orgErr, orgId: org.id }, "Billing: failed to send trial nudge for org");
        }
      }

      logger.info({ count: nudgeCandidates.length }, "Billing: trial day-5 nudge check complete");
    } catch (err) {
      logger.error({ err }, "Billing: trial day-5 nudge cron failed");
    }
  });

  // ── Monthly usage counter reset — runs at 00:01 UTC on 1st of each month ──
  cron.schedule("1 0 1 * *", async () => {
    logger.info("Billing: resetting monthly usage counters");
    try {
      await db.update(organizations).set({
        leadsUsedThisMonth:  0,
        emailsUsedThisMonth: 0,
        auditsUsedThisMonth: 0,
        updatedAt: drizzleSql`now()`,
      }).where(inArray(organizations.plan, ["solo", "growth", "agency"]));
      logger.info("Billing: monthly usage counters reset");
    } catch (err) {
      logger.error({ err }, "Billing: monthly counter reset failed");
    }
  });

  logger.info("Billing: trial expiry + day-5 nudge + monthly counter reset crons scheduled");

  // ── Signal Intelligence Cron Jobs ─────────────────────────────────────────
  // Reddit crawler — every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    logger.info("Signal Intelligence: Reddit crawl starting");
    try {
      const result = await crawlReddit();
      logger.info(result, "Signal Intelligence: Reddit crawl complete");
    } catch (err) {
      logger.error({ err }, "Signal Intelligence: Reddit crawl failed");
    }
  });

  // Signal classifier — every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await classifyPendingSignals();
      if (result.classified > 0) {
        logger.info(result, "Signal Intelligence: classifier batch complete");
      }
    } catch (err) {
      logger.error({ err }, "Signal Intelligence: classifier failed");
    }
  });

  // Entity resolver — every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    try {
      // Use org 1 (Dreamsdesign) as default — multi-org support via separate per-org config if needed
      const result = await processEntityQueue(1);
      if (result.processed > 0) {
        logger.info(result, "Signal Intelligence: entity resolver batch complete");
      }
    } catch (err) {
      logger.error({ err }, "Signal Intelligence: entity resolver failed");
    }
  });

  // Job boards scraper — daily at 01:30 AM UTC
  cron.schedule("30 1 * * *", async () => {
    logger.info("Signal Intelligence: job boards scrape starting");
    try {
      const results = await scrapeJobBoards();
      logger.info({ count: results.length }, "Signal Intelligence: job boards scrape complete");
    } catch (err) {
      logger.error({ err }, "Signal Intelligence: job boards scrape failed");
    }
  });

  // Google Maps scraper — daily at 02:30 AM UTC
  cron.schedule("30 2 * * *", async () => {
    logger.info("Signal Intelligence: Google Maps scrape starting");
    try {
      const result = await runDailyGoogleMapsScrape();
      logger.info(result, "Signal Intelligence: Google Maps scrape complete");
    } catch (err) {
      logger.error({ err }, "Signal Intelligence: Google Maps scrape failed");
    }
  });

  logger.info("Signal Intelligence: 5 cron jobs scheduled (Reddit 15min, Classifier 5min, Resolver 10min, Jobs 01:30 UTC, GMaps 02:30 UTC)");

  // ── Per-play signal crawlers (Module 5) ───────────────────────────────────
  // Reddit: every 20 min for all active plays
  cron.schedule("*/20 * * * *", async () => {
    try {
      await runAllActivePlays("reddit");
    } catch (err) {
      logger.error({ err }, "Play crawl: Reddit tick failed");
    }
  });

  // LinkedIn (Apify): every 6 hours for all active plays
  cron.schedule("0 */6 * * *", async () => {
    try {
      await runAllActivePlays("linkedin");
    } catch (err) {
      logger.error({ err }, "Play crawl: LinkedIn tick failed");
    }
  });

  // Job boards (Apify): daily at 01:30 UTC for all active plays
  cron.schedule("30 1 * * *", async () => {
    try {
      await runAllActivePlays("jobboards");
    } catch (err) {
      logger.error({ err }, "Play crawl: job-board tick failed");
    }
  });

  logger.info("Play crawlers: 3 cron jobs scheduled (Reddit 20min, LinkedIn 6h, Jobs 01:30 UTC)");

  // ── Per-play signal qualification funnel (Module 6) ───────────────────────
  // Runs every 5 minutes — processes up to 25 unprocessed per-play posts
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await processPendingSignals(25);
      if (result.processed > 0) {
        logger.info(result, "Play funnel: batch complete");
      }
    } catch (err) {
      logger.error({ err }, "Play funnel: batch failed");
    }
  });

  logger.info("Play funnel: cron job scheduled (every 5 min)");

  // ── AI spend threshold checker — runs daily at 04:30 UTC = 10:00 AM IST ────
  // Checks yesterday's spend for every org against their configured daily limit.
  cron.schedule("30 4 * * *", async () => {
    logger.info("AI Spend: checking daily spend thresholds");
    try {
      const result = await checkAllOrgsAiSpendThresholds();
      logger.info(result, "AI Spend: threshold check complete");
    } catch (err) {
      logger.error({ err }, "AI Spend: threshold check failed");
    }
  });

  logger.info("AI Spend: threshold alert cron scheduled (04:30 UTC daily)");

  // ── Intent summary generator (Module 7) ───────────────────────────────────
  // Runs every 5 minutes — fills intent_summary for up to 15 play_leads (Sonnet)
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await generatePendingSummaries(15);
      if (result.processed > 0) {
        logger.info(result, "Intent summary: batch complete");
      }
    } catch (err) {
      logger.error({ err }, "Intent summary: batch failed");
    }
  });
  logger.info("Intent summary: cron job scheduled (every 5 min, batch 15)");
});

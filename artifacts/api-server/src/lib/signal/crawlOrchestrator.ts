/**
 * Crawl Orchestrator
 * Loads all active plays with their signal_configs and runs
 * per-play Reddit + Apify crawlers.
 *
 * - Reddit: awaited (sequential, rate-limited inside crawler)
 * - Apify:  fire-and-forget (non-blocking background tasks)
 * - 1.5 s delay between plays to avoid hammering the DB or Reddit OAuth
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import { crawlPlayReddit } from "./playRedditCrawler";
import { runLinkedInCrawl, runJobBoardCrawl } from "./playApifyCrawler";

interface ActivePlayRow {
  id:                number;
  user_id:           number | null;
  buying_signals:    string[] | null;
  problem_signals:   string[] | null;
  competitor_signals: string[] | null;
  industry_keywords: string[] | null;
  target_subreddits: string[] | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function loadActivePlays(): Promise<ActivePlayRow[]> {
  const result = await db.execute(sql`
    SELECT
      p.id,
      p.user_id,
      sc.buying_signals,
      sc.problem_signals,
      sc.competitor_signals,
      sc.industry_keywords,
      sc.target_subreddits
    FROM plays p
    INNER JOIN signal_configs sc ON sc.play_id = p.id
    WHERE p.status = 'active'
    ORDER BY p.id
  `);
  return ((result as unknown as { rows: ActivePlayRow[] }).rows) ?? [];
}

/**
 * Run crawlers for ALL active plays.
 * Called by the scheduled cron jobs.
 */
export async function runAllActivePlays(mode: "reddit" | "linkedin" | "jobboards" = "reddit"): Promise<void> {
  let plays: ActivePlayRow[];

  try {
    plays = await loadActivePlays();
  } catch (err) {
    logger.error({ err }, "[CRAWL ORCH] Failed to load active plays");
    return;
  }

  if (plays.length === 0) {
    return; // No active plays — no-op
  }

  logger.info({ count: plays.length, mode }, "[CRAWL ORCH] Starting crawl for active plays");

  for (const row of plays) {
    const playRecord    = { id: row.id, userId: row.user_id };
    const signalConfig  = {
      buyingSignals:     row.buying_signals    ?? [],
      problemSignals:    row.problem_signals   ?? [],
      competitorSignals: row.competitor_signals ?? [],
      industryKeywords:  row.industry_keywords ?? [],
      targetSubreddits:  row.target_subreddits ?? [],
    };

    try {
      if (mode === "reddit") {
        const stats = await crawlPlayReddit(playRecord, signalConfig);
        logger.info({ playId: row.id, ...stats }, "[CRAWL ORCH] Reddit done for play");
      } else if (mode === "linkedin") {
        void runLinkedInCrawl(playRecord, signalConfig);
        logger.info({ playId: row.id }, "[CRAWL ORCH] LinkedIn crawl dispatched for play");
      } else if (mode === "jobboards") {
        void runJobBoardCrawl(playRecord, signalConfig);
        logger.info({ playId: row.id }, "[CRAWL ORCH] Job board crawl dispatched for play");
      }
    } catch (err) {
      logger.warn({ err, playId: row.id, mode }, "[CRAWL ORCH] Crawl failed for play — continuing with next");
    }

    await sleep(1500);
  }

  logger.info({ count: plays.length, mode }, "[CRAWL ORCH] All active plays processed");
}

/**
 * Run Reddit + Apify crawlers for a single play.
 * Called by the `POST /api/plays/:id/crawl/run` route.
 * Verifies play ownership (orgId) before proceeding.
 */
export async function runSinglePlay(playId: number, orgId: number): Promise<void> {
  let playRow: ActivePlayRow | undefined;

  try {
    const result = await db.execute(sql`
      SELECT
        p.id,
        p.user_id,
        sc.buying_signals,
        sc.problem_signals,
        sc.competitor_signals,
        sc.industry_keywords,
        sc.target_subreddits
      FROM plays p
      INNER JOIN signal_configs sc ON sc.play_id = p.id
      WHERE p.id = ${playId}
        AND p.org_id = ${orgId}
        AND p.status = 'active'
      LIMIT 1
    `);
    playRow = ((result as unknown as { rows: ActivePlayRow[] }).rows)[0];
  } catch (err) {
    logger.error({ err, playId }, "[CRAWL ORCH] Failed to load play for single crawl");
    return;
  }

  if (!playRow) {
    logger.warn({ playId, orgId }, "[CRAWL ORCH] Play not found or not active — skipping single crawl");
    return;
  }

  const playRecord   = { id: playRow.id, userId: playRow.user_id };
  const signalConfig = {
    buyingSignals:     playRow.buying_signals    ?? [],
    problemSignals:    playRow.problem_signals   ?? [],
    competitorSignals: playRow.competitor_signals ?? [],
    industryKeywords:  playRow.industry_keywords ?? [],
    targetSubreddits:  playRow.target_subreddits ?? [],
  };

  // Reddit: awaited
  try {
    const stats = await crawlPlayReddit(playRecord, signalConfig);
    logger.info({ playId, ...stats }, "[CRAWL ORCH] Reddit crawl done (single)");
  } catch (err) {
    logger.warn({ err, playId }, "[CRAWL ORCH] Reddit crawl failed (single) — continuing");
  }

  // Apify: fire-and-forget
  void runLinkedInCrawl(playRecord, signalConfig).catch(err =>
    logger.warn({ err, playId }, "[CRAWL ORCH] LinkedIn crawl failed (single)")
  );
  void runJobBoardCrawl(playRecord, signalConfig).catch(err =>
    logger.warn({ err, playId }, "[CRAWL ORCH] Job board crawl failed (single)")
  );
}

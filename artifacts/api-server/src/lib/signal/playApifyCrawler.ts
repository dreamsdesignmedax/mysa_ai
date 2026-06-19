/**
 * Per-Play Apify Crawler
 * Runs LinkedIn and job-board Apify actors dynamically from a play's signal_configs.
 * Both functions are fire-and-forget background tasks — they write to signal_posts
 * with play_id so results stay scoped to the originating play.
 *
 * Sources: LinkedIn, Indeed, Naukri
 */

import { ApifyClient } from "apify-client";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

function getClient(): ApifyClient | null {
  const token = process.env["APIFY_TOKEN"];
  if (!token) {
    logger.warn("[PLAY APIFY] APIFY_TOKEN not set — Apify scraping disabled");
    return null;
  }
  return new ApifyClient({ token });
}

export interface PlayRecord {
  id:     number;
  userId: number | null;
}

export interface SignalConfigRecord {
  buyingSignals:    string[] | null;
  problemSignals:   string[] | null;
  industryKeywords: string[] | null;
}

// ── LinkedIn crawl ─────────────────────────────────────────────────────────────

export async function runLinkedInCrawl(
  play:         PlayRecord,
  signalConfig: SignalConfigRecord,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  const queries = [
    ...(signalConfig.buyingSignals  ?? []),
    ...(signalConfig.problemSignals ?? []),
  ].filter(Boolean).slice(0, 5);

  if (queries.length === 0) return;

  for (const query of queries) {
    try {
      const run = await client.actor("curious_coder/linkedin-profile-scraper").call({
        searchUrls: [`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`],
        proxy: { useApifyProxy: true },
        maxItems: 10,
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 10 });

      for (const item of items) {
        const i       = item as Record<string, unknown>;
        const name    = String(i.fullName ?? i.name ?? "").slice(0, 200);
        if (!name) continue;

        const postUrl = `linkedin:play${play.id}:${query}:${name}`.replace(/\s+/g, "_").slice(0, 400);
        const title   = name;
        const body    = [i.headline, i.company, i.location].filter(Boolean).join(" | ").slice(0, 1000);

        try {
          await db.execute(sql`
            INSERT INTO signal_posts (
              post_url, platform, title, body, author, raw_json,
              crawled_at, play_id, user_id, matched_signal, processed
            ) VALUES (
              ${postUrl}, 'linkedin', ${title}, ${body}, ${name}, ${JSON.stringify(i)},
              NOW(), ${play.id}, ${play.userId ?? null}, 'buying', false
            )
            ON CONFLICT (post_url, play_id) DO NOTHING
          `);
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      logger.warn({ err, query, playId: play.id }, "[PLAY APIFY] LinkedIn crawl failed for query");
    }
  }

  logger.info({ playId: play.id }, "[PLAY APIFY] LinkedIn crawl complete");
}

// ── Shared job-board insert helper ─────────────────────────────────────────────

async function insertJobPost(
  play:     PlayRecord,
  platform: string,
  keyword:  string,
  item:     Record<string, unknown>,
): Promise<void> {
  const company = String(item.company ?? "").slice(0, 200);
  if (!company) return;

  const postUrl = `${platform}:play${play.id}:${keyword}:${company}`.replace(/\s+/g, "_").slice(0, 400);
  const title   = String(item.title ?? keyword).slice(0, 300);
  const body    = String(item.description ?? item.snippet ?? "").slice(0, 1500);

  await db.execute(sql`
    INSERT INTO signal_posts (
      post_url, platform, title, body, author, raw_json,
      crawled_at, play_id, user_id, matched_signal, processed
    ) VALUES (
      ${postUrl}, ${platform}, ${title}, ${body}, ${company}, ${JSON.stringify(item)},
      NOW(), ${play.id}, ${play.userId ?? null}, 'buying', false
    )
    ON CONFLICT (post_url, play_id) DO NOTHING
  `);
}

// ── Job board crawl (Indeed + Naukri) ─────────────────────────────────────────

export async function runJobBoardCrawl(
  play:         PlayRecord,
  signalConfig: SignalConfigRecord,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  const keywords = (signalConfig.industryKeywords ?? []).filter(Boolean).slice(0, 5);
  if (keywords.length === 0) return;

  // ── Indeed ──────────────────────────────────────────────────────────────────
  for (const keyword of keywords) {
    try {
      const run = await client.actor("curious_coder/indeed-scraper").call({
        keyword,
        location: "",
        maxItems: 10,
        proxy: { useApifyProxy: true },
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 10 });

      for (const item of items) {
        try {
          await insertJobPost(play, "indeed", keyword, item as Record<string, unknown>);
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      logger.warn({ err, keyword, playId: play.id }, "[PLAY APIFY] Indeed scrape failed for keyword");
    }
  }

  logger.info({ playId: play.id }, "[PLAY APIFY] Indeed crawl complete");

  // ── Naukri ──────────────────────────────────────────────────────────────────
  for (const keyword of keywords) {
    try {
      const run = await client.actor("curious_coder/naukri-scraper").call({
        keyword,
        location: "",
        maxItems: 10,
        proxy: { useApifyProxy: true },
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 10 });

      for (const item of items) {
        try {
          await insertJobPost(play, "naukri", keyword, item as Record<string, unknown>);
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      logger.warn({ err, keyword, playId: play.id }, "[PLAY APIFY] Naukri scrape failed for keyword");
    }
  }

  logger.info({ playId: play.id }, "[PLAY APIFY] Naukri crawl complete");
}

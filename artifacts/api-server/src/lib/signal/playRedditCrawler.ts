/**
 * Per-Play Reddit Crawler
 * Crawls Reddit dynamically based on each play's signal_configs.
 * Reuses the same OAuth token-cache pattern as redditCrawler.ts.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

const REDDIT_API = "https://oauth.reddit.com";
const TOKEN_URL  = "https://www.reddit.com/api/v1/access_token";

let cachedToken:    string | null = null;
let tokenExpiresAt: number        = 0;

async function getRedditToken(): Promise<string | null> {
  const clientId     = process.env["REDDIT_CLIENT_ID"];
  const clientSecret = process.env["REDDIT_CLIENT_SECRET"];
  const username     = process.env["REDDIT_USERNAME"];
  const password     = process.env["REDDIT_PASSWORD"];
  const userAgent    = process.env["REDDIT_USER_AGENT"] ?? "MysaAI Signal Bot/1.0";

  if (!clientId || !clientSecret || !username || !password) {
    logger.warn("[PLAY REDDIT] Missing Reddit credentials — skipping per-play crawl");
    return null;
  }

  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  try {
    const res = await fetch(TOKEN_URL, {
      method:  "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type":  "application/x-www-form-urlencoded",
        "User-Agent":    userAgent,
      },
      body: new URLSearchParams({ grant_type: "password", username, password }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "[PLAY REDDIT] Token fetch failed");
      return null;
    }

    const data      = await res.json() as { access_token: string; expires_in: number };
    cachedToken     = data.access_token;
    tokenExpiresAt  = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  } catch (err) {
    logger.error({ err }, "[PLAY REDDIT] Token fetch error");
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface RedditPost {
  title:     string;
  selftext:  string;
  url:       string;
  permalink: string;
  subreddit: string;
  author:    string;
  score:     number;
}

async function fetchSubredditSearch(
  token:     string,
  subreddit: string,
  query:     string,
  userAgent: string,
): Promise<RedditPost[]> {
  try {
    const params = new URLSearchParams({ q: query, sort: "new", limit: "10", type: "link", t: "week" });
    const res = await fetch(`${REDDIT_API}/r/${subreddit}/search?${params.toString()}`, {
      headers: { "Authorization": `Bearer ${token}`, "User-Agent": userAgent },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data: { children: Array<{ data: RedditPost }> } };
    return data.data?.children?.map(c => c.data) ?? [];
  } catch {
    return [];
  }
}

/** Dissatisfaction wrapper phrases for competitor signals */
const DISSATISFACTION_WRAPPERS = [
  "frustrated with",
  "alternative to",
  "switching from",
  "problems with",
  "leaving",
];

export interface PlayRecord {
  id:     number;
  userId: number | null;
}

export interface SignalConfigRecord {
  buyingSignals:     string[] | null;
  problemSignals:    string[] | null;
  competitorSignals: string[] | null;
  industryKeywords:  string[] | null;
  targetSubreddits:  string[] | null;
}

interface QueryEntry {
  query:   string;
  matched: string; // "buying" | "problem" | "competitor" | "keyword"
}

/**
 * Build up to 6 search queries per subreddit from signal config.
 * Priority: buying > problem > competitor (wrapped with dissatisfaction phrases) > keyword.
 * Competitor signals are expanded with dissatisfaction phrases so we surface intent-driven posts.
 */
function buildQueryEntries(sc: SignalConfigRecord): QueryEntry[] {
  const entries: QueryEntry[] = [];

  for (const phrase of (sc.buyingSignals ?? [])) {
    if (entries.length >= 6) break;
    entries.push({ query: phrase, matched: "buying" });
  }

  for (const phrase of (sc.problemSignals ?? [])) {
    if (entries.length >= 6) break;
    entries.push({ query: phrase, matched: "problem" });
  }

  // Expand competitor signals with dissatisfaction phrases — pick one wrapper per competitor
  for (const phrase of (sc.competitorSignals ?? [])) {
    if (entries.length >= 6) break;
    const wrapper = DISSATISFACTION_WRAPPERS[entries.length % DISSATISFACTION_WRAPPERS.length];
    entries.push({ query: `${wrapper} ${phrase}`, matched: "competitor" });
  }

  for (const phrase of (sc.industryKeywords ?? [])) {
    if (entries.length >= 6) break;
    entries.push({ query: phrase, matched: "keyword" });
  }

  return entries;
}

export async function crawlPlayReddit(
  play:         PlayRecord,
  signalConfig: SignalConfigRecord,
): Promise<{ inserted: number; skipped: number }> {
  const subreddits = (signalConfig.targetSubreddits ?? []).filter(Boolean);

  if (subreddits.length === 0) {
    logger.info({ playId: play.id }, "[PLAY REDDIT] No target subreddits — skipping");
    return { inserted: 0, skipped: 0 };
  }

  const token = await getRedditToken();
  if (!token) return { inserted: 0, skipped: 0 };

  const userAgent    = process.env["REDDIT_USER_AGENT"] ?? "MysaAI Signal Bot/1.0";
  const queryEntries = buildQueryEntries(signalConfig);

  if (queryEntries.length === 0) {
    logger.info({ playId: play.id }, "[PLAY REDDIT] No signal phrases — skipping");
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped  = 0;

  for (const subreddit of subreddits) {
    for (const { query, matched } of queryEntries) {
      try {
        const posts = await fetchSubredditSearch(token, subreddit, query, userAgent);

        for (const post of posts) {
          const postUrl = `https://www.reddit.com${post.permalink}`;
          const title   = post.title.slice(0, 500);
          const body    = [post.title, post.selftext ?? ""].join(" ").slice(0, 5000);
          const author  = post.author ?? "";
          const score   = post.score ?? 0;
          const rawJson = JSON.stringify(post);

          try {
            // Use the per-play partial unique index: (post_url, play_id) WHERE play_id IS NOT NULL
            const result = await db.execute(sql`
              INSERT INTO signal_posts (
                post_url, platform, title, body, author, subreddit, score, raw_json,
                crawled_at, play_id, user_id, matched_signal, processed
              ) VALUES (
                ${postUrl}, 'reddit', ${title}, ${body}, ${author}, ${subreddit}, ${score}, ${rawJson},
                NOW(), ${play.id}, ${play.userId ?? null}, ${matched}, false
              )
              ON CONFLICT (post_url, play_id) DO NOTHING
              RETURNING id
            `);

            const rows = (result as unknown as { rows: { id: number }[] }).rows;
            if ((rows?.length ?? 0) > 0) {
              inserted++;
            } else {
              skipped++;
            }
          } catch (err) {
            logger.warn({ err, postUrl, playId: play.id }, "[PLAY REDDIT] Insert failed");
            skipped++;
          }
        }

        await sleep(400);
      } catch (err) {
        logger.warn({ err, subreddit, query, playId: play.id }, "[PLAY REDDIT] Subreddit query failed");
      }
    }
  }

  logger.info({ playId: play.id, inserted, skipped }, "[PLAY REDDIT] Play crawl complete");
  return { inserted, skipped };
}

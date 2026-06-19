/**
 * Reddit Signal Crawler
 * Fetches buying-intent posts from targeted subreddits using Reddit OAuth API.
 * Deduplicates by post_url (ON CONFLICT DO NOTHING) before inserting into signal_posts.
 * Uses RETURNING id to count only rows that were actually inserted.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

const REDDIT_API = "https://oauth.reddit.com";
const TOKEN_URL  = "https://www.reddit.com/api/v1/access_token";

const SUBREDDITS = [
  "entrepreneur", "startups", "smallbusiness", "marketing", "digital_marketing",
  "SEO", "PPC", "ecommerce", "SaaS", "B2Bmarketing",
  "webdesign", "web_design", "freelance", "consulting",
  "sales", "CRM", "growthhacking", "rebranding",
];

const SEARCH_QUERIES = [
  "need website redesign", "looking for web agency", "branding help",
  "website audit needed", "digital marketing agency recommendation",
  "SEO help needed", "need better website", "rebranding our company",
  "outreach help", "sales strategy",
];

// ── Token cache ──────────────────────────────────────────────────────────────
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getRedditToken(): Promise<string | null> {
  const clientId     = process.env["REDDIT_CLIENT_ID"];
  const clientSecret = process.env["REDDIT_CLIENT_SECRET"];
  const username     = process.env["REDDIT_USERNAME"];
  const password     = process.env["REDDIT_PASSWORD"];
  const userAgent    = process.env["REDDIT_USER_AGENT"] ?? "MysaAI Signal Bot/1.0";

  if (!clientId || !clientSecret || !username || !password) {
    logger.warn("[REDDIT CRAWLER] Missing Reddit credentials — set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD");
    return null;
  }

  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type":  "application/x-www-form-urlencoded",
        "User-Agent":    userAgent,
      },
      body: new URLSearchParams({ grant_type: "password", username, password }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "[REDDIT CRAWLER] Token fetch failed");
      return null;
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken    = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  } catch (err) {
    logger.error({ err }, "[REDDIT CRAWLER] Token fetch error");
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    return data.data?.children?.map((c) => c.data) ?? [];
  } catch {
    return [];
  }
}

export async function crawlReddit(): Promise<{ inserted: number; skipped: number }> {
  const token = await getRedditToken();
  if (!token) return { inserted: 0, skipped: 0 };

  const userAgent = process.env["REDDIT_USER_AGENT"] ?? "MysaAI Signal Bot/1.0";
  let inserted = 0;
  let skipped  = 0;

  for (const subreddit of SUBREDDITS) {
    for (const query of SEARCH_QUERIES) {
      const posts = await fetchSubredditSearch(token, subreddit, query, userAgent);

      for (const post of posts) {
        const postUrl = `https://www.reddit.com${post.permalink}`;
        const title   = post.title.slice(0, 500);
        const body    = [post.title, post.selftext ?? ""].join(" ").slice(0, 5000);
        const author  = post.author ?? "";
        const score   = post.score  ?? 0;
        const rawJson = JSON.stringify(post);

        try {
          // Use RETURNING id — only counts if the row was actually inserted
          // (ON CONFLICT DO NOTHING suppresses duplicates without error)
          const result = await db.execute(sql`
            INSERT INTO signal_posts (
              post_url, platform, title, body, author, subreddit, score, raw_json, crawled_at
            ) VALUES (
              ${postUrl}, 'reddit', ${title}, ${body}, ${author}, ${subreddit}, ${score}, ${rawJson}, NOW()
            )
            ON CONFLICT (post_url) DO NOTHING
            RETURNING id
          `);

          const resultRows = (result as unknown as { rows: { id: number }[] }).rows;
          if ((resultRows?.length ?? 0) > 0) {
            inserted++;
          } else {
            skipped++; // duplicate — ON CONFLICT DO NOTHING silently skipped it
          }
        } catch (err) {
          logger.warn({ err, postUrl }, "[REDDIT CRAWLER] Insert failed");
          skipped++;
        }
      }

      await sleep(500);
    }
  }

  logger.info({ inserted, skipped }, "[REDDIT CRAWLER] Crawl complete");
  return { inserted, skipped };
}

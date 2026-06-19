/**
 * Apify Service
 * Wraps Apify actors for LinkedIn profile scraping, job board scraping,
 * and Google Maps / local business discovery.
 */

import { ApifyClient } from "apify-client";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

function getClient(): ApifyClient | null {
  const token = process.env["APIFY_TOKEN"];
  if (!token) {
    logger.warn("[APIFY] APIFY_TOKEN not set — Apify scraping disabled");
    return null;
  }
  return new ApifyClient({ token });
}

// ── LinkedIn Profile Scraper ─────────────────────────────────────────────────

export interface LinkedInProfile {
  fullName?:  string;
  headline?:  string;
  company?:   string;
  location?:  string;
  email?:     string;
  photoUrl?:  string;
}

export async function scrapeLinkedInProfile(linkedInUrl: string): Promise<LinkedInProfile | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const run = await client.actor("curious_coder/linkedin-profile-scraper").call({
      profileUrls: [linkedInUrl],
      proxy: { useApifyProxy: true },
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 1 });
    const item = items[0] as Record<string, unknown> | undefined;
    if (!item) return null;

    return {
      fullName:  item.fullName  ? String(item.fullName)  : undefined,
      headline:  item.headline  ? String(item.headline)  : undefined,
      company:   item.company   ? String(item.company)   : undefined,
      location:  item.location  ? String(item.location)  : undefined,
      email:     item.email     ? String(item.email)     : undefined,
      photoUrl:  item.photoUrl  ? String(item.photoUrl)  : undefined,
    };
  } catch (err) {
    logger.warn({ err, linkedInUrl }, "[APIFY] LinkedIn profile scrape failed");
    return null;
  }
}

// ── Job Board Scraper (Indeed) ────────────────────────────────────────────────

export interface JobBoardResult {
  company:      string;
  jobTitle:     string;
  location?:    string;
  description?: string;
  url?:         string;
  postedAt?:    string;
}

const JOB_TITLES = [
  "Head of Marketing",
  "VP Marketing",
  "Chief Marketing Officer",
  "Digital Marketing Manager",
  "Growth Marketing Lead",
  "Brand Manager",
  "Head of Growth",
];

export async function scrapeJobBoards(): Promise<JobBoardResult[]> {
  const client = getClient();
  if (!client) return [];

  const results: JobBoardResult[] = [];

  for (const title of JOB_TITLES) {
    try {
      const run = await client.actor("curious_coder/indeed-scraper").call({
        keyword: title,
        location: "",
        maxItems: 10,
        proxy: { useApifyProxy: true },
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 10 });
      for (const item of items) {
        const i = item as Record<string, unknown>;
        if (i.company) {
          results.push({
            company:     String(i.company ?? ""),
            jobTitle:    String(i.title ?? title),
            location:    i.location    ? String(i.location)                  : undefined,
            description: i.description ? String(i.description).slice(0, 500) : undefined,
            url:         i.url         ? String(i.url)                        : undefined,
            postedAt:    i.date        ? String(i.date)                       : undefined,
          });
        }
      }
    } catch (err) {
      logger.warn({ err, title }, "[APIFY] Job board scrape failed for title");
    }
  }

  return results;
}

// ── Google Maps / Local Business Scraper ─────────────────────────────────────

export interface GoogleMapsLead {
  name:         string;
  category?:    string;
  address?:     string;
  phone?:       string;
  website?:     string;
  rating?:      number;
  reviewCount?: number;
  location?:    string;
  searchQuery?: string;
}

const GOOGLE_MAPS_SEARCHES = [
  { query: "web design agency",        location: "Mumbai, India" },
  { query: "digital marketing agency", location: "Mumbai, India" },
  { query: "branding agency",          location: "Mumbai, India" },
  { query: "web design agency",        location: "Bangalore, India" },
  { query: "digital marketing agency", location: "Bangalore, India" },
  { query: "ecommerce agency",         location: "Delhi, India" },
  { query: "web design company",       location: "Pune, India" },
  { query: "seo agency",               location: "Hyderabad, India" },
];

export async function scrapeGoogleMaps(query: string, location: string): Promise<GoogleMapsLead[]> {
  const client = getClient();
  if (!client) return [];

  try {
    const run = await client.actor("compass/crawler-google-places").call({
      searchStringsArray:         [`${query} in ${location}`],
      maxCrawledPlacesPerSearch:  20,
      language:                   "en",
      exportPlaceUrls:            false,
      proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 20 });
    return items
      .map((item) => {
        const i = item as Record<string, unknown>;
        return {
          name:        String(i.title ?? i.name ?? ""),
          category:    i.categoryName ? String(i.categoryName) : undefined,
          address:     i.address      ? String(i.address)      : undefined,
          phone:       i.phone        ? String(i.phone)        : undefined,
          website:     i.website      ? String(i.website)      : undefined,
          rating:      i.totalScore   ? Number(i.totalScore)   : undefined,
          reviewCount: i.reviewsCount ? Number(i.reviewsCount) : undefined,
          location,
          searchQuery: query,
        };
      })
      .filter((p) => Boolean(p.name));
  } catch (err) {
    logger.warn({ err, query, location }, "[APIFY] Google Maps scrape failed");
    return [];
  }
}

export async function runDailyGoogleMapsScrape(): Promise<{ total: number; queries: number }> {
  let total   = 0;
  let queries = 0;

  for (const { query, location } of GOOGLE_MAPS_SEARCHES) {
    const results = await scrapeGoogleMaps(query, location);
    total   += results.length;
    queries += 1;

    for (const place of results) {
      try {
        const body    = [place.category, place.address, place.phone, place.website].filter(Boolean).join(" | ");
        const postUrl = `googlemaps:${place.name}:${location}:${query}`.replace(/\s+/g, "_");

        await db.execute(sql`
          INSERT INTO signal_posts (
            post_url, platform, title, body, subreddit, score, raw_json, crawled_at
          ) VALUES (
            ${postUrl}, 'google_maps', ${place.name.slice(0, 500)}, ${body.slice(0, 2000)},
            ${query}, 0, ${JSON.stringify(place)}, NOW()
          )
          ON CONFLICT (post_url) DO NOTHING
        `);
      } catch { /* non-fatal — deduplicate on next run */ }
    }
  }

  logger.info({ total, queries }, "[APIFY] Daily Google Maps scrape complete");
  return { total, queries };
}

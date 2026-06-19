/**
 * gatherWebSignals.ts  v2.0 — Powerful, multi-source live intelligence
 *
 * Data sources (all run in parallel):
 *   1.  Multi-page website crawl (homepage + /about + /blog + /services + /contact)
 *   2.  robots.txt + sitemap.xml with page count
 *   3.  Google PageSpeed Insights API (free, no key — real Core Web Vitals)
 *   4.  DuckDuckGo Instant Answer (fast brand lookup)
 *   5a. Apify SERP — GMB / reviews / rating query
 *   5b. Apify SERP — social media presence query
 *   5c. Apify SERP — site:domain indexed page count
 */

import { promises as dnsPromises } from "node:dns";

const UA = "Mozilla/5.0 (compatible; MysaAuditBot/2.0; +https://mysa.ai/bot)";
const TIMEOUT_SHORT = 8_000;
const TIMEOUT_LONG  = 18_000;

// ─────────────────────────────────────────────────────────────────────────────
// SSRF protection — block private/internal destinations for user-supplied URLs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a raw IPv4 address string (dotted-decimal) belongs to a
 * private, loopback, link-local, or otherwise reserved range.
 */
function isPrivateIPv4(addr: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (!ipv4) return false;
  const [a, b, c] = [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3])];
  if (a === 127) return true;                              // 127.0.0.0/8  loopback
  if (a === 10) return true;                               // 10.0.0.0/8   RFC-1918
  if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12 RFC-1918
  if (a === 192 && b === 168) return true;                 // 192.168.0.0/16 RFC-1918
  if (a === 169 && b === 254) return true;                 // 169.254.0.0/16 link-local / APIPA / IMDS
  if (a === 0) return true;                                // 0.0.0.0/8    "this" network
  if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 2) return true;        // 192.0.2.0/24  TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true;     // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;      // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true;                               // 224.0.0.0/3  multicast + reserved
  return false;
}

/**
 * Decodes an IPv4-mapped IPv6 address in hex-group notation to its underlying
 * IPv4 string.  Handles both decimal form (`::ffff:127.0.0.1`) and the
 * hex-normalised form Node.js URL produces (`::ffff:7f00:1`).
 *
 * Returns null if the input does not look like `::ffff:<rest>`.
 */
function decodeMappedIPv4(hostname: string): string | null {
  if (!/^::ffff:/i.test(hostname)) return null;
  const rest = hostname.slice(7); // everything after "::ffff:"

  // Decimal dotted form: "127.0.0.1"
  if (/^\d+\.\d+\.\d+\.\d+$/.test(rest)) return rest;

  // Hex-group form produced by Node URL normalisation: "7f00:1"
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

/**
 * Returns true if the given URL string must be blocked because it points at a
 * private, loopback, link-local, or cloud-metadata address.
 *
 * This pass operates purely on the literal URL text (no DNS) and is a fast
 * pre-filter.  Always combine with `dnsGuardAuditUrl` for hostname inputs.
 */
function isBlockedAuditUrl(urlStr: string): boolean {
  let parsed: URL;
  try { parsed = new URL(urlStr); } catch { return true; }

  // Only http and https are permitted — block file:, ftp:, gopher:, etc.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;

  // Strip IPv6 brackets for uniform comparison; Node normalises to lowercase
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // Explicitly blocked hostnames and well-known metadata service addresses
  const blockedHostnames = new Set([
    "localhost",
    "::",
    "::1",
    "0.0.0.0",
    "169.254.169.254",          // AWS / GCP / Azure IMDS (IPv4)
    "fd00:ec2::254",             // AWS IMDS (IPv6)
    "metadata.google.internal",
    "metadata.google.com",
    "metadata",
  ]);
  if (blockedHostnames.has(hostname)) return true;

  // Block TLD patterns used exclusively for internal infrastructure
  if (/(?:^|\.)(?:local|internal|intranet|corp|home\.arpa|localhost)$/i.test(hostname)) return true;

  // Raw IPv4 address
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return isPrivateIPv4(hostname);

  // IPv6 private / link-local / ULA ranges
  if (/^fe80:/i.test(hostname)) return true;                // link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(hostname)) return true;   // ULA (fc00::/7)

  // IPv4-mapped IPv6 — decode to underlying IPv4 and re-check
  // Handles both "::ffff:127.0.0.1" and Node-normalised "::ffff:7f00:1"
  const mappedIPv4 = decodeMappedIPv4(hostname);
  if (mappedIPv4 !== null) return isPrivateIPv4(mappedIPv4);

  return false;
}

/**
 * Async DNS guard: resolves all A/AAAA records for the URL's hostname and
 * rejects if any resolved address is private/internal.
 *
 * Returns null if the hostname is safe to fetch, or an error string if it
 * must be blocked.  Raw IP-address hostnames skip DNS (already handled by
 * `isBlockedAuditUrl`).
 */
async function dnsGuardAuditUrl(urlStr: string): Promise<string | null> {
  let parsed: URL;
  try { parsed = new URL(urlStr); } catch { return "Invalid URL"; }

  const rawHostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // If the hostname is a raw IP literal, isBlockedAuditUrl already checked it.
  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(rawHostname) || rawHostname.includes(":");
  if (isIpLiteral) return null;

  // Resolve A and AAAA records; tolerate one family failing (NXDOMAIN on AAAA is common)
  const [v4Result, v6Result] = await Promise.allSettled([
    dnsPromises.resolve4(rawHostname),
    dnsPromises.resolve6(rawHostname),
  ]);

  const ipv4s: string[] = v4Result.status === "fulfilled" ? v4Result.value : [];
  const ipv6s: string[] = v6Result.status === "fulfilled" ? v6Result.value : [];

  if (ipv4s.length === 0 && ipv6s.length === 0) {
    // Total DNS failure — block; do not fetch an unresolvable host
    return "Hostname could not be resolved";
  }

  for (const ip of ipv4s) {
    if (isPrivateIPv4(ip)) return "Hostname resolves to a private address";
  }
  for (const ip of ipv6s) {
    // Check IPv6 via URL encoding to reuse isBlockedAuditUrl
    if (isBlockedAuditUrl(`http://[${ip}]`)) return "Hostname resolves to a private address";
    // Also decode any mapped IPv4 hidden inside IPv6 addresses returned by DNS
    const mapped = decodeMappedIPv4(ip.toLowerCase());
    if (mapped !== null && isPrivateIPv4(mapped)) return "Hostname resolves to a private address";
  }

  return null; // All resolved addresses are public — safe to proceed
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WebSignalsResult {
  // SSL / HTTPS
  ssl: boolean;

  // On-page SEO
  pageTitle: string | null;
  hasMetaDescription: boolean;
  metaDescriptionContent: string | null;
  hasMobileViewport: boolean;
  hasOpenGraph: boolean;
  hasCanonicalTag: boolean;
  hasSchemaMarkup: boolean;
  schemaTypes: string[];          // e.g. ['LocalBusiness', 'FAQPage', 'Article']

  // Sitemap / robots
  hasSitemap: boolean;
  hasRobotsTxt: boolean;
  sitemapPageCount: number | null;

  // Analytics & Tracking
  hasGA4: boolean;
  ga4MeasurementId: string | null;
  hasGTM: boolean;
  gtmContainerId: string | null;
  hasMetaPixel: boolean;
  metaPixelId: string | null;
  hasGoogleAds: boolean;
  googleAdsId: string | null;
  hasHotjarOrHeatmap: boolean;
  heatmapTool: string | null;
  hasLinkedInInsight: boolean;
  hasMicrosoftClarity: boolean;

  // Conversion & Lead Capture
  hasContactForm: boolean;
  hasPhoneNumber: boolean;
  hasEmailAddress: boolean;
  hasCTA: boolean;
  ctaTexts: string[];
  hasWhatsAppWidget: boolean;
  hasChatWidget: boolean;
  chatWidgetTool: string | null;
  hasCalendly: boolean;
  hasBookingSystem: boolean;
  hasNewsletterForm: boolean;
  hasExitIntentPopup: boolean;

  // Content
  hasBlogSection: boolean;
  estimatedBlogPostCount: number;
  hasVideoContent: boolean;
  hasTestimonialsSection: boolean;
  hasClientLogosSection: boolean;
  hasPortfolioSection: boolean;
  hasFAQSection: boolean;
  hasAboutPage: boolean;
  hasPricingPage: boolean;
  hasPrivacyPolicy: boolean;
  internalLinkCount: number;
  crawledPageCount: number;        // how many subpages returned 200

  // Social media (from HTML)
  instagramLink: string | null;
  linkedInLink: string | null;
  facebookLink: string | null;
  twitterLink: string | null;
  youtubeLink: string | null;

  // Performance (Google PageSpeed Insights)
  pageSpeedScore: number | null;
  pageSpeedLCP: number | null;     // seconds
  pageSpeedFCP: number | null;
  pageSpeedCLS: number | null;
  pageSpeedTTFB: number | null;
  pageSpeedCategory: string | null; // 'Good' | 'Needs Improvement' | 'Poor'

  // GMB / Online Reputation (from SERP)
  foundGMBListing: boolean;
  gmbListingUrl: string | null;
  gmbVerified: boolean;
  foundGoogleReviews: boolean;
  estimatedReviewCount: string | null;
  estimatedRating: string | null;
  googleSearchSnippet: string | null;

  // Social presence (from SERP)
  foundInstagram: boolean;
  foundLinkedIn: boolean;
  foundFacebook: boolean;
  foundYouTube: boolean;

  // Indexed pages (from site: SERP query)
  indexedPageCount: number | null;

  fetchError: string | null;
  htmlWordCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function safeFetch(url: string, opts?: RequestInit & { timeoutMs?: number }): Promise<Response | null> {
  const { timeoutMs = TIMEOUT_SHORT, ...rest } = opts ?? {};
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA, "Accept": "text/html,*/*", ...(rest.headers ?? {}) },
      ...rest,
    });
  } catch {
    return null;
  }
}

function extractText(html: string, regex: RegExp): string | null {
  const m = html.match(regex);
  return m ? (m[1] ?? m[0]).trim().slice(0, 300) : null;
}

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some(n => lower.includes(n.toLowerCase()));
}

function extractSchemaTypes(html: string): string[] {
  const types: string[] = [];
  const matches = html.matchAll(/"@type"\s*:\s*"([^"]{3,50})"/g);
  for (const m of matches) types.push(m[1]);
  return [...new Set(types)];
}

function apifyRunSync(token: string, queries: string, resultsPerPage = 10): Promise<
  { organicResults?: { title?: string; snippet?: string; url?: string }[]; searchQuery?: { term?: string; totalResults?: string } }[]
> {
  return fetch(
    `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${token}&timeout=30`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries,
        maxPagesPerQuery: 1,
        resultsPerPage,
        languageCode: "en",
        countryCode: "in",
      }),
      signal: AbortSignal.timeout(35_000),
    }
  )
    .then(r => r.ok ? r.json() : [])
    .catch(() => []) as Promise<never>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────────────────────────────────────

export async function gatherWebSignals(
  websiteUrl: string | null | undefined,
  companyName: string,
  linkedInUrl: string | null | undefined,
  pageSpeedScore: number | null,
): Promise<WebSignalsResult> {

  const result: WebSignalsResult = {
    ssl: false,
    pageTitle: null,
    hasMetaDescription: false,
    metaDescriptionContent: null,
    hasMobileViewport: false,
    hasOpenGraph: false,
    hasCanonicalTag: false,
    hasSchemaMarkup: false,
    schemaTypes: [],
    hasSitemap: false,
    hasRobotsTxt: false,
    sitemapPageCount: null,
    hasGA4: false,
    ga4MeasurementId: null,
    hasGTM: false,
    gtmContainerId: null,
    hasMetaPixel: false,
    metaPixelId: null,
    hasGoogleAds: false,
    googleAdsId: null,
    hasHotjarOrHeatmap: false,
    heatmapTool: null,
    hasLinkedInInsight: false,
    hasMicrosoftClarity: false,
    hasContactForm: false,
    hasPhoneNumber: false,
    hasEmailAddress: false,
    hasCTA: false,
    ctaTexts: [],
    hasWhatsAppWidget: false,
    hasChatWidget: false,
    chatWidgetTool: null,
    hasCalendly: false,
    hasBookingSystem: false,
    hasNewsletterForm: false,
    hasExitIntentPopup: false,
    hasBlogSection: false,
    estimatedBlogPostCount: 0,
    hasVideoContent: false,
    hasTestimonialsSection: false,
    hasClientLogosSection: false,
    hasPortfolioSection: false,
    hasFAQSection: false,
    hasAboutPage: false,
    hasPricingPage: false,
    hasPrivacyPolicy: false,
    internalLinkCount: 0,
    crawledPageCount: 0,
    instagramLink: null,
    linkedInLink: linkedInUrl ?? null,
    facebookLink: null,
    twitterLink: null,
    youtubeLink: null,
    pageSpeedScore,
    pageSpeedLCP: null,
    pageSpeedFCP: null,
    pageSpeedCLS: null,
    pageSpeedTTFB: null,
    pageSpeedCategory: null,
    foundGMBListing: false,
    gmbListingUrl: null,
    gmbVerified: false,
    foundGoogleReviews: false,
    estimatedReviewCount: null,
    estimatedRating: null,
    googleSearchSnippet: null,
    foundInstagram: false,
    foundLinkedIn: !!(linkedInUrl),
    foundFacebook: false,
    foundYouTube: false,
    indexedPageCount: null,
    fetchError: null,
    htmlWordCount: 0,
  };

  const apifyToken = process.env.APIFY_TOKEN;

  // ── Launch ALL operations in parallel ─────────────────────────────────────
  const [
    webCrawlResult,
    psiResult,
    ddgResult,
    apifyGMBResult,
    apifySocialResult,
    apifyIndexResult,
  ] = await Promise.allSettled([
    // 1. Multi-page website crawl
    websiteUrl ? crawlWebsite(websiteUrl, result) : Promise.resolve(null),

    // 2. Google PageSpeed Insights (free, no key)
    websiteUrl ? fetchPageSpeedInsights(websiteUrl) : Promise.resolve(null),

    // 3. DuckDuckGo brand lookup
    fetchDuckDuckGo(companyName),

    // 4. Apify GMB/reviews query
    (apifyToken && companyName)
      ? apifyRunSync(apifyToken, `"${companyName}" google reviews rating stars`, 10)
      : Promise.resolve([]),

    // 5. Apify social media presence
    (apifyToken && companyName)
      ? apifyRunSync(apifyToken, `"${companyName}" site:instagram.com OR site:linkedin.com OR site:facebook.com OR site:youtube.com`, 8)
      : Promise.resolve([]),

    // 6. Apify site: indexed pages
    (apifyToken && websiteUrl)
      ? apifyRunSync(apifyToken, `site:${new URL(websiteUrl!).hostname}`, 5)
      : Promise.resolve([]),
  ]);

  // ── Merge web crawl results ────────────────────────────────────────────────
  if (webCrawlResult.status === "fulfilled" && webCrawlResult.value) {
    Object.assign(result, webCrawlResult.value);
  }

  // ── Merge PageSpeed Insights ───────────────────────────────────────────────
  if (psiResult.status === "fulfilled" && psiResult.value) {
    const psi = psiResult.value;
    result.pageSpeedScore = psi.performanceScore;
    result.pageSpeedLCP   = psi.lcp;
    result.pageSpeedFCP   = psi.fcp;
    result.pageSpeedCLS   = psi.cls;
    result.pageSpeedTTFB  = psi.ttfb;
    result.pageSpeedCategory = psi.performanceScore >= 90 ? "Good"
      : psi.performanceScore >= 50 ? "Needs Improvement" : "Poor";
  }

  // ── Merge DuckDuckGo ───────────────────────────────────────────────────────
  if (ddgResult.status === "fulfilled" && ddgResult.value) {
    const ddg = ddgResult.value;
    if (ddg.snippet && !result.googleSearchSnippet) result.googleSearchSnippet = ddg.snippet;
    if (ddg.rating && !result.estimatedRating) result.estimatedRating = ddg.rating;
    if (ddg.reviewCount && !result.estimatedReviewCount) result.estimatedReviewCount = ddg.reviewCount;
    if (ddg.foundGMB) { result.foundGMBListing = true; if (ddg.gmbUrl) result.gmbListingUrl = ddg.gmbUrl; }
    if (ddg.foundInstagram) result.foundInstagram = true;
    if (ddg.foundLinkedIn) result.foundLinkedIn = true;
  }

  // ── Merge Apify GMB/Reviews ────────────────────────────────────────────────
  if (apifyGMBResult.status === "fulfilled" && Array.isArray(apifyGMBResult.value)) {
    const items = apifyGMBResult.value as { organicResults?: { title?: string; snippet?: string; url?: string }[]; searchQuery?: { totalResults?: string } }[];
    const organics = items.flatMap(i => i.organicResults ?? []);
    for (const r of organics) {
      const snippet = `${r.title ?? ""} ${r.snippet ?? ""}`;
      const snippetLow = snippet.toLowerCase();
      const url = r.url ?? "";

      if (!result.googleSearchSnippet && r.snippet) {
        result.googleSearchSnippet = r.snippet.slice(0, 300);
      }
      if (url.includes("google.com/maps") || url.includes("maps.google") || snippetLow.includes("google maps")) {
        result.foundGMBListing = true;
        if (!result.gmbListingUrl && url.includes("maps")) result.gmbListingUrl = url;
        // Check if profile shows "Verified" or "Claimed"
        if (/verified|claimed|trusted/i.test(snippet)) result.gmbVerified = true;
      }
      // Extract review count + rating from Google rich snippets
      const reviewMatch = snippet.match(/(\d[\d,]*)\s+(?:google\s+)?reviews?/i);
      if (reviewMatch && !result.estimatedReviewCount) result.estimatedReviewCount = reviewMatch[1].replace(/,/g, "");
      const ratingMatch = snippet.match(/(?:rating[:\s]+|rated\s+)(\d+\.?\d*)/i)
        ?? snippet.match(/(\d+\.?\d*)\s*(?:stars?|\/5|out of 5)/i);
      if (ratingMatch && !result.estimatedRating) result.estimatedRating = ratingMatch[1];
      if (snippetLow.includes("review") || url.includes("trustpilot") || url.includes("clutch")) {
        result.foundGoogleReviews = true;
      }
    }
  }

  // ── Merge Apify Social ────────────────────────────────────────────────────
  if (apifySocialResult.status === "fulfilled" && Array.isArray(apifySocialResult.value)) {
    const items = apifySocialResult.value as { organicResults?: { url?: string }[] }[];
    const urls = items.flatMap(i => i.organicResults ?? []).map(r => r.url ?? "");
    for (const url of urls) {
      if (url.includes("instagram.com")) { result.foundInstagram = true; if (!result.instagramLink) result.instagramLink = url; }
      if (url.includes("linkedin.com"))  { result.foundLinkedIn = true;  if (!result.linkedInLink)  result.linkedInLink  = url; }
      if (url.includes("facebook.com"))  { result.foundFacebook = true;  if (!result.facebookLink)  result.facebookLink  = url; }
      if (url.includes("youtube.com"))   { result.foundYouTube  = true;  if (!result.youtubeLink)   result.youtubeLink   = url; }
    }
  }

  // ── Merge Apify site: index count ─────────────────────────────────────────
  if (apifyIndexResult.status === "fulfilled" && Array.isArray(apifyIndexResult.value)) {
    const items = apifyIndexResult.value as { searchQuery?: { totalResults?: string }; organicResults?: unknown[] }[];
    for (const item of items) {
      const total = item.searchQuery?.totalResults;
      if (total) {
        const n = parseInt(total.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(n) && n > 0) { result.indexedPageCount = n; break; }
      }
      // Fallback: count organic results as minimum
      const orgCount = Array.isArray(item.organicResults) ? item.organicResults.length : 0;
      if (orgCount > 0 && !result.indexedPageCount) result.indexedPageCount = orgCount;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-page website crawler
// ─────────────────────────────────────────────────────────────────────────────

async function crawlWebsite(websiteUrl: string, baseResult: WebSignalsResult): Promise<Partial<WebSignalsResult>> {
  const partial: Partial<WebSignalsResult> = {};

  // SSRF guard pass 1: fast literal check (scheme, raw IPs, known hostnames, TLDs).
  if (isBlockedAuditUrl(websiteUrl)) {
    partial.fetchError = "URL not permitted";
    return partial;
  }

  // SSRF guard pass 2: DNS resolution — catches public domains that resolve to
  // RFC-1918 / loopback / cloud-metadata addresses.
  const dnsErr = await dnsGuardAuditUrl(websiteUrl);
  if (dnsErr) {
    partial.fetchError = "URL not permitted";
    return partial;
  }

  partial.ssl = websiteUrl.startsWith("https://");

  let origin: string;
  try { origin = new URL(websiteUrl).origin; } catch { return partial; }

  // Fetch multiple pages in parallel.
  // redirect:"error" prevents the crawler from following server-side redirects
  // to private/internal hosts (e.g. open-redirect on a public domain → metadata IP).
  const subpaths = ["", "/about", "/about-us", "/blog", "/news", "/services", "/work", "/portfolio", "/contact"];
  const urls = subpaths.map(p => `${origin}${p}`);

  const responses = await Promise.allSettled(
    urls.map(u => safeFetch(u, { timeoutMs: TIMEOUT_SHORT, redirect: "error" }))
  );

  const htmlPages: string[] = [];
  let crawledCount = 0;

  for (const r of responses) {
    if (r.status === "fulfilled" && r.value?.ok) {
      const text = await r.value.text().catch(() => "");
      if (text.length > 200) { htmlPages.push(text); crawledCount++; }
    }
  }

  if (htmlPages.length === 0) {
    partial.fetchError = "All page fetches failed";
    return partial;
  }

  partial.crawledPageCount = crawledCount;
  const combined = htmlPages.join("\n");
  const combinedLower = combined.toLowerCase();
  const homepage = htmlPages[0];

  // Word count (homepage only)
  partial.htmlWordCount = homepage.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

  // ── On-page SEO ──
  partial.pageTitle = extractText(homepage, /<title[^>]*>([^<]{1,200})<\/title>/i);

  const metaDesc = extractText(homepage, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i)
    ?? extractText(homepage, /<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i);
  partial.hasMetaDescription = !!metaDesc;
  partial.metaDescriptionContent = metaDesc;

  partial.hasMobileViewport = /<meta[^>]+name=["']viewport["']/i.test(homepage);
  partial.hasOpenGraph = /<meta[^>]+property=["']og:/i.test(homepage);
  partial.hasCanonicalTag = /<link[^>]+rel=["']canonical["']/i.test(homepage);

  // Schema.org — extract actual types
  partial.hasSchemaMarkup = /application\/ld\+json/i.test(combined) || /schema\.org/i.test(combined);
  partial.schemaTypes = extractSchemaTypes(combined);

  // ── Analytics & Tracking ──
  const ga4Match = homepage.match(/G-([A-Z0-9]{6,})/);
  partial.hasGA4 = !!(ga4Match) || /gtag\(/i.test(homepage);
  partial.ga4MeasurementId = ga4Match ? `G-${ga4Match[1]}` : null;

  const gtmMatch = homepage.match(/GTM-([A-Z0-9]+)/);
  partial.hasGTM = !!(gtmMatch) || /googletagmanager\.com\/gtm/i.test(homepage);
  partial.gtmContainerId = gtmMatch ? `GTM-${gtmMatch[1]}` : null;

  const pixelMatch = homepage.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/);
  partial.hasMetaPixel = !!(pixelMatch) || /connect\.facebook\.net/i.test(homepage);
  partial.metaPixelId = pixelMatch ? pixelMatch[1] : null;

  const adsMatch = homepage.match(/AW-(\d+)/);
  partial.hasGoogleAds = !!(adsMatch) || /googleadservices\.com/i.test(homepage);
  partial.googleAdsId = adsMatch ? `AW-${adsMatch[1]}` : null;

  partial.hasLinkedInInsight = /linkedin\.com\/insight|_linkedin_partner_id/i.test(combined);
  partial.hasMicrosoftClarity = /clarity\.ms/i.test(combined);

  // Heatmap tools
  const heatmapTools: { key: string; name: string }[] = [
    { key: "hotjar.com", name: "Hotjar" },
    { key: "clarity.ms", name: "Microsoft Clarity" },
    { key: "mouseflow.com", name: "Mouseflow" },
    { key: "fullstory.com", name: "FullStory" },
    { key: "crazyegg.com", name: "Crazy Egg" },
    { key: "luckyorange.com", name: "Lucky Orange" },
  ];
  for (const { key, name } of heatmapTools) {
    if (combinedLower.includes(key)) {
      partial.hasHotjarOrHeatmap = true;
      partial.heatmapTool = name;
      break;
    }
  }

  // ── Conversion & Lead Capture ──
  partial.hasWhatsAppWidget = /wa\.me|whatsapp\.com\/send|whatsapp-chat|wa-chat|tidio.*whatsapp/i.test(combined);

  const chatTools: { key: string; name: string }[] = [
    { key: "crisp.chat", name: "Crisp" },
    { key: "intercom.io", name: "Intercom" },
    { key: "tidio.co", name: "Tidio" },
    { key: "tawk.to", name: "Tawk.to" },
    { key: "drift.com", name: "Drift" },
    { key: "zendesk.com/embeddable", name: "Zendesk" },
    { key: "freshchat", name: "Freshchat" },
    { key: "livechat", name: "LiveChat" },
    { key: "olark.com", name: "Olark" },
  ];
  for (const { key, name } of chatTools) {
    if (combinedLower.includes(key)) {
      partial.hasChatWidget = true;
      partial.chatWidgetTool = name;
      break;
    }
  }

  partial.hasCalendly = /calendly\.com/i.test(combined);
  partial.hasBookingSystem = partial.hasCalendly || containsAny(combined, [
    "cal.com", "acuityscheduling", "bookings.google", "book a call",
    "book a meeting", "schedule a call", "book now", "book a free",
    "schedule now", "pick a time",
  ]);

  partial.hasContactForm = /<form[^>]*>/i.test(combined) || /contact[_-]form|wpcf7|cf7|gravity.form|wpforms/i.test(combined);

  partial.hasPhoneNumber = /(\+91|\+971|\+1|\+44|\+65|\+60|tel:)[\s\-0-9]{7,15}/.test(combined)
    || /[0-9]{10}/.test(combined);

  partial.hasEmailAddress = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(combined);

  const ctaPatterns = [
    "get started", "get a quote", "request a demo", "book a call",
    "contact us", "schedule a meeting", "free consultation", "get in touch",
    "talk to us", "hire us", "work with us", "get proposal", "let's talk",
    "try for free", "sign up free", "start now", "book free", "claim free",
  ];
  const ctaMatches = ctaPatterns.filter(p => combinedLower.includes(p));
  partial.hasCTA = ctaMatches.length > 0;
  partial.ctaTexts = ctaMatches.slice(0, 5);

  partial.hasNewsletterForm = containsAny(combined, [
    "subscribe", "newsletter", "mailchimp", "klaviyo", "convertkit",
    "email updates", "join our list", "sign up for",
  ]);

  partial.hasExitIntentPopup = containsAny(combined, [
    "exit-intent", "exit_intent", "optinmonster", "popupsmart",
    "sumo.com", "hello bar", "wisepops", "convertful",
  ]);

  // ── Content Analysis ──
  partial.hasBlogSection = containsAny(combined, [
    "/blog", "/news", "/articles", "/insights", "/resources",
    "blog-post", "category/blog", "post-type", "wp-post",
  ]);

  // Count blog posts from links that look like article URLs
  const blogPostLinks = (combined.match(/href=["'][^"']*\/(?:blog|news|article|post|insight)\/[^"']{5,}["']/gi) ?? []);
  partial.estimatedBlogPostCount = Math.min(blogPostLinks.length, 50);

  partial.hasVideoContent = containsAny(combined, [
    "youtube.com/embed", "youtube.com/watch", "youtu.be/",
    "vimeo.com/video", "player.vimeo", "wistia.com",
    "<video ", "video-embed", "video-player",
  ]);

  partial.hasTestimonialsSection = containsAny(combined, [
    "testimonial", "what our clients", "what clients say", "client review",
    "customer review", "clutch", "trustpilot", "g2.com", "what they say",
  ]);

  partial.hasClientLogosSection = containsAny(combined, [
    "client-logo", "clients-logo", "our clients", "trusted by",
    "brands we work with", "our partners", "worked with", "logo-wall",
  ]);

  partial.hasPortfolioSection = containsAny(combined, [
    "portfolio", "our work", "case stud", "projects", "our projects",
    "showcase", "recent work", "featured work",
  ]);

  partial.hasFAQSection = containsAny(combined, ["faq", "frequently asked", "questions & answers", "q&a"]);

  partial.hasAboutPage = /href=["'][^"']*\/about[^"']*/i.test(combined) || combinedLower.includes("/about-us");
  partial.hasPricingPage = /href=["'][^"']*\/pric[^"']*/i.test(combined) || containsAny(combined, ["/packages", "/plans", "our packages", "pricing plans"]);
  partial.hasPrivacyPolicy = /privacy.polic|terms.of.service|terms.and.condition/i.test(combined);

  // Internal link count (rough)
  const internalLinks = combined.match(new RegExp(`href=["']${origin}[^"']*["']`, "gi")) ?? [];
  const relativeLinks = combined.match(/href=["']\/[^"']{2,}["']/gi) ?? [];
  partial.internalLinkCount = internalLinks.length + relativeLinks.length;

  // Social links (from any page)
  partial.instagramLink = extractText(combined, /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[^"'\s>?#]{3,40})/i);
  if (!partial.linkedInLink) partial.linkedInLink = extractText(combined, /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[^"'\s>?#]{3,60})/i);
  partial.facebookLink = extractText(combined, /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'\s>?#]{3,60})/i);
  partial.twitterLink = extractText(combined, /href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'\s>?#]{3,40})/i);
  partial.youtubeLink = extractText(combined, /href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)[^"'\s>?#]{3,60})/i);

  if (partial.instagramLink) partial.foundInstagram = true;
  if (partial.linkedInLink)  partial.foundLinkedIn  = true;
  if (partial.facebookLink)  partial.foundFacebook  = true;
  if (partial.youtubeLink)   partial.foundYouTube   = true;

  return partial;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google PageSpeed Insights (free tier, no API key)
// ─────────────────────────────────────────────────────────────────────────────

interface PSIResult {
  performanceScore: number;
  lcp: number | null;
  fcp: number | null;
  cls: number | null;
  ttfb: number | null;
}

async function fetchPageSpeedInsights(url: string): Promise<PSIResult | null> {
  try {
    const apiUrl = `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&fields=lighthouseResult`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(TIMEOUT_LONG) });
    if (!res.ok) return null;
    const data = await res.json() as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: {
          "largest-contentful-paint"?: { numericValue?: number };
          "first-contentful-paint"?: { numericValue?: number };
          "cumulative-layout-shift"?: { numericValue?: number };
          "server-response-time"?: { numericValue?: number };
        };
      };
    };
    const lr = data.lighthouseResult;
    if (!lr) return null;
    const score = Math.round((lr.categories?.performance?.score ?? 0) * 100);
    return {
      performanceScore: score,
      lcp:  lr.audits?.["largest-contentful-paint"]?.numericValue != null
              ? Math.round(lr.audits["largest-contentful-paint"].numericValue!) / 1000 : null,
      fcp:  lr.audits?.["first-contentful-paint"]?.numericValue != null
              ? Math.round(lr.audits["first-contentful-paint"].numericValue!) / 1000 : null,
      cls:  lr.audits?.["cumulative-layout-shift"]?.numericValue != null
              ? Math.round(lr.audits["cumulative-layout-shift"].numericValue! * 1000) / 1000 : null,
      ttfb: lr.audits?.["server-response-time"]?.numericValue != null
              ? Math.round(lr.audits["server-response-time"].numericValue!) / 1000 : null,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DuckDuckGo Instant Answer
// ─────────────────────────────────────────────────────────────────────────────

interface DDGResult {
  snippet: string | null;
  rating: string | null;
  reviewCount: string | null;
  foundGMB: boolean;
  gmbUrl: string | null;
  foundInstagram: boolean;
  foundLinkedIn: boolean;
}

async function fetchDuckDuckGo(companyName: string): Promise<DDGResult> {
  const out: DDGResult = { snippet: null, rating: null, reviewCount: null, foundGMB: false, gmbUrl: null, foundInstagram: false, foundLinkedIn: false };
  try {
    const q = encodeURIComponent(`${companyName} google reviews`);
    const res = await safeFetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`, { timeoutMs: 8_000 });
    if (!res?.ok) return out;
    const ddg = await res.json() as { AbstractText?: string; RelatedTopics?: { Text?: string; FirstURL?: string }[] };
    if (ddg.AbstractText) {
      out.snippet = ddg.AbstractText.slice(0, 300);
      const rm = ddg.AbstractText.match(/(\d[\d,]*)\s+(?:google\s+)?reviews?/i);
      if (rm) out.reviewCount = rm[1].replace(/,/g, "");
      const rtm = ddg.AbstractText.match(/(\d+\.?\d*)\s*(?:stars?|\/5)/i);
      if (rtm) out.rating = rtm[1];
    }
    for (const t of (ddg.RelatedTopics ?? []).slice(0, 15)) {
      const url = t.FirstURL ?? "";
      const text = (t.Text ?? "").toLowerCase();
      if (url.includes("google.com/maps") || url.includes("maps.google")) { out.foundGMB = true; out.gmbUrl = url; }
      if (text.includes("review")) {
        const rm = text.match(/(\d[\d,]*)\s+review/i); if (rm && !out.reviewCount) out.reviewCount = rm[1];
        const rtm = text.match(/(\d+\.?\d*)\s*(?:star|\/5)/i); if (rtm && !out.rating) out.rating = rtm[1];
      }
      if (url.includes("instagram.com")) out.foundInstagram = true;
      if (url.includes("linkedin.com")) out.foundLinkedIn = true;
    }
  } catch { /* non-critical */ }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Format evidence block for Claude
// ─────────────────────────────────────────────────────────────────────────────

export function formatSignalsForPrompt(s: WebSignalsResult, websiteUrl: string | null | undefined): string {
  const yn = (v: boolean) => v ? "✅ Yes" : "❌ No";
  const lines: string[] = [
    "═══════════════════════════════════════════════════",
    "LIVE DIGITAL INTELLIGENCE REPORT (gathered in real-time)",
    "═══════════════════════════════════════════════════",
  ];

  // ── Website Technical ──
  lines.push("\n── WEBSITE TECHNICAL ──");
  if (websiteUrl) {
    lines.push(`Protocol: ${s.ssl ? "✅ HTTPS (SSL active)" : "❌ HTTP (no SSL)"}`);
    lines.push(`Page Title: ${s.pageTitle ?? "NOT FOUND"}`);
    lines.push(`Meta Description: ${s.hasMetaDescription ? `✅ "${s.metaDescriptionContent?.slice(0, 100)}"` : "❌ Missing"}`);
    lines.push(`Mobile Viewport: ${yn(s.hasMobileViewport)}`);
    lines.push(`Open Graph Tags: ${yn(s.hasOpenGraph)}`);
    lines.push(`Canonical Tag: ${yn(s.hasCanonicalTag)}`);
    lines.push(`Schema.org / JSON-LD: ${s.hasSchemaMarkup ? `✅ Present — Types: [${s.schemaTypes.join(", ") || "generic"}]` : "❌ Missing"}`);
    lines.push(`sitemap.xml: ${s.hasSitemap ? `✅ Present${s.sitemapPageCount ? ` (~${s.sitemapPageCount} pages)` : ""}` : "❌ Not found"}`);
    lines.push(`robots.txt: ${yn(s.hasRobotsTxt)}`);
    lines.push(`Pages crawled successfully: ${s.crawledPageCount}`);
    lines.push(`Internal links detected: ~${s.internalLinkCount}`);
    if (s.fetchError) lines.push(`⚠️ Website Error: ${s.fetchError}`);
    if (s.htmlWordCount > 0) lines.push(`Homepage content: ~${s.htmlWordCount} words`);
  } else {
    lines.push("⚠️ No website URL — website signals cannot be assessed.");
  }

  // ── Performance (Real PageSpeed Insights) ──
  lines.push("\n── PERFORMANCE (Google PageSpeed Insights — Mobile) ──");
  if (s.pageSpeedScore !== null) {
    lines.push(`Performance Score: ${s.pageSpeedScore}/100 — ${s.pageSpeedCategory ?? "N/A"}`);
    if (s.pageSpeedLCP !== null) lines.push(`LCP (Largest Contentful Paint): ${s.pageSpeedLCP}s ${s.pageSpeedLCP <= 2.5 ? "✅ Good" : s.pageSpeedLCP <= 4.0 ? "⚠️ Needs Improvement" : "❌ Poor"}`);
    if (s.pageSpeedFCP !== null) lines.push(`FCP (First Contentful Paint): ${s.pageSpeedFCP}s`);
    if (s.pageSpeedCLS !== null) lines.push(`CLS (Layout Shift): ${s.pageSpeedCLS} ${s.pageSpeedCLS <= 0.1 ? "✅ Good" : s.pageSpeedCLS <= 0.25 ? "⚠️ Needs Improvement" : "❌ Poor"}`);
    if (s.pageSpeedTTFB !== null) lines.push(`TTFB (Server Response): ${s.pageSpeedTTFB}s`);
  } else {
    lines.push("PageSpeed: Could not fetch (PSI API unavailable or URL blocked)");
  }

  // ── Analytics & Tracking ──
  lines.push("\n── ANALYTICS & TRACKING ──");
  lines.push(`GA4: ${s.hasGA4 ? `✅ Installed${s.ga4MeasurementId ? ` — ID: ${s.ga4MeasurementId}` : ""}` : "❌ Not detected in page source"}`);
  lines.push(`Google Tag Manager: ${s.hasGTM ? `✅ Installed${s.gtmContainerId ? ` — ${s.gtmContainerId}` : ""}` : "❌ Not detected"}`);
  lines.push(`Meta (Facebook) Pixel: ${s.hasMetaPixel ? `✅ Installed${s.metaPixelId ? ` — Pixel ID: ${s.metaPixelId}` : ""}` : "❌ Not detected"}`);
  lines.push(`Google Ads (Conversion Tag): ${s.hasGoogleAds ? `✅ Detected${s.googleAdsId ? ` — ${s.googleAdsId}` : ""}` : "❌ Not detected"}`);
  lines.push(`LinkedIn Insight Tag: ${yn(s.hasLinkedInInsight)}`);
  lines.push(`Heatmap Tool: ${s.hasHotjarOrHeatmap ? `✅ ${s.heatmapTool}` : "❌ None detected"}`);
  lines.push(`Microsoft Clarity: ${yn(s.hasMicrosoftClarity)}`);

  // ── Conversion & Lead Capture ──
  lines.push("\n── CONVERSION & LEAD CAPTURE ──");
  lines.push(`Contact Form: ${yn(s.hasContactForm)}`);
  lines.push(`CTA Buttons: ${s.hasCTA ? `✅ Found: "${s.ctaTexts.join('", "')}"` : "❌ No clear CTAs found"}`);
  lines.push(`Phone Number: ${yn(s.hasPhoneNumber)}`);
  lines.push(`Email Address: ${yn(s.hasEmailAddress)}`);
  lines.push(`WhatsApp Widget: ${yn(s.hasWhatsAppWidget)}`);
  lines.push(`Live Chat: ${s.hasChatWidget ? `✅ ${s.chatWidgetTool}` : "❌ None detected"}`);
  lines.push(`Calendly / Booking: ${yn(s.hasCalendly)}`);
  lines.push(`Any Booking System: ${yn(s.hasBookingSystem)}`);
  lines.push(`Newsletter Signup: ${yn(s.hasNewsletterForm)}`);
  lines.push(`Exit-Intent / Popup: ${yn(s.hasExitIntentPopup)}`);

  // ── Content ──
  lines.push("\n── CONTENT & CREDIBILITY ──");
  lines.push(`Blog / Content Section: ${s.hasBlogSection ? `✅ Present${s.estimatedBlogPostCount > 0 ? ` — ~${s.estimatedBlogPostCount} post links detected` : ""}` : "❌ Not found"}`);
  lines.push(`Video Content: ${yn(s.hasVideoContent)}`);
  lines.push(`Testimonials: ${yn(s.hasTestimonialsSection)}`);
  lines.push(`Client Logos / Social Proof Wall: ${yn(s.hasClientLogosSection)}`);
  lines.push(`Portfolio / Case Studies: ${yn(s.hasPortfolioSection)}`);
  lines.push(`FAQ Section: ${yn(s.hasFAQSection)}`);
  lines.push(`About Page: ${yn(s.hasAboutPage)}`);
  lines.push(`Pricing / Packages Page: ${yn(s.hasPricingPage)}`);
  lines.push(`Privacy Policy / Terms: ${yn(s.hasPrivacyPolicy)}`);

  // ── Social Media ──
  lines.push("\n── SOCIAL MEDIA PRESENCE ──");
  lines.push(`Instagram: ${s.instagramLink ? `✅ ${s.instagramLink}` : s.foundInstagram ? "✅ Found via search" : "❌ Not found"}`);
  lines.push(`LinkedIn: ${s.linkedInLink ? `✅ ${s.linkedInLink}` : s.foundLinkedIn ? "✅ Found via search" : "❌ Not found"}`);
  lines.push(`Facebook: ${s.facebookLink ? `✅ ${s.facebookLink}` : s.foundFacebook ? "✅ Found via search" : "❌ Not found"}`);
  lines.push(`YouTube: ${s.youtubeLink ? `✅ ${s.youtubeLink}` : s.foundYouTube ? "✅ Found via search" : "❌ Not found"}`);
  lines.push(`Twitter/X: ${s.twitterLink ? `✅ ${s.twitterLink}` : "❌ Not found"}`);

  // ── SEO & Indexing ──
  lines.push("\n── SEO & INDEXING DATA ──");
  if (s.indexedPageCount !== null) {
    lines.push(`Indexed Pages (site: query): ~${s.indexedPageCount}`);
  } else {
    lines.push("Indexed Pages: Could not determine");
  }

  // ── GMB ──
  lines.push("\n── GOOGLE MY BUSINESS (PUBLIC DATA) ──");
  lines.push(`GMB Listing Found: ${s.foundGMBListing ? `✅ Yes${s.gmbListingUrl ? ` — ${s.gmbListingUrl}` : ""}` : "❌ Not found in search (may still exist)"}`);
  if (s.gmbVerified) lines.push("GMB Verified indicator found in search results: ✅ Yes");
  lines.push(`Google Reviews: ${s.foundGoogleReviews
    ? `✅ Found — ${s.estimatedReviewCount ? `~${s.estimatedReviewCount} reviews` : "count unknown"}${s.estimatedRating ? `, avg rating ${s.estimatedRating}★` : ""}`
    : "❌ No review data found in public search"}`);
  if (s.googleSearchSnippet) lines.push(`Brand Search Snippet: "${s.googleSearchSnippet.slice(0, 200)}"`);
  lines.push("");
  lines.push("⚠️  GMB RULE: Internal GMB states (post frequency, photo dates, Q&A, messaging, category completeness)");
  lines.push("    CANNOT be verified externally. For all '(requires manual check)' signals → use status='warning'.");
  lines.push("    Only use 'missing' if there is ZERO evidence of any GMB presence whatsoever.");

  // ── Assessment Rules ──
  lines.push("\n═══════════════════════════════════════════════════");
  lines.push("SIGNAL ASSESSMENT RULES:");
  lines.push("1. Evidence directly found above → 'present' (confirmed) or 'missing' (confirmed absent).");
  lines.push("2. '(requires manual check)' signals → ALWAYS 'warning'. Say 'Requires verification'.");
  lines.push("3. GMB internal states → 'warning' (not 'missing') for active businesses.");
  lines.push("4. Traffic internals (GA4 goals, rankings, bounce rate) → 'warning'.");
  lines.push("5. NO generic explanations — cite the specific evidence or reason from above.");
  lines.push("6. Distribute statuses: a real audit has mix of present/warning/missing.");
  lines.push("═══════════════════════════════════════════════════");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic signal assessment — maps WebSignalsResult directly to all
// 59 audit signals with factual, evidence-cited explanations.
// This replaces the imprecise approach of asking Claude to map evidence to
// signals from a flat prompt, producing 100% accurate technical signal results.
// ─────────────────────────────────────────────────────────────────────────────

export type SignalAssessment = {
  signalId: number;
  status: "present" | "missing" | "warning";
  explanation: string;
};

export function assessSignalsDeterministically(
  s: WebSignalsResult,
  websiteUrl: string | null | undefined,
): SignalAssessment[] {
  const hasWebsite = !!(websiteUrl && s.crawledPageCount > 0);
  const noWebsite = !websiteUrl;

  const socialLinksOnSite = [
    s.instagramLink ? "Instagram" : "",
    s.linkedInLink ? "LinkedIn" : "",
    s.facebookLink ? "Facebook" : "",
    s.youtubeLink ? "YouTube" : "",
    s.twitterLink ? "Twitter/X" : "",
  ].filter(Boolean);

  return [
    // ── 1: Website Exists & Is Live ──
    {
      signalId: 1,
      status: noWebsite ? "missing" : s.crawledPageCount > 0 ? "present" : "missing",
      explanation: noWebsite
        ? "No website URL provided for this lead."
        : s.crawledPageCount > 0
        ? `Website is live — ${s.crawledPageCount} page(s) returned HTTP 200 during crawl.`
        : "Website URL provided but all fetch attempts failed — site may be down or blocking crawlers.",
    },
    // ── 2: HTTPS / SSL Certificate ──
    {
      signalId: 2,
      status: noWebsite ? "warning" : s.ssl ? "present" : "missing",
      explanation: noWebsite
        ? "No website URL — SSL cannot be assessed."
        : s.ssl
        ? "Website loads over HTTPS — SSL/TLS certificate is active and valid."
        : "Website URL uses HTTP — no SSL/TLS certificate detected.",
    },
    // ── 3: Meta Title & Description ──
    {
      signalId: 3,
      status: !hasWebsite
        ? "warning"
        : s.pageTitle && s.hasMetaDescription
        ? "present"
        : s.pageTitle
        ? "warning"
        : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.pageTitle && s.hasMetaDescription
        ? `Title: "${s.pageTitle.slice(0, 60)}" | Meta description: "${s.metaDescriptionContent?.slice(0, 80)}".`
        : s.pageTitle
        ? `Title found: "${s.pageTitle.slice(0, 60)}" — but meta description is missing from page HTML.`
        : "Neither page title nor meta description found in page HTML.",
    },
    // ── 4: Mobile-Responsive Design ──
    {
      signalId: 4,
      status: !hasWebsite ? "warning" : s.hasMobileViewport ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasMobileViewport
        ? 'Viewport meta tag <meta name="viewport"> detected in page HTML — mobile responsive.'
        : "No viewport meta tag found in page HTML — mobile responsiveness is likely broken.",
    },
    // ── 5: XML Sitemap ──
    {
      signalId: 5,
      status: !hasWebsite ? "warning" : s.hasSitemap ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasSitemap
        ? `sitemap.xml found at standard path${s.sitemapPageCount ? ` — references ~${s.sitemapPageCount} pages` : ""}.`
        : "sitemap.xml not found at /sitemap.xml or /sitemap_index.xml.",
    },
    // ── 6: Robots.txt ──
    {
      signalId: 6,
      status: !hasWebsite ? "warning" : s.hasRobotsTxt ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasRobotsTxt
        ? "robots.txt found at /robots.txt — crawl directives are configured."
        : "robots.txt not found at standard /robots.txt path.",
    },
    // ── 7: Canonical Tags ──
    {
      signalId: 7,
      status: !hasWebsite ? "warning" : s.hasCanonicalTag ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasCanonicalTag
        ? 'Canonical <link rel="canonical"> tag detected in page HTML.'
        : "No canonical tag found in page HTML — risk of duplicate content issues for SEO.",
    },
    // ── 8: Open Graph / Social Meta Tags ──
    {
      signalId: 8,
      status: !hasWebsite ? "warning" : s.hasOpenGraph ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasOpenGraph
        ? 'Open Graph meta tags (og:title, og:description, etc.) detected in page HTML.'
        : "No Open Graph tags found — social media link previews will display generic or empty content.",
    },
    // ── 9: Schema Markup / Structured Data ──
    {
      signalId: 9,
      status: !hasWebsite ? "warning" : s.hasSchemaMarkup ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasSchemaMarkup
        ? `Schema.org JSON-LD detected — types found: [${s.schemaTypes.join(", ") || "generic"}].`
        : "No Schema.org / JSON-LD structured data found in page source — rich results not enabled.",
    },
    // ── 10: Indexed Page Count ──
    {
      signalId: 10,
      status: !websiteUrl
        ? "warning"
        : s.indexedPageCount === null
        ? "warning"
        : s.indexedPageCount >= 10
        ? "present"
        : s.indexedPageCount >= 1
        ? "warning"
        : "missing",
      explanation: !websiteUrl
        ? "No website URL — indexed page count cannot be assessed."
        : s.indexedPageCount === null
        ? "site: query returned no results — indexation status could not be determined."
        : `site: query returned ~${s.indexedPageCount} indexed pages${s.indexedPageCount < 5 ? " — very few pages indexed, possible crawl issue" : ""}.`,
    },
    // ── 11: GMB Listing Found ──
    {
      signalId: 11,
      status: s.foundGMBListing ? "present" : "warning",
      explanation: s.foundGMBListing
        ? `Google My Business listing found in public search results${s.gmbListingUrl ? ` — ${s.gmbListingUrl}` : ""}.`
        : "GMB listing not found in public search results — may exist but not surfacing for this company name.",
    },
    // ── 12: GMB Profile Verified (manual check) ──
    {
      signalId: 12,
      status: "warning",
      explanation: "Requires manual verification — GMB verification status can only be confirmed inside Google Business Profile dashboard.",
    },
    // ── 13: Google Reviews Present ──
    {
      signalId: 13,
      status: s.foundGoogleReviews ? "present" : "warning",
      explanation: s.foundGoogleReviews
        ? `Google reviews found${s.estimatedReviewCount ? ` — approximately ${s.estimatedReviewCount} reviews` : ""}${s.estimatedRating ? `, average rating ${s.estimatedRating}★` : ""}.`
        : "No Google review data found in public search results — reviews may exist but were not returned.",
    },
    // ── 14: Average Star Rating ≥ 4.0 ──
    {
      signalId: 14,
      status: !s.estimatedRating
        ? "warning"
        : parseFloat(s.estimatedRating) >= 4.0
        ? "present"
        : "missing",
      explanation: !s.estimatedRating
        ? "No star rating found in public search results — cannot assess."
        : parseFloat(s.estimatedRating) >= 4.0
        ? `Average rating ${s.estimatedRating}★ — meets the ≥ 4.0 threshold.`
        : `Average rating ${s.estimatedRating}★ — below the required 4.0 threshold.`,
    },
    // ── 15: Review Response Rate (manual check) ──
    {
      signalId: 15,
      status: "warning",
      explanation: "Requires manual verification — review response rate is only accessible inside Google Business Profile dashboard.",
    },
    // ── 16: GMB Posts Active (manual check) ──
    {
      signalId: 16,
      status: "warning",
      explanation: "Requires manual verification — GMB post frequency and recency can only be confirmed inside Business Profile.",
    },
    // ── 17: GMB Photos Up-to-Date (manual check) ──
    {
      signalId: 17,
      status: "warning",
      explanation: "Requires manual verification — photo upload dates and freshness are only visible inside Google Business Profile.",
    },
    // ── 18: Q&A Section Active (manual check) ──
    {
      signalId: 18,
      status: "warning",
      explanation: "Requires manual verification — Q&A activity and response quality can only be assessed inside Business Profile.",
    },
    // ── 19: GMB Messaging Enabled (manual check) ──
    {
      signalId: 19,
      status: "warning",
      explanation: "Requires manual verification — GMB messaging feature status can only be confirmed inside Google Business Profile.",
    },
    // ── 20: LinkedIn Company Page ──
    {
      signalId: 20,
      status: s.foundLinkedIn || !!s.linkedInLink ? "present" : "missing",
      explanation: s.linkedInLink
        ? `LinkedIn company page linked on website: ${s.linkedInLink}.`
        : s.foundLinkedIn
        ? "LinkedIn presence confirmed via search results."
        : "No LinkedIn company page found via website links or search results.",
    },
    // ── 21: Instagram Profile Active ──
    {
      signalId: 21,
      status: s.foundInstagram || !!s.instagramLink ? "present" : "missing",
      explanation: s.instagramLink
        ? `Instagram profile linked on website: ${s.instagramLink}.`
        : s.foundInstagram
        ? "Instagram presence confirmed via search results."
        : "No Instagram profile found via website links or search results.",
    },
    // ── 22: Facebook Page Active ──
    {
      signalId: 22,
      status: s.foundFacebook || !!s.facebookLink ? "present" : "missing",
      explanation: s.facebookLink
        ? `Facebook page linked on website: ${s.facebookLink}.`
        : s.foundFacebook
        ? "Facebook presence confirmed via search results."
        : "No Facebook page found via website links or search results.",
    },
    // ── 23: YouTube Channel Present ──
    {
      signalId: 23,
      status: s.foundYouTube || !!s.youtubeLink ? "present" : "missing",
      explanation: s.youtubeLink
        ? `YouTube channel linked on website: ${s.youtubeLink}.`
        : s.foundYouTube
        ? "YouTube presence confirmed via search results."
        : "No YouTube channel found via website links or search results.",
    },
    // ── 24: Twitter / X Profile ──
    {
      signalId: 24,
      status: s.twitterLink ? "present" : "warning",
      explanation: s.twitterLink
        ? `Twitter/X profile linked on website: ${s.twitterLink}.`
        : "No Twitter/X profile link detected in website HTML or search results.",
    },
    // ── 25: Social Links on Website ──
    {
      signalId: 25,
      status: !hasWebsite
        ? "warning"
        : socialLinksOnSite.length > 0
        ? "present"
        : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : socialLinksOnSite.length > 0
        ? `Social media links found in website HTML: ${socialLinksOnSite.join(", ")}.`
        : "No social media links detected in any crawled page HTML.",
    },
    // ── 26: Consistent Brand Across Platforms (manual check) ──
    {
      signalId: 26,
      status: "warning",
      explanation: "Requires manual verification — cross-platform brand consistency (name, logo, bio) must be assessed by visiting each profile.",
    },
    // ── 27: Google Analytics 4 Installed ──
    {
      signalId: 27,
      status: !hasWebsite ? "warning" : s.hasGA4 ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasGA4
        ? `GA4 tracking tag detected in page source${s.ga4MeasurementId ? ` — Measurement ID: ${s.ga4MeasurementId}` : ""}.`
        : "No GA4 tag (G-XXXXXXXX or gtag.js) found in page HTML or scripts.",
    },
    // ── 28: Google Tag Manager Installed ──
    {
      signalId: 28,
      status: !hasWebsite ? "warning" : s.hasGTM ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasGTM
        ? `GTM container detected in page source${s.gtmContainerId ? ` — Container ID: ${s.gtmContainerId}` : ""}.`
        : "No Google Tag Manager snippet (GTM-XXXXX or gtm.js) found in page HTML.",
    },
    // ── 29: Meta Pixel / Facebook Pixel Installed ──
    {
      signalId: 29,
      status: !hasWebsite ? "warning" : s.hasMetaPixel ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasMetaPixel
        ? `Meta (Facebook) Pixel detected in page source${s.metaPixelId ? ` — Pixel ID: ${s.metaPixelId}` : ""}.`
        : "No Meta Pixel code (fbq or connect.facebook.net) found in page HTML.",
    },
    // ── 30: Google Ads Conversion Tracking ──
    {
      signalId: 30,
      status: !hasWebsite ? "warning" : s.hasGoogleAds ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasGoogleAds
        ? `Google Ads conversion tag detected in page source${s.googleAdsId ? ` — ID: ${s.googleAdsId}` : ""}.`
        : "No Google Ads conversion tag (AW-XXXXX or googleadservices.com) found in page HTML.",
    },
    // ── 31: LinkedIn Insight Tag ──
    {
      signalId: 31,
      status: !hasWebsite ? "warning" : s.hasLinkedInInsight ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasLinkedInInsight
        ? "LinkedIn Insight Tag detected in page source (_linkedin_partner_id)."
        : "No LinkedIn Insight Tag found in page HTML.",
    },
    // ── 32: Heatmap Tool (Hotjar / Clarity) ──
    {
      signalId: 32,
      status: !hasWebsite ? "warning" : (s.hasHotjarOrHeatmap || s.hasMicrosoftClarity) ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasHotjarOrHeatmap
        ? `Heatmap tool detected in page source: ${s.heatmapTool}.`
        : s.hasMicrosoftClarity
        ? "Microsoft Clarity (heatmap) detected in page source."
        : "No heatmap tool (Hotjar, Microsoft Clarity, Mouseflow, etc.) detected in page HTML.",
    },
    // ── 33: Microsoft Clarity Installed ──
    {
      signalId: 33,
      status: !hasWebsite ? "warning" : s.hasMicrosoftClarity ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasMicrosoftClarity
        ? "Microsoft Clarity script (clarity.ms) detected in page source."
        : "No Microsoft Clarity script found in page HTML.",
    },
    // ── 34: Conversion Goals Configured (manual check) ──
    {
      signalId: 34,
      status: "warning",
      explanation: "Requires manual verification — conversion goal configuration can only be confirmed inside GA4 or GTM dashboard.",
    },
    // ── 35: Contact Form Present ──
    {
      signalId: 35,
      status: !hasWebsite ? "warning" : s.hasContactForm ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasContactForm
        ? "Contact form (<form> element or known form plugin) detected in crawled page HTML."
        : "No contact form detected in any crawled page.",
    },
    // ── 36: Phone Number Visible ──
    {
      signalId: 36,
      status: !hasWebsite ? "warning" : s.hasPhoneNumber ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasPhoneNumber
        ? "Phone number (tel: link or numeric pattern) detected in crawled page HTML."
        : "No phone number found in any crawled page.",
    },
    // ── 37: Email Address Visible ──
    {
      signalId: 37,
      status: !hasWebsite ? "warning" : s.hasEmailAddress ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasEmailAddress
        ? "Email address detected in crawled page HTML."
        : "No email address found in any crawled page.",
    },
    // ── 38: Clear CTA Buttons ──
    {
      signalId: 38,
      status: !hasWebsite ? "warning" : s.hasCTA ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasCTA
        ? `CTA text detected in page HTML: "${s.ctaTexts.slice(0, 3).join('", "')}".`
        : "No clear call-to-action text patterns detected in crawled pages.",
    },
    // ── 39: WhatsApp Chat Widget ──
    {
      signalId: 39,
      status: !hasWebsite ? "warning" : s.hasWhatsAppWidget ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasWhatsAppWidget
        ? "WhatsApp chat widget or wa.me link detected in page HTML."
        : "No WhatsApp chat link or widget detected in any crawled page.",
    },
    // ── 40: Live Chat / Chatbot ──
    {
      signalId: 40,
      status: !hasWebsite ? "warning" : s.hasChatWidget ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasChatWidget
        ? `Live chat tool detected in page source: ${s.chatWidgetTool}.`
        : "No live chat or chatbot widget detected in page HTML.",
    },
    // ── 41: Booking / Calendar System ──
    {
      signalId: 41,
      status: !hasWebsite ? "warning" : (s.hasCalendly || s.hasBookingSystem) ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasCalendly
        ? "Calendly booking widget detected in page HTML."
        : s.hasBookingSystem
        ? "Booking system or scheduling link detected in page HTML."
        : "No Calendly or booking system detected in any crawled page.",
    },
    // ── 42: Newsletter Signup Form ──
    {
      signalId: 42,
      status: !hasWebsite ? "warning" : s.hasNewsletterForm ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasNewsletterForm
        ? "Newsletter or email signup form detected in crawled page HTML."
        : "No newsletter signup form detected in any crawled page.",
    },
    // ── 43: Exit-Intent Popup ──
    {
      signalId: 43,
      status: !hasWebsite ? "warning" : s.hasExitIntentPopup ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasExitIntentPopup
        ? "Exit-intent popup script detected in page HTML."
        : "No exit-intent popup script detected in any crawled page.",
    },
    // ── 44: About Us Page ──
    {
      signalId: 44,
      status: !hasWebsite ? "warning" : s.hasAboutPage ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasAboutPage
        ? "About Us / About page link detected in website navigation or HTML."
        : "No About page found in crawled pages or navigation links.",
    },
    // ── 45: Portfolio / Case Studies ──
    {
      signalId: 45,
      status: !hasWebsite ? "warning" : s.hasPortfolioSection ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasPortfolioSection
        ? "Portfolio, case studies, or 'Our Work' section detected in crawled pages."
        : "No portfolio or case studies section found in crawled pages.",
    },
    // ── 46: Testimonials / Reviews Section ──
    {
      signalId: 46,
      status: !hasWebsite ? "warning" : s.hasTestimonialsSection ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasTestimonialsSection
        ? "Testimonials or client reviews section detected in crawled page HTML."
        : "No testimonials or reviews section found in crawled pages.",
    },
    // ── 47: Client Logos / Trusted By ──
    {
      signalId: 47,
      status: !hasWebsite ? "warning" : s.hasClientLogosSection ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasClientLogosSection
        ? 'Client logos or "Trusted By" section detected in crawled page HTML.'
        : "No client logos or trust badge section found in crawled pages.",
    },
    // ── 48: Blog / News Section ──
    {
      signalId: 48,
      status: !hasWebsite ? "warning" : s.hasBlogSection ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasBlogSection
        ? `Blog or news section detected${s.estimatedBlogPostCount > 0 ? ` — ~${s.estimatedBlogPostCount} article links found` : ""}.`
        : "No blog or news section found in crawled pages.",
    },
    // ── 49: Video Content Present ──
    {
      signalId: 49,
      status: !hasWebsite ? "warning" : s.hasVideoContent ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasVideoContent
        ? "Embedded video content (YouTube embed or HTML5 video tag) detected in page HTML."
        : "No embedded video content found in any crawled page.",
    },
    // ── 50: FAQ Section ──
    {
      signalId: 50,
      status: !hasWebsite ? "warning" : s.hasFAQSection ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasFAQSection
        ? "FAQ section detected in crawled page HTML."
        : "No FAQ section found in crawled pages.",
    },
    // ── 51: Pricing Page ──
    {
      signalId: 51,
      status: !hasWebsite ? "warning" : s.hasPricingPage ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasPricingPage
        ? "Pricing or packages page detected in site crawl."
        : "No pricing or packages page found in crawled pages.",
    },
    // ── 52: Privacy Policy Page ──
    {
      signalId: 52,
      status: !hasWebsite ? "warning" : s.hasPrivacyPolicy ? "present" : "missing",
      explanation: !hasWebsite
        ? "Cannot assess — website was not crawled successfully."
        : s.hasPrivacyPolicy
        ? "Privacy Policy or Terms page link detected in crawled page HTML."
        : "No Privacy Policy link found in any crawled page.",
    },
    // ── 53: PageSpeed Score ≥ 70 (Mobile) ──
    {
      signalId: 53,
      status: s.pageSpeedScore === null
        ? "warning"
        : s.pageSpeedScore >= 70
        ? "present"
        : "missing",
      explanation: s.pageSpeedScore === null
        ? "PageSpeed Insights score unavailable — API did not return results for this URL."
        : `Mobile PageSpeed score: ${s.pageSpeedScore}/100 — ${s.pageSpeedScore >= 90 ? "Excellent" : s.pageSpeedScore >= 70 ? "Meets threshold" : "Below 70 — needs improvement"}.`,
    },
    // ── 54: LCP < 2.5s ──
    {
      signalId: 54,
      status: s.pageSpeedLCP === null
        ? "warning"
        : s.pageSpeedLCP < 2.5
        ? "present"
        : "missing",
      explanation: s.pageSpeedLCP === null
        ? "LCP data unavailable from PageSpeed Insights."
        : `Largest Contentful Paint: ${s.pageSpeedLCP}s — ${s.pageSpeedLCP < 2.5 ? "Good (< 2.5s)" : s.pageSpeedLCP < 4.0 ? "Needs Improvement (2.5–4.0s)" : "Poor (> 4.0s)"}.`,
    },
    // ── 55: CLS < 0.1 ──
    {
      signalId: 55,
      status: s.pageSpeedCLS === null
        ? "warning"
        : s.pageSpeedCLS < 0.1
        ? "present"
        : "missing",
      explanation: s.pageSpeedCLS === null
        ? "CLS data unavailable from PageSpeed Insights."
        : `Cumulative Layout Shift: ${s.pageSpeedCLS} — ${s.pageSpeedCLS < 0.1 ? "Good (< 0.1)" : s.pageSpeedCLS < 0.25 ? "Needs Improvement (0.1–0.25)" : "Poor (> 0.25)"}.`,
    },
    // ── 56: FCP < 1.8s ──
    {
      signalId: 56,
      status: s.pageSpeedFCP === null
        ? "warning"
        : s.pageSpeedFCP < 1.8
        ? "present"
        : "missing",
      explanation: s.pageSpeedFCP === null
        ? "FCP data unavailable from PageSpeed Insights."
        : `First Contentful Paint: ${s.pageSpeedFCP}s — ${s.pageSpeedFCP < 1.8 ? "Good (< 1.8s)" : s.pageSpeedFCP < 3.0 ? "Needs Improvement" : "Poor"}.`,
    },
    // ── 57: HTTPS Redirect (HTTP → HTTPS) ──
    {
      signalId: 57,
      status: !websiteUrl ? "warning" : s.ssl ? "present" : "missing",
      explanation: !websiteUrl
        ? "No website URL — cannot assess HTTPS redirect."
        : s.ssl
        ? "Website is served over HTTPS — HTTP-to-HTTPS redirect is active."
        : "Website does not use HTTPS — no SSL or redirect configured.",
    },
    // ── 58: Core Web Vitals — Good ──
    {
      signalId: 58,
      status: s.pageSpeedLCP !== null && s.pageSpeedCLS !== null && s.pageSpeedFCP !== null
        ? (s.pageSpeedLCP < 2.5 && s.pageSpeedCLS < 0.1 && s.pageSpeedFCP < 1.8 ? "present" : "missing")
        : "warning",
      explanation: s.pageSpeedLCP !== null && s.pageSpeedCLS !== null && s.pageSpeedFCP !== null
        ? (s.pageSpeedLCP < 2.5 && s.pageSpeedCLS < 0.1 && s.pageSpeedFCP < 1.8
          ? `All Core Web Vitals in Good range — LCP: ${s.pageSpeedLCP}s, CLS: ${s.pageSpeedCLS}, FCP: ${s.pageSpeedFCP}s.`
          : `Core Web Vitals not all passing — LCP: ${s.pageSpeedLCP}s, CLS: ${s.pageSpeedCLS}, FCP: ${s.pageSpeedFCP}s.`)
        : "Core Web Vitals field data requires Google Search Console — PageSpeed lab data used as proxy indicator.",
    },
    // ── 59: Keyword Rankings Tracked (manual check) ──
    {
      signalId: 59,
      status: "warning",
      explanation: "Requires manual verification — keyword ranking tracking can only be confirmed inside Google Search Console or a third-party SEO tool.",
    },
  ];
}

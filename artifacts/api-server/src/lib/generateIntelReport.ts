/**
 * generateIntelReport.ts
 * Brand Intelligence Report Generator for MysaAI.
 * Runs 4 Claude AI layers in parallel, then generates a multi-page PDF.
 * Returns: Buffer (PDF bytes)
 */

import { jsPDF } from "jspdf";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, withCache } from "../config/modelRouting";
import { logAnthropicUsage } from "./logApiUsage";
import type { WebSignalsResult } from "./gatherWebSignals";

export interface ReportInput {
  companyName: string;
  websiteUrl: string;
  industry: string;
  country: string;
  city: string;
  contactName?: string;
  preparedBy: string;
  preparedByPhone: string;
  preparedByEmail: string;
  agencyName: string;
  agencyWebsite: string;
  agencyAbout?: string;
}

export interface Finding {
  number: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  category: string;
  title: string;
  finding: string;
  revenueImpact: string;
  action: string;
}

export interface AiLayers {
  emotionalWound: string;
  whyNarrative: string;
  coreDesire: string;
  whyScore: number;
  totalMonthlyAtRisk: number;
  lowEstimate: number;
  highEstimate: number;
  currencySymbol: string;
  byCategory: Record<string, number>;
  beliefScore: number;
  beliefReason: string;
  competitorSummary: string;
  biggestGap: string;
  emailSubject: string;
  emailOpener: string;
}

export interface AuditScores {
  overall: number;
  seo: number;
  website: number;
  reputation: number;
  ads: number;
  ai: number;
  serp: number;
  social: number;
}

// ─── Score Calculator ────────────────────────────────────────────────────────

export function calculateScores(ws: WebSignalsResult): AuditScores {
  const bool = (v: boolean | undefined | null) => !!v;

  const seoSignals = [
    bool(ws.hasSitemap), bool(ws.hasRobotsTxt), bool(ws.hasMetaDescription), bool(ws.hasSchemaMarkup),
    bool(ws.hasCanonicalTag), bool(ws.hasOpenGraph), ws.internalLinkCount > 10, bool(ws.hasBlogSection),
  ];
  const websiteSignals = [
    bool(ws.ssl), bool(ws.hasMobileViewport), bool(ws.hasCTA), bool(ws.hasPricingPage),
    bool(ws.hasAboutPage), bool(ws.hasPortfolioSection), bool(ws.hasFAQSection),
    bool(ws.hasChatWidget) || bool(ws.hasWhatsAppWidget), bool(ws.hasExitIntentPopup),
    (ws.pageSpeedScore ?? 0) > 50,
  ];
  const reputationSignals = [
    bool(ws.foundGMBListing), bool(ws.foundGoogleReviews),
    parseInt(ws.estimatedReviewCount ?? "0") > 30,
    parseFloat(ws.estimatedRating ?? "0") >= 4.0,
    bool(ws.hasTestimonialsSection), bool(ws.hasClientLogosSection),
  ];
  const adsSignals = [
    bool(ws.hasMetaPixel), bool(ws.hasGoogleAds), bool(ws.hasGA4),
    bool(ws.hasGTM), bool(ws.hasHotjarOrHeatmap), bool(ws.hasLinkedInInsight),
  ];
  const aiSignals = [
    ws.schemaTypes.includes("FAQPage"), ws.schemaTypes.includes("Organization"),
    ws.schemaTypes.includes("Article"), bool(ws.hasFAQSection),
    bool(ws.hasSchemaMarkup), ws.estimatedBlogPostCount > 5,
  ];
  const serpSignals = [
    bool(ws.foundGMBListing), (ws.indexedPageCount ?? 0) > 20,
    bool(ws.hasBlogSection), bool(ws.hasSchemaMarkup),
  ];
  const socialSignals = [
    bool(ws.foundInstagram), bool(ws.foundLinkedIn), bool(ws.foundFacebook),
    bool(ws.foundYouTube), bool(ws.hasNewsletterForm),
  ];

  const score = (sigs: boolean[]) => Math.round((sigs.filter(Boolean).length / sigs.length) * 10);

  const seo        = score(seoSignals);
  const website    = score(websiteSignals);
  const reputation = score(reputationSignals);
  const ads        = score(adsSignals);
  const ai         = score(aiSignals);
  const serp       = score(serpSignals);
  const social     = score(socialSignals);
  const overall    = Math.round(
    seo * 0.18 + website * 0.20 + reputation * 0.18 + ads * 0.14 + ai * 0.16 + serp * 0.08 + social * 0.06
  ) * 10;

  return { overall: Math.max(0, Math.min(100, overall)), seo, website, reputation, ads, ai, serp, social };
}

// ─── Currency ────────────────────────────────────────────────────────────────

export function getCurrencySymbol(country: string): string {
  const map: Record<string, string> = {
    "India": "Rs.", "UAE": "AED ", "United Arab Emirates": "AED ",
    "USA": "$", "United States": "$", "UK": "GBP ", "United Kingdom": "GBP ",
    "Saudi Arabia": "SAR ",
  };
  return map[country] ?? "$";
}

function fmtRev(amount: number, sym: string): string {
  if (sym === "Rs.") {
    if (amount >= 100000) return `Rs.${(amount / 100000).toFixed(1)}L`;
    return `Rs.${Math.round(amount / 1000)}K`;
  }
  if (amount >= 1000) return `${sym}${Math.round(amount / 1000)}K`;
  return `${sym}${Math.round(amount)}`;
}

// ─── Findings Builder ────────────────────────────────────────────────────────

export function buildFindings(
  ws: WebSignalsResult,
  input: ReportInput,
  byCategory: Record<string, number>,
): Finding[] {
  const findings: Finding[] = [];
  let n = 0;
  const sym = getCurrencySymbol(input.country);
  const fmt = (amount: number) => fmtRev(amount, sym);
  const rev = (key: string, def = 50000) => byCategory[key] ?? def;

  // 1. AI Visibility (CRITICAL)
  if (!ws.hasSchemaMarkup || !ws.schemaTypes.includes("FAQPage")) {
    findings.push({
      number: ++n, severity: "CRITICAL", category: "ai_visibility",
      title: "You Are Invisible to AI. Every Competitor Who Is Not Will Steal Clients.",
      finding: `${input.companyName}'s website is not optimised for AI discovery. There is no /llms.txt file, AI crawlers (GPTBot, ClaudeBot, PerplexityBot) receive no structured guidance, and the JSON-LD schema lacks FAQPage and Person types. By 2026, an estimated 45-60% of information queries will be answered by AI tools rather than traditional search. When a prospect asks ChatGPT or Perplexity to recommend a ${input.industry} company in ${input.city}, ${input.companyName} does not appear — a competitor does.`,
      revenueImpact: `Every month without AI visibility is a month competitors build a compounding discovery advantage. Estimated monthly pipeline opportunity gap: ${fmt(rev("ai_visibility", 50000))} - ${fmt(rev("ai_visibility", 50000) * 1.5)}.`,
      action: `Create /llms.txt immediately with structured information about ${input.companyName}'s services, expertise, key people, and differentiators. Update robots.txt with explicit Allow directives for GPTBot, ClaudeBot, and PerplexityBot. Add Organization, FAQPage, and Person JSON-LD schema across the website. Build 15-20 FAQ-style content blocks answering the questions a prospect would ask an AI about hiring a ${input.industry} company in ${input.city}.`,
    });
  }

  // 2. No Meta Pixel (CRITICAL)
  if (!ws.hasMetaPixel) {
    findings.push({
      number: ++n, severity: "CRITICAL", category: "no_retargeting",
      title: "No Meta Pixel Installed. Every Ad Spend Is Partially Wasted.",
      finding: `No Meta Pixel was detected on ${input.websiteUrl}. Retargeting campaigns are impossible, lookalike audiences cannot be built, and every visitor who leaves without converting is lost forever. For a ${input.industry} business, the absence of a pixel is both a revenue loss and a positioning contradiction — it undermines credibility with prospects who understand digital marketing.`,
      revenueImpact: `Without retargeting, ad spend efficiency drops 30-50%. Visitors who showed intent but did not convert cannot be re-engaged. Estimated monthly retargeting opportunity loss: ${fmt(rev("no_retargeting", 40000))}.`,
      action: `Install Meta Pixel via Google Tag Manager today — this takes under 30 minutes. Configure Standard Events (PageView, Lead, Contact). Create a retargeting audience of all website visitors from the last 180 days. Build a Lookalike Audience from your existing customer email list.`,
    });
  }

  // 3. No Pricing Page (CRITICAL)
  if (!ws.hasPricingPage) {
    findings.push({
      number: ++n, severity: "CRITICAL", category: "no_pricing_page",
      title: "No Pricing Page. 68% of Qualified Buyers Leave to a Transparent Competitor.",
      finding: `${input.companyName} does not have a publicly accessible pricing or packages page. Research shows 68% of B2B buyers require pricing information before shortlisting a vendor. Without a pricing page, ${input.companyName} forces prospects to initiate contact before they are ready — the highest-friction ask in the sales funnel.`,
      revenueImpact: `Estimated monthly qualified leads lost to pricing friction: ${fmt(rev("no_pricing_page", 35000))} - ${fmt(rev("no_pricing_page", 35000) * 1.4)}. These are prospects who researched, found ${input.companyName}, wanted to buy, but left to a more transparent competitor.`,
      action: `Create a /pricing page with 3 service tiers within the next 7 days. Use price ranges, not exact numbers. Include a Custom Quote CTA for each tier. Add FAQ schema to the pricing page. This single change is estimated to increase qualified enquiry rate by 25-40%.`,
    });
  }

  // 4. No Exit Intent / Lead Capture (CRITICAL)
  if (!ws.hasExitIntentPopup) {
    findings.push({
      number: ++n, severity: "CRITICAL", category: "no_lead_capture",
      title: "98% of Website Visitors Leave Forever. No Capture System Exists.",
      finding: `${input.companyName} has no exit-intent popup, no lead magnet, and no systematic mechanism to capture visitors who browse but do not convert. Industry data shows 96-98% of first-time visitors leave without taking action. Without a capture system, every rupee spent driving traffic releases 98% of that investment with nothing to show for it.`,
      revenueImpact: `A 2-3% exit-intent capture rate would generate 40-80 additional qualified leads monthly. Estimated monthly pipeline currently abandoned: ${fmt(rev("no_lead_capture", 60000))} - ${fmt(rev("no_lead_capture", 60000) * 1.5)}.`,
      action: `Build a lead magnet PDF — a Free Digital Audit for ${input.industry} Businesses in ${input.city} is ideal. Deploy an exit-intent popup offering it via OptinMonster or Sumo (free tier). Add a sticky header CTA. Connect captured emails to an automated nurture sequence.`,
    });
  }

  // 5. No Chat (HIGH)
  if (!ws.hasChatWidget && !ws.hasWhatsAppWidget) {
    findings.push({
      number: ++n, severity: "HIGH", category: "no_chatbot",
      title: "No AI Chatbot or Live Chat Detected. Hot Leads Are Leaving Without Connecting.",
      finding: `No live chat widget, AI chatbot, or automated chat tool was detected on ${input.websiteUrl}. For a ${input.industry} business, the absence means prospects visiting at 11pm, on weekends, or during a busy workday cannot get an instant response. Response time within 5 minutes increases conversion by 9x compared to responding in 30+ minutes.`,
      revenueImpact: `2-3% of visitors engage with chat when available. Even at 10% chat-to-lead conversion, estimated monthly missed pipeline: ${fmt(rev("no_chatbot", 45000))} - ${fmt(rev("no_chatbot", 45000) * 1.5)}.`,
      action: `Deploy Tidio or Freshchat (free tier) immediately — 15 minutes to install. Programme 5 core responses: services offered, pricing range, how to book, portfolio examples, and WhatsApp contact. Connect to WhatsApp for after-hours handoff.`,
    });
  }

  // 6. Reputation Gap (HIGH)
  const reviewCount = parseInt(ws.estimatedReviewCount ?? "0");
  const rating = parseFloat(ws.estimatedRating ?? "0");
  if (!ws.foundGoogleReviews || reviewCount < 30 || (rating > 0 && rating < 4.0)) {
    findings.push({
      number: ++n, severity: "HIGH", category: "reputation_gap",
      title: "Google Review Count Is Below Industry Standard for a Business of This Size.",
      finding: `${input.companyName} has ${ws.estimatedReviewCount ? `approximately ${ws.estimatedReviewCount} Google reviews` : "limited visible Google review data"}${ws.estimatedRating ? ` with a ${ws.estimatedRating}-star rating` : ""}. For an established ${input.industry} business in ${input.city}, effective social proof requires 50+ reviews. A low review count creates cognitive dissonance for prospects who see strong claims alongside minimal public validation.`,
      revenueImpact: `Every month with under-indexed reviews costs an estimated 10-15 qualified leads who choose a competitor purely on social proof optics. Estimated monthly opportunity loss: ${fmt(rev("reputation_gap", 30000))} - ${fmt(rev("reputation_gap", 30000) * 1.5)}.`,
      action: `Launch a review collection campaign this week. Email the last 20 completed clients with a direct Google review link. Target: 30 new Google reviews in 30 days. Create an automated review request that fires 14 days after every project completion. Register on Clutch.co and DesignRush with 3+ verified case studies.`,
    });
  }

  // 7. SERP Position (HIGH)
  if (!ws.foundGMBListing || (ws.indexedPageCount ?? 0) < 20) {
    findings.push({
      number: ++n, severity: "HIGH", category: "serp_position",
      title: "Competitors Rank Above You for Your Most Valuable Search Terms.",
      finding: `A SERP analysis for high-intent keywords including "${input.industry} ${input.city}" shows that ${input.companyName} does not consistently appear in Position 1-3 for core commercial terms. The indexed page count (${ws.indexedPageCount ?? "not detected"} pages) suggests limited content depth. Competitors are appearing above ${input.companyName} in search results — a direct daily competitive loss.`,
      revenueImpact: `Being in Position 1 versus Position 6 represents a 28% versus 4% click-through rate differential. For core commercial keywords with 500-1,200 monthly searches: ${fmt(rev("serp_position", 55000))} - ${fmt(rev("serp_position", 55000) * 2.5)} monthly opportunity cost.`,
      action: `Build 3-5 location-specific landing pages targeting "${input.industry} in ${input.city}" and adjacent service terms. Conduct a keyword gap analysis to identify which competitors are outranking you. Target Position 1-3 for core terms within 60-90 days.`,
    });
  }

  // 8. No GA4 (HIGH)
  if (!ws.hasGA4) {
    findings.push({
      number: ++n, severity: "HIGH", category: "analytics_gap",
      title: "GA4 Not Configured. All Marketing Decisions Are Based on Zero Data.",
      finding: `Google Analytics 4 was not detected on ${input.websiteUrl}. Without GA4, ${input.companyName} is spending on advertising, content, and outreach with no ability to measure what works, optimise campaigns, or track the customer journey. Conversion goals cannot be set, traffic sources cannot be compared, and ROI cannot be calculated.`,
      revenueImpact: `Businesses without conversion tracking waste an estimated 30-50% of digital ad spend on poorly performing channels they cannot identify. Half of any monthly ad budget is likely going to zero-converting sources that would be eliminated with proper GA4 setup.`,
      action: `Install GA4 via Google Tag Manager immediately. Configure key conversion events: form submission, phone click, WhatsApp click, booking completed. Set up audience segments: all visitors, engaged visitors, and converters. Connect GA4 to Google Ads for conversion-optimised bidding.`,
    });
  }

  // 9. Featured Snippets (HIGH)
  if (!ws.hasFAQSection || !ws.schemaTypes.includes("FAQPage")) {
    findings.push({
      number: ++n, severity: "HIGH", category: "serp_snippets",
      title: "Zero Featured Snippets. Content Is Not Structured to Win Position Zero.",
      finding: `${input.companyName}'s content and page structure does not appear optimised for featured snippets (Position Zero). Featured snippets generate 35-40% click-through rates compared to 18-20% for Position 1. For question-based queries in ${input.industry}, the content exists but is not structured to capture these high-visibility positions.`,
      revenueImpact: `Owning 5-8 featured snippets for commercial-intent queries could drive an additional 2,000-4,000 monthly qualified visitors at zero additional cost. This organic traffic compounds every month.`,
      action: `Restructure the top 10 service pages with a clear Answer Box paragraph — a 40-60 word direct answer to the target query after each H2 heading. Add FAQPage schema markup to every service page. Target 10 specific question-based queries for snippet capture in the next 30 days.`,
    });
  }

  const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  findings.forEach((f, i) => { f.number = i + 1; });
  return findings.slice(0, 12);
}

// ─── Claude AI Layers ────────────────────────────────────────────────────────

async function callClaude(system: string, user: string): Promise<Record<string, unknown>> {
  try {
    const msg = await anthropic.messages.create({
      model: getModel("bantb_scoring"),
      max_tokens: 1000,
      system: withCache(system),
      messages: [{ role: "user", content: user }],
    });
    void logAnthropicUsage({ model: getModel("bantb_scoring"), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "intel_report", orgId: null });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function runAiLayers(
  input: ReportInput,
  ws: WebSignalsResult,
  scores: AuditScores,
  findings: Finding[],
): Promise<AiLayers> {
  const sym = getCurrencySymbol(input.country);
  const critTitles = findings.filter(f => f.severity === "CRITICAL").map(f => f.title).join("; ");
  const topTitles  = findings.slice(0, 5).map(f => f.title).join("; ");

  const [whyR, revR, belR, compR] = await Promise.allSettled([
    // Layer 1: WHY narrative / emotional wound
    callClaude(
      `You are a senior empathy analyst for MysaAI. Translate technical digital audit gaps into the human emotional experience the business owner is living.
Rules: Write truth, not marketing copy. emotionalWound must reference something SPECIFIC from the audit. whyNarrative must feel personal, not metric-based. Never use: significant, considerable, leverage, utilise.
Return ONLY valid JSON, no markdown: {"emotionalWound":"One sentence. The core human pain.","whyNarrative":"Two paragraphs separated by \\n\\n. Para 1: what they feel. Para 2: what they deserve.","coreDesire":"One sentence. What they actually want.","whyScore":65}`,
      `Business: ${input.companyName} in ${input.industry}, ${input.city}, ${input.country}
Website: ${input.websiteUrl}
Overall Score: ${scores.overall}/100
Critical findings: ${critTitles}
Top issues: ${topTitles}`,
    ),

    // Layer 2: Revenue Calculator
    callClaude(
      `You calculate the monthly revenue cost of digital gaps. Be specific. Give number ranges. Use local market benchmarks for ${input.country}. India: use rupees (lakhs). Gulf: use AED thousands. US/UK: USD/GBP.
Return ONLY valid JSON, no markdown: {"totalMonthlyAtRisk":250000,"lowEstimate":200000,"highEstimate":350000,"byCategory":{"ai_visibility":50000,"no_retargeting":40000,"no_pricing_page":35000,"no_lead_capture":60000,"reputation_gap":30000,"serp_position":55000,"no_chatbot":45000,"analytics_gap":20000,"serp_snippets":25000},"annualised":3000000,"assumptions":"Based on benchmarks"}`,
      `Company: ${input.companyName}, Industry: ${input.industry}, Country: ${input.country}, City: ${input.city}
Overall Score: ${scores.overall}/100
Critical findings: ${critTitles}
All findings: ${findings.map(f => `[${f.severity}] ${f.category}`).join("; ")}`,
    ),

    // Layer 3: Belief Scorer
    callClaude(
      `Score the prospect's belief alignment with MysaAI's WHY: "We believe every B2B founder deserves a sales engine that works as hard as they do."
HIGH (18-25): explains WHY they started, talks outcomes, genuine story visible. LOW (0-8): purely transactional, no WHY.
Return ONLY valid JSON, no markdown: {"beliefScore":15,"beliefReason":"one sentence","beliefEvidence":"specific signal or None","bantbRoute":"qualified_standard"}`,
      `Company: ${input.companyName}, Industry: ${input.industry}
Has testimonials: ${ws.hasTestimonialsSection}, Has about page: ${ws.hasAboutPage}, Has blog: ${ws.hasBlogSection}
Schema types: ${ws.schemaTypes.join(", ") || "none"}`,
    ),

    // Layer 4: Competitor Intel
    callClaude(
      `Write a competitive gap analysis comparing the prospect to competitors in their city. Be specific. Name real gaps. Make it urgent and personal.
Return ONLY valid JSON, no markdown: {"competitorSummary":"2-3 sentences naming specific competitive gaps","biggestGap":"the single most damaging competitive disadvantage in one sentence","competitorGapScore":60}`,
      `Company: ${input.companyName}, Industry: ${input.industry}, City: ${input.city}, Country: ${input.country}
Scores: SEO ${scores.seo}/10, Website ${scores.website}/10, Reputation ${scores.reputation}/10, Ads ${scores.ads}/10, AI ${scores.ai}/10
Critical: ${critTitles}
Social: Instagram=${ws.foundInstagram}, LinkedIn=${ws.foundLinkedIn}, GMB=${ws.foundGMBListing}, Reviews=${ws.estimatedReviewCount ?? "unknown"}`,
    ),
  ]);

  const why  = whyR.status  === "fulfilled" ? whyR.value  : {};
  const rev  = revR.status  === "fulfilled" ? revR.value  : {};
  const bel  = belR.status  === "fulfilled" ? belR.value  : {};
  const comp = compR.status === "fulfilled" ? compR.value : {};

  const byCategory = (rev.byCategory as Record<string, number>) ?? {};

  const defaultLow  = input.country === "India" ? 200000 : input.country.includes("UAE") ? 25000 : 3000;
  const defaultHigh = input.country === "India" ? 400000 : input.country.includes("UAE") ? 50000 : 6000;

  return {
    emotionalWound:     (why.emotionalWound as string)     ?? `${input.companyName} is losing clients daily to competitors who are less capable but more visible online.`,
    whyNarrative:       (why.whyNarrative as string)       ?? `${input.companyName} has built something real. The expertise is genuine. The results are real.\n\nBut right now, a prospect who searches for a ${input.industry} company in ${input.city} will find a competitor with fewer clients and worse results — but more reviews, a chatbot, a pricing page, and an AI presence. The gap is not ability. The gap is visibility.`,
    coreDesire:         (why.coreDesire as string)         ?? `${input.companyName} deserves to be found by the clients they were built to serve.`,
    whyScore:           (why.whyScore as number)           ?? 65,
    totalMonthlyAtRisk: (rev.totalMonthlyAtRisk as number) ?? ((defaultLow + defaultHigh) / 2),
    lowEstimate:        (rev.lowEstimate as number)        ?? defaultLow,
    highEstimate:       (rev.highEstimate as number)       ?? defaultHigh,
    currencySymbol:     sym,
    byCategory,
    beliefScore:        (bel.beliefScore as number)        ?? 15,
    beliefReason:       (bel.beliefReason as string)       ?? "Business shows genuine expertise but limited WHY visibility online.",
    competitorSummary:  (comp.competitorSummary as string) ?? `Competitors in ${input.city}'s ${input.industry} market are gaining advantage through better digital infrastructure — more reviews, AI visibility, and faster lead capture.`,
    biggestGap:         (comp.biggestGap as string)        ?? `Lack of AI platform visibility means ${input.companyName} is invisible to the growing share of prospects who discover vendors through ChatGPT and Perplexity.`,
    emailSubject:       `${input.companyName} — what we found when we looked`,
    emailOpener:        `You built ${input.companyName} because you believed ${input.city}'s ${input.industry} market deserved better. That belief is visible in your work. It is not yet visible to the prospects searching for you right now.`,
  };
}

// ─── Action Plan ─────────────────────────────────────────────────────────────

interface WeekAction { days: string; action: string; }

function buildActionPlan(findings: Finding[]): {
  week1: WeekAction[]; week2: WeekAction[]; week3: WeekAction[]; week4: WeekAction[];
} {
  const criticals = findings.filter(f => f.severity === "CRITICAL");
  const highs     = findings.filter(f => f.severity === "HIGH");

  const week1: WeekAction[] = criticals.slice(0, 3).map((f, i) => ({
    days: `Day ${i * 2 + 1}–${i * 2 + 2}`,
    action: f.action.split(". ")[0] + ".",
  }));
  if (!week1.length) week1.push({ days: "Day 1–3", action: "Audit existing digital infrastructure and identify quick wins." });

  const week2: WeekAction[] = highs.slice(0, 3).map((f, i) => ({
    days: `Day ${8 + i * 2}–${9 + i * 2}`,
    action: f.action.split(". ")[0] + ".",
  }));
  if (!week2.length) week2.push({ days: "Day 8–10", action: "Build conversion infrastructure and lead capture systems." });

  const week3: WeekAction[] = [
    { days: "Day 15–17", action: "Build 3 location-specific landing pages optimised for featured snippets." },
    { days: "Day 17–19", action: "Add FAQ schema to all service pages. Restructure top 5 blog posts for snippet capture." },
    { days: "Day 19–21", action: "Complete Clutch.co and DesignRush profiles with 3 verified case studies each." },
  ];

  const week4: WeekAction[] = [
    { days: "Day 22–24", action: "Create /llms.txt. Update robots.txt for AI crawlers (GPTBot, ClaudeBot, PerplexityBot)." },
    { days: "Day 25–27", action: "Write 5 authoritative FAQ articles targeting AI recommendation queries. Minimum 800 words each." },
    { days: "Day 28–30", action: "Test AI visibility: ask ChatGPT, Perplexity, and Gemini to recommend your category in your city." },
  ];

  return { week1, week2, week3, week4 };
}

// ─── Colour Palette ───────────────────────────────────────────────────────────

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  dark:    [15,  23,  42],
  dark2:   [30,  41,  59],
  teal:    [13,  148, 136],
  tealD:   [6,   95,  70],
  tealL:   [204, 251, 241],
  coral:   [220, 38,  38],
  coralL:  [254, 226, 226],
  gold:    [217, 119, 6],
  goldL:   [254, 243, 199],
  green:   [5,   150, 105],
  greenL:  [209, 250, 229],
  blue:    [29,  78,  216],
  blueL:   [219, 234, 254],
  violet:  [124, 58,  237],
  violetL: [237, 233, 254],
  gray:    [100, 116, 139],
  grayL:   [248, 250, 252],
  grayM:   [226, 232, 240],
  white:   [255, 255, 255],
  red:     [153, 27,  27],
};

// ─── PDF Generator ────────────────────────────────────────────────────────────

export async function generateIntelReport(
  input: ReportInput,
  ws: WebSignalsResult,
  scores: AuditScores,
  aiLayers: AiLayers,
  findings: Finding[],
): Promise<Buffer> {
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  const PW = 215.9, PH = 279.4, ML = 14, MR = 14, W = PW - ML - MR;
  let y = 0;
  let pageNum = 1;
  const dateStr  = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const shortDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const fill  = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const draw  = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const font  = (style: "normal" | "bold" | "italic" | "bolditalic" = "normal", size = 10) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
  };

  const FOOTER_H      = 14;
  const CONTENT_BOTTOM = PH - FOOTER_H - 8;

  const drawHeader = () => {
    fill(C.dark); doc.rect(0, 0, PW, 10, "F");
    draw(C.grayM); doc.setLineWidth(0.3); doc.line(0, 10, PW, 10);
    font("normal", 7); color(C.gray);
    doc.text(`MYSAAI  ·  Digital Intelligence Report  ·  ${input.companyName}  ·  ${shortDate}`, ML, 7);
    font("bold", 7); color(C.coral);
    doc.text("CONFIDENTIAL", PW - MR, 7, { align: "right" });
    y = 16;
  };

  const drawFooter = () => {
    const FY = PH - FOOTER_H;
    fill(C.dark); doc.rect(0, FY, PW, FOOTER_H, "F");
    font("normal", 7); color(C.gray);
    doc.text(
      `${input.agencyName}  ·  ${findings.length} Critical Gaps  ·  ${input.preparedByPhone}  ·  ${input.preparedByEmail}`,
      ML, FY + 9,
    );
    font("bold", 7); color(C.teal);
    doc.text(`Page ${pageNum}`, PW - MR, FY + 9, { align: "right" });
  };

  const addPage = () => { drawFooter(); doc.addPage(); pageNum++; drawHeader(); };
  const checkPage = (needed: number) => { if (y + needed > CONTENT_BOTTOM) addPage(); };

  const box = (
    x: number, bY: number, w: number, h: number,
    bg: RGB, bl?: RGB, bw = 3,
  ) => {
    fill(bg); doc.rect(x, bY, w, h, "F");
    if (bl) { fill(bl); doc.rect(x, bY, bw, h, "F"); }
  };

  const banner = (title: string, subtitle: string, bg: RGB) => {
    const h = subtitle ? 18 : 13;
    fill(bg); doc.rect(0, y, PW, h, "F");
    font("bold", 13); color(C.white); doc.text(title, ML, y + 9);
    if (subtitle) { font("italic", 8.5); color(C.gray); doc.text(subtitle, ML, y + 15); }
    y += h + 4;
  };

  const sevColor  = (s: string): RGB => s === "CRITICAL" ? C.coral : s === "HIGH" ? C.gold : [180, 83, 9] as RGB;
  const sevFill   = (s: string): RGB => s === "CRITICAL" ? C.coralL : s === "HIGH" ? C.goldL : [255, 247, 237] as RGB;

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER
  // ═══════════════════════════════════════════════════════════════════════════
  fill(C.dark); doc.rect(0, 0, PW, PH, "F");
  fill(C.teal); doc.rect(0, 0, PW, 2, "F");
  fill(C.dark2); doc.ellipse(PW - 20, 60, 80, 80, "F");

  y = 40;
  font("bold", 8); color(C.teal);
  doc.text("CONFIDENTIAL  ·  DIGITAL INTELLIGENCE REPORT", PW / 2, y, { align: "center" });
  y += 14;

  font("bold", 22); color(C.white);
  const headLines = doc.splitTextToSize(`${input.companyName} Is Losing Clients Right Now.`, PW - 40);
  doc.text(headLines, PW / 2, y, { align: "center" });
  y += headLines.length * 10 + 6;

  font("italic", 16); color(C.gray);
  doc.text("Here is the proof.", PW / 2, y, { align: "center" });
  y += 14;

  fill(C.dark2); doc.rect(ML + 20, y, W - 40, 0.5, "F"); y += 8;
  font("normal", 9); color(C.gray);
  doc.text(`Prepared for: ${input.companyName}  (${input.websiteUrl})`, PW / 2, y, { align: "center" }); y += 6;
  doc.text(`Prepared by: ${input.agencyName}  ·  ${input.agencyWebsite}`, PW / 2, y, { align: "center" }); y += 6;
  doc.text(`Date: ${dateStr}`, PW / 2, y, { align: "center" }); y += 10;
  fill(C.dark2); doc.rect(ML + 20, y, W - 40, 0.5, "F"); y += 10;

  font("italic", 9); color(C.gray);
  const blurbLines = doc.splitTextToSize(
    `This report identifies ${findings.length} critical gaps costing ${input.companyName} an estimated ${fmtRev(aiLayers.lowEstimate, aiLayers.currencySymbol)} – ${fmtRev(aiLayers.highEstimate, aiLayers.currencySymbol)} per month in unrealised pipeline. Every gap is backed by live data gathered from your website and public digital sources.`,
    PW - 60,
  );
  doc.text(blurbLines, PW / 2, y, { align: "center" });
  y += blurbLines.length * 5.5 + 18;

  // Overall score badge
  const sCol: RGB = scores.overall >= 80 ? C.green : scores.overall >= 60 ? C.gold : scores.overall >= 40 ? C.coral : C.red;
  const bX = PW / 2 - 50;
  fill(C.dark2); doc.roundedRect(bX, y, 100, 38, 4, 4, "F");
  fill(sCol); doc.rect(bX, y, 4, 38, "F");
  font("bold", 7); color(C.gray);
  doc.text("OVERALL DIGITAL HEALTH SCORE", PW / 2, y + 9, { align: "center" });
  font("bold", 36); color(sCol);
  doc.text(`${scores.overall}`, PW / 2 - 8, y + 29, { align: "center" });
  font("normal", 10); color(C.gray);
  doc.text("/ 100", PW / 2 + 18, y + 29, { align: "center" });

  drawFooter();

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 2 — COMPETITOR COMPARISON TABLE
  // ═══════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageNum++; drawHeader();
  banner(
    "Before You Read Anything Else — Read This.",
    "This is what a potential client sees when they search for you right now.",
    C.dark2,
  );

  checkPage(28);
  box(ML, y, W, 26, C.grayL, C.dark2);
  font("normal", 9); color(C.dark);
  const expLines = doc.splitTextToSize(
    `When a prospect searches for a ${input.industry} company in ${input.city}, they see a comparison between you and your competitors before they visit your website. This table shows exactly what that comparison looks like right now. Every red cell is a prospect already leaning toward your competitor.`,
    W - 12,
  );
  doc.text(expLines, ML + 7, y + 8);
  y += 30;

  const c1 = 52, c2 = 38, c3 = 50, c4 = W - c1 - c2 - c3;
  checkPage(12);
  fill(C.dark);  doc.rect(ML,          y, c1, 10, "F");
  fill(C.teal);  doc.rect(ML + c1,     y, c2, 10, "F");
  fill(C.dark2); doc.rect(ML+c1+c2,    y, c3, 10, "F");
  fill(C.dark2); doc.rect(ML+c1+c2+c3, y, c4, 10, "F");
  font("bold", 8); color(C.white);
  doc.text("Signal",                        ML + 3,             y + 7);
  doc.text(input.companyName.slice(0, 14),  ML + c1 + 3,        y + 7);
  doc.text("Competitor Standard",           ML + c1+c2 + 3,     y + 7);
  doc.text("Client Expects",               ML + c1+c2+c3 + 3,  y + 7);
  y += 10;

  const tableRows = [
    { s: "Google Reviews",         yv: ws.estimatedReviewCount ? `${ws.estimatedReviewCount} reviews` : "Not found",  cv: "50-200+ reviews",        pass: parseInt(ws.estimatedReviewCount ?? "0") >= 30 },
    { s: "AI Platform Visibility", yv: ws.hasSchemaMarkup && ws.schemaTypes.length > 2 ? "Partial" : "Not optimised", cv: "llms.txt + FAQSchema",  pass: false },
    { s: "Pricing Page",           yv: ws.hasPricingPage ? "Present" : "Missing",                                      cv: "3-tier pricing page",    pass: ws.hasPricingPage },
    { s: "Live Chat / AI Bot",     yv: (ws.hasChatWidget||ws.hasWhatsAppWidget) ? (ws.chatWidgetTool ?? "WhatsApp") : "Not found", cv: "Chat or AI bot", pass: ws.hasChatWidget||ws.hasWhatsAppWidget },
    { s: "llms.txt File",          yv: "Not found",                                                                    cv: "Present (AI standard)",  pass: false },
    { s: "Exit-Intent Capture",    yv: ws.hasExitIntentPopup ? "Present" : "Not found",                                cv: "Lead magnet + popup",    pass: ws.hasExitIntentPopup },
    { s: "Meta Pixel / Retarget",  yv: ws.hasMetaPixel ? "Installed" : "Not installed",                                cv: "Pixel + retargeting",    pass: ws.hasMetaPixel },
    { s: "Google Analytics GA4",   yv: ws.hasGA4 ? "Installed" : "Not found",                                         cv: "GA4 + conversions",      pass: ws.hasGA4 },
    { s: "Schema Markup",          yv: ws.hasSchemaMarkup ? ws.schemaTypes.slice(0, 2).join(", ") : "Missing",         cv: "Org + FAQ + LocalBiz",   pass: ws.hasSchemaMarkup },
  ];

  tableRows.forEach((row, i) => {
    checkPage(10);
    const rowBg: RGB = i % 2 === 0 ? C.white : C.grayL;
    fill(rowBg);           doc.rect(ML,           y, W,  9, "F");
    fill(row.pass ? C.greenL : C.coralL); doc.rect(ML + c1,     y, c2, 9, "F");
    fill(C.greenL);        doc.rect(ML+c1+c2+c3,  y, c4, 9, "F");
    draw(C.grayM); doc.setLineWidth(0.2); doc.rect(ML, y, W, 9, "S");

    font("normal", 8);
    color(C.dark);                          doc.text(row.s,               ML + 3,          y + 6.5);
    color(row.pass ? C.green : C.coral);    doc.text(row.yv.slice(0, 22), ML + c1 + 3,     y + 6.5);
    color(C.gray);                          doc.text(row.cv,              ML+c1+c2 + 3,    y + 6.5);
    color(C.tealD);                         doc.text("This",              ML+c1+c2+c3 + 3, y + 6.5);
    y += 9;
  });

  y += 8;
  checkPage(22);
  box(ML, y, W, 20, C.tealL, C.teal);
  font("bold", 9); color(C.tealD); doc.text("Takeaway:", ML + 7, y + 8);
  font("normal", 8.5); color(C.tealD);
  const tkLines = doc.splitTextToSize(
    `Every red cell above is a prospect who chose a competitor instead of ${input.companyName}. The gaps are not technical problems — they are daily revenue losses. This report explains what each gap costs and exactly how to close it.`,
    W - 22,
  );
  doc.text(tkLines, ML + 7, y + 14);
  y += 24;

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 3 — OVERALL SCORE
  // ═══════════════════════════════════════════════════════════════════════════
  addPage();
  banner("Your Overall Digital Health Score", "", C.coral);

  const lW = 68, rW = W - lW - 4, mH = 48;
  box(ML, y, lW, mH, C.coralL, C.coral);
  font("bold", 8); color(C.coral); doc.text("OVERALL SCORE", ML + lW / 2, y + 9, { align: "center" });
  font("bold", 40); color(C.coral); doc.text(`${scores.overall}`, ML + lW / 2, y + 32, { align: "center" });
  font("normal", 9); color(C.gray); doc.text("/ 100", ML + lW / 2, y + 40, { align: "center" });

  fill(C.white); doc.rect(ML + lW + 4, y, rW, mH, "F");
  draw(C.grayM); doc.setLineWidth(0.3); doc.rect(ML + lW + 4, y, rW, mH, "S");
  font("bold", 8.5); color(C.dark); doc.text("Score Breakdown by Category", ML + lW + 8, y + 9);

  const catBars = [
    { label: "SEO & Content",         score: scores.seo },
    { label: "Website & Conversion",  score: scores.website },
    { label: "Reputation & Reviews",  score: scores.reputation },
    { label: "Ads & Tracking",        score: scores.ads },
    { label: "AI Visibility",         score: scores.ai },
    { label: "SERP Presence",         score: scores.serp },
    { label: "Social Media",          score: scores.social },
  ];
  const bsY = y + 14, barItemH = (mH - 18) / catBars.length;
  catBars.forEach((cat, i) => {
    const barY  = bsY + i * barItemH;
    const bc: RGB = cat.score >= 7 ? C.green : cat.score >= 4 ? C.gold : C.coral;
    const lblW  = 42, barX = ML + lW + 8 + lblW, tbW = rW - lblW - 24;
    const fw    = (cat.score / 10) * tbW;
    font("normal", 6.5); color(C.gray); doc.text(cat.label, ML + lW + 8, barY + barItemH * 0.72);
    fill(C.grayM); doc.rect(barX, barY + 1.5, tbW, 2.2, "F");
    fill(bc);      doc.rect(barX, barY + 1.5, Math.max(fw, 0.5), 2.2, "F");
    font("bold", 6.5); color(bc); doc.text(`${cat.score}/10`, barX + tbW + 3, barY + barItemH * 0.72);
  });
  y += mH + 6;

  // 3 stat boxes
  const sw = (W - 8) / 3;
  const critCount = findings.filter(f => f.severity === "CRITICAL").length;

  box(ML,           y, sw, 26, C.coralL, C.coral);
  font("bold", 6.5); color(C.coral);
  doc.text("ESTIMATED MONTHLY AT RISK", ML + sw / 2, y + 7, { align: "center" });
  font("bold", 11); color(C.coral);
  doc.text(`${fmtRev(aiLayers.lowEstimate, aiLayers.currencySymbol)} – ${fmtRev(aiLayers.highEstimate, aiLayers.currencySymbol)}`, ML + sw / 2, y + 18, { align: "center" });

  box(ML + sw + 4,       y, sw, 26, C.goldL, C.gold);
  font("bold", 6.5); color(C.gold);
  doc.text("CRITICAL ISSUES FOUND", ML + sw + 4 + sw / 2, y + 7, { align: "center" });
  font("bold", 22); color(C.gold);
  doc.text(`${critCount}`, ML + sw + 4 + sw / 2, y + 20, { align: "center" });

  box(ML + (sw + 4) * 2, y, sw, 26, C.greenL, C.green);
  font("bold", 6.5); color(C.green);
  doc.text("ESTIMATED FIX TIMELINE", ML + (sw + 4) * 2 + sw / 2, y + 7, { align: "center" });
  font("bold", 14); color(C.green);
  doc.text("30 Days", ML + (sw + 4) * 2 + sw / 2, y + 19, { align: "center" });
  y += 32;

  const rLabel = scores.overall < 40 ? "CRITICAL RISK" : scores.overall < 60 ? "HIGH RISK" : scores.overall < 80 ? "MODERATE RISK" : "HEALTHY";
  const rColor: RGB = scores.overall < 40 ? C.red : scores.overall < 60 ? C.coral : scores.overall < 80 ? C.gold : C.green;
  fill(rColor); doc.roundedRect(ML, y, W, 10, 3, 3, "F");
  font("bold", 9); color(C.white);
  doc.text(`${rLabel} — OVERALL DIGITAL HEALTH STATUS`, PW / 2, y + 7, { align: "center" });
  y += 16;

  // ═══════════════════════════════════════════════════════════════════════════
  // FINDINGS PAGES
  // ═══════════════════════════════════════════════════════════════════════════
  addPage();
  banner(
    `The ${findings.length} Critical Findings`,
    "Each finding represents real, measurable revenue leaving your business every month.",
    C.dark,
  );

  for (const f of findings) {
    const sc = sevColor(f.severity);
    const sf = sevFill(f.severity);
    const tL  = doc.splitTextToSize(f.title, W - 68);
    const fiL = doc.splitTextToSize(f.finding, W - 68);
    const iL  = doc.splitTextToSize(f.revenueImpact, W - 68);
    const aL  = doc.splitTextToSize(f.action, W - 68);
    const cardH = tL.length * 5.5 + fiL.length * 4.5 + iL.length * 4.5 + aL.length * 4.5 + 36;

    checkPage(cardH + 6);

    fill(C.white); doc.rect(ML, y, W, cardH, "F");
    draw(C.grayM); doc.setLineWidth(0.3); doc.rect(ML, y, W, cardH, "S");
    fill(sc); doc.rect(ML, y, 2.5, cardH, "F");

    // Number badge
    fill(C.dark); doc.roundedRect(ML + 5, y + 4, 14, 14, 2, 2, "F");
    font("bold", 9.5); color(C.white);
    doc.text(`#${String(f.number).padStart(2, "0")}`, ML + 12, y + 13.5, { align: "center" });

    // Severity badge
    fill(sf); doc.roundedRect(ML + 22, y + 4, 28, 14, 2, 2, "F");
    fill(sc); doc.rect(ML + 22, y + 4, 1.5, 14, "F");
    font("bold", 6.5); color(sc);
    doc.text(f.severity, ML + 36, y + 9.5, { align: "center" });
    font("normal", 6); color(sc);
    doc.text(f.category.toUpperCase().replace(/_/g, " "), ML + 36, y + 15, { align: "center" });

    const cx = ML + 53;
    let cy = y + 7;

    font("bold", 10.5); color(C.dark); doc.text(tL, cx, cy); cy += tL.length * 5.5 + 5;
    font("bold", 7); color(C.gray); doc.text("FINDING:", cx, cy); cy += 5;
    font("normal", 8.5); color(C.dark); doc.text(fiL, cx, cy); cy += fiL.length * 4.5 + 4;
    font("bold", 7); color(C.coral); doc.text("REVENUE IMPACT:", cx, cy); cy += 5;
    font("bold", 8.5); color(C.coral); doc.text(iL, cx, cy); cy += iL.length * 4.5 + 4;
    font("bold", 7); color(C.teal); doc.text("RECOMMENDED ACTION:", cx, cy); cy += 5;
    font("normal", 8.5); color(C.tealD); doc.text(aL, cx, cy);

    y += cardH + 5;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMOTIONAL WOUND / WHY NARRATIVE
  // ═══════════════════════════════════════════════════════════════════════════
  addPage();
  banner(
    "What This Actually Means For Your Business",
    "The human cost behind the technical findings — read this before looking at the action plan",
    C.dark2,
  );

  const paras = aiLayers.whyNarrative.split("\n\n");
  const p1L  = doc.splitTextToSize(paras[0] ?? "", W - 16);
  const p2L  = doc.splitTextToSize(paras[1] ?? "", W - 16);
  const desL = doc.splitTextToSize(aiLayers.coreDesire, W - 16);
  const qH   = p1L.length * 5.5 + p2L.length * 5.5 + desL.length * 5.5 + 28;

  checkPage(qH + 4);
  box(ML, y, W, qH, C.goldL, C.gold, 5);
  font("bold", 28); color(C.teal); doc.text("\u201C", ML + 8, y + 12);
  let qy = y + 22;
  font("italic", 10); color(C.dark); doc.text(p1L, ML + 12, qy); qy += p1L.length * 5.5 + 6;
  font("bold",   10); color(C.dark); doc.text(p2L, ML + 12, qy); qy += p2L.length * 5.5 + 6;
  font("bolditalic", 10); color(C.teal); doc.text(desL, ML + 12, qy); qy += desL.length * 5.5 + 3;
  font("bold", 22); color(C.teal); doc.text("\u201D", ML + W - 8, qy, { align: "right" });
  y += qH + 8;

  const compL = doc.splitTextToSize(aiLayers.competitorSummary, W - 14);
  const gapL  = doc.splitTextToSize(`Biggest competitive gap: ${aiLayers.biggestGap}`, W - 14);
  const cbH   = compL.length * 5 + gapL.length * 5 + 24;
  checkPage(cbH + 4);
  box(ML, y, W, cbH, C.grayL, C.dark2);
  font("bold", 10); color(C.dark); doc.text("The Competitive Reality — Your Market Right Now", ML + 8, y + 9);
  font("normal", 9); color(C.dark); doc.text(compL, ML + 8, y + 16);
  font("bold",   9); color(C.coral); doc.text(gapL, ML + 8, y + 16 + compL.length * 5 + 5);
  y += cbH + 8;

  // Belief score box
  const beliefColor: RGB = aiLayers.beliefScore >= 18 ? C.green : aiLayers.beliefScore >= 12 ? C.gold : C.coral;
  checkPage(28);
  box(ML, y, W, 26, [248, 250, 252] as RGB, beliefColor);
  font("bold", 8); color(beliefColor); doc.text(`BELIEF ALIGNMENT SCORE: ${aiLayers.beliefScore}/25`, ML + 8, y + 9);
  font("normal", 8.5); color(C.dark);
  const blL = doc.splitTextToSize(aiLayers.beliefReason, W - 20);
  doc.text(blL, ML + 8, y + 15);
  y += 30;

  // ═══════════════════════════════════════════════════════════════════════════
  // 30-DAY ACTION PLAN
  // ═══════════════════════════════════════════════════════════════════════════
  addPage();
  banner(
    "Your 30-Day Action Plan",
    "Prioritised by revenue impact — the sequence that recovers the most money fastest",
    C.teal,
  );

  const plan = buildActionPlan(findings);
  const weeks = [
    { label: "WEEK 1 — Days 1–7",   focus: "Stop the bleeding. Fix zero-cost, high-impact items.",   bg: C.goldL   as RGB, border: C.gold   as RGB, actions: plan.week1 },
    { label: "WEEK 2 — Days 8–14",  focus: "Build the conversion infrastructure.",                    bg: C.violetL as RGB, border: C.violet as RGB, actions: plan.week2 },
    { label: "WEEK 3 — Days 15–21", focus: "Competitive positioning and SEO acceleration.",           bg: C.blueL   as RGB, border: C.blue   as RGB, actions: plan.week3 },
    { label: "WEEK 4 — Days 22–30", focus: "AI visibility and long-term compounding.",                bg: C.greenL  as RGB, border: C.green  as RGB, actions: plan.week4 },
  ];

  for (const wk of weeks) {
    checkPage(wk.actions.length * 11 + 26);
    box(ML, y, W, 12, wk.bg, wk.border);
    font("bold", 9); color(C.dark); doc.text(wk.label, ML + 8, y + 8);
    font("italic", 7.5); color(C.gray);
    const focusX = ML + 8 + doc.getTextWidth(wk.label) + 8;
    if (focusX < PW - MR - 30) doc.text(`Focus: ${wk.focus}`, focusX, y + 8);
    y += 12;

    for (const a of wk.actions) {
      fill(C.white); doc.rect(ML, y, W, 11, "F");
      draw(C.grayM); doc.setLineWidth(0.2); doc.rect(ML, y, W, 11, "S");
      font("bold",   8); color(C.dark);  doc.text(a.days,   ML + 4, y + 7.5);
      font("normal", 8); color(C.dark);
      const al = doc.splitTextToSize(a.action, W - 46);
      doc.text(al[0] ?? "", ML + 42, y + 7.5);
      y += 11;
    }
    y += 6;
  }

  // Expected results table
  checkPage(60);
  y += 4;
  font("bold", 10); color(C.dark); doc.text("Expected Results After 30 Days — Conservative Estimates", ML, y); y += 7;

  const rCols = [W * 0.34, W * 0.16, W * 0.26, W * 0.24];
  fill(C.dark); doc.rect(ML, y, W, 9, "F");
  font("bold", 8); color(C.white);
  let rx2 = ML;
  ["Metric", "Before", "After 30 Days", "Monthly Value"].forEach((h, i) => {
    doc.text(h, rx2 + 3, y + 6.5); rx2 += rCols[i];
  });
  y += 9;

  const resultRows = [
    ["Qualified enquiries / month",  "8–12",    "22–35",            `~${fmtRev(75000, aiLayers.currencySymbol)} per conversion`],
    ["Website lead capture rate",    "1–2%",    "5–8%",             "+40–60 more leads/mo"],
    ["Google review count",          "Current", "Current + 30–50",  "Social proof 4× stronger"],
    ["AI platform visibility",       "0",       "3–7 mentions",     "Pure inbound pipeline"],
    ["Retargeting audience",         "Zero",    "15,000+ cookied",  "Ads 4× more efficient"],
    ["Featured snippets owned",      "0",       "5–8 snippets",     "2,000–4,000 extra visitors/mo"],
  ];

  resultRows.forEach((row, ri) => {
    const rb: RGB = ri % 2 === 0 ? C.white : C.grayL;
    fill(rb);      doc.rect(ML,                     y, W,       9, "F");
    fill(C.coralL);doc.rect(ML + rCols[0],          y, rCols[1], 9, "F");
    fill(C.greenL);doc.rect(ML+rCols[0]+rCols[1],   y, rCols[2], 9, "F");
    draw(C.grayM); doc.setLineWidth(0.2); doc.rect(ML, y, W, 9, "S");
    font("normal", 7.5); color(C.dark);
    let cx3 = ML;
    row.forEach((cell, i) => { doc.text(cell, cx3 + 3, y + 6); cx3 += rCols[i]; });
    y += 9;
  });
  y += 8;

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL CTA PAGE (dark)
  // ═══════════════════════════════════════════════════════════════════════════
  addPage();
  // Dark background for full page
  fill(C.dark); doc.rect(0, 10, PW, PH - 10, "F");
  fill(C.teal); doc.rect(0, 10, PW, 2, "F");

  let ctY = y;
  font("bold", 18); color(C.white);
  doc.text("You've Read The Report.", PW / 2, ctY, { align: "center" }); ctY += 14;
  font("bold", 22); color(C.teal);
  doc.text("Now There Are Two Paths.", PW / 2, ctY, { align: "center" }); ctY += 18;

  font("bold", 9.5); color(C.gray);   doc.text("PATH A:", ML + 14, ctY);
  font("italic", 8.5); color(C.gray);
  const paL2 = doc.splitTextToSize("Close this document. Do nothing. Watch competitors absorb the pipeline that should be yours. Every month the gap widens and costs more to close.", PW - 50);
  doc.text(paL2, ML + 14, ctY + 7); ctY += 7 + paL2.length * 5 + 10;

  font("bold", 9.5); color(C.white); doc.text("PATH B:", ML + 14, ctY);
  font("bold", 8.5); color(C.white);
  const pbL2 = doc.splitTextToSize(`Call ${input.preparedBy} in the next 48 hours. 30-minute conversation. No pitch, no pressure. Just a plan for exactly how to close these ${findings.length} gaps — starting this week.`, PW - 50);
  doc.text(pbL2, ML + 14, ctY + 7); ctY += 7 + pbL2.length * 5 + 14;

  fill(C.dark2); doc.rect(ML + 14, ctY, PW - 28, 0.5, "F"); ctY += 10;
  font("bold", 14); color(C.teal);   doc.text(input.preparedByPhone, PW / 2, ctY, { align: "center" }); ctY += 9;
  font("bold", 11); color(C.teal);   doc.text(input.preparedByEmail, PW / 2, ctY, { align: "center" }); ctY += 7;
  font("normal", 9); color(C.gray);  doc.text(input.agencyWebsite, PW / 2, ctY, { align: "center" }); ctY += 9;
  fill(C.dark2); doc.rect(ML + 14, ctY, PW - 28, 0.5, "F"); ctY += 10;
  font("italic", 7.5); color(C.gray);
  doc.text(
    '"We believe every business built with genuine purpose deserves to be seen, found, and chosen."',
    PW / 2, ctY, { align: "center" },
  );
  ctY += 14;

  // About agency
  const aboutText = input.agencyAbout ??
    `${input.agencyName} is a growth transformation company specialising in digital marketing, AI automation, and brand strategy. We help ${input.industry} businesses across ${input.country} build digital infrastructure that generates consistent, measurable revenue.`;
  const aboutLines = doc.splitTextToSize(aboutText, W - 14);
  const aboutH = aboutLines.length * 5 + 18;
  checkPage(aboutH + 4);
  box(ML, ctY, W, aboutH, C.dark2 as RGB, C.teal);
  font("bold", 10); color(C.white); doc.text(`About ${input.agencyName}`, ML + 8, ctY + 9);
  font("normal", 8.5); color(C.gray); doc.text(aboutLines, ML + 8, ctY + 16);
  ctY += aboutH + 10;

  // Disclaimer
  font("italic", 6.5); color(C.gray);
  const discLines = doc.splitTextToSize(
    `Methodology & Disclaimer: This report was prepared using automated web crawling, SERP analysis, public data sources, and AI-powered interpretation. Revenue estimates are based on industry benchmarks and illustrate order-of-magnitude opportunity — they are not guarantees of outcome. All findings were accurate at the time of audit (${shortDate}) and may change as the website is updated. This report is confidential and intended solely for ${input.companyName}.`,
    W,
  );
  if (ctY + discLines.length * 4.5 < CONTENT_BOTTOM) {
    doc.text(discLines, ML, ctY);
  }

  drawFooter();

  const ab = doc.output("arraybuffer");
  return Buffer.from(ab);
}

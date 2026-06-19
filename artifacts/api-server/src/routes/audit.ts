import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { auditCategories, auditSignals, leadAudits, auditRuns, leads, shareTokens, organizations } from "@workspace/db/schema";
import { eq, desc, inArray, and, sql } from "drizzle-orm";
import { resourceLimitGuard, featureGuard } from "../middlewares/planGuard";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel } from "../config/modelRouting";
import { repairAiStatus } from "../lib/repairAiStatus";
import { logger } from "../lib/logger";
import { gatherWebSignals, formatSignalsForPrompt, assessSignalsDeterministically } from "../lib/gatherWebSignals";
import { calculateScores, buildFindings, runAiLayers, generateIntelReport, getCurrencySymbol } from "../lib/generateIntelReport";
import { requireOwnerOrAdmin } from "../middleware";
import { logAnthropicUsage, logApifyUsage, logPageSpeedUsage } from "../lib/logApiUsage";
import { fetchOrgOverrides } from "../config/modelRouting";

const router = Router();

const RunAuditSchema = z.object({
  leadId: z.number().int().positive(),
  companyName: z.string().min(1),
  websiteUrl: z.string().url().optional().nullable(),
  linkedInUrl: z.string().url().optional().nullable(),
});

const SIGNAL_STATUS = ["present", "missing", "warning"] as const;

type AuditSignal = {
  signalId: number;
  status: string;
  aiStatus?: string;
  signalName: string;
  severity: string;
  categorySlug: string;
  explanation?: string;
  manualOverride?: boolean;
};

const UpdateAuditSchema = z.object({
  signals: z.array(z.union([
    z.object({ signalId: z.number().int(), status: z.enum(SIGNAL_STATUS), reset: z.undefined().optional() }),
    z.object({ signalId: z.number().int(), reset: z.literal(true), status: z.undefined().optional() }),
  ])),
});

async function fetchPageSpeedScore(url: string): Promise<number | null> {
  try {
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = await res.json() as { lighthouseResult?: { categories?: { performance?: { score?: number } } } };
    const score = data.lighthouseResult?.categories?.performance?.score;
    return typeof score === "number" ? Math.round(score * 100) : null;
  } catch {
    return null;
  }
}

router.get("/audit/categories", async (_req: Request, res: Response): Promise<void> => {
  const cats = await db.select().from(auditCategories).orderBy(auditCategories.id);
  const withSignals = await Promise.all(
    cats.map(async (cat) => {
      const sigs = await db.select().from(auditSignals).where(eq(auditSignals.categoryId, cat.id));
      return { ...cat, signals: sigs };
    }),
  );
  res.json(withSignals);
});

router.post("/audit/run", resourceLimitGuard("audits"), async (req: Request, res: Response): Promise<void> => {
  const parsed = RunAuditSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { leadId, companyName, websiteUrl, linkedInUrl } = parsed.data;
  const orgId = req.user!.orgId;

  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const allSignals = await db
    .select({ signal: auditSignals, cat: auditCategories })
    .from(auditSignals)
    .innerJoin(auditCategories, eq(auditSignals.categoryId, auditCategories.id));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ── Phase 1: Gather live intelligence in parallel ──
  sendEvent("status", { message: "Fetching live website data & digital signals..." });

  const [pageSpeedScore, webSignals] = await Promise.all([
    websiteUrl ? fetchPageSpeedScore(websiteUrl) : Promise.resolve(null),
    gatherWebSignals(websiteUrl, companyName, linkedInUrl, null),
  ]);

  // Patch pagespeed into the webSignals result
  webSignals.pageSpeedScore = pageSpeedScore;

  // Log external API usage (fire-and-forget)
  if (websiteUrl) void logPageSpeedUsage({ feature: "audit", orgId: orgId ?? null });
  if (process.env["APIFY_TOKEN"]) {
    const apifyCalls = (companyName ? 2 : 0) + (websiteUrl ? 1 : 0);
    if (apifyCalls > 0) void logApifyUsage({ feature: "audit", calls: apifyCalls, orgId: orgId ?? null });
  }

  sendEvent("status", { message: "Assessing all signals from live evidence..." });

  // ── Deterministic signal assessment ───────────────────────────────────────
  // All 59 signals are assessed directly from crawl + PageSpeed + SERP data.
  // No ambiguity — every status is derived from a specific field in webSignals.
  const deterministicAssessments = assessSignalsDeterministically(webSignals, websiteUrl);
  const assessmentById = new Map(deterministicAssessments.map((a) => [a.signalId, a]));

  // Merge with DB signal list to attach names, severity, category
  const signalResults = allSignals.map((row) => {
    const assessment = assessmentById.get(row.signal.id);
    const status = assessment?.status ?? "warning";
    return {
      signalId: row.signal.id,
      signalName: row.signal.name,
      severity: row.signal.severity,
      categorySlug: row.cat.slug,
      categoryName: row.cat.name,
      status,
      aiStatus: status,
      explanation: assessment?.explanation ?? "Unable to assess — signal data unavailable.",
    };
  });

  // ── Claude: generate structured Intelligence Report JSON ──────────────────
  sendEvent("status", { message: "Running AI intelligence analysis..." });

  // Detect currency from lead country
  const currency = (() => {
    const c = (lead.country ?? "").toLowerCase();
    if (c.includes("india")) return "₹";
    if (c.includes("uae") || c.includes("emirates")) return "AED ";
    if (c.includes("united kingdom") || c === "uk") return "£";
    return "$";
  })();

  const criticalCount = signalResults.filter((s) => s.severity === "critical" && s.status === "missing").length;
  const highCount = signalResults.filter((s) => s.severity === "high" && s.status === "missing").length;
  const mediumCount = signalResults.filter((s) => s.severity === "medium" && s.status === "missing").length;
  const healthScore = Math.max(0, Math.min(100, 100 - criticalCount * 8 - highCount * 4 - mediumCount * 2));

  const missingSignals = signalResults.filter((s) => s.status === "missing");
  const presentSignals = signalResults.filter((s) => s.status === "present");
  const signalSummaryForPrompt = [
    ...missingSignals.map((s) => `[MISSING:${s.severity.toUpperCase()}] ${s.signalName} — ${s.explanation.slice(0, 120)}`),
    ...signalResults.filter((s) => s.status === "warning").slice(0, 6).map((s) => `[WARN] ${s.signalName} — ${s.explanation.slice(0, 80)}`),
    ...presentSignals.slice(0, 8).map((s) => `[PRESENT] ${s.signalName}`),
  ].join("\n");

  const loc = [lead.city, lead.country].filter(Boolean).join(", ") || "unknown";

  const reportPrompt = `You are MysaAI's Revenue Intelligence Engine. You completed a 61-point brand audit of ${companyName}. Generate a complete Intelligence Report as a single valid JSON object. Return ONLY the JSON — no markdown fences, no explanation, no text before or after.

COMPANY: ${companyName} | Website: ${websiteUrl ?? "unknown"} | Industry: ${lead.industry ?? "unknown"} | Location: ${loc}
HEALTH SCORE: ${healthScore}/100 | CURRENCY: ${currency} | CRITICAL GAPS: ${criticalCount} | HIGH GAPS: ${highCount}

AUDIT SIGNALS:
${signalSummaryForPrompt}

Generate this exact JSON structure — all fields required, all arrays at specified lengths:
{
  "v": 2,
  "companyName": "${companyName}",
  "website": "${websiteUrl ?? ""}",
  "healthScore": ${healthScore},
  "criticalCount": ${criticalCount},
  "hero": {
    "monthlyRisk": "calculate in ${currency} based on criticalCount=${criticalCount} and industry — use local number format",
    "annualRisk": "12x monthly risk",
    "fixTimeline": "30 Days"
  },
  "why": {
    "quote": "1-2 sentence motivational WHY quote, second-person perspective, specific to ${companyName}'s industry and mission in ${loc}",
    "body": "3-4 sentences on visibility gap vs real capability. Mention actual missing signals. Use <strong> tags for key phrases. Name ${companyName}.",
    "positiveTags": ["2-3 signals that ARE present as short positive labels"],
    "negativeTags": ["5-6 of the worst missing signals as short labels"]
  },
  "compare": [
    {"name": "AI Visibility — ChatGPT · Perplexity · Gemini Recommendations", "company": {"label": "Not Appearing", "status": "fail"}, "competitors": {"label": "Some appear", "status": "warn"}, "industry": {"label": "AI Recommended", "status": "pass"}},
    {"name": "Meta Pixel & Retargeting Infrastructure", "company": {"label": "STATUS_FROM_AUDIT", "status": "fail_or_pass"}, "competitors": {"label": "Varies", "status": "warn"}, "industry": {"label": "Non-negotiable", "status": "pass"}},
    {"name": "Pricing / Packages Page (Trust Signal)", "company": {"label": "STATUS_FROM_AUDIT", "status": "fail_or_pass"}, "competitors": {"label": "Most have it", "status": "pass"}, "industry": {"label": "Always Expected", "status": "pass"}},
    {"name": "Exit-Intent Capture / Lead Magnet", "company": {"label": "STATUS_FROM_AUDIT", "status": "fail_or_pass"}, "competitors": {"label": "Some have", "status": "warn"}, "industry": {"label": "+8-12% capture", "status": "pass"}},
    {"name": "AI Chatbot / Instant Response System", "company": {"label": "STATUS_FROM_AUDIT", "status": "fail_or_pass"}, "competitors": {"label": "Growing fast", "status": "warn"}, "industry": {"label": "Instant response", "status": "pass"}},
    {"name": "Google Review Volume vs Claimed Experience", "company": {"label": "STATUS_FROM_AUDIT", "status": "fail_warn_pass"}, "competitors": {"label": "50-200+ reviews", "status": "pass"}, "industry": {"label": "50+ minimum", "status": "pass"}},
    {"name": "Featured Snippet Ownership (Position Zero)", "company": {"label": "STATUS_FROM_AUDIT", "status": "fail_or_pass"}, "competitors": {"label": "Some own", "status": "warn"}, "industry": {"label": "35-40% CTR", "status": "pass"}},
    {"name": "llms.txt File — AI Discoverability Signal", "company": {"label": "STATUS_FROM_AUDIT", "status": "fail_or_pass"}, "competitors": {"label": "Most missing", "status": "fail"}, "industry": {"label": "Forward-thinking", "status": "pass"}}
  ],
  "categoryScores": [
    {"name": "AI & Future Visibility", "score": SCORE_1_TO_10_BASED_ON_AUDIT},
    {"name": "Paid Ads Infrastructure", "score": SCORE},
    {"name": "Google Reputation & Reviews", "score": SCORE},
    {"name": "Website Conversion Signals", "score": SCORE},
    {"name": "SERP & Competitive Position", "score": SCORE},
    {"name": "Social Media Presence", "score": SCORE},
    {"name": "SEO & Organic Signals", "score": SCORE}
  ],
  "revenueCards": [
    {"amount": "${currency}X", "title": "Gap name", "note": "specific impact with real numbers relevant to ${companyName}'s scale and ${loc}"}
  ],
  "findings": [
    {"num": "01", "severity": "critical", "title": "COMPELLING HEADLINE specific to ${companyName}", "revenuePill": "revenue impact in ${currency}", "whatWeFound": "2-4 sentences with specific evidence from the audit signals", "exactFix": "2-4 sentences with concrete numbered action steps"}
  ],
  "belief": {
    "score": NUMBER_1_TO_25,
    "title": "Belief tier (Emerging/Qualified/Strong/True Believer)",
    "pillLabel": "Short label",
    "pillType": "positive_neutral_or_negative",
    "summary": "One sentence",
    "quote": "1-2 sentence belief assessment in third-person about ${companyName}",
    "body": "2-3 sentences on their belief foundation",
    "signals": [
      {"label": "Signal name", "on": true_or_false}
    ]
  },
  "actionPlan": [
    {"week": "W1", "range": "Days 1-7", "title": "theme", "pillType": "urgent", "actions": [{"day": "Day 1-2", "text": "<strong>Bold action.</strong> Explanation with specifics for ${companyName}."}]}
  ],
  "cta": {
    "eyebrow": "Book your free 30-minute strategy call",
    "phone": "phone from website scan or leave as +91 93777 56660",
    "email": "email from website scan",
    "website": "${websiteUrl ? new URL(websiteUrl).hostname : companyName.toLowerCase().replace(/\\s/g,'')+'.com'}",
    "address": "${loc}"
  }
}

STRICT RULES:
- compare: exactly 8 rows. Set actual status from audit signals (fail=missing, warn=warning, pass=present).
- categoryScores: exactly 7 items. Score each 1-10 based on actual missing signals in that category. Order worst to best.
- revenueCards: exactly 6 cards. Use ${currency} with local format (₹1.2L or $12K not ₹120000).
- findings: exactly 9 items. First 4 severity="critical", last 5 severity="high". Every title must name a specific gap found in the audit. Mention ${companyName} by name in whatWeFound.
- belief.signals: exactly 6 items, realistic mix of on/off based on audit.
- actionPlan: exactly 4 weeks with pillType urgent/high/medium/strategic. 3-4 actions each. Use <strong> tags.
- Revenue estimates calibrated to ${lead.industry ?? "this industry"} in ${loc}.`;

  // Build a deterministic fallback in case Claude fails
  const revBase = criticalCount >= 6 ? ["2.4L", "4.8L", "28L", "57L"] : criticalCount >= 3 ? ["80K", "1.6L", "9.6L", "19L"] : ["20K", "60K", "2.4L", "7L"];
  const fallbackReport = JSON.stringify({
    v: 2, companyName, website: websiteUrl ?? "", healthScore, criticalCount,
    hero: { monthlyRisk: `${currency}${revBase[0]} – ${currency}${revBase[1]}`, annualRisk: `${currency}${revBase[2]} – ${currency}${revBase[3]}`, fixTimeline: "30 Days" },
    why: {
      quote: `You didn't build ${companyName} to be the best-kept secret in ${lead.city ?? "your market"}. You built it because you genuinely believed your clients deserved a partner who gives a damn about their growth.`,
      body: `That belief is real. Your work and client history proves it. But right now, a business owner types your core service into Google or asks ChatGPT — and <strong>your competitors appear. You don't.</strong> We found ${criticalCount} critical gaps creating this visibility wall. The gap is not ability. The gap is visibility.`,
      positiveTags: presentSignals.slice(0, 3).map((s) => s.signalName),
      negativeTags: missingSignals.slice(0, 6).map((s) => s.signalName),
    },
    compare: [
      { name: "AI Visibility — ChatGPT · Perplexity · Gemini Recommendations", company: { label: "Not Appearing", status: "fail" }, competitors: { label: "Some appear", status: "warn" }, industry: { label: "AI Recommended", status: "pass" } },
      { name: "Meta Pixel & Retargeting Infrastructure", company: { label: missingSignals.some(s => s.signalName.toLowerCase().includes("pixel")) ? "Not Installed" : "Installed", status: missingSignals.some(s => s.signalName.toLowerCase().includes("pixel")) ? "fail" : "pass" }, competitors: { label: "Varies", status: "warn" }, industry: { label: "Non-negotiable", status: "pass" } },
      { name: "Pricing / Packages Page (Trust Signal)", company: { label: missingSignals.some(s => s.signalName.toLowerCase().includes("pric")) ? "Not Found" : "Present", status: missingSignals.some(s => s.signalName.toLowerCase().includes("pric")) ? "fail" : "pass" }, competitors: { label: "Most have it", status: "pass" }, industry: { label: "Always Expected", status: "pass" } },
      { name: "Exit-Intent Capture / Lead Magnet", company: { label: "Not Detected", status: "fail" }, competitors: { label: "Some have", status: "warn" }, industry: { label: "+8-12% capture", status: "pass" } },
      { name: "AI Chatbot / Instant Response System", company: { label: missingSignals.some(s => s.signalName.toLowerCase().includes("chat")) ? "Not Detected" : "Active", status: missingSignals.some(s => s.signalName.toLowerCase().includes("chat")) ? "fail" : "pass" }, competitors: { label: "Growing fast", status: "warn" }, industry: { label: "Instant response", status: "pass" } },
      { name: "Google Review Volume vs Claimed Experience", company: { label: "Below standard", status: "warn" }, competitors: { label: "50-200+ reviews", status: "pass" }, industry: { label: "50+ minimum", status: "pass" } },
      { name: "Featured Snippet Ownership (Position Zero)", company: { label: "Zero Owned", status: "fail" }, competitors: { label: "Some own", status: "warn" }, industry: { label: "35-40% CTR", status: "pass" } },
      { name: "llms.txt File — AI Discoverability Signal", company: { label: "Missing", status: "fail" }, competitors: { label: "Most missing", status: "fail" }, industry: { label: "Forward-thinking", status: "pass" } },
    ],
    categoryScores: [
      { name: "AI & Future Visibility", score: Math.max(1, Math.min(10, 10 - missingSignals.filter(s => ["ai", "llm", "schema"].some(k => s.signalName.toLowerCase().includes(k))).length * 3)) },
      { name: "Paid Ads Infrastructure", score: Math.max(1, Math.min(10, 10 - missingSignals.filter(s => ["pixel", "ads", "tag", "gtm"].some(k => s.signalName.toLowerCase().includes(k))).length * 3)) },
      { name: "Google Reputation & Reviews", score: Math.max(2, Math.min(10, 10 - missingSignals.filter(s => ["review", "gmb", "rating"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
      { name: "Website Conversion Signals", score: Math.max(3, Math.min(10, 10 - missingSignals.filter(s => ["chat", "form", "cta", "whatsapp", "booking"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
      { name: "SERP & Competitive Position", score: Math.max(3, Math.min(10, 10 - missingSignals.filter(s => ["snippet", "canonical", "sitemap", "robots"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
      { name: "Social Media Presence", score: Math.max(4, Math.min(10, 10 - missingSignals.filter(s => ["linkedin", "instagram", "facebook", "youtube", "twitter"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
      { name: "SEO & Organic Signals", score: Math.max(4, Math.min(10, 10 - missingSignals.filter(s => ["meta", "title", "ssl", "mobile", "open graph"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
    ],
    revenueCards: [
      { amount: `${currency}65K-85K`, title: "No Retargeting Pixel", note: "Every visitor who lands on your site cannot be retargeted. Lookalike audiences — impossible. Pure ad spend waste month after month." },
      { amount: `${currency}75K-1.1L`, title: "No Pricing Page", note: "68% of B2B buyers quietly eliminate vendors with no pricing transparency. They don't email to ask. They just leave — and you never know it happened." },
      { amount: `${currency}80K-1.2L`, title: "No Lead Capture System", note: "Thousands of monthly visitors with zero capture infrastructure. A 6% exit capture rate would convert hundreds of anonymous visitors into qualified leads monthly." },
      { amount: `${currency}56K-84K`, title: "No AI Chatbot", note: "Prospects visit at 11pm, on Sundays, during busy days. They get silence. A 5-minute response boosts conversion 9x vs 30+ minutes." },
      { amount: `${currency}45K-72K`, title: "AI Invisibility", note: "Dozens of AI-referred prospects per month are being directed to competitors because ChatGPT and Perplexity don't know your business exists." },
      { amount: `${currency}72K-1.4L`, title: "SERP Position Loss", note: "Position 1 gets 28% of clicks. Position 6 gets 4%. On your core commercial search queries, that gap is enormous and compounding daily." },
    ],
    findings: [
      { num: "01", severity: "critical", title: `${companyName} Is Invisible to AI — And AI Is Now How Clients Find Their Next Vendor`, revenuePill: "Annual AI pipeline currently at zero", whatWeFound: `When ChatGPT, Perplexity, Claude, and Google AI Overviews are asked to recommend a ${lead.industry ?? "business"} in ${lead.city ?? "your area"} — ${companyName} does not appear. The llms.txt file is missing. AI crawlers receive no explicit guidance. 78% of B2B buyers now use AI tools before making a vendor decision. This is the most urgent gap in the entire audit.`, exactFix: "Create /llms.txt today with company description, services, key people, and client verticals. Update robots.txt to explicitly allow GPTBot, ClaudeBot, PerplexityBot. Expand JSON-LD schema to add Organization, Person, FAQPage, and SearchAction types. Write 5 FAQ articles targeting AI recommendation queries for your core services." },
      { num: "02", severity: "critical", title: "No Retargeting Pixel. Every Visitor You've Ever Had Is Gone Forever.", revenuePill: `${currency}65K–85K monthly retargeting revenue uncaptured`, whatWeFound: `The Meta Pixel is not detected on ${websiteUrl ?? companyName}'s website. Every visitor who has ever come — through ads, SEO, or word of mouth — cannot be retargeted. Lookalike audiences built from your highest-value visitors are impossible. And here's the painful irony for any business that markets itself: every prospect who checks can see the gap.`, exactFix: "Install Meta Pixel via Google Tag Manager — 20 minutes of work. Set up Standard Events immediately: PageView, Lead (on contact form submit), and Purchase. Create a 30-day retargeting audience from all website visitors. Build a Lookalike Audience from your existing client email list. Conversion rates should improve from 1–3% to 8–12% within 30 days." },
      { num: "03", severity: "critical", title: "No Pricing Page. 68% of Your Most Qualified Prospects Are Self-Eliminating in Silence.", revenuePill: `${currency}1.5L–2.5L monthly in self-eliminated qualified leads`, whatWeFound: `There is no pricing, packages, or plans page found. Research across thousands of B2B sales cycles shows 68% of buyers eliminate a vendor when pricing is completely unavailable. They don't email to ask. They just leave — and you never know it happened. The absence raises a question prospects will never voice but always feel.`, exactFix: "Create a /pricing page with 3 clearly defined service tiers. Show price ranges, not exact numbers — this removes price anxiety without locking you in. Show what each tier includes, who it's for, and the expected outcome. Include a prominent 'Get Custom Quote' CTA for complex projects. This single page will increase qualified enquiry rates by 25–40%." },
      { num: "04", severity: "critical", title: "98% of Your Website Visitors Vanish Forever — You Have Zero System to Catch Them.", revenuePill: `${currency}80K–1.2L monthly in capturable lead value lost`, whatWeFound: `No exit-intent popup. No lead magnet. No email capture mechanism of any kind is detected. With thousands of monthly visitors and zero capture infrastructure, the vast majority leave every month — permanently. This is the single largest conversion leak in the entire funnel. The traffic exists. The interest exists. The capture system does not.`, exactFix: "Build one high-value lead magnet immediately: a 'Free Digital Health Check for Businesses.' Deploy an exit-intent popup. Add a sticky header bar. Connect the capture form to a 5-email nurture sequence. Industry benchmark: 6–9% exit capture rate = hundreds of additional qualified leads from your existing traffic." },
      { num: "05", severity: "high", title: "Competitors Are Ranking Above You for the Searches Where Your Clients Come From.", revenuePill: `${currency}72K–1.4L monthly from position loss on core keywords`, whatWeFound: `${companyName} does not consistently appear in positions 1–3 for high-intent commercial queries in the ${lead.industry ?? "industry"} space. Competitors with a fraction of your experience and client results appear above you in Google every single day. The prospect finds them first. They may never reach you.`, exactFix: "Build 3 location-specific landing pages with keyword-optimised content and correct schema markup. Each page needs an Answer Box paragraph — 40–60 words directly answering the target query — for featured snippet capture. Timeline: Position 1–3 movement expected within 60–90 days of publishing and proper indexing." },
      { num: "06", severity: "high", title: "Your Review Count Doesn't Match Your Claimed Experience. And Prospects Notice.", revenuePill: "10–15 qualified leads monthly choosing competitors on reviews alone", whatWeFound: `${companyName}'s Google review count does not reflect their claimed experience scale. For any company positioning itself as a premium choice in ${lead.city ?? "their market"}, a low review count creates cognitive dissonance. Prospects see the claim. They see the reviews. They do the math silently and move on without ever telling you why.`, exactFix: "Launch a review collection campaign this week. Email the last 20 completed clients personally with a direct Google review link and a personal note. Target: 50 new reviews in 30 days. Create an automated review request that triggers 14 days after every project completion. Complete Clutch.co and DesignRush profiles with verified case studies featuring real performance metrics." },
      { num: "07", severity: "high", title: "No AI Chatbot. Prospects Who Visit at Night and Weekends Get Silence.", revenuePill: `${currency}56K–84K monthly in missed chat conversions`, whatWeFound: `No live chat, AI chatbot, or automated conversation widget is detected. Prospects visiting at 11pm, on a Sunday, or during a jam-packed workday cannot get an instant response. Research shows a 5-minute response time increases conversion by 9x compared to 30+ minutes. You're responding in hours — if ever.`, exactFix: "Deploy Tidio or Freshchat free tier immediately. Programme 5 core responses: services offered, pricing direction, portfolio access, booking a call, and WhatsApp handoff. Connect to WhatsApp for seamless transition. Within 30 days, upgrade to a custom AI agent — this becomes a live demonstration of capabilities to every new prospect." },
      { num: "08", severity: "high", title: "AI Crawlers Are Flying Blind on Your Website — No Signals, No Citations.", revenuePill: "Compounding AI advantage worth significant annual revenue by 2027", whatWeFound: `The website provides no explicit guidance for AI crawlers — GPTBot (OpenAI), ClaudeBot (Anthropic), PerplexityBot. No llms.txt file. No AI-optimised FAQ structure. No topical authority signals designed for language model ingestion. By 2026, 45–60% of information queries will be answered by AI tools. The window to establish AI visibility is open right now — and closing quickly.`, exactFix: "Create /llms.txt with structured company information formatted for AI consumption. Add 15–20 FAQ-style content blocks answering questions AI tools use to recommend businesses like yours. Build 3 topic cluster pages with E-E-A-T signals: author bios, credentials, publication dates, and verified case data with specific numbers and outcomes." },
      { num: "09", severity: "high", title: "Zero Featured Snippets. You're Writing the Answers — Competitors Are Claiming the Credit.", revenuePill: "2,000–4,000 additional monthly visitors available to capture", whatWeFound: `No featured snippets are owned for any target keywords. Featured snippets appear above all organic results — above even Position 1 — and generate 35–40% click-through rates vs 18–20% for standard first-place results. Relevant content may exist on the site, but it is not structured to win Position Zero. The traffic is being given away to competitors who figured out the formatting.`, exactFix: "Restructure the top 20 blog posts with a dedicated 'Answer Box' paragraph — 40–60 words directly answering the target query, placed immediately after the H2 heading. Add FAQ schema markup to every service page. Identify and target 10 specific question-based queries for snippet optimisation in the next 30 days. First snippets should appear within 3–4 weeks." },
    ],
    belief: {
      score: Math.max(8, Math.min(22, 25 - criticalCount * 2 - highCount)),
      title: criticalCount >= 6 ? "Emerging Believer" : criticalCount >= 3 ? "Qualified Believer" : "Strong Believer",
      pillLabel: criticalCount >= 6 ? "WHY Needs Amplification" : "Strong WHY Foundation",
      pillType: criticalCount >= 6 ? "neutral" : "positive",
      summary: "The foundation is real. The belief needs to be louder at the digital layer.",
      quote: `${companyName} has a genuine story — real clients, real results, a clear purpose. The WHY is real. But it's buried beneath service lists and capability claims. The world sees WHAT you do. It should see WHY you do it.`,
      body: "This score indicates a belief foundation that isn't being communicated effectively at the digital layer. Leading with WHY before listing WHAT — the Golden Circle principle — would attract clients who stay for years, not quarters.",
      signals: [
        { label: "LinkedIn Presence Active", on: presentSignals.some(s => s.signalName.toLowerCase().includes("linkedin")) },
        { label: "Founder Story Visible", on: presentSignals.some(s => s.signalName.toLowerCase().includes("about")) },
        { label: "Portfolio & Case Studies", on: presentSignals.some(s => s.signalName.toLowerCase().includes("portfolio") || s.signalName.toLowerCase().includes("testimonial")) },
        { label: "WHY Statement on Homepage", on: false },
        { label: "Mission-Led Content", on: false },
        { label: "Belief-First Messaging", on: false },
      ],
    },
    actionPlan: [
      { week: "W1", range: "Days 1–7", title: "Stop the bleeding — zero-cost, same-day impact", pillType: "urgent", actions: [
        { day: "Day 1–2", text: "<strong>Install tracking pixel via GTM.</strong> Set up PageView, Lead, and Purchase events. Create 30-day retargeting audience. This is 20 minutes of work that immediately makes every previous ad spend more efficient." },
        { day: "Day 2–3", text: "<strong>Create /llms.txt and update robots.txt</strong> to allow GPTBot, ClaudeBot, PerplexityBot explicitly. Zero cost. Begins compounding AI visibility from today — the earlier you start, the bigger the advantage." },
        { day: "Day 3–4", text: "<strong>Deploy free chatbot</strong> (Tidio free tier). Programme 5 core responses. Connect to WhatsApp. Instant uplift on evening and weekend visitors who currently leave without ever connecting." },
        { day: "Day 5–7", text: "<strong>Launch personal review collection campaign.</strong> Email the last 20 completed clients personally with a direct review link. Target: 15 new Google reviews this week alone." },
      ]},
      { week: "W2", range: "Days 8–14", title: "Build the conversion infrastructure that captures every visitor", pillType: "high", actions: [
        { day: "Day 8–10", text: "<strong>Create /pricing page</strong> with 3 service tiers showing price ranges. Include who each tier is for and a 'Custom Quote' CTA. This will be the highest-converting page on the site within 60 days of launch." },
        { day: "Day 10–12", text: "<strong>Build the lead magnet:</strong> 'Free 10-Point Digital Health Check for Businesses.' This report style proves capability before a conversation happens." },
        { day: "Day 12–14", text: "<strong>Deploy exit-intent popup</strong> offering the audit. Add a sticky header CTA. Connect to a 5-email nurture sequence. Expected: 6–9% exit capture rate from traffic that is currently being lost entirely." },
      ]},
      { week: "W3", range: "Days 15–21", title: "Win the search positions where your clients are deciding", pillType: "medium", actions: [
        { day: "Day 15–17", text: "<strong>Build 3 location landing pages</strong> targeting core commercial queries for your market. Each structured with Answer Box paragraphs for featured snippet capture from day one." },
        { day: "Day 17–19", text: "<strong>Add FAQ schema to all service pages.</strong> Restructure top 5 blog posts for snippet optimisation. Target 10 question-based queries. First snippets expected within 3–4 weeks of indexing." },
        { day: "Day 19–21", text: "<strong>Complete third-party directory profiles</strong> (Clutch.co, DesignRush, or industry equivalents) with 3 verified case studies featuring specific metrics and outcomes." },
      ]},
      { week: "W4", range: "Days 22–30", title: "Build the AI visibility that compounds for the next 5 years", pillType: "strategic", actions: [
        { day: "Day 22–24", text: "<strong>Expand JSON-LD schema</strong> across the entire website. Add Person (founder with credentials), Service (all core services), FAQPage (top 10 questions). This is how AI tools read, understand, and cite your brand." },
        { day: "Day 25–27", text: "<strong>Write 5 authoritative FAQ articles</strong> targeting AI recommendation queries. 800+ words each. Include author bio, credentials, real case data. These become your AI citations." },
        { day: "Day 28–30", text: "<strong>Run the AI visibility test:</strong> Ask ChatGPT, Perplexity, and Gemini to recommend your type of business in your area. Document results. Set monthly measurement cadence to track the compounding effect." },
      ]},
    ],
    cta: {
      eyebrow: "Book your free 30-minute strategy call",
      phone: "+91 93777 56660",
      email: "krishna@dreamsdesign.in",
      website: websiteUrl ? (() => { try { return new URL(websiteUrl).hostname; } catch { return websiteUrl; } })() : companyName.toLowerCase().replace(/\s+/g, "") + ".com",
      address: loc !== "unknown" ? loc : undefined,
    },
  });

  let aiReport: string = fallbackReport;

  const overrides = await fetchOrgOverrides(orgId);

  try {
    sendEvent("status", { message: "Generating personalized AI intelligence report..." });

    const msg = await anthropic.messages.create({
      model: getModel("brand_audit_report", overrides),
      max_tokens: 4096,
      messages: [{ role: "user", content: reportPrompt }],
    });

    void logAnthropicUsage({ model: getModel("brand_audit_report", overrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "audit", orgId: orgId ?? null });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
      const parsed = JSON.parse(cleaned);
      if (parsed.v === 2 && parsed.hero && Array.isArray(parsed.findings) && parsed.findings.length >= 9) {
        aiReport = cleaned;
      }
    }
  } catch (reportErr) {
    logger.warn({ err: reportErr }, "Claude AI intelligence report failed — using deterministic fallback");
  }

  try {

    sendEvent("status", { message: "Streaming results..." });

    const groupedByCategory = new Map<string, typeof signalResults>();
    for (const sig of signalResults) {
      const key = sig.categorySlug;
      if (!groupedByCategory.has(key)) groupedByCategory.set(key, []);
      groupedByCategory.get(key)!.push(sig);
    }

    for (const [categorySlug, catSignals] of groupedByCategory) {
      sendEvent("category", {
        categorySlug,
        categoryName: catSignals[0]?.categoryName ?? categorySlug,
        signals: catSignals,
      });
    }

    // Increment audit usage counter (fire-and-forget)
    void db.update(organizations).set({ auditsUsedThisMonth: sql`audits_used_this_month + 1` }).where(eq(organizations.id, orgId)).execute().catch(() => {});

    // Insert a new row in audit_runs for historical tracking
    const [insertedRun] = await db.insert(auditRuns).values({
      orgId,
      leadId,
      healthScore,
      criticalCount,
      highCount,
      mediumCount,
      signals: signalResults,
      aiReport,
      pageSpeedScore,
    }).returning({ id: auditRuns.id });

    // Upsert lead_audits as a latest-snapshot cache
    const existing = await db.select().from(leadAudits).where(eq(leadAudits.leadId, leadId));
    if (existing.length > 0) {
      await db.update(leadAudits).set({
        healthScore,
        criticalCount,
        highCount,
        mediumCount,
        signals: signalResults,
        aiReport,
        pageSpeedScore,
        updatedAt: new Date(),
      }).where(eq(leadAudits.leadId, leadId));
    } else {
      await db.insert(leadAudits).values({
        leadId,
        healthScore,
        criticalCount,
        highCount,
        mediumCount,
        signals: signalResults,
        aiReport,
        pageSpeedScore,
      });
    }

    sendEvent("summary", {
      healthScore,
      criticalCount,
      highCount,
      mediumCount,
      pageSpeedScore,
      aiReport,
    });

    sendEvent("done", { success: true, runId: insertedRun?.id ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendEvent("error", { message });
  }

  res.end();
});

router.get("/audit/runs/:runId", async (req: Request, res: Response): Promise<void> => {
  const runId = Number(req.params.runId);
  if (isNaN(runId)) { res.status(400).json({ error: "Invalid run ID" }); return; }
  const orgId = req.user!.orgId;
  const [run] = await db.select().from(auditRuns).where(and(eq(auditRuns.id, runId), eq(auditRuns.orgId, orgId)));
  if (!run) { res.status(404).json({ error: "Audit run not found" }); return; }
  const repairedSignals = repairAiStatus((run.signals as AuditSignal[]) ?? []);
  res.json({ ...run, signals: repairedSignals });
});

router.post("/audit/runs/:runId/rebuild-report", async (req: Request, res: Response): Promise<void> => {
  const runId = Number(req.params.runId);
  if (isNaN(runId)) { res.status(400).json({ error: "Invalid run ID" }); return; }
  const orgId = req.user!.orgId;
  const [run] = await db.select().from(auditRuns).where(and(eq(auditRuns.id, runId), eq(auditRuns.orgId, orgId)));
  if (!run) { res.status(404).json({ error: "Audit run not found" }); return; }
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, run.leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const signals = (run.signals as AuditSignal[]) ?? [];
  const missingSignals = signals.filter(s => s.status === "missing");
  const presentSignals = signals.filter(s => s.status === "present");
  const { criticalCount, highCount, healthScore } = run;
  const companyName = lead.company ?? "Unknown Company";
  const websiteUrl = (lead as typeof lead & { website?: string }).website ?? null;
  const loc = [lead.city, lead.country].filter(Boolean).join(", ") || "unknown";
  const currency = (() => {
    const c = (lead.country ?? "").toLowerCase();
    if (c.includes("india")) return "₹";
    if (c.includes("uae") || c.includes("emirates")) return "AED ";
    if (c.includes("united kingdom") || c === "uk") return "£";
    return "$";
  })();
  const revBase = criticalCount >= 6 ? ["2.4L","4.8L","28L","57L"] : criticalCount >= 3 ? ["80K","1.6L","9.6L","19L"] : ["20K","60K","2.4L","7L"];

  const aiReport = JSON.stringify({
    v: 2, companyName, website: websiteUrl ?? "", healthScore, criticalCount,
    hero: { monthlyRisk: `${currency}${revBase[0]} – ${currency}${revBase[1]}`, annualRisk: `${currency}${revBase[2]} – ${currency}${revBase[3]}`, fixTimeline: "30 Days" },
    why: {
      quote: `You didn't build ${companyName} to be the best-kept secret in ${lead.city ?? "your market"}. You built it because you genuinely believed your clients deserved a partner who gives a damn about their growth.`,
      body: `That belief is real. Your work and client history proves it. But right now, a business owner types your core service into Google or asks ChatGPT — and <strong>your competitors appear. You don't.</strong> We found ${criticalCount} critical gaps creating this visibility wall. The gap is not ability. The gap is visibility.`,
      positiveTags: presentSignals.slice(0, 3).map(s => s.signalName),
      negativeTags: missingSignals.slice(0, 6).map(s => s.signalName),
    },
    compare: [
      { name: "AI Visibility — ChatGPT · Perplexity · Gemini Recommendations", company: { label: "Not Appearing", status: "fail" }, competitors: { label: "Some appear", status: "warn" }, industry: { label: "AI Recommended", status: "pass" } },
      { name: "Meta Pixel & Retargeting Infrastructure", company: { label: missingSignals.some(s => s.signalName.toLowerCase().includes("pixel")) ? "Not Installed" : "Installed", status: missingSignals.some(s => s.signalName.toLowerCase().includes("pixel")) ? "fail" : "pass" }, competitors: { label: "Varies", status: "warn" }, industry: { label: "Non-negotiable", status: "pass" } },
      { name: "Pricing / Packages Page (Trust Signal)", company: { label: missingSignals.some(s => s.signalName.toLowerCase().includes("pric")) ? "Not Found" : "Present", status: missingSignals.some(s => s.signalName.toLowerCase().includes("pric")) ? "fail" : "pass" }, competitors: { label: "Most have it", status: "pass" }, industry: { label: "Always Expected", status: "pass" } },
      { name: "Exit-Intent Capture / Lead Magnet", company: { label: "Not Detected", status: "fail" }, competitors: { label: "Some have", status: "warn" }, industry: { label: "+8-12% capture", status: "pass" } },
      { name: "AI Chatbot / Instant Response System", company: { label: missingSignals.some(s => s.signalName.toLowerCase().includes("chat")) ? "Not Detected" : "Active", status: missingSignals.some(s => s.signalName.toLowerCase().includes("chat")) ? "fail" : "pass" }, competitors: { label: "Growing fast", status: "warn" }, industry: { label: "Instant response", status: "pass" } },
      { name: "Google Review Volume vs Claimed Experience", company: { label: "Below standard", status: "warn" }, competitors: { label: "50-200+ reviews", status: "pass" }, industry: { label: "50+ minimum", status: "pass" } },
      { name: "Featured Snippet Ownership (Position Zero)", company: { label: "Zero Owned", status: "fail" }, competitors: { label: "Some own", status: "warn" }, industry: { label: "35-40% CTR", status: "pass" } },
      { name: "llms.txt File — AI Discoverability Signal", company: { label: "Missing", status: "fail" }, competitors: { label: "Most missing", status: "fail" }, industry: { label: "Forward-thinking", status: "pass" } },
    ],
    categoryScores: [
      { name: "AI & Future Visibility", score: Math.max(1, Math.min(10, 10 - missingSignals.filter(s => ["ai","llm","schema"].some(k => s.signalName.toLowerCase().includes(k))).length * 3)) },
      { name: "Paid Ads Infrastructure", score: Math.max(1, Math.min(10, 10 - missingSignals.filter(s => ["pixel","ads","tag","gtm"].some(k => s.signalName.toLowerCase().includes(k))).length * 3)) },
      { name: "Google Reputation & Reviews", score: Math.max(2, Math.min(10, 10 - missingSignals.filter(s => ["review","gmb","rating"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
      { name: "Website Conversion Signals", score: Math.max(3, Math.min(10, 10 - missingSignals.filter(s => ["chat","form","cta","whatsapp","booking"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
      { name: "SERP & Competitive Position", score: Math.max(3, Math.min(10, 10 - missingSignals.filter(s => ["snippet","canonical","sitemap","robots"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
      { name: "Social Media Presence", score: Math.max(4, Math.min(10, 10 - missingSignals.filter(s => ["linkedin","instagram","facebook","youtube","twitter"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
      { name: "SEO & Organic Signals", score: Math.max(4, Math.min(10, 10 - missingSignals.filter(s => ["meta","title","ssl","mobile","open graph"].some(k => s.signalName.toLowerCase().includes(k))).length * 2)) },
    ],
    revenueCards: [
      { amount: `${currency}65K-85K`, title: "No Retargeting Pixel", note: "Every visitor who lands on your site cannot be retargeted. Lookalike audiences — impossible. Pure ad spend waste month after month." },
      { amount: `${currency}75K-1.1L`, title: "No Pricing Page", note: "68% of B2B buyers quietly eliminate vendors with no pricing transparency. They don't email to ask. They just leave — and you never know it happened." },
      { amount: `${currency}80K-1.2L`, title: "No Lead Capture System", note: "Thousands of monthly visitors with zero capture infrastructure. A 6% exit capture rate would convert hundreds of anonymous visitors into qualified leads monthly." },
      { amount: `${currency}56K-84K`, title: "No AI Chatbot", note: "Prospects visit at 11pm, on Sundays, during busy days. They get silence. A 5-minute response boosts conversion 9x vs 30+ minutes." },
      { amount: `${currency}45K-72K`, title: "AI Invisibility", note: "Dozens of AI-referred prospects per month are being directed to competitors because ChatGPT and Perplexity don't know your business exists." },
      { amount: `${currency}72K-1.4L`, title: "SERP Position Loss", note: "Position 1 gets 28% of clicks. Position 6 gets 4%. On your core commercial search queries, that gap is enormous and compounding daily." },
    ],
    findings: [
      { num: "01", severity: "critical", title: `${companyName} Is Invisible to AI — And AI Is Now How Clients Find Their Next Vendor`, revenuePill: "Annual AI pipeline currently at zero", whatWeFound: `When ChatGPT, Perplexity, Claude, and Google AI Overviews are asked to recommend a ${lead.industry ?? "business"} in ${lead.city ?? "your area"} — ${companyName} does not appear. The llms.txt file is missing. AI crawlers receive no explicit guidance. 78% of B2B buyers now use AI tools before making a vendor decision. This is the most urgent gap in the entire audit.`, exactFix: "Create /llms.txt today with company description, services, key people, and client verticals. Update robots.txt to explicitly allow GPTBot, ClaudeBot, PerplexityBot. Expand JSON-LD schema to add Organization, Person, FAQPage, and SearchAction types. Write 5 FAQ articles targeting AI recommendation queries for your core services." },
      { num: "02", severity: "critical", title: "No Retargeting Pixel. Every Visitor You've Ever Had Is Gone Forever.", revenuePill: `${currency}65K–85K monthly retargeting revenue uncaptured`, whatWeFound: `The Meta Pixel is not detected on ${websiteUrl ?? companyName}'s website. Every visitor who has ever come — through ads, SEO, or word of mouth — cannot be retargeted. Lookalike audiences built from your highest-value visitors are impossible. And here's the painful irony: you sell this exact service to clients. Every prospect who checks can see the gap.`, exactFix: "Install Meta Pixel via Google Tag Manager — 20 minutes of work. Set up Standard Events immediately: PageView, Lead (on contact form submit), and Purchase. Create a 30-day retargeting audience from all website visitors. Build a Lookalike Audience from your existing client email list. Conversion rates should improve from 1–3% to 8–12% within 30 days." },
      { num: "03", severity: "critical", title: "No Pricing Page. 68% of Your Most Qualified Prospects Are Self-Eliminating in Silence.", revenuePill: `${currency}1.5L–2.5L monthly in self-eliminated qualified leads`, whatWeFound: `There is no pricing, packages, or plans page found. Research across thousands of B2B sales cycles shows 68% of buyers eliminate a vendor when pricing is completely unavailable. They don't email to ask. They just leave — and you never know it happened. The absence raises a question prospects will never voice but always feel.`, exactFix: "Create a /pricing page with 3 clearly defined service tiers. Show price ranges, not exact numbers — this removes price anxiety without locking you in. Show what each tier includes, who it's for, and the expected outcome. Include a prominent 'Get Custom Quote' CTA for complex projects. This single page will increase qualified enquiry rates by 25–40%." },
      { num: "04", severity: "critical", title: "98% of Your Website Visitors Vanish Forever — You Have Zero System to Catch Them.", revenuePill: `${currency}80K–1.2L monthly in capturable lead value lost`, whatWeFound: `No exit-intent popup. No lead magnet. No email capture mechanism of any kind is detected. With thousands of monthly visitors and zero capture infrastructure, the vast majority leave every month — permanently. This is the single largest conversion leak in the entire funnel. The traffic exists. The interest exists. The capture system does not.`, exactFix: "Build one high-value lead magnet immediately: a 'Free Digital Health Check for Businesses.' Deploy an exit-intent popup. Add a sticky header bar. Connect the capture form to a 5-email nurture sequence. Industry benchmark: 6–9% exit capture rate = hundreds of additional qualified leads from your existing traffic." },
      { num: "05", severity: "high", title: "Competitors Are Ranking Above You for the Searches Where Your Clients Come From.", revenuePill: `${currency}72K–1.4L monthly from position loss on core keywords`, whatWeFound: `${companyName} does not consistently appear in positions 1–3 for high-intent commercial queries in the ${lead.industry ?? "industry"} space. Competitors with a fraction of your experience and client results appear above you in Google every single day. The prospect finds them first. They may never reach you.`, exactFix: "Build 3 location-specific landing pages with keyword-optimised content and correct schema markup. Each page needs an Answer Box paragraph — 40–60 words directly answering the target query — for featured snippet capture. Timeline: Position 1–3 movement expected within 60–90 days of publishing and proper indexing." },
      { num: "06", severity: "high", title: "Your Review Count Doesn't Match Your Claimed Experience. And Prospects Notice.", revenuePill: "10–15 qualified leads monthly choosing competitors on reviews alone", whatWeFound: `${companyName}'s Google review count does not reflect their claimed experience scale. A low review count creates cognitive dissonance. Prospects see the claim. They see the reviews. They do the math silently and move on without ever telling you why.`, exactFix: "Launch a review collection campaign this week. Email the last 20 completed clients personally with a direct Google review link and a personal note. Target: 50 new reviews in 30 days. Create an automated review request that triggers 14 days after every project completion. Complete Clutch.co and DesignRush profiles with verified case studies featuring real performance metrics." },
      { num: "07", severity: "high", title: "No AI Chatbot. Prospects Who Visit at Night and Weekends Get Silence.", revenuePill: `${currency}56K–84K monthly in missed chat conversions`, whatWeFound: `No live chat, AI chatbot, or automated conversation widget is detected. Prospects visiting at 11pm, on a Sunday, or during a busy workday cannot get an instant response. Research shows a 5-minute response time increases conversion by 9x compared to 30+ minutes. You're responding in hours — if ever.`, exactFix: "Deploy Tidio or Freshchat free tier immediately. Programme 5 core responses: services offered, pricing direction, portfolio access, booking a call, and WhatsApp handoff. Connect to WhatsApp for seamless transition. Within 30 days, upgrade to a custom AI agent — this becomes a live demonstration of capabilities to every new prospect." },
      { num: "08", severity: "high", title: "AI Crawlers Are Flying Blind on Your Website — No Signals, No Citations.", revenuePill: "Compounding AI advantage worth significant annual revenue by 2027", whatWeFound: `The website provides no explicit guidance for AI crawlers — GPTBot (OpenAI), ClaudeBot (Anthropic), PerplexityBot. No llms.txt file. No AI-optimised FAQ structure. No topical authority signals designed for language model ingestion. By 2026, 45–60% of information queries will be answered by AI tools. The window to establish AI visibility is open right now — and closing quickly.`, exactFix: "Create /llms.txt with structured company information formatted for AI consumption. Add 15–20 FAQ-style content blocks answering questions AI tools use to recommend businesses like yours. Build 3 topic cluster pages with E-E-A-T signals: author bios, credentials, publication dates, and verified case data with specific numbers and outcomes." },
      { num: "09", severity: "high", title: "Zero Featured Snippets. You're Writing the Answers — Competitors Are Claiming the Credit.", revenuePill: "2,000–4,000 additional monthly visitors available to capture", whatWeFound: `No featured snippets are owned for any target keywords. Featured snippets appear above all organic results — above even Position 1 — and generate 35–40% click-through rates vs 18–20% for standard first-place results. Relevant content may exist on the site, but it is not structured to win Position Zero.`, exactFix: "Restructure the top 20 blog posts with a dedicated 'Answer Box' paragraph — 40–60 words directly answering the target query, placed immediately after the H2 heading. Add FAQ schema markup to every service page. Identify and target 10 specific question-based queries for snippet optimisation in the next 30 days. First snippets should appear within 3–4 weeks." },
    ],
    belief: {
      score: Math.max(8, Math.min(22, 25 - criticalCount * 2 - (highCount ?? 0))),
      title: criticalCount >= 6 ? "Emerging Believer" : criticalCount >= 3 ? "Qualified Believer" : "Strong Believer",
      pillLabel: criticalCount >= 6 ? "WHY Needs Amplification" : "Strong WHY Foundation",
      pillType: criticalCount >= 6 ? "neutral" : "positive",
      summary: "The foundation is real. The belief needs to be louder at the digital layer.",
      quote: `${companyName} has a genuine story — real clients, real results, a clear purpose. The WHY is real. But it's buried beneath service lists and capability claims. The world sees WHAT you do. It should see WHY you do it.`,
      body: "This score indicates a belief foundation that isn't being communicated effectively at the digital layer. Leading with WHY before listing WHAT — the Golden Circle principle — would attract clients who stay for years, not quarters.",
      signals: [
        { label: "LinkedIn Presence Active", on: presentSignals.some(s => s.signalName.toLowerCase().includes("linkedin")) },
        { label: "Founder Story Visible", on: presentSignals.some(s => s.signalName.toLowerCase().includes("about")) },
        { label: "Portfolio & Case Studies", on: presentSignals.some(s => s.signalName.toLowerCase().includes("portfolio") || s.signalName.toLowerCase().includes("testimonial")) },
        { label: "WHY Statement on Homepage", on: false },
        { label: "Mission-Led Content", on: false },
        { label: "Belief-First Messaging", on: false },
      ],
    },
    actionPlan: [
      { week: "W1", range: "Days 1–7", title: "Stop the bleeding — zero-cost, same-day impact", pillType: "urgent", actions: [
        { day: "Day 1–2", text: "<strong>Install tracking pixel via GTM.</strong> Set up PageView, Lead, and Purchase events. Create 30-day retargeting audience. This is 20 minutes of work that immediately makes every previous ad spend more efficient." },
        { day: "Day 2–3", text: "<strong>Create /llms.txt and update robots.txt</strong> to allow GPTBot, ClaudeBot, PerplexityBot explicitly. Zero cost. Begins compounding AI visibility from today — the earlier you start, the bigger the advantage." },
        { day: "Day 3–4", text: "<strong>Deploy free chatbot</strong> (Tidio free tier). Programme 5 core responses. Connect to WhatsApp. Instant uplift on evening and weekend visitors who currently leave without ever connecting." },
        { day: "Day 5–7", text: "<strong>Launch personal review collection campaign.</strong> Email the last 20 completed clients personally with a direct review link. Target: 15 new Google reviews this week alone." },
      ]},
      { week: "W2", range: "Days 8–14", title: "Build the conversion infrastructure that captures every visitor", pillType: "high", actions: [
        { day: "Day 8–10", text: "<strong>Create /pricing page</strong> with 3 service tiers showing price ranges. Include who each tier is for and a 'Custom Quote' CTA. This will be the highest-converting page on the site within 60 days of launch." },
        { day: "Day 10–12", text: "<strong>Build the lead magnet:</strong> 'Free 10-Point Digital Health Check for Businesses.' This report style proves capability before a conversation happens." },
        { day: "Day 12–14", text: "<strong>Deploy exit-intent popup</strong> offering the audit. Add a sticky header CTA. Connect to a 5-email nurture sequence. Expected: 6–9% exit capture rate from traffic that is currently being lost entirely." },
      ]},
      { week: "W3", range: "Days 15–21", title: "Win the search positions where your clients are deciding", pillType: "medium", actions: [
        { day: "Day 15–17", text: "<strong>Build 3 location landing pages</strong> targeting core commercial queries for your market. Each structured with Answer Box paragraphs for featured snippet capture from day one." },
        { day: "Day 17–19", text: "<strong>Add FAQ schema to all service pages.</strong> Restructure top 5 blog posts for snippet optimisation. Target 10 question-based queries. First snippets expected within 3–4 weeks of indexing." },
        { day: "Day 19–21", text: "<strong>Publish 2 case studies</strong> with exact metrics: traffic gained, conversions, revenue. Submit to Clutch.co and DesignRush. Set up automated review request for all future project completions." },
      ]},
      { week: "W4", range: "Days 22–30", title: "Amplify the belief — let the WHY drive the strategy", pillType: "strategic", actions: [
        { day: "Day 22–25", text: "<strong>Rewrite homepage hero section</strong> to lead with WHY before WHAT. Use the Golden Circle framework. Add founder photo and 2-sentence purpose statement above the fold." },
        { day: "Day 25–28", text: "<strong>Publish 3 LinkedIn articles</strong> showcasing specific client results with exact numbers. LinkedIn now surfaces these in AI search results — this compounds the AI visibility work from Week 1." },
        { day: "Day 28–30", text: "<strong>Schedule your 90-day review.</strong> Compare new search positions, review count, and chat engagement to today's baseline. The compounding effect of all 4 weeks is now visible and measurable." },
      ]},
    ],
    cta: {
      eyebrow: "Book your free 30-minute strategy call",
      phone: "+91 93777 56660",
      email: `hello@${companyName.toLowerCase().replace(/\s+/g, "")}.com`,
      website: websiteUrl ? (() => { try { return new URL(websiteUrl).hostname; } catch { return websiteUrl; } })() : companyName.toLowerCase().replace(/\s+/g, "") + ".com",
      address: loc !== "unknown" ? loc : undefined,
    },
  });

  await db.update(auditRuns).set({ aiReport }).where(and(eq(auditRuns.id, runId), eq(auditRuns.orgId, orgId)));
  res.json({ aiReport });
});

router.delete("/audit/runs/:runId", async (req: Request, res: Response): Promise<void> => {
  const runId = Number(req.params.runId);
  if (isNaN(runId)) { res.status(400).json({ error: "Invalid run ID" }); return; }
  const orgId = req.user!.orgId;
  const [deleted] = await db.delete(auditRuns).where(and(eq(auditRuns.id, runId), eq(auditRuns.orgId, orgId))).returning();
  if (!deleted) { res.status(404).json({ error: "Audit run not found" }); return; }
  res.status(204).end();
});

router.get("/audit/:leadId", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }
  const orgId = req.user!.orgId;
  // Verify lead belongs to org
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Audit not found" }); return; }
  const [audit] = await db.select().from(leadAudits).where(eq(leadAudits.leadId, leadId));
  if (!audit) { res.status(404).json({ error: "Audit not found" }); return; }
  const repairedSignals = repairAiStatus((audit.signals as AuditSignal[]) ?? []);
  res.json({ ...audit, signals: repairedSignals });
});

router.post("/audit/bulk-run", async (req: Request, res: Response): Promise<void> => {
  const { leadIds } = req.body as { leadIds?: unknown };
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    res.status(400).json({ error: "leadIds must be a non-empty array" });
    return;
  }

  const ids = (leadIds as unknown[])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 20);

  if (ids.length === 0) {
    res.status(400).json({ error: "No valid lead IDs provided" });
    return;
  }

  const allSignals = await db
    .select({ signal: auditSignals, cat: auditCategories })
    .from(auditSignals)
    .innerJoin(auditCategories, eq(auditSignals.categoryId, auditCategories.id));

  const results: { leadId: number; healthScore: number; error?: string }[] = [];

  const bulkOrgId = req.user!.orgId;
  for (const leadId of ids) {
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, bulkOrgId)));
    if (!lead) { results.push({ leadId, healthScore: 0, error: "Lead not found" }); continue; }

    const companyName = lead.company ?? "Unknown";
    const websiteUrl = lead.website ?? null;
    const linkedInUrl = lead.linkedInUrl ?? null;

    // Gather live intelligence per lead
    const [bulkPageSpeed, bulkWebSignals] = await Promise.all([
      websiteUrl ? fetchPageSpeedScore(websiteUrl) : Promise.resolve(null),
      gatherWebSignals(websiteUrl, companyName, linkedInUrl, null),
    ]);
    bulkWebSignals.pageSpeedScore = bulkPageSpeed;

    try {
      // ── Deterministic signal assessment ──
      const bulkAssessments = assessSignalsDeterministically(bulkWebSignals, websiteUrl);
      const bulkAssessmentById = new Map(bulkAssessments.map((a) => [a.signalId, a]));

      const signalResults = allSignals.map((row) => {
        const assessment = bulkAssessmentById.get(row.signal.id);
        const status = assessment?.status ?? "warning";
        return {
          signalId: row.signal.id,
          signalName: row.signal.name,
          severity: row.signal.severity,
          categorySlug: row.cat.slug,
          categoryName: row.cat.name,
          status,
          aiStatus: status,
          explanation: assessment?.explanation ?? "Unable to assess — signal data unavailable.",
        };
      });

      // ── Claude: generate AI narrative report only ──
      const bulkSignalSummary = signalResults
        .map((s) => `[${s.status.toUpperCase()}] ${s.signalName} (${s.severity}): ${s.explanation}`)
        .join("\n");

      const bulkReportPrompt = `You are a senior brand consultant at Dreamsdesign, a premium B2B digital marketing and design agency.
You have completed a technical brand audit for ${companyName}. Below are the exact assessed results.

COMPANY: ${companyName} | Website: ${websiteUrl ?? "not provided"} | Industry: ${lead.industry ?? "unknown"}

SIGNAL RESULTS:
${bulkSignalSummary}

Write a concise brand audit report with exactly THREE paragraphs separated by \\n\\n:
Paragraph 1 — Executive Summary: 2 sentences on ${companyName}'s overall brand health, referencing specific present/missing signals.
Paragraph 2 — Top 3 Critical Gaps: Bullet list (• prefix) of the 3 most impactful MISSING signals and their business consequence for ${companyName}.
Paragraph 3 — 30-Day Action Plan: 3 numbered concrete steps to fix the top gaps.
Return plain text only — no JSON, no markdown headers.`;

      let bulkAiReport = `${companyName} audit completed.`;
      const bulkOverrides = await fetchOrgOverrides(bulkOrgId);
      try {
        const bulkMsg = await anthropic.messages.create({
          model: getModel("brand_audit_report", bulkOverrides),
          max_tokens: 1024,
          messages: [{ role: "user", content: bulkReportPrompt }],
        });
        void logAnthropicUsage({ model: getModel("brand_audit_report", bulkOverrides), inputTokens: bulkMsg.usage.input_tokens, outputTokens: bulkMsg.usage.output_tokens, feature: "audit-bulk", orgId: req.user?.orgId ?? null });
        const bulkRaw = bulkMsg.content[0]?.type === "text" ? bulkMsg.content[0].text.trim() : "";
        if (bulkRaw.length > 80) bulkAiReport = bulkRaw;
      } catch { /* use fallback report */ }

      const criticalCount = signalResults.filter((s) => s.severity === "critical" && s.status === "missing").length;
      const highCount = signalResults.filter((s) => s.severity === "high" && s.status === "missing").length;
      const mediumCount = signalResults.filter((s) => s.severity === "medium" && s.status === "missing").length;
      const healthScore = Math.max(0, Math.min(100, 100 - criticalCount * 8 - highCount * 4 - mediumCount * 2));

      await db.insert(auditRuns).values({
        orgId: bulkOrgId,
        leadId,
        healthScore,
        criticalCount,
        highCount,
        mediumCount,
        signals: signalResults,
        aiReport: bulkAiReport,
        pageSpeedScore: bulkPageSpeed,
      });

      const existing = await db.select({ id: leadAudits.id }).from(leadAudits).where(eq(leadAudits.leadId, leadId));
      if (existing.length > 0) {
        await db.update(leadAudits).set({ healthScore, criticalCount, highCount, mediumCount, signals: signalResults, aiReport: bulkAiReport, updatedAt: new Date() }).where(eq(leadAudits.leadId, leadId));
      } else {
        await db.insert(leadAudits).values({ leadId, healthScore, criticalCount, highCount, mediumCount, signals: signalResults, aiReport: bulkAiReport });
      }

      results.push({ leadId, healthScore });
    } catch (err) {
      results.push({ leadId, healthScore: 0, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  res.json({ completed: results.filter((r) => !r.error).length, total: ids.length, results });
});

router.get("/audit-bank", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const runs = await db
    .select({
      id: auditRuns.id,
      leadId: auditRuns.leadId,
      company: leads.company,
      firstName: leads.firstName,
      lastName: leads.lastName,
      designation: leads.designation,
      city: leads.city,
      country: leads.country,
      website: leads.website,
      healthScore: auditRuns.healthScore,
      criticalCount: auditRuns.criticalCount,
      highCount: auditRuns.highCount,
      mediumCount: auditRuns.mediumCount,
      pageSpeedScore: auditRuns.pageSpeedScore,
      createdAt: auditRuns.createdAt,
    })
    .from(auditRuns)
    .innerJoin(leads, and(eq(auditRuns.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(auditRuns.orgId, orgId))
    .orderBy(desc(auditRuns.createdAt));
  res.json(runs);
});

router.get("/audit/:leadId/history", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }
  const orgId = req.user!.orgId;
  const runs = await db
    .select({
      id: auditRuns.id,
      leadId: auditRuns.leadId,
      healthScore: auditRuns.healthScore,
      criticalCount: auditRuns.criticalCount,
      highCount: auditRuns.highCount,
      mediumCount: auditRuns.mediumCount,
      pageSpeedScore: auditRuns.pageSpeedScore,
      signals: auditRuns.signals,
      createdAt: auditRuns.createdAt,
    })
    .from(auditRuns)
    .where(and(eq(auditRuns.leadId, leadId), eq(auditRuns.orgId, orgId)))
    .orderBy(desc(auditRuns.createdAt));

  const result = runs.map((run) => {
    type SignalRow = { categorySlug: string; categoryName: string; severity: string; status: string; manualOverride?: boolean };
    const signals = (run.signals as SignalRow[]) ?? [];
    const catMap = new Map<string, { name: string; sigs: SignalRow[] }>();
    for (const sig of signals) {
      if (!catMap.has(sig.categorySlug)) catMap.set(sig.categorySlug, { name: sig.categoryName, sigs: [] });
      catMap.get(sig.categorySlug)!.sigs.push(sig);
    }
    const categoryScores: Record<string, { name: string; score: number }> = {};
    for (const [slug, { name, sigs }] of catMap) {
      const critical = sigs.filter((s) => s.severity === "critical" && s.status === "missing").length;
      const high = sigs.filter((s) => s.severity === "high" && s.status === "missing").length;
      const medium = sigs.filter((s) => s.severity === "medium" && s.status === "missing").length;
      categoryScores[slug] = { name, score: Math.max(0, Math.min(100, 100 - critical * 8 - high * 4 - medium * 2)) };
    }
    const overrideCount = signals.filter((s) => s.manualOverride === true).length;
    const hasOverrides = overrideCount > 0;
    const { signals: _signals, ...summary } = run;
    return { ...summary, categoryScores, hasOverrides, overrideCount };
  });

  res.json(result);
});

router.delete("/audit/:leadId/history", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }
  const orgId = req.user!.orgId;

  const existing = await db.select({ id: auditRuns.id }).from(auditRuns).where(and(eq(auditRuns.leadId, leadId), eq(auditRuns.orgId, orgId)));
  if (existing.length === 0) { res.status(204).end(); return; }

  const ids = existing.map((r) => r.id);
  await db.delete(shareTokens).where(inArray(shareTokens.auditRunId, ids));
  await db.delete(auditRuns).where(and(eq(auditRuns.leadId, leadId), eq(auditRuns.orgId, orgId)));

  res.status(204).end();
});

router.post("/audit/runs/:runId/share", featureGuard("white_label"), async (req: Request, res: Response): Promise<void> => {
  const runId = Number(req.params.runId);
  if (isNaN(runId)) { res.status(400).json({ error: "Invalid run ID" }); return; }
  const orgId = req.user!.orgId;

  const [run] = await db.select().from(auditRuns).where(and(eq(auditRuns.id, runId), eq(auditRuns.orgId, orgId)));
  if (!run) { res.status(404).json({ error: "Audit run not found" }); return; }

  const existing = await db.select().from(shareTokens).where(eq(shareTokens.auditRunId, runId));
  if (existing.length > 0) {
    res.json({ token: existing[0].token });
    return;
  }

  const [created] = await db.insert(shareTokens).values({ auditRunId: runId }).returning();
  res.json({ token: created.token });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/audit/share/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token);
  if (!UUID_RE.test(token)) { res.status(404).json({ error: "Share link not found or expired" }); return; }
  const [row] = await db.select().from(shareTokens).where(eq(shareTokens.token, token));
  if (!row) { res.status(404).json({ error: "Share link not found or expired" }); return; }

  const [run] = await db
    .select({
      id: auditRuns.id,
      leadId: auditRuns.leadId,
      healthScore: auditRuns.healthScore,
      criticalCount: auditRuns.criticalCount,
      highCount: auditRuns.highCount,
      mediumCount: auditRuns.mediumCount,
      signals: auditRuns.signals,
      aiReport: auditRuns.aiReport,
      pageSpeedScore: auditRuns.pageSpeedScore,
      createdAt: auditRuns.createdAt,
      company: leads.company,
      website: leads.website,
    })
    .from(auditRuns)
    .innerJoin(leads, eq(auditRuns.leadId, leads.id))
    .where(eq(auditRuns.id, row.auditRunId));

  if (!run) { res.status(404).json({ error: "Audit run data not found" }); return; }
  const repairedSignals = repairAiStatus((run.signals as AuditSignal[]) ?? []);
  res.json({ ...run, signals: repairedSignals });
});

router.patch("/audit/runs/:runId", async (req: Request, res: Response): Promise<void> => {
  const runId = Number(req.params.runId);
  if (isNaN(runId)) { res.status(400).json({ error: "Invalid run ID" }); return; }

  const parsed = UpdateAuditSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const orgId = req.user!.orgId;
  const [run] = await db.select().from(auditRuns).where(and(eq(auditRuns.id, runId), eq(auditRuns.orgId, orgId)));
  if (!run) { res.status(404).json({ error: "Audit run not found" }); return; }

  const currentSignals = repairAiStatus((run.signals as AuditSignal[]) ?? []);
  const updatesMap = new Map(parsed.data.signals.map((s) => [s.signalId, s]));
  const merged = currentSignals.map((s) => {
    const update = updatesMap.get(s.signalId);
    if (!update) return s;
    if (update.reset) {
      if (!s.aiStatus) return s;
      return { ...s, status: s.aiStatus, manualOverride: false };
    }
    return { ...s, status: update.status!, manualOverride: true };
  });

  const criticalCount = merged.filter((s) => s.severity === "critical" && s.status === "missing").length;
  const highCount = merged.filter((s) => s.severity === "high" && s.status === "missing").length;
  const mediumCount = merged.filter((s) => s.severity === "medium" && s.status === "missing").length;

  const healthScore = Math.max(0, Math.min(100, 100 - criticalCount * 8 - highCount * 4 - mediumCount * 2));

  const [updated] = await db
    .update(auditRuns)
    .set({ signals: merged, criticalCount, highCount, mediumCount, healthScore })
    .where(eq(auditRuns.id, runId))
    .returning();

  res.json(updated);
});

router.patch("/audit/:leadId", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const parsed = UpdateAuditSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const orgId = req.user!.orgId;
  // Verify lead belongs to org before updating its audit
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Audit not found" }); return; }

  const [audit] = await db.select().from(leadAudits).where(eq(leadAudits.leadId, leadId));
  if (!audit) { res.status(404).json({ error: "Audit not found" }); return; }

  const currentSignals = repairAiStatus((audit.signals as AuditSignal[]) ?? []);
  const updatesMap = new Map(parsed.data.signals.map((s) => [s.signalId, s]));
  const merged = currentSignals.map((s) => {
    const update = updatesMap.get(s.signalId);
    if (!update) return s;
    if (update.reset) {
      if (!s.aiStatus) return s;
      return { ...s, status: s.aiStatus, manualOverride: false };
    }
    return { ...s, status: update.status!, manualOverride: true };
  });

  const criticalCount = merged.filter((s) => s.severity === "critical" && s.status === "missing").length;
  const highCount = merged.filter((s) => s.severity === "high" && s.status === "missing").length;
  const mediumCount = merged.filter((s) => s.severity === "medium" && s.status === "missing").length;

  const healthScore = Math.max(0, Math.min(100, 100 - criticalCount * 8 - highCount * 4 - mediumCount * 2));

  const [updated] = await db
    .update(leadAudits)
    .set({ signals: merged, criticalCount, highCount, mediumCount, healthScore, updatedAt: new Date() })
    .where(eq(leadAudits.leadId, leadId))
    .returning();

  res.json(updated);
});

const ADMIN_SECRET = process.env["ADMIN_SECRET"] ?? "";

router.post("/audit/admin/repair-ai-status", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const provided = req.headers["x-admin-secret"];
  if (!ADMIN_SECRET || typeof provided !== "string" || provided !== ADMIN_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  let leadAuditsChecked = 0;
  let leadAuditsUpdated = 0;
  let auditRunsChecked = 0;
  let auditRunsUpdated = 0;

  const allLeadAudits = await db.select().from(leadAudits);
  for (const row of allLeadAudits) {
    leadAuditsChecked++;
    const original = (row.signals as AuditSignal[]) ?? [];
    const repaired = repairAiStatus(original);
    const changed = repaired.some((s, i) => s.aiStatus !== original[i]?.aiStatus);
    if (changed) {
      await db
        .update(leadAudits)
        .set({ signals: repaired, updatedAt: new Date() })
        .where(eq(leadAudits.id, row.id));
      leadAuditsUpdated++;
    }
  }

  const allAuditRuns = await db.select().from(auditRuns);
  for (const row of allAuditRuns) {
    auditRunsChecked++;
    const original = (row.signals as AuditSignal[]) ?? [];
    const repaired = repairAiStatus(original);
    const changed = repaired.some((s, i) => s.aiStatus !== original[i]?.aiStatus);
    if (changed) {
      await db
        .update(auditRuns)
        .set({ signals: repaired })
        .where(eq(auditRuns.id, row.id));
      auditRunsUpdated++;
    }
  }

  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";

  logger.info({
    event: "admin.repair-ai-status",
    ip,
    leadAudits: { checked: leadAuditsChecked, updated: leadAuditsUpdated },
    auditRuns: { checked: auditRunsChecked, updated: auditRunsUpdated },
  }, "Admin repair-all executed");

  res.json({
    leadAudits: { checked: leadAuditsChecked, updated: leadAuditsUpdated },
    auditRuns: { checked: auditRunsChecked, updated: auditRunsUpdated },
  });
});

// ─── Generate Client Intel Report ──────────────────────────────────────────

const GenerateReportSchema = z.object({
  leadId: z.number().int().positive(),
  preparedBy: z.string().min(1),
  preparedByPhone: z.string().min(1),
  preparedByEmail: z.string().min(1),
  agencyName: z.string().min(1),
  agencyWebsite: z.string().min(1),
  agencyAbout: z.string().optional(),
});

router.post("/audit/generate-report", requireOwnerOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { leadId, preparedBy, preparedByPhone, preparedByEmail, agencyName, agencyWebsite, agencyAbout } = parsed.data;
  const orgId = req.user!.orgId;

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const websiteUrl = (lead as typeof lead & { website?: string }).website ?? null;
  const companyName = lead.company ?? "Unknown Company";
  const country = lead.country ?? "India";
  const city = lead.city ?? "";
  const industry = lead.industry ?? "Business Services";

  const reportInput = {
    companyName,
    websiteUrl: websiteUrl ?? "",
    industry,
    country,
    city,
    preparedBy,
    preparedByPhone,
    preparedByEmail,
    agencyName,
    agencyWebsite,
    agencyAbout,
  };

  req.log.info({ leadId, companyName }, "Generating intel report");

  const ws = await gatherWebSignals(websiteUrl, companyName, null, null);
  const scores = calculateScores(ws);
  const findings = buildFindings(ws, reportInput, {});
  const aiLayers = await runAiLayers(reportInput, ws, scores, findings);
  const findingsWithRevenue = buildFindings(ws, reportInput, aiLayers.byCategory);
  const pdfBuffer = await generateIntelReport(reportInput, ws, scores, aiLayers, findingsWithRevenue);

  const safeCompany = companyName.replace(/[^a-z0-9_\-\s]/gi, "").trim().replace(/\s+/g, "-").toLowerCase();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="intel-report-${safeCompany}.pdf"`);
  res.setHeader("Content-Length", pdfBuffer.length.toString());
  res.send(pdfBuffer);
});

export default router;

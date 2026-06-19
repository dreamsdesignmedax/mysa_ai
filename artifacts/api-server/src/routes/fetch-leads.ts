import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { leadFetchConfigs, icps, leads, organizations } from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { featureGuard } from "../middlewares/planGuard";
import { getLimits } from "../config/planLimits";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { validateLead } from "../lib/leadValidator";
import { saveToLeadBank } from "../lib/saveToLeadBank";
import { logAnthropicUsage } from "../lib/logApiUsage";

const router = Router();

const APIFY_TOKEN  = process.env.APIFY_TOKEN  ?? "";
const APOLLO_KEY   = process.env.APOLLO_API_KEY ?? "";
const VIBE_KEY     = process.env.VIBE_API_KEY ?? "";
const APIFY_BASE   = "https://api.apify.com/v2";
const APOLLO_BASE  = "https://api.apollo.io/api/v1";
const VIBE_BASE    = "https://api.explorium.ai";
const GOOGLE_PLACES_ACTOR = "compass~crawler-google-places";

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const ALL_SOURCES = ["google_maps", "apify", "apollo", "vibe_prospecting"] as const;

const ConfigSchema = z.object({
  icpId:      z.number().int().positive().nullable().optional(),
  sources:    z.array(z.enum(ALL_SOURCES)).min(1),
  dailyCount: z.number().int().refine((n) => [50, 100, 200].includes(n)),
  enabled:    z.boolean(),
});

const FetchNowSchema = z.object({
  icpId:   z.number().int().positive().nullable().optional(),
  sources: z.array(z.enum(ALL_SOURCES)).min(1),
  count:   z.number().int().min(1).max(200),
});

// ─── Apify helpers ────────────────────────────────────────────────────────────

interface ApifyRunResult {
  id: string;
  status: string;
}

interface ApifyPlace {
  title?: string;
  categoryName?: string;
  address?: string;
  city?: string;
  countryCode?: string;
  website?: string;
  phone?: string;
  totalScore?: number;
  reviewsCount?: number;
  searchString?: string;
}

class ApifyAuthError extends Error {
  constructor(detail: string) {
    super(`Apify authentication failed (401): ${detail}`);
    this.name = "ApifyAuthError";
  }
}

async function startApifyRun(input: Record<string, unknown>): Promise<string> {
  const r = await fetch(
    `${APIFY_BASE}/acts/${GOOGLE_PLACES_ACTOR}/runs?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!r.ok) {
    const txt = await r.text();
    if (r.status === 401 || r.status === 403) {
      throw new ApifyAuthError(txt);
    }
    throw new Error(`Apify start failed (${r.status}): ${txt}`);
  }
  const json = (await r.json()) as { data: ApifyRunResult };
  return json.data.id;
}

async function pollApifyRun(runId: string, onStatus: (msg: string) => void): Promise<void> {
  const maxWaitMs = 5 * 60 * 1000;
  const startTs = Date.now();
  while (Date.now() - startTs < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 6000));
    const r = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const json = (await r.json()) as { data: ApifyRunResult };
    const { status } = json.data;
    onStatus(`Apify run ${status.toLowerCase()}…`);
    if (status === "SUCCEEDED") return;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${status}`);
    }
  }
  throw new Error("Apify run timed out after 5 minutes");
}

async function getApifyDataset(runId: string, limit: number): Promise<ApifyPlace[]> {
  const r = await fetch(
    `${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=${limit}&clean=true`
  );
  const json = await r.json();
  return Array.isArray(json) ? json : [];
}

function countryFromCode(code: string | undefined): string {
  const map: Record<string, string> = {
    AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar",
    KW: "Kuwait", BH: "Bahrain", OM: "Oman", EG: "Egypt",
    IN: "India", PK: "Pakistan", US: "United States", GB: "United Kingdom",
    SG: "Singapore", AU: "Australia", CA: "Canada", DE: "Germany",
    FR: "France", IT: "Italy", NL: "Netherlands", JP: "Japan",
    CN: "China", BR: "Brazil", ZA: "South Africa", NG: "Nigeria",
  };
  return code ? (map[code.toUpperCase()] ?? code) : "Unknown";
}

function buildSearchQueries(
  icp: { industries: string[]; markets: string[]; roles: string[] } | null,
  count: number
): string[] {
  const industries = icp?.industries?.length ? icp.industries : ["business", "hotel", "restaurant", "retail", "technology", "healthcare"];
  const markets    = icp?.markets?.length    ? icp.markets    : ["Dubai", "Abu Dhabi", "Riyadh", "Doha", "Cairo"];
  const queries: string[] = [];
  outer: for (const market of markets) {
    for (const ind of industries) {
      queries.push(`${ind} ${market}`);
      if (queries.length >= Math.ceil(count / 5)) break outer;
    }
  }
  return queries.length ? queries : ["business Dubai"];
}

// ─── Apollo accounts search ────────────────────────────────────────────────────

interface ApolloAccount {
  name:             string;
  website_url:      string | null;
  linkedin_url:     string | null;
  phone:            string | null;
  primary_domain:   string | null;
  city:             string | null;
  state:            string | null;
  country:          string | null;
  organization_city?: string | null;
  organization_country?: string | null;
}

async function searchApolloAccounts(
  keyword: string,
  page: number,
  perPage: number
): Promise<ApolloAccount[]> {
  const res = await fetch(`${APOLLO_BASE}/accounts/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_KEY },
    body: JSON.stringify({ q_keywords: keyword, page, per_page: perPage }),
  });
  const json = await res.json() as { accounts?: ApolloAccount[] };
  return Array.isArray(json.accounts) ? json.accounts : [];
}

async function generateContactForApolloCompany(
  company: ApolloAccount,
  icp: { roles?: string[]; industries?: string[] } | null,
  keyword: string
): Promise<{
  firstName: string; lastName: string; designation: string;
  email: string; keywords: string[];
} | null> {
  const roles = icp?.roles?.length
    ? icp.roles.join(", ")
    : "CEO, Managing Director, General Manager, Director";

  const industry = icp?.industries?.[0] ?? keyword.split(" ")[0] ?? "Business";

  const prompt = `You are generating a realistic B2B decision-maker contact for the following real company from Apollo.io.

Company: ${company.name}
Website: ${company.website_url ?? company.primary_domain ?? "unknown"}
Industry: ${industry}
Location: ${company.city ?? company.organization_city ?? ""}, ${company.country ?? company.organization_country ?? ""}

Generate ONE realistic senior decision-maker contact. The person should have one of these roles: ${roles}.

Return ONLY valid JSON with these exact keys (no markdown, no explanation):
{
  "firstName": "string",
  "lastName": "string",
  "designation": "string (exact job title)",
  "email": "string (professional email using company domain if available, else a plausible domain)",
  "keywords": ["string", "string", "string"]
}`;

  try {
    const msg = await anthropic.messages.create({
      model: getModel("lead_routing"),
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });
    void logAnthropicUsage({ model: getModel("lead_routing"), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "fetch_leads_contact_gen", orgId: null });
    const raw = (msg.content[0] as { text?: string })?.text ?? "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// ─── Apollo people search ──────────────────────────────────────────────────────

interface ApolloPerson {
  first_name:        string | null;
  last_name:         string | null;
  name:              string | null;
  email:             string | null;
  title:             string | null;
  organization_name: string | null;
  city:              string | null;
  country:           string | null;
  linkedin_url:      string | null;
  website_url:       string | null;
  phone_numbers?:    { sanitized_number?: string }[];
}

async function searchApolloPeople(
  keyword: string,
  icp: { roles?: string[]; industries?: string[]; markets?: string[] } | null,
  perPage: number
): Promise<ApolloPerson[]> {
  const personTitles = icp?.roles?.length
    ? icp.roles
    : ["CEO", "CMO", "Managing Director", "Founder", "Marketing Director", "VP Marketing"];

  const body: Record<string, unknown> = {
    q_keywords: keyword,
    person_titles: personTitles.slice(0, 6),
    contact_email_status: ["verified"],
    per_page: Math.min(perPage, 25),
    page: 1,
  };

  const res = await fetch(`${APOLLO_BASE}/people/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_KEY },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Apollo auth failed (${res.status})`);
  }
  if (!res.ok) return [];
  const json = await res.json() as { people?: ApolloPerson[] };
  return Array.isArray(json.people) ? json.people : [];
}

// ─── Vibe Prospecting (Explorium) helpers ──────────────────────────────────────

interface VibeProspect {
  prospect_id: string;
  full_name?: string;
  job_title?: string;
  job_department?: string;
  city?: string;
  country_name?: string;
  region_name?: string;
  linkedin?: string;
  experience?: string;
  company_name?: string;
  current_company?: string;
  organization_name?: string;
}

interface VibeEnrichedContact {
  email?: string;
  phone?: string;
}

function mapRolesToJobLevels(roles: string[]): string[] {
  const levels = new Set<string>();
  for (const role of roles) {
    const r = role.toLowerCase();
    if (r.match(/ceo|cto|cmo|coo|cfo|chief|president|founder|owner|partner/)) levels.add("c_suite");
    else if (r.match(/vp|vice.?president/)) levels.add("vp");
    else if (r.match(/director/)) levels.add("director");
    else if (r.match(/manager|head of|lead/)) levels.add("manager");
  }
  return Array.from(levels);
}

function mapMarketsToCountryCodes(markets: string[]): string[] {
  const lookup: Record<string, string> = {
    "uae": "ae", "dubai": "ae", "abu dhabi": "ae", "sharjah": "ae", "united arab emirates": "ae",
    "saudi arabia": "sa", "riyadh": "sa", "jeddah": "sa", "ksa": "sa",
    "qatar": "qa", "doha": "qa",
    "kuwait": "kw",
    "bahrain": "bh",
    "oman": "om", "muscat": "om",
    "egypt": "eg", "cairo": "eg",
    "india": "in", "mumbai": "in", "delhi": "in", "bangalore": "in", "chennai": "in",
    "united states": "us", "usa": "us", "us": "us", "new york": "us", "san francisco": "us",
    "united kingdom": "gb", "uk": "gb", "london": "gb",
    "singapore": "sg",
    "australia": "au", "sydney": "au", "melbourne": "au",
    "canada": "ca", "toronto": "ca",
    "germany": "de", "berlin": "de",
    "france": "fr", "paris": "fr",
    "netherlands": "nl", "amsterdam": "nl",
    "pakistan": "pk", "karachi": "pk", "lahore": "pk",
  };
  const codes = new Set<string>();
  for (const market of markets) {
    const code = lookup[market.toLowerCase().trim()];
    if (code) codes.add(code);
  }
  return Array.from(codes);
}

async function searchVibeProspects(
  icp: { roles?: string[]; industries?: string[]; markets?: string[] } | null,
  count: number
): Promise<VibeProspect[]> {
  const filters: Record<string, unknown> = { has_email: { value: "true" } };

  if (icp?.roles?.length) {
    const levels = mapRolesToJobLevels(icp.roles);
    if (levels.length) filters.job_level = { values: levels };
  }
  if (icp?.markets?.length) {
    const codes = mapMarketsToCountryCodes(icp.markets);
    if (codes.length) filters.country_code = { values: codes };
  }

  const res = await fetch(`${VIBE_BASE}/v1/prospects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "API_KEY": VIBE_KEY },
    body: JSON.stringify({
      mode: "full",
      size: Math.min(count, 100),
      page_size: Math.min(count, 100),
      page: 1,
      filters,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vibe Prospecting API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = await res.json() as {
    data?: VibeProspect[];
    total_results?: number;
    response_context?: { request_status?: string };
  };

  if (json.response_context?.request_status && json.response_context.request_status !== "success") {
    throw new Error(`Vibe Prospecting returned status: ${json.response_context.request_status}`);
  }

  return Array.isArray(json.data) ? json.data : [];
}

async function enrichVibeProspect(prospectId: string): Promise<VibeEnrichedContact> {
  try {
    const res = await fetch(`${VIBE_BASE}/v1/prospects/contacts_information/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "API_KEY": VIBE_KEY },
      body: JSON.stringify({ prospect_id: prospectId }),
    });
    if (!res.ok) return {};
    const json = await res.json() as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    return {
      email: String(data.email ?? data.work_email ?? data.personal_email ?? ""),
      phone: String(data.phone ?? data.phone_number ?? ""),
    };
  } catch {
    return {};
  }
}

function extractVibeCompany(prospect: VibeProspect): string {
  if (prospect.company_name) return prospect.company_name;
  if (prospect.current_company) return prospect.current_company;
  if (prospect.organization_name) return prospect.organization_name;
  if (prospect.experience) {
    try {
      const exp = JSON.parse(prospect.experience);
      if (Array.isArray(exp) && typeof exp[0]?.company === "string") return exp[0].company;
    } catch {
      const m = prospect.experience.match(/(?:at|@)\s+([A-Z][^\n,(]+)/);
      if (m) return m[1].trim();
    }
  }
  return "";
}

// ─── Config routes ─────────────────────────────────────────────────────────────

router.get("/leads/fetch-config", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const [config] = await db.select().from(leadFetchConfigs).where(eq(leadFetchConfigs.orgId, orgId)).orderBy(desc(leadFetchConfigs.createdAt)).limit(1);
  res.json(config ?? null);
});

router.post("/leads/fetch-config", async (req: Request, res: Response): Promise<void> => {
  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { icpId, sources, dailyCount, enabled } = parsed.data;
  const orgId = req.user!.orgId;
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const [existing] = await db.select().from(leadFetchConfigs).where(eq(leadFetchConfigs.orgId, orgId)).orderBy(desc(leadFetchConfigs.createdAt)).limit(1);
  if (existing) {
    const [updated] = await db.update(leadFetchConfigs)
      .set({ icpId: icpId ?? null, sources, dailyCount, enabled, nextRunAt: enabled ? tomorrow : null, updatedAt: now })
      .where(and(eq(leadFetchConfigs.id, existing.id), eq(leadFetchConfigs.orgId, orgId)))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db.insert(leadFetchConfigs)
      .values({ orgId, icpId: icpId ?? null, sources, dailyCount, enabled, nextRunAt: enabled ? tomorrow : null })
      .returning();
    res.json(created);
  }
});

// ─── Fetch-now SSE endpoint ────────────────────────────────────────────────────

router.post("/leads/fetch-now", featureGuard("data_fetch"), async (req: Request, res: Response): Promise<void> => {
  const parsed = FetchNowSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { icpId, sources, count } = parsed.data;
  const orgId = req.user!.orgId;
  const fetchNowOverrides = await fetchOrgOverrides(orgId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let totalImported = 0;
  let totalSkipped  = 0;
  const usedEmails  = new Set<string>();

  // ── Lead quota check ──────────────────────────────────────────────────────
  const [orgQuota] = await db.select({ plan: organizations.plan, leadsUsedThisMonth: organizations.leadsUsedThisMonth })
    .from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const planCap = getLimits(orgQuota?.plan ?? "trial");
  const quotaRemaining = planCap.leads_max === -1 ? Infinity : Math.max(0, planCap.leads_max - (orgQuota?.leadsUsedThisMonth ?? 0));
  if (planCap.leads_max !== -1 && quotaRemaining <= 0) {
    send("error", { message: "Lead quota exhausted for this month. Upgrade your plan to import more leads.", upgrade_url: "/billing" });
    res.end();
    return;
  }

  // Load ICP
  let icp: { name: string; industries: string[]; markets: string[]; roles: string[]; companySize: string } | null = null;
  if (icpId) {
    const [found] = await db.select().from(icps).where(and(eq(icps.id, icpId), eq(icps.orgId, orgId)));
    if (found) icp = found;
  }

  try {
    for (const source of sources) {
      const perSource = Math.ceil(count / sources.length);

      // ── Google Maps via real Apify actor ──────────────────────────────────
      if (source === "google_maps") {
        if (!APIFY_TOKEN) {
          send("status", { message: "⚠️ APIFY_TOKEN not set — falling back to AI Sample mode to generate leads…" });
          await generateAiLeads({
            orgId, source: "google_maps", label: "Google Maps AI Sample",
            flavor: "Realistic B2B decision-makers from businesses in major cities (Dubai, Riyadh, Mumbai, London). Use REAL company names that exist. Email must use the company website domain.",
            icp, count: perSource, icpId, usedEmails,
            onStatus: (m) => send("status", { message: m }),
            onLead:   (l, t) => send("lead", { lead: l, total: t }),
            onSkip:   (e, r) => send("skip", { email: e, reason: r }),
            getTotal: () => totalImported,
            addTotal: (n) => { totalImported += n; },
            addSkip:  (n) => { totalSkipped  += n; },
          });
          continue;
        }
        send("status", { message: "🗺️ Starting Google Places crawler (Apify)…" });

        const queries = buildSearchQueries(icp, perSource);
        const maxPerSearch = Math.ceil(perSource / queries.length);

        let runId: string;
        try {
          runId = await startApifyRun({
            searchStringsArray: queries,
            maxCrawledPlacesPerSearch: maxPerSearch,
            language: "en",
            outputNamedCrawl: false,
            maxImages: 0,
            exportPlaceUrls: false,
            additionalInfo: false,
          });
        } catch (e) {
          if (e instanceof ApifyAuthError) {
            // Invalid / expired Apify token — fall back to AI Sample gracefully
            send("status", { message: "⚠️ Apify token invalid or expired — falling back to AI Sample mode to generate leads…" });
            await generateAiLeads({
              orgId, source: "google_maps", label: "Google Maps AI Sample",
              flavor: "Realistic B2B decision-makers from businesses in major cities (Dubai, Riyadh, Mumbai, London). Use REAL company names that exist. Email must use the company website domain.",
              icp, count: perSource, icpId, usedEmails,
              onStatus: (m) => send("status", { message: m }),
              onLead:   (l, t) => send("lead", { lead: l, total: t }),
              onSkip:   (e2, r2) => send("skip", { email: e2, reason: r2 }),
              getTotal: () => totalImported,
              addTotal: (n) => { totalImported += n; },
              addSkip:  (n) => { totalSkipped  += n; },
            });
          } else {
            send("error", { message: `Failed to start Apify run: ${String(e)}` });
          }
          continue;
        }

        send("status", { message: `📍 Apify run started (ID: ${runId.slice(0, 8)}…). Crawling Google Maps…` });

        try {
          await pollApifyRun(runId, (msg) => send("status", { message: `📍 ${msg}` }));
        } catch (e) {
          send("error", { message: `Apify crawl failed: ${String(e)}` });
          continue;
        }

        send("status", { message: "✅ Crawl complete — extracting businesses and generating contacts…" });

        let places: ApifyPlace[] = [];
        try {
          places = await getApifyDataset(runId, perSource * 3);
        } catch (e) {
          send("error", { message: `Failed to fetch dataset: ${String(e)}` });
          continue;
        }

        // Only use places with a real verified website so we can enforce a real email domain.
        // Places without a website are skipped to prevent AI-hallucinated email addresses.
        const goodPlaces = places
          .filter((p) => p.title && p.website)
          .slice(0, perSource);

        send("status", { message: `🏢 Found ${goodPlaces.length} businesses — generating decision-maker contacts…` });

        // Use AI to generate contact people for each business in batches
        const batchSize = 10;
        for (let i = 0; i < goodPlaces.length; i += batchSize) {
          const batch = goodPlaces.slice(i, i + batchSize);
          const icpRoles = icp?.roles?.length ? icp.roles : ["CEO", "Managing Director", "General Manager", "Owner"];
          const icpIndustries = icp?.industries;

          const companySummaries = batch.map((p, idx) => {
            const domain = p.website ? p.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : null;
            return `${idx + 1}. Company: "${p.title}", Category: "${p.categoryName ?? "Business"}", City: "${p.city ?? ""}", Country: "${countryFromCode(p.countryCode)}", Website: "${p.website ?? ""}", Phone: "${p.phone ?? ""}"`;
          }).join("\n");

          const prompt = `For each business below, generate ONE realistic decision-maker contact who likely works there.

Target role types: ${icpRoles.join(", ")}
${icpIndustries?.length ? `Target industries: ${icpIndustries.join(", ")}` : ""}

${companySummaries}

Rules:
- Name must be realistic for the country/region
- Email must follow company domain pattern (use website domain if available, else guess from company name)
- Return ONLY a JSON array with exactly ${batch.length} objects in this format:
[{"firstName":"...","lastName":"...","email":"...","designation":"...","keywords":["k1","k2"]}]
No explanation, just the JSON array.`;

          let contacts: { firstName: string; lastName: string; email: string; designation: string; keywords: string[] }[] = [];
          try {
            const msg = await anthropic.messages.create({
              model: getModel("lead_routing", fetchNowOverrides),
              max_tokens: 2000,
              messages: [{ role: "user", content: prompt }],
            });
            void logAnthropicUsage({ model: getModel("lead_routing", fetchNowOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "fetch_leads_batch_contacts", orgId });
            const txt = msg.content[0].type === "text" ? msg.content[0].text : "";
            const match = txt.match(/\[[\s\S]*\]/);
            if (match) contacts = JSON.parse(match[0]);
          } catch {
            // fallback contacts
            contacts = batch.map((p) => ({
              firstName: "Manager",
              lastName: p.title?.split(" ")[0] ?? "Unknown",
              email: `info@${(p.website ?? "business.com").replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}`,
              designation: icpRoles[0] ?? "Manager",
              keywords: [p.categoryName ?? "business"],
            }));
          }

          for (let j = 0; j < batch.length; j++) {
            const place   = batch[j];
            const contact = contacts[j] ?? contacts[0];

            // ── Domain enforcement: email domain MUST come from the real website ──
            // The AI often invents a different domain. We override it with the
            // actual Google Maps website domain so the email is at least verifiable.
            if (!place.website) {
              totalSkipped++;
              send("skip", { email: "", reason: "no verified website — skipping to avoid fake email" });
              continue;
            }
            const realDomain = place.website
              .replace(/^https?:\/\/(www\.)?/, "")
              .split("/")[0]
              .toLowerCase()
              .trim();
            if (!realDomain || !realDomain.includes(".")) {
              totalSkipped++;
              send("skip", { email: "", reason: "could not extract real domain from website" });
              continue;
            }
            const aiEmail  = String(contact?.email ?? "").toLowerCase().trim();
            const aiPrefix = aiEmail.includes("@") ? aiEmail.split("@")[0] : "";
            // Build a clean prefix: prefer AI-provided personal name prefix, fall back to first.last
            const emailPrefix = (aiPrefix && aiPrefix.length > 1 && aiPrefix !== "info" && aiPrefix !== "contact" && aiPrefix !== "admin")
              ? aiPrefix
              : `${String(contact?.firstName ?? "contact").toLowerCase()}.${String(contact?.lastName ?? "").toLowerCase()}`.replace(/[^a-z0-9.]/g, "");
            const email = `${emailPrefix || "info"}@${realDomain}`;
            // ─────────────────────────────────────────────────────────────────────

            if (!email || !email.includes("@") || usedEmails.has(email)) {
              totalSkipped++;
              send("skip", { email, reason: "duplicate or invalid email" });
              continue;
            }
            const vCheck = validateLead({
              firstName: contact?.firstName,
              lastName:  contact?.lastName,
              email,
              company:   place.title,
            });
            if (!vCheck.valid) {
              totalSkipped++;
              send("skip", { email, reason: vCheck.reason });
              continue;
            }
            usedEmails.add(email);

            if (planCap.leads_max !== -1 && totalImported >= quotaRemaining) {
              totalSkipped++;
              send("skip", { email, reason: "quota_exceeded" });
              continue;
            }
            try {
              const [inserted] = await db.insert(leads).values({
                orgId,
                icpId:        icpId ?? null,
                firstName:    contact.firstName || "Unknown",
                lastName:     contact.lastName  || "Lead",
                email,
                phone:        place.phone   ?? null,
                company:      place.title   ?? "Unknown Co.",
                city:         place.city    ?? null,
                country:      countryFromCode(place.countryCode),
                designation:  contact.designation || "Manager",
                website:      place.website ?? null,
                industry:     place.categoryName ?? icp?.industries?.[0] ?? "Business",
                source:       "google_maps",
                keywords:     contact.keywords ?? [],
                status:       "new_enquiry",
              }).onConflictDoNothing().returning();

              if (inserted) {
                void saveToLeadBank(inserted);
                totalImported++;
                send("lead", { lead: inserted, total: totalImported });
              } else {
                totalSkipped++;
                send("skip", { email, reason: "duplicate" });
              }
            } catch {
              totalSkipped++;
              send("skip", { email, reason: "db error" });
            }
          }
        }
      }

      // ── AI Sample Leads (labelled honestly — not real LinkedIn scraping) ────
      else if (source === "apify") {
        send("status", {
          message: "⚠️ 'LinkedIn/Apify' source generates AI-enriched sample leads for testing. " +
            "Emails and websites are AI-estimated — use Google Maps or Apollo for verified contact data.",
        });
        await generateAiLeads({
          orgId,
          source: "ai_sample",
          label: "AI Sample",
          flavor: "Realistic B2B decision-makers from SMB companies in the target market. " +
            "IMPORTANT: Use REAL company names that actually exist in the target industry and market. " +
            "Email must use the company website domain. Website must be a real, working URL for the company.",
          icp, count: perSource, icpId, usedEmails,
          onStatus: (m) => send("status", { message: m }),
          onLead:   (l, t) => send("lead", { lead: l, total: t }),
          onSkip:   (e, r) => send("skip", { email: e, reason: r }),
          getTotal: () => totalImported,
          addTotal: (n) => { totalImported += n; },
          addSkip:  (n) => { totalSkipped  += n; },
        });
      }

      // ── Apollo (real people search API — real names, real emails) ────────────
      else if (source === "apollo") {
        if (!APOLLO_KEY) {
          send("status", { message: "⚠️ APOLLO_API_KEY not set — falling back to AI Sample mode…" });
          await generateAiLeads({
            orgId, source: "apollo", label: "Apollo AI Sample",
            flavor: "Realistic B2B decision-makers from mid-market companies. Focus on founders, CEOs, CMOs and VPs. Use REAL company names. Email must use the company website domain.",
            icp, count: perSource, icpId, usedEmails,
            onStatus: (m) => send("status", { message: m }),
            onLead:   (l, t) => send("lead", { lead: l, total: t }),
            onSkip:   (e, r) => send("skip", { email: e, reason: r }),
            getTotal: () => totalImported,
            addTotal: (n) => { totalImported += n; },
            addSkip:  (n) => { totalSkipped  += n; },
          });
        } else {
          const queries = buildSearchQueries(icp, perSource);
          const perQuery = Math.ceil(perSource / queries.length);
          send("status", { message: `Apollo people search: ${queries.length} keyword set(s)…` });

          let apolloAuthFailed = false;
          for (const kw of queries) {
            if (totalImported >= count) break;
            send("status", { message: `Apollo: searching people for "${kw}"…` });

            let people: Awaited<ReturnType<typeof searchApolloPeople>>;
            try {
              people = await searchApolloPeople(kw, icp, Math.min(perQuery, 25));
            } catch (apolloErr) {
              const msg = String(apolloErr);
              if (msg.includes("Apollo auth failed")) {
                apolloAuthFailed = true;
                break;
              }
              people = [];
            }
            send("status", { message: `Apollo: found ${people.length} real contacts` });

            for (const person of people) {
              if (totalImported >= count) break;

              const firstName = (person.first_name ?? (person.name?.split(" ")[0]) ?? "").trim();
              const lastName  = (person.last_name  ?? (person.name?.split(" ").slice(1).join(" ")) ?? "").trim();
              const email     = (person.email ?? "").toLowerCase().trim();
              const company   = (person.organization_name ?? "").trim();

              if (!email || !email.includes("@") || usedEmails.has(email)) {
                totalSkipped++;
                send("skip", { email, reason: "no email or duplicate" });
                continue;
              }

              if (!firstName || !lastName || !company) {
                totalSkipped++;
                send("skip", { email, reason: "incomplete contact data" });
                continue;
              }

              const vCheck2 = validateLead({ firstName, lastName, email, company });
              if (!vCheck2.valid) {
                totalSkipped++;
                send("skip", { email, reason: vCheck2.reason });
                continue;
              }
              usedEmails.add(email);

              const phone = person.phone_numbers?.[0]?.sanitized_number ?? null;
              const website = person.website_url ?? null;

              if (planCap.leads_max !== -1 && totalImported >= quotaRemaining) {
                totalSkipped++;
                send("skip", { email, reason: "quota_exceeded" });
                continue;
              }
              try {
                const [inserted] = await db.insert(leads).values({
                  orgId,
                  icpId:       icpId ?? null,
                  firstName,
                  lastName,
                  email,
                  phone,
                  company,
                  city:        person.city ?? null,
                  country:     person.country ?? "Unknown",
                  designation: person.title ?? "Executive",
                  website,
                  linkedInUrl: person.linkedin_url ?? null,
                  industry:    icp?.industries?.[0] ?? kw.split(" ")[0] ?? "Business",
                  source:      "apollo",
                  keywords:    [kw],
                  status:      "new_enquiry",
                }).onConflictDoNothing().returning();

                if (inserted) {
                  void saveToLeadBank(inserted);
                  totalImported++;
                  send("lead", { lead: inserted, total: totalImported });
                } else {
                  totalSkipped++;
                  send("skip", { email, reason: "duplicate" });
                }
              } catch {
                totalSkipped++;
                send("skip", { email, reason: "db error" });
              }
            }
          }
          if (apolloAuthFailed) {
            send("status", { message: "⚠️ Apollo API key invalid or expired — falling back to AI Sample mode to generate leads…" });
            await generateAiLeads({
              orgId, source: "apollo", label: "Apollo AI Sample",
              flavor: "Realistic B2B decision-makers from mid-market companies. Focus on founders, CEOs, CMOs and VPs. Use REAL company names. Email must use the company website domain.",
              icp, count: perSource, icpId, usedEmails,
              onStatus: (m) => send("status", { message: m }),
              onLead:   (l, t) => send("lead", { lead: l, total: t }),
              onSkip:   (e, r) => send("skip", { email: e, reason: r }),
              getTotal: () => totalImported,
              addTotal: (n) => { totalImported += n; },
              addSkip:  (n) => { totalSkipped  += n; },
            });
          }
        }
      }

      // ── Vibe Prospecting (Explorium — 800M+ professional database) ──────────
      else if (source === "vibe_prospecting") {
        if (!VIBE_KEY) {
          send("status", { message: "⚠️ VIBE_API_KEY not set — falling back to AI Sample mode…" });
          await generateAiLeads({
            orgId, source: "vibe_prospecting", label: "Vibe AI Sample",
            flavor: "Realistic senior B2B professionals from technology, SaaS, healthcare, and finance sectors. Focus on VPs, Directors, and C-suite. Use REAL company names. Email must use the company website domain.",
            icp, count: perSource, icpId, usedEmails,
            onStatus: (m) => send("status", { message: m }),
            onLead:   (l, t) => send("lead", { lead: l, total: t }),
            onSkip:   (e, r) => send("skip", { email: e, reason: r }),
            getTotal: () => totalImported,
            addTotal: (n) => { totalImported += n; },
            addSkip:  (n) => { totalSkipped  += n; },
          });
          continue;
        }

        send("status", { message: "🎯 Vibe Prospecting: searching Explorium's 800M+ professional database…" });

        let prospects: VibeProspect[] = [];
        try {
          prospects = await searchVibeProspects(icp, perSource * 2); // fetch extra to account for enrichment misses
          send("status", { message: `🎯 Found prospects — enriching top ${Math.min(prospects.length, perSource)} contacts for verified emails…` });
        } catch (e) {
          send("error", { message: `Vibe Prospecting search failed: ${String(e)}` });
          continue;
        }

        let enriched = 0;
        for (const prospect of prospects) {
          if (totalImported >= count) break;

          send("status", { message: `🎯 Enriching contact ${++enriched}/${prospects.length}…` });

          const contact = await enrichVibeProspect(prospect.prospect_id);
          const email = String(contact.email ?? "").toLowerCase().trim();

          if (!email || !email.includes("@") || usedEmails.has(email)) {
            totalSkipped++;
            send("skip", { email, reason: "no verified email or duplicate" });
            continue;
          }

          const nameParts = (prospect.full_name ?? "").trim().split(/\s+/);
          const firstName = nameParts[0] ?? "";
          const lastName = nameParts.slice(1).join(" ") || firstName;
          const company = extractVibeCompany(prospect);

          if (!firstName) {
            totalSkipped++;
            send("skip", { email, reason: "no name data from Vibe" });
            continue;
          }

          const vCheckV = validateLead({ firstName, lastName: lastName || "—", email, company: company || "Unknown" });
          if (!vCheckV.valid) {
            totalSkipped++;
            send("skip", { email, reason: vCheckV.reason });
            continue;
          }

          usedEmails.add(email);

          // Capitalise country_name (API returns lowercase e.g. "united states")
          const countryRaw = prospect.country_name ?? "";
          const country = countryRaw
            ? countryRaw.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
            : "Unknown";

          if (planCap.leads_max !== -1 && totalImported >= quotaRemaining) {
            totalSkipped++;
            send("skip", { email, reason: "quota_exceeded" });
            continue;
          }
          try {
            const [inserted] = await db.insert(leads).values({
              orgId,
              icpId:       icpId ?? null,
              firstName,
              lastName:    lastName || firstName,
              email,
              phone:       contact.phone && contact.phone !== "undefined" ? contact.phone : null,
              company:     company || "Unknown",
              city:        prospect.city ?? null,
              country,
              designation: prospect.job_title ?? icp?.roles?.[0] ?? "Executive",
              linkedInUrl: prospect.linkedin ?? null,
              industry:    icp?.industries?.[0] ?? "Business",
              source:      "vibe_prospecting",
              keywords:    [],
              status:      "new_enquiry",
            }).onConflictDoNothing().returning();

            if (inserted) {
              void saveToLeadBank(inserted);
              totalImported++;
              send("lead", { lead: inserted, total: totalImported });
            } else {
              totalSkipped++;
              send("skip", { email, reason: "duplicate in DB" });
            }
          } catch {
            totalSkipped++;
            send("skip", { email, reason: "db error" });
          }
        }
      }
    }

    // Update lastRunAt
    await db.update(leadFetchConfigs)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(leadFetchConfigs.enabled, true));

    if (totalImported > 0) {
      void db.update(organizations).set({ leadsUsedThisMonth: sql`leads_used_this_month + ${totalImported}` }).where(eq(organizations.id, orgId)).execute().catch(() => {});
    }
    send("done", { imported: totalImported, skipped: totalSkipped, requested: count });
    res.end();
  } catch (err) {
    send("error", { message: String(err) });
    res.end();
  }
});

// ─── AI lead generation helper ────────────────────────────────────────────────

interface AiLeadGenOptions {
  orgId: number;
  source: string;
  label: string;
  flavor: string;
  icp: { name?: string; industries?: string[]; markets?: string[]; roles?: string[]; companySize?: string } | null;
  count: number;
  icpId: number | null | undefined;
  usedEmails: Set<string>;
  onStatus: (msg: string) => void;
  onLead: (lead: Record<string, unknown>, total: number) => void;
  onSkip: (email: string, reason: string) => void;
  getTotal: () => number;
  addTotal: (n: number) => void;
  addSkip:  (n: number) => void;
}

async function generateAiLeads(opts: AiLeadGenOptions) {
  const { orgId, source, label, flavor, icp, count, icpId, usedEmails, onStatus, onLead, onSkip, getTotal, addTotal, addSkip } = opts;
  const aiLeadOverrides = await fetchOrgOverrides(orgId);

  const icpContext = icp
    ? `Target ICP: "${icp.name}"
- Industries: ${icp.industries?.join(", ") || "any"}
- Roles/titles: ${icp.roles?.join(", ") || "C-suite, VP, Director"}
- Company size: ${icp.companySize || "SMB to Mid-market"}
- Markets/regions: ${icp.markets?.join(", ") || "global"}`
    : "No specific ICP — generate diverse B2B decision-makers.";

  const batchSize = 10;
  const batches = Math.ceil(count / batchSize);

  for (let b = 0; b < batches; b++) {
    const batchCount = Math.min(batchSize, count - b * batchSize);
    onStatus(`🤖 ${label}: generating batch ${b + 1} of ${batches}…`);

    const prompt = `You are a B2B lead generation AI. Generate exactly ${batchCount} realistic, unique leads.

${icpContext}
Data source flavor: ${flavor}

CRITICAL RULES:
1. The "website" field must be a real, plausible URL for the company (e.g. https://www.companyname.com). Do NOT invent random domains.
2. The "email" field MUST use the exact same domain as the "website". E.g. if website is https://www.acme.co.in, email must end in @acme.co.in.
3. Do NOT use generic prefixes like info@, contact@, admin@ — use a realistic personal email like firstname.lastname@domain.com.
4. All fields must be internally consistent (city/country/industry must match).

Return ONLY a JSON array of ${batchCount} objects (no markdown, no explanation):
[{
  "firstName":"string","lastName":"string","email":"firstname.lastname@companydomain.com",
  "phone":"with_country_code_or_null","designation":"string",
  "company":"string","city":"string_or_null","country":"string",
  "website":"https://www.companydomain.com","linkedInUrl":"https://linkedin.com/in/..._or_null",
  "industry":"string","companySize":"string_or_null","annualRevenue":"string_or_null",
  "keywords":["2","to","4","keywords"]
}]`;

    let batch: Record<string, unknown>[] = [];
    try {
      const msg = await anthropic.messages.create({
        model: getModel("lead_routing", aiLeadOverrides),
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      });
      void logAnthropicUsage({ model: getModel("lead_routing", aiLeadOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "fetch_leads_ai_generation", orgId });
      const txt = msg.content[0].type === "text" ? msg.content[0].text : "";
      const match = txt.match(/\[[\s\S]*\]/);
      if (match) batch = JSON.parse(match[0]);
    } catch { continue; }

    for (const raw of batch) {
      // ── Enforce email domain matches website domain ──────────────────────
      const rawWebsite = raw.website ? String(raw.website).trim() : "";
      if (!rawWebsite) {
        addSkip(1); onSkip("", "no website provided — skipping to avoid unverifiable email"); continue;
      }
      const websiteDomain = rawWebsite
        .replace(/^https?:\/\/(www\.)?/, "")
        .split("/")[0]
        .toLowerCase()
        .trim();
      if (!websiteDomain || !websiteDomain.includes(".")) {
        addSkip(1); onSkip("", "invalid website domain"); continue;
      }
      const rawEmail   = String(raw.email ?? "").toLowerCase().trim();
      const rawPrefix  = rawEmail.includes("@") ? rawEmail.split("@")[0] : "";
      const emailDomain = rawEmail.includes("@") ? rawEmail.split("@")[1] : "";
      // If AI used a different domain than website, override with real website domain
      const finalPrefix = (rawPrefix && rawPrefix.length > 1 && rawPrefix !== "info" && rawPrefix !== "contact")
        ? rawPrefix
        : `${String(raw.firstName ?? "").toLowerCase()}.${String(raw.lastName ?? "").toLowerCase()}`.replace(/[^a-z0-9.]/g, "") || "info";
      const email = emailDomain === websiteDomain
        ? rawEmail  // AI got it right — use as-is
        : `${finalPrefix}@${websiteDomain}`;  // Override with correct domain
      // ──────────────────────────────────────────────────────────────────────

      if (!email || !email.includes("@") || usedEmails.has(email)) {
        addSkip(1); onSkip(email, "duplicate or invalid"); continue;
      }
      const vCheck3 = validateLead({
        firstName: String(raw.firstName ?? ""),
        lastName:  String(raw.lastName  ?? ""),
        email,
        company:   String(raw.company   ?? ""),
      });
      if (!vCheck3.valid) {
        addSkip(1); onSkip(email, vCheck3.reason ?? "invalid"); continue;
      }
      usedEmails.add(email);
      try {
        const [inserted] = await db.insert(leads).values({
          orgId,
          icpId:        icpId ?? null,
          firstName:    String(raw.firstName ?? "Unknown"),
          lastName:     String(raw.lastName  ?? "Lead"),
          email,
          phone:        raw.phone       ? String(raw.phone)       : null,
          company:      String(raw.company ?? "Unknown Co."),
          city:         raw.city        ? String(raw.city)        : null,
          country:      String(raw.country ?? "Unknown"),
          designation:  String(raw.designation ?? "Executive"),
          website:      rawWebsite,
          linkedInUrl:  raw.linkedInUrl ? String(raw.linkedInUrl) : null,
          industry:     String(raw.industry ?? "Technology"),
          companySize:  raw.companySize  ? String(raw.companySize)  : null,
          annualRevenue: raw.annualRevenue ? String(raw.annualRevenue) : null,
          source,
          keywords:     Array.isArray(raw.keywords) ? raw.keywords.map(String) : [],
          status:       "new_enquiry",
        }).onConflictDoNothing().returning();

        if (inserted) {
          void saveToLeadBank(inserted as Parameters<typeof saveToLeadBank>[0]);
          addTotal(1);
          onLead(inserted as Record<string, unknown>, getTotal());
        } else {
          addSkip(1); onSkip(email, "duplicate");
        }
      } catch {
        addSkip(1); onSkip(email, "db error");
      }
    }
  }
}

export default router;

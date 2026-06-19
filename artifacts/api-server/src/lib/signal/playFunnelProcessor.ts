/**
 * Play Funnel Processor — Module 6
 *
 * Turns raw per-play signal_posts (processed=false, play_id IS NOT NULL)
 * into scored play_leads + leads table rows via a 6-stage funnel.
 *
 * Stage order:
 *  1. qualified_intent  — Claude Haiku: is the author a genuine potential buyer?
 *  2. org_identified    — Claude Haiku: extract company_name from post text
 *  3. org_found         — Apollo: company lookup returns domain + firmographics
 *  4. non_competitor    — list-based: not our own org, not a competitor
 *  5. icp_matched       — deterministic scoring against play ICPs (max 100 pts, pass ≥ min_score)
 *  6. lead_created      — dedupe → upsert leads → insert play_leads → mark processed=true
 *
 * Every stage failure logs a funnel_event with passed=false and sets signal_post.processed=true.
 * On full pass, lead_created funnel_event is logged and processed=true is set.
 */

import { db } from "../db";
import { leads } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { searchApolloByCompany } from "./apolloCompanySearch";
import type { ApolloContact } from "./apolloCompanySearch";
import { logger } from "../logger";

// ── Working lead context (accumulated across stages) ──────────────────────────

interface WorkingLead {
  company_name:  string;
  domain?:       string;
  industry?:     string;
  hq_country?:   string;
  company_size?: string;
  person_name?:  string;
  person_role?:  string;
  location?:     string;
  urgency:       "high" | "medium" | "low";
  key_phrase?:   string;
  signal_type:   string;
  confidence:    number;
  icp_score:     number;
  matched_icp:   number | null;
  key_contacts:  ApolloContact[];
}

// ── Post shape from DB ─────────────────────────────────────────────────────────

interface FunnelPost {
  id:                number;
  title:             string;
  body:              string;
  subreddit:         string | null;
  platform:          string;
  post_url:          string;
  play_id:           number;
  org_id:            number;
  matched_signal:    string | null;
}

// ── Signal config + ICP data loaded once per post ────────────────────────────

interface PlayContext {
  orgId:              number;
  orgName:            string;
  icpIds:             number[];
  minScore:           number;
  problemSignals:     string[];
  buyingSignals:      string[];
  competitorSignals:  string[];
  icps:               { id: number; industries: string[]; markets: string[]; roles: string[]; companySize: string }[];
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

async function logFunnelEvent(
  playId:  number,
  postId:  number,
  stage:   string,
  passed:  boolean,
  reason:  string,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO funnel_events (play_id, signal_post_id, stage, passed, reason, created_at)
      VALUES (${playId}, ${postId}, ${stage}, ${passed}, ${reason}, NOW())
    `);
  } catch { /* non-fatal */ }
}

async function markProcessed(postId: number, keyPhrase: string | null = null): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE signal_posts
      SET processed = true,
          key_phrase = COALESCE(${keyPhrase}, key_phrase)
      WHERE id = ${postId}
    `);
  } catch (err) {
    logger.warn({ err, postId }, "[FUNNEL] markProcessed failed");
  }
}

async function failStage(
  playId:   number,
  postId:   number,
  stage:    string,
  reason:   string,
  keyPhrase?: string | null,
): Promise<"failed"> {
  await logFunnelEvent(playId, postId, stage, false, reason);
  await markProcessed(postId, keyPhrase ?? null);
  return "failed";
}

// ── Stage 1: qualified_intent ─────────────────────────────────────────────────

interface Stage1Result {
  is_qualified: boolean;
  confidence:   number;
  signal_type:  string;
  urgency:      "high" | "medium" | "low";
  key_phrase:   string | null;
}

async function runStage1(post: FunnelPost, ctx: PlayContext): Promise<Stage1Result | null> {
  const allSignals = [...ctx.buyingSignals, ...ctx.problemSignals].slice(0, 15);

  const systemPrompt = `You are a B2B sales signal classifier. Determine if the author of this social media post has a genuine buying need that matches the given signals.

Return ONLY valid JSON:
{
  "is_qualified": boolean,
  "confidence": float 0.0-1.0,
  "signal_type": one of "buying_intent" | "problem_signal" | "research" | "none",
  "urgency": "high" | "medium" | "low",
  "key_phrase": string or null (the most revealing phrase from the post, max 80 chars)
}`;

  const userContent = `Buying signals to check for: ${allSignals.join(", ")}

Post title: ${post.title}
Post body: ${(post.body ?? "").slice(0, 1500)}

Is the author a genuine potential buyer for these signals?`;

  try {
    const msg = await anthropic.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 250,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userContent }],
    });

    const raw   = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as Partial<Stage1Result>;
    return {
      is_qualified: Boolean(parsed.is_qualified ?? false),
      confidence:   Math.min(1, Math.max(0, Number(parsed.confidence ?? 0))),
      signal_type:  String(parsed.signal_type ?? "none"),
      urgency:      (["high", "medium", "low"].includes(String(parsed.urgency)) ? parsed.urgency : "low") as Stage1Result["urgency"],
      key_phrase:   parsed.key_phrase ? String(parsed.key_phrase).slice(0, 80) : null,
    };
  } catch (err) {
    logger.warn({ err, postId: post.id }, "[FUNNEL] Stage 1 Claude call failed");
    return null;
  }
}

// ── Stage 2: org_identified ───────────────────────────────────────────────────

interface Stage2Result {
  company_name: string;
  person_name:  string | null;
  person_role:  string | null;
  industry:     string | null;
  location:     string | null;
}

async function runStage2(post: FunnelPost): Promise<Stage2Result | null> {
  const content = `Extract the following from this social media post. Return JSON only, no markdown.

Post title: ${post.title}
Post body: ${(post.body ?? "").slice(0, 2000)}

Return JSON with:
{
  "company_name": string or null (the company that needs the service),
  "person_name": string or null,
  "person_role": string or null (job title/role of the poster),
  "industry": string or null,
  "location": string or null
}

Use null for unknown fields. company_name is required — the business that has the need.`;

  try {
    const msg = await anthropic.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 300,
      messages:   [{ role: "user", content }],
    });

    const raw   = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as Partial<Stage2Result>;
    const company = parsed.company_name ? String(parsed.company_name).trim().slice(0, 200) : null;
    if (!company) return null;

    return {
      company_name: company,
      person_name:  parsed.person_name ? String(parsed.person_name).slice(0, 100) : null,
      person_role:  parsed.person_role ? String(parsed.person_role).slice(0, 100) : null,
      industry:     parsed.industry    ? String(parsed.industry).slice(0, 100)    : null,
      location:     parsed.location    ? String(parsed.location).slice(0, 100)    : null,
    };
  } catch (err) {
    logger.warn({ err, postId: post.id }, "[FUNNEL] Stage 2 Claude call failed");
    return null;
  }
}

// ── Stage 4: non_competitor helpers ──────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCompetitorOrSelf(
  companyName: string,
  domain:      string | undefined,
  orgName:     string,
  competitors: string[],
): string | null {
  const normCompany = normalise(companyName);
  const normDomain  = domain ? normalise(domain.replace(/^www\./, "").split(".")[0] ?? "") : "";

  // Self-check
  const normOrg = normalise(orgName);
  if (normOrg.length > 2 && (normCompany.includes(normOrg) || normOrg.includes(normCompany))) {
    return `matches own org: ${orgName}`;
  }

  // Competitor check
  for (const comp of competitors) {
    const normComp = normalise(comp);
    if (normComp.length < 2) continue;
    if (
      normCompany.includes(normComp) || normComp.includes(normCompany) ||
      (normDomain && (normDomain.includes(normComp) || normComp.includes(normDomain)))
    ) {
      return `matches competitor: ${comp}`;
    }
  }

  return null;
}

// ── Stage 5: icp_matched (deterministic scoring) ──────────────────────────────

interface IcpRow {
  id:          number;
  industries:  string[];
  markets:     string[];
  roles:       string[];
  companySize: string;
}

function scoreAgainstIcp(lead: WorkingLead, icp: IcpRow): number {
  let score = 0;

  // Industry match — 30 pts
  const leadIndustry = (lead.industry ?? "").toLowerCase();
  if (leadIndustry && icp.industries.some(ind => leadIndustry.includes(ind.toLowerCase()) || ind.toLowerCase().includes(leadIndustry))) {
    score += 30;
  }

  // Market / location match — 20 pts
  const leadCountry = (lead.hq_country ?? lead.location ?? "").toLowerCase();
  if (leadCountry && icp.markets.some(m => leadCountry.includes(m.toLowerCase()) || m.toLowerCase().includes(leadCountry))) {
    score += 20;
  }

  // Decision-maker role match — 25 pts
  const leadRole = (lead.person_role ?? lead.key_contacts[0]?.title ?? "").toLowerCase();
  if (leadRole && icp.roles.some(r => leadRole.includes(r.toLowerCase()) || r.toLowerCase().includes(leadRole))) {
    score += 25;
  }

  // Company size in range — 15 pts
  const empStr  = lead.company_size ?? "";
  const empNum  = parseInt(empStr, 10);
  const icpSize = icp.companySize.toLowerCase();
  if (empNum > 0 && icpSize) {
    // Simple range check: "1-10", "10-50", "50-200", "200-1000", "1000+"
    const empRange = empNum < 10 ? "1-10" : empNum < 50 ? "10-50" : empNum < 200 ? "50-200" : empNum < 1000 ? "200-1000" : "1000+";
    if (icpSize.includes(empRange) || icpSize.includes(empNum.toString())) {
      score += 15;
    }
  } else if (!empStr && icpSize) {
    // No size data — give partial credit
    score += 5;
  }

  // Signal urgency — 10 pts
  score += lead.urgency === "high" ? 10 : lead.urgency === "medium" ? 5 : 0;

  return score;
}

// ── Stage 6 helpers ───────────────────────────────────────────────────────────

async function checkDuplicate(playId: number, companyName: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT id FROM play_leads
    WHERE play_id = ${playId}
      AND LOWER(company_name) = LOWER(${companyName})
    LIMIT 1
  `);
  return ((result as unknown as { rows: unknown[] }).rows).length > 0;
}

async function upsertLeadRow(
  orgId:   number,
  lead:    WorkingLead,
  postUrl: string,
  postBody: string,
): Promise<number | null> {
  // Check existing by company name within org
  const existCheck = await db.execute(sql`
    SELECT id FROM leads
    WHERE org_id = ${orgId}
      AND LOWER(company) = LOWER(${lead.company_name})
    LIMIT 1
  `);
  const existRow = ((existCheck as unknown as { rows: { id: number }[] }).rows)[0];
  if (existRow?.id) return existRow.id;

  const primary   = lead.key_contacts[0];
  const firstName = primary?.firstName ?? lead.person_name?.split(" ")[0]  ?? "Signal";
  const lastName  = primary?.lastName  ?? lead.person_name?.split(" ").slice(1).join(" ") ?? "Lead";
  const email     = primary?.email     ?? `signal.${Date.now()}@noemail.mysa.internal`;
  const title     = lead.person_role   ?? primary?.title ?? "";
  const notes     = `Signal (play funnel): ${lead.signal_type}. Source: ${postUrl}. Key phrase: ${lead.key_phrase ?? ""}. Context: ${postBody.slice(0, 300)}`;

  try {
    const [created] = await db.insert(leads).values({
      orgId,
      firstName,
      lastName,
      email,
      company:     lead.company_name,
      designation: title,
      country:     lead.hq_country ?? lead.location ?? "",
      industry:    lead.industry   ?? "",
      website:     lead.domain ? `https://${lead.domain}` : undefined,
      linkedInUrl: lead.key_contacts[0]?.linkedInUrl ?? undefined,
      photoUrl:    lead.key_contacts[0]?.photoUrl    ?? undefined,
      companySize: lead.company_size ?? undefined,
      source:      "signal_detection",
      notes,
      tags:        [],
    }).returning({ id: leads.id });

    if (!created?.id) return null;

    await db.execute(sql`
      UPDATE leads SET
        signal_type        = ${lead.signal_type},
        signal_strength    = ${lead.icp_score},
        original_post_url  = ${postUrl},
        original_post_text = ${postBody.slice(0, 800)},
        signal_detected_at = NOW()
      WHERE id = ${created.id}
    `);

    return created.id;
  } catch (err) {
    logger.warn({ err, company: lead.company_name }, "[FUNNEL] Lead row insert failed");
    return null;
  }
}

async function insertPlayLead(
  playId:   number,
  orgId:    number,
  postId:   number,
  leadId:   number | null,
  lead:     WorkingLead,
): Promise<boolean> {
  try {
    const insertRes = await db.execute(sql`
      INSERT INTO play_leads
        (play_id, org_id, signal_post_id, lead_id, company_name, intent_summary,
         lead_score, score_breakdown, key_contacts, enriched, credits_charged, status, created_at)
      VALUES
        (${playId}, ${orgId}, ${postId}, ${leadId},
         ${lead.company_name},
         null,
         ${lead.icp_score},
         ${JSON.stringify({
           icp_score:   lead.icp_score,
           matched_icp: lead.matched_icp,
           urgency:     lead.urgency,
           signal_type: lead.signal_type,
           confidence:  Math.round(lead.confidence * 100),
         })},
         ${JSON.stringify(lead.key_contacts.slice(0, 5).map(c => ({
           name:        [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown",
           title:       c.title       ?? "",
           email:       c.email       ?? undefined,
           linkedInUrl: c.linkedInUrl ?? undefined,
           photoUrl:    c.photoUrl    ?? undefined,
         })))},
         ${lead.key_contacts.filter(c => c.email).length > 0},
         ${lead.key_contacts.filter(c => c.email).length},
         'new',
         NOW())
      RETURNING id
    `);

    // Fast-path: kick off intent summary immediately for new leads
    const newId = ((insertRes as unknown as { rows: { id: number }[] }).rows)[0]?.id;
    if (newId) {
      import("./intentSummaryService").then(({ generateIntentSummary }) => {
        void generateIntentSummary(newId).catch(err =>
          logger.warn({ err, newId }, "[FUNNEL] fast-path summary failed")
        );
      }).catch(() => { /* non-fatal if import fails */ });
    }

    return true;
  } catch (err) {
    logger.warn({ err, playId, postId }, "[FUNNEL] play_leads insert failed");
    return false;
  }
}

// ── Per-post funnel runner ────────────────────────────────────────────────────

async function processSignalPost(
  post: FunnelPost,
  ctx:  PlayContext,
): Promise<"passed" | "failed"> {
  const playId = post.play_id;
  const orgId  = post.org_id;
  const postId = post.id;

  // ── Stage 1: qualified_intent ──────────────────────────────────────────────
  const stage1 = await runStage1(post, ctx);
  if (!stage1) {
    return failStage(playId, postId, "qualified_intent", "AI classifier returned null");
  }
  if (!stage1.is_qualified || stage1.confidence < 0.7 || stage1.signal_type === "none") {
    return failStage(
      playId, postId, "qualified_intent",
      `Not qualified: is_qualified=${stage1.is_qualified}, confidence=${stage1.confidence.toFixed(2)}, signal_type=${stage1.signal_type}`,
      stage1.key_phrase,
    );
  }
  await logFunnelEvent(playId, postId, "qualified_intent", true,
    `confidence=${stage1.confidence.toFixed(2)}, signal_type=${stage1.signal_type}, urgency=${stage1.urgency}`);

  // ── Stage 2: org_identified ────────────────────────────────────────────────
  const stage2 = await runStage2(post);
  if (!stage2 || !stage2.company_name) {
    return failStage(
      playId, postId, "org_identified",
      "No company name extracted from post",
      stage1.key_phrase,
    );
  }
  await logFunnelEvent(playId, postId, "org_identified", true, `company: ${stage2.company_name}`);

  // Build working lead object
  const working: WorkingLead = {
    company_name: stage2.company_name,
    person_name:  stage2.person_name ?? undefined,
    person_role:  stage2.person_role ?? undefined,
    industry:     stage2.industry    ?? undefined,
    location:     stage2.location    ?? undefined,
    urgency:      stage1.urgency,
    key_phrase:   stage1.key_phrase  ?? undefined,
    signal_type:  stage1.signal_type,
    confidence:   stage1.confidence,
    icp_score:    0,
    matched_icp:  null,
    key_contacts: [],
  };

  // ── Stage 3: org_found (Apollo) ────────────────────────────────────────────
  const apolloContacts = await searchApolloByCompany(stage2.company_name, undefined, 5);
  const primaryContact = apolloContacts[0] ?? null;

  const domain = primaryContact?.website
    ? primaryContact.website.replace(/^https?:\/\//, "").split("/")[0]
    : undefined;
  const hasFirmographics = !!(
    primaryContact?.company &&
    domain &&
    (primaryContact.industry || primaryContact.country || primaryContact.companySize)
  );

  if (!hasFirmographics) {
    return failStage(
      playId, postId, "org_found",
      primaryContact?.company
        ? `Apollo found company but missing domain/firmographics for: ${stage2.company_name}`
        : `Apollo returned no results for: ${stage2.company_name}`,
      stage1.key_phrase,
    );
  }

  // Enrich working lead with Apollo firmographics
  working.domain       = domain;
  working.industry     = primaryContact!.industry  ?? working.industry;
  working.hq_country   = primaryContact!.country   ?? working.location;
  working.company_size = primaryContact!.companySize;
  working.key_contacts = apolloContacts;

  await logFunnelEvent(playId, postId, "org_found", true,
    `domain=${working.domain ?? "unknown"}, size=${working.company_size ?? "unknown"}, contacts=${apolloContacts.length}`);

  // ── Stage 4: non_competitor ────────────────────────────────────────────────
  const competitorMatch = isCompetitorOrSelf(
    stage2.company_name,
    working.domain,
    ctx.orgName,
    ctx.competitorSignals,
  );
  if (competitorMatch) {
    return failStage(
      playId, postId, "non_competitor",
      competitorMatch,
      stage1.key_phrase,
    );
  }
  await logFunnelEvent(playId, postId, "non_competitor", true, "Not own org or competitor");

  // ── Stage 5: icp_matched (deterministic) ──────────────────────────────────
  let bestScore = 0;
  let bestIcpId: number | null = null;

  if (ctx.icps.length === 0) {
    return failStage(
      playId, postId, "icp_matched",
      "No ICP rows configured for this play — cannot score",
      stage1.key_phrase,
    );
  }

  for (const icp of ctx.icps) {
    const s = scoreAgainstIcp(working, icp);
    if (s > bestScore) { bestScore = s; bestIcpId = icp.id; }
  }

  if (bestScore < ctx.minScore) {
    return failStage(
      playId, postId, "icp_matched",
      `Best ICP score ${bestScore} < min_score ${ctx.minScore} (ICP id=${bestIcpId ?? "none"})`,
      stage1.key_phrase,
    );
  }
  await logFunnelEvent(playId, postId, "icp_matched", true,
    `Best score=${bestScore} (ICP id=${bestIcpId ?? "none"}, min=${ctx.minScore})`);

  working.icp_score  = bestScore;
  working.matched_icp = bestIcpId;

  // ── Stage 6: lead_created ──────────────────────────────────────────────────
  // Dedupe: skip if this play already has a lead for the same company
  const isDuplicate = await checkDuplicate(playId, stage2.company_name);
  if (isDuplicate) {
    await logFunnelEvent(playId, postId, "lead_created", false,
      `duplicate_dropped: play already has a lead for ${stage2.company_name}`);
    await markProcessed(postId, stage1.key_phrase);
    return "failed";
  }

  // Upsert leads row
  const leadId = await upsertLeadRow(orgId, working, post.post_url, post.body ?? "");

  // Insert play_leads row — must succeed; any failure stops this post permanently
  const playLeadInserted = await insertPlayLead(playId, orgId, postId, leadId, working);
  if (!playLeadInserted) {
    await logFunnelEvent(playId, postId, "lead_created", false,
      `play_leads insert failed for company=${stage2.company_name}`);
    await markProcessed(postId, stage1.key_phrase);
    return "failed";
  }

  // Log success event and mark processed only after durable write
  await logFunnelEvent(playId, postId, "lead_created", true,
    `company=${stage2.company_name}, score=${bestScore}, lead_id=${leadId ?? "new"}`);
  await markProcessed(postId, stage1.key_phrase);

  return "passed";
}

// ── Load play context (shared for all posts in a batch) ───────────────────────

async function loadPlayContext(playId: number, orgId: number): Promise<PlayContext | null> {
  const configRes = await db.execute(sql`
    SELECT
      sc.min_score,
      sc.problem_signals,
      sc.buying_signals,
      sc.competitor_signals,
      o.name  AS org_name,
      p.icp_ids
    FROM signal_configs sc
    JOIN plays         p ON p.id    = sc.play_id
    JOIN organizations o ON o.id    = sc.org_id
    WHERE sc.play_id = ${playId} AND sc.org_id = ${orgId}
    LIMIT 1
  `);

  const row = ((configRes as unknown as { rows: Record<string, unknown>[] }).rows)[0];
  if (!row) return null;

  const icpIds = (row.icp_ids as number[] | null) ?? [];
  let icps: PlayContext["icps"] = [];

  if (icpIds.length > 0) {
    const icpRes = await db.execute(sql`
      SELECT id, industries, markets, roles, company_size AS "companySize"
      FROM icps WHERE id = ANY(${icpIds})
    `);
    icps = (icpRes as unknown as { rows: PlayContext["icps"] }).rows ?? [];
  }

  return {
    orgId,
    orgName:           String(row.org_name ?? ""),
    icpIds,
    minScore:          Number(row.min_score ?? 50),
    problemSignals:    (row.problem_signals    as string[]) ?? [],
    buyingSignals:     (row.buying_signals     as string[]) ?? [],
    competitorSignals: (row.competitor_signals as string[]) ?? [],
    icps,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ProcessResult {
  processed:     number;
  passed:        number;
  failed:        number;
  leads_created: number;
}

/**
 * Process up to `limit` pending per-play signal posts through the 6-stage funnel.
 * If playId is provided, only that play's posts are processed (used by the manual route).
 */
export async function processPendingSignals(
  limit: number = 25,
  playId?: number,
): Promise<ProcessResult> {
  let processed     = 0;
  let passed        = 0;
  let failed        = 0;
  let leadsCreated  = 0;

  const postsRes = await db.execute(
    playId
      ? sql`
          SELECT sp.id, sp.title, sp.body, sp.subreddit, sp.platform, sp.post_url,
                 sp.play_id, p.org_id
          FROM signal_posts sp
          JOIN plays p ON p.id = sp.play_id
          WHERE sp.processed = false
            AND sp.play_id   = ${playId}
          ORDER BY sp.crawled_at ASC
          LIMIT ${limit}
        `
      : sql`
          SELECT sp.id, sp.title, sp.body, sp.subreddit, sp.platform, sp.post_url,
                 sp.play_id, p.org_id
          FROM signal_posts sp
          JOIN plays p ON p.id = sp.play_id
          WHERE sp.processed = false
            AND sp.play_id IS NOT NULL
          ORDER BY sp.crawled_at ASC
          LIMIT ${limit}
        `,
  );

  const posts = (postsRes as unknown as { rows: FunnelPost[] }).rows ?? [];
  if (posts.length === 0) return { processed, passed, failed, leads_created: leadsCreated };

  // Group by play to avoid reloading context for each post
  const byPlay = new Map<number, FunnelPost[]>();
  for (const p of posts) {
    if (!byPlay.has(p.play_id)) byPlay.set(p.play_id, []);
    byPlay.get(p.play_id)!.push(p);
  }

  for (const [pid, playPosts] of byPlay) {
    const orgId  = playPosts[0]!.org_id;
    const ctx    = await loadPlayContext(pid, orgId);
    if (!ctx) {
      // No signal config — mark all posts processed to avoid infinite retry
      for (const p of playPosts) {
        await markProcessed(p.id);
        failed++;
        processed++;
      }
      continue;
    }

    for (const post of playPosts) {
      try {
        const result = await processSignalPost(post, ctx);
        processed++;
        if (result === "passed") { passed++; leadsCreated++; }
        else                       failed++;
      } catch (err) {
        logger.error({ err, postId: post.id, playId: pid }, "[FUNNEL] Unexpected error");
        await markProcessed(post.id);
        failed++;
        processed++;
      }
    }
  }

  logger.info({ processed, passed, failed, leads_created: leadsCreated }, "[FUNNEL] Batch complete");
  return { processed, passed, failed, leads_created: leadsCreated };
}

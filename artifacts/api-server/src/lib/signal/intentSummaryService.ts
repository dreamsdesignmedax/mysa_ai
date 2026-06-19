/**
 * Intent Summary Service — Module 7
 *
 * Generates evidence-grounded "why this lead" intent summaries using Claude Sonnet
 * with prompt caching. Runs in a 5-minute batch (limit 15) and on-demand.
 *
 * Fills play_leads.intent_summary + updates lead_score and score_breakdown.
 * Never touches credits, contacts, or enrichment (Module 9 does that).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { withCache, MODELS } from "../../config/modelRouting";
import { logAnthropicUsage } from "../logApiUsage";
import { logger } from "../logger";

// ── System prompt (cached on Anthropic side via ephemeral cache_control) ───────

const SYSTEM_PROMPT = `You write Intent Summaries for MysaAI, a B2B sales intelligence platform. \
An Intent Summary explains, with specific evidence, why a company is likely in-market RIGHT NOW \
for the user's offering. You are precise and factual. You NEVER invent facts, numbers, dates, or \
events that are not supported by the provided evidence. If evidence is thin, you say what is \
observed and what is inferred, clearly. You return ONLY valid JSON.`;

// ── DB row shape returned by the context query ────────────────────────────────

interface LeadContext {
  id:               number;
  play_id:          number;
  org_id:           number;
  company_name:     string | null;
  structural_score: number | null;
  score_breakdown:  Record<string, unknown> | null;
  post_body:        string | null;
  post_url:         string | null;
  platform:         string | null;
  matched_signal:   string | null;
  intent_type:      string | null;
  key_phrase:       string | null;
  industry:         string | null;
  company_size:     string | null;
  website:          string | null;
  play_name:        string | null;
  play_description: string | null;
  icp_name:         string | null;
  icp_industries:   string[] | null;
  icp_markets:      string[] | null;
  icp_roles:        string[] | null;
}

// ── Claude response shape ─────────────────────────────────────────────────────

interface SummaryResult {
  intent_summary:    string;
  why_this_lead:     string;
  recommended_angle: string;
  signal_score:      number;
  confidence:        number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

function buildMatchedAttributes(ctx: LeadContext): string {
  const parts: string[] = [];
  if (ctx.icp_industries?.length && ctx.industry) {
    const matched = ctx.icp_industries.some(ind =>
      ctx.industry!.toLowerCase().includes(ind.toLowerCase()) ||
      ind.toLowerCase().includes(ctx.industry!.toLowerCase())
    );
    if (matched) parts.push(`industry: ${ctx.industry}`);
  }
  if (ctx.icp_markets?.length) {
    parts.push(`markets: ${ctx.icp_markets.slice(0, 2).join(", ")}`);
  }
  if (ctx.company_size && ctx.icp_industries?.length) {
    parts.push(`size: ${ctx.company_size}`);
  }
  return parts.length > 0 ? parts.join(", ") : "signal match";
}

function buildUserPrompt(ctx: LeadContext): string {
  const matchedAttrs = buildMatchedAttributes(ctx);
  const postSnippet  = (ctx.post_body ?? "").slice(0, 600);

  return `The user sells: ${ctx.play_name ?? "their product"} — ${ctx.play_description ?? "B2B solution"}

A buying signal was detected for this company:
- Company: ${ctx.company_name ?? "Unknown"} (${ctx.industry ?? "unknown industry"}, ${ctx.company_size ?? "unknown size"} employees, ${ctx.website ?? "no website"})
- Signal source: ${ctx.platform ?? "web"}  (${ctx.post_url ?? "no url"})
- What was detected: "${postSnippet}"
- Signal type: ${ctx.matched_signal ?? "general"} / ${ctx.intent_type ?? "unknown"}
- Key phrase: ${ctx.key_phrase ?? "none"}
- Matched ICP: ${ctx.icp_name ?? "unnamed"} (matched on: ${matchedAttrs})

Write an Intent Summary. Return ONLY this JSON:
{
  "intent_summary": "2-4 sentences. State the specific event/activity that signals buying intent, citing what was actually observed in the signal. Then explain why this makes them a fit for the user's offering. Factual, specific, no hype. If something is inferred rather than stated, mark it as 'likely' or 'appears to'.",
  "why_this_lead": "1 sentence — the single sharpest reason to reach out now",
  "recommended_angle": "1 sentence — what to lead with in outreach",
  "signal_score": <0-100, how strong/timely this buying signal is — explicit active buying = high, vague pain = lower, stale = lower>,
  "confidence": <0.0-1.0, your confidence the summary is accurate given the evidence>
}

Rules:
- Ground every claim in the provided signal/firmographics. Do not fabricate.
- Keep intent_summary under 90 words.
- If the evidence is weak, lower the signal_score and confidence honestly.`;
}

function antiFabricationCheck(summary: string, postBody: string): boolean {
  const yearRegex     = /\b(19|20)\d{2}\b/g;
  const currencyRegex = /[$€£₹]\d|USD|EUR|INR|GBP/g;

  const summaryYears    = [...summary.matchAll(yearRegex)].map(m => m[0]);
  const summaryMoneys   = [...summary.matchAll(currencyRegex)].map(m => m[0]);

  for (const yr of summaryYears) {
    if (!postBody.includes(yr)) return true;
  }
  for (const money of summaryMoneys) {
    if (!postBody.includes(money)) return true;
  }
  return false;
}

// ── Core: generate summary for one play_lead ──────────────────────────────────

export async function generateIntentSummary(playLeadId: number): Promise<void> {
  // 1. Load all context in one join
  const ctxRes = await db.execute(sql`
    SELECT
      pl.id,
      pl.play_id,
      pl.org_id,
      pl.company_name,
      pl.lead_score     AS structural_score,
      pl.score_breakdown,
      sp.body           AS post_body,
      sp.post_url,
      sp.platform,
      sp.matched_signal,
      sp.intent_type,
      sp.key_phrase,
      l.industry,
      l.company_size,
      l.website,
      p.name            AS play_name,
      p.description     AS play_description,
      i.name            AS icp_name,
      i.industries      AS icp_industries,
      i.markets         AS icp_markets,
      i.roles           AS icp_roles
    FROM play_leads pl
    LEFT JOIN signal_posts sp ON sp.id = pl.signal_post_id
    LEFT JOIN leads         l  ON l.id  = pl.lead_id
    LEFT JOIN plays         p  ON p.id  = pl.play_id
    LEFT JOIN icps          i  ON i.id  = (pl.score_breakdown->>'matched_icp')::int
    WHERE pl.id = ${playLeadId}
  `);

  const rows = (ctxRes as unknown as { rows: LeadContext[] }).rows;
  if (!rows.length) {
    logger.warn({ playLeadId }, "[INTENT] play_lead not found — skipping");
    return;
  }
  const ctx = rows[0]!;

  // 2. Call Claude Sonnet with prompt caching on the system prompt
  let msg: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    msg = await anthropic.messages.create({
      model:      MODELS.SMART,
      max_tokens: 512,
      system: withCache(SYSTEM_PROMPT),
      messages: [{ role: "user", content: buildUserPrompt(ctx) }],
    });
  } catch (err) {
    logger.warn({ err, playLeadId }, "[INTENT] Claude call failed — skipping lead");
    return;
  }

  // 3. Log Anthropic usage (non-fatal)
  void logAnthropicUsage({
    model:        MODELS.SMART,
    inputTokens:  msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    feature:      "intent_summary",
    orgId:        ctx.org_id,
  });

  // 4. Parse JSON safely
  const rawText = msg.content.find(b => b.type === "text")?.text ?? "";
  let result: SummaryResult;
  try {
    result = JSON.parse(stripFences(rawText)) as SummaryResult;
  } catch (parseErr) {
    logger.warn({ parseErr, rawText: rawText.slice(0, 200), playLeadId }, "[INTENT] JSON parse failed — skipping");
    return;
  }

  // Clamp values to valid ranges
  const signalScore = Math.max(0, Math.min(100, Math.round(Number(result.signal_score) || 0)));
  const confidence  = Math.max(0, Math.min(1,   Number(result.confidence) || 0));

  // 5. Anti-fabrication check
  const fabricated = antiFabricationCheck(result.intent_summary ?? "", ctx.post_body ?? "");

  // 6. Final score: 0.6 × structural + 0.4 × signal_score
  const structuralScore = Math.max(0, Math.min(100, Number(ctx.structural_score) || 0));
  const finalScore      = Math.round(0.6 * structuralScore + 0.4 * signalScore);

  // 7. Merge score_breakdown
  const existingBreakdown = (ctx.score_breakdown ?? {}) as Record<string, unknown>;
  const updatedBreakdown  = {
    ...existingBreakdown,
    signal_score:       signalScore,
    why_this_lead:      result.why_this_lead      ?? "",
    recommended_angle:  result.recommended_angle  ?? "",
    summary_confidence: confidence,
    low_confidence:     confidence < 0.4 || fabricated,
  };

  // 8. Write back to play_leads
  try {
    await db.execute(sql`
      UPDATE play_leads
      SET intent_summary  = ${result.intent_summary ?? ""},
          lead_score      = ${finalScore},
          score_breakdown = ${JSON.stringify(updatedBreakdown)}::jsonb
      WHERE id = ${playLeadId}
    `);
    logger.info(
      { playLeadId, company: ctx.company_name, finalScore, signalScore, confidence },
      "[INTENT] summary written"
    );
  } catch (err) {
    logger.warn({ err, playLeadId }, "[INTENT] DB update failed");
  }
}

// ── Batch processor ───────────────────────────────────────────────────────────

export async function generatePendingSummaries(
  limit = 15,
): Promise<{ processed: number; avg_score: number }> {
  const pendingRes = await db.execute(sql`
    SELECT id FROM play_leads
    WHERE intent_summary IS NULL
    ORDER BY created_at ASC
    LIMIT ${limit}
  `);

  const pending = (pendingRes as unknown as { rows: { id: number }[] }).rows;
  if (!pending.length) return { processed: 0, avg_score: 0 };

  let processed  = 0;
  let scoreTotal = 0;

  for (const row of pending) {
    try {
      // Snapshot score before, read updated score after
      await generateIntentSummary(row.id);

      // Read back the updated lead_score for the avg calculation
      const updRes = await db.execute(sql`
        SELECT lead_score FROM play_leads WHERE id = ${row.id}
      `);
      const updScore = Number(
        ((updRes as unknown as { rows: { lead_score: number | null }[] }).rows)[0]?.lead_score ?? 0
      );
      scoreTotal += updScore;
      processed++;
    } catch (err) {
      logger.warn({ err, leadId: row.id }, "[INTENT] batch: lead failed — continuing");
    }
  }

  const avg_score = processed > 0 ? Math.round(scoreTotal / processed) : 0;
  return { processed, avg_score };
}

/**
 * playDrafter — AI service that generates a full Play draft from a user's
 * one-sentence GTM intent using the existing Anthropic client.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { withCache } from "../config/modelRouting";
import { logAnthropicUsage } from "./logApiUsage";
import { logger } from "./logger";

const PLAY_DRAFTER_MODEL = "claude-haiku-4-5-20251001";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExistingIcp {
  id:          number;
  name:        string;
  markets:     string[];
  industries:  string[];
  roles:       string[];
  companySize: string;
}

export interface SuggestedNewIcp {
  name:        string;
  markets:     string[];
  industries:  string[];
  roles:       string[];
  companySize: string;
}

export interface PlayDraft {
  name:               string;
  description:        string;
  intent_keywords:    string[];
  qualification_mode: "manual" | "scout_agent";
  scout_daily_budget: number;
  collect_phone:      boolean;
  min_score:          number;
  suggested_icp_ids:  number[];
  suggested_new_icp:  SuggestedNewIcp | null;
  problem_signals:    string[];
  buying_signals:     string[];
  competitor_signals: string[];
  industry_keywords:  string[];
  target_subreddits:  string[];
}

// ── System prompt (prompt-cached) ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a B2B go-to-market strategist. Your job is to draft a complete, actionable sales Play based on the user's one-sentence GTM intent.

A Play defines who to target, what buying signals to watch, and how leads are qualified.

You will receive:
1. The user's intent message (e.g. "Find UAE healthcare companies looking to hire a marketing agency")
2. A list of the user's existing ICP profiles (id, name, markets, industries, roles, companySize)

Return a single valid JSON object — NO markdown, NO code fences, NO extra text — with exactly these fields:
{
  "name": "Short play name — 3-6 words, action-oriented, e.g. 'UAE Healthcare Outreach'",
  "description": "1-2 sentence description of who this play targets and why",
  "intent_keywords": ["5-10 short keywords describing the play's focus"],
  "qualification_mode": "manual" or "scout_agent" (use scout_agent for large markets >1000 companies),
  "scout_daily_budget": 10,
  "collect_phone": false,
  "min_score": 50,
  "suggested_icp_ids": [list of matching ICP ids from the provided list; empty array [] if none fit],
  "suggested_new_icp": null or { "name": "...", "markets": [...], "industries": [...], "roles": [...], "companySize": "..." },
  "problem_signals": ["5-8 phrases people post online when they have this problem"],
  "buying_signals": ["5-8 phrases indicating active vendor search or intent to buy"],
  "competitor_signals": ["3-5 competitor names or brand terms relevant to this play"],
  "industry_keywords": ["5-10 industry terms for signal detection"],
  "target_subreddits": ["3-5 relevant subreddit names without r/ prefix, e.g. 'marketing', 'entrepreneur'"]
}

Rules:
- suggested_icp_ids: match by market/industry/role overlap. Empty [] if none of the existing ICPs fit.
- suggested_new_icp: if no existing ICPs match, suggest one new ICP. If existing ICPs cover it, set to null.
- Return ONLY the JSON object. Nothing else.`;

// ── Signal Suggest ─────────────────────────────────────────────────────────────

type BucketType = "problem" | "buying" | "competitor" | "keyword" | "subreddit";

const BUCKET_SYSTEM = `You are a B2B signal intelligence expert. Suggest signal phrases for a go-to-market play's detection bucket.
Return ONLY a valid JSON array of strings — no markdown, no code fences, no extra text.`;

const BUCKET_PROMPTS: Record<BucketType, string> = {
  problem:    "Suggest 8-10 phrases that B2B buyers post online when they are experiencing the problem this play addresses. Use natural, colloquial language people actually type — not corporate speak.",
  buying:     "Suggest 8-10 phrases indicating active buying intent — someone actively searching for or ready to purchase a solution like this play targets.",
  competitor: "Suggest 8-10 competitor brand names, product names, or comparison phrases relevant to this play's market (e.g. 'vs X', 'alternative to X', 'X pricing').",
  keyword:    "Suggest 8-10 industry domain keywords and terminology for signal detection relevant to this play's target market and ICP.",
  subreddit:  "Suggest 8-10 subreddit names (without the r/ prefix) where the target audience is likely active. Include relevant Indian communities if the market includes India (e.g. indiastartups, india, entrepreneur).",
};

export async function suggestSignalPhrases(opts: {
  play:     { name: string; description: string | null; intentKeywords: string[] };
  icpNames: string[];
  bucket:   BucketType;
  existing: string[];
  orgId:    number;
}): Promise<string[]> {
  const userMsg = `Play: "${opts.play.name}"
Description: ${opts.play.description ?? "N/A"}
Keywords: ${(opts.play.intentKeywords ?? []).join(", ") || "none"}
ICPs: ${opts.icpNames.join(", ") || "not specified"}
Already in this bucket: ${opts.existing.length > 0 ? opts.existing.join(", ") : "none"}

${BUCKET_PROMPTS[opts.bucket]}
Return ONLY new entries NOT already listed above.`;

  const model = PLAY_DRAFTER_MODEL;
  let raw = "";
  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 400,
      system:   withCache(BUCKET_SYSTEM),
      messages: [{ role: "user", content: userMsg }],
    });
    void logAnthropicUsage({ model, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "signal_suggest", orgId: opts.orgId });
    raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  } catch (err) {
    logger.error({ err }, "[SIGNAL_SUGGEST] Anthropic call failed");
    throw new Error("AI service unavailable — please try again");
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    const existingLower = new Set(opts.existing.map(s => s.toLowerCase().trim()));
    return (parsed as unknown[])
      .map(s => String(s).trim())
      .filter(s => s && !existingLower.has(s.toLowerCase()))
      .slice(0, 10);
  } catch {
    logger.error({ raw: cleaned.slice(0, 300) }, "[SIGNAL_SUGGEST] JSON parse failed");
    return [];
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function draftPlayFromIntent(
  intent:       string,
  existingIcps: ExistingIcp[],
  orgId:        number,
): Promise<PlayDraft> {
  const icpContext = existingIcps.length > 0
    ? `\n\nExisting ICP Profiles:\n${existingIcps.map(icp =>
        `  ID ${icp.id}: "${icp.name}" | Markets: ${icp.markets.join(", ")} | Industries: ${icp.industries.join(", ")} | Roles: ${icp.roles.join(", ")}`
      ).join("\n")}`
    : "\n\nExisting ICP Profiles: None defined yet.";

  const userMessage = `User GTM Intent: "${intent}"${icpContext}

Draft a complete Play JSON for this intent.`;

  const model = PLAY_DRAFTER_MODEL;

  let raw: string;
  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 1200,
      system:   withCache(SYSTEM_PROMPT),
      messages: [{ role: "user", content: userMessage }],
    });

    void logAnthropicUsage({
      model,
      inputTokens:  msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      feature:      "play_drafter",
      orgId,
    });

    raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  } catch (err) {
    logger.error({ err }, "[PLAY_DRAFTER] Anthropic call failed");
    throw new Error("AI service unavailable — please try again");
  }

  // Strip markdown fences if Claude wrapped the JSON
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    logger.error({ raw: cleaned.slice(0, 500) }, "[PLAY_DRAFTER] JSON parse failed");
    throw new Error("Couldn't draft that — try rephrasing your intent");
  }

  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).map(String) : [];

  const numArr = (v: unknown): number[] =>
    Array.isArray(v)
      ? (v as unknown[]).filter((x): x is number => typeof x === "number")
      : [];

  const newIcp = parsed.suggested_new_icp != null && typeof parsed.suggested_new_icp === "object"
    ? (parsed.suggested_new_icp as Record<string, unknown>)
    : null;

  return {
    name:               String(parsed.name ?? "Untitled Play").slice(0, 100),
    description:        String(parsed.description ?? ""),
    intent_keywords:    arr(parsed.intent_keywords),
    qualification_mode: parsed.qualification_mode === "scout_agent" ? "scout_agent" : "manual",
    scout_daily_budget: typeof parsed.scout_daily_budget === "number" ? parsed.scout_daily_budget : 10,
    collect_phone:      Boolean(parsed.collect_phone),
    min_score:          typeof parsed.min_score === "number" ? parsed.min_score : 50,
    suggested_icp_ids:  numArr(parsed.suggested_icp_ids),
    suggested_new_icp:  newIcp
      ? {
          name:        String(newIcp.name ?? ""),
          markets:     arr(newIcp.markets),
          industries:  arr(newIcp.industries),
          roles:       arr(newIcp.roles),
          companySize: String(newIcp.companySize ?? ""),
        }
      : null,
    problem_signals:    arr(parsed.problem_signals),
    buying_signals:     arr(parsed.buying_signals),
    competitor_signals: arr(parsed.competitor_signals),
    industry_keywords:  arr(parsed.industry_keywords),
    target_subreddits:  arr(parsed.target_subreddits),
  };
}

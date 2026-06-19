/**
 * Signal Classifier
 * Keyword pre-filter + Claude Haiku classification for pending signal_posts.
 * Queues high-confidence signals into signal_entity_queue.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";
import { logAnthropicUsage } from "../logApiUsage";

const BATCH_SIZE = 50;

// ── Keyword pre-filter ───────────────────────────────────────────────────────
const INTENT_KEYWORDS = [
  "need", "looking for", "want", "help with", "recommend", "agency",
  "redesign", "rebrand", "website", "branding", "seo", "marketing",
  "digital", "hire", "find", "best", "advice", "suggestions",
  "proposal", "quote", "vendor", "service", "freelancer",
];

function quickFilter(text: string): boolean {
  const lower = text.toLowerCase();
  return INTENT_KEYWORDS.some((kw) => lower.includes(kw));
}

interface RawPost {
  id:        number;
  title:     string;
  body:      string;
  subreddit: string;
  post_url:  string;
}

interface ClassificationResult {
  intent_type:       string;
  confidence:        number;
  is_buying_signal:  boolean;
  company_mentioned: string | null;
  industry_hint:     string | null;
  budget_hint:       string | null;
  reasoning:         string;
}

const SYSTEM_PROMPT = `You are a B2B sales signal classifier. You analyze Reddit posts and determine if they represent a genuine buying intent or business need.

Classify each post and return a JSON object with:
- intent_type: one of "website_redesign", "seo_help", "branding", "digital_marketing", "sales_help", "other"
- confidence: float 0.0-1.0 (probability this is a real buying signal)
- is_buying_signal: boolean (true if confidence >= 0.72 and not generic discussion)
- company_mentioned: string or null
- industry_hint: string or null (e.g. "ecommerce", "saas", "healthcare")
- budget_hint: string or null
- reasoning: one sentence

Return ONLY valid JSON, no markdown.`;

async function classifyPost(post: RawPost): Promise<ClassificationResult | null> {
  const userContent = `Subreddit: r/${post.subreddit}
Title: ${post.title}
Body: ${(post.body ?? "").slice(0, 1500)}

Classify this post as a B2B buying signal.`;

  try {
    const msg = await anthropic.messages.create({
      model:  "claude-haiku-4-5",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    void logAnthropicUsage({ model: "claude-haiku-4-5", inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "signal_classifier", orgId: null });
    const raw   = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as ClassificationResult;
  } catch (err) {
    logger.warn({ err, postId: post.id }, "[SIGNAL CLASSIFIER] Claude call failed");
    return null;
  }
}

export async function classifyPendingSignals(): Promise<{ classified: number; queued: number }> {
  let classified = 0;
  let queued     = 0;

  const rows = await db.execute(sql`
    SELECT id, title, body, subreddit, post_url
    FROM signal_posts
    WHERE classified_at IS NULL
    ORDER BY crawled_at DESC
    LIMIT ${BATCH_SIZE}
  `);

  const posts = (rows as unknown as { rows: RawPost[] }).rows ?? [];

  for (const post of posts) {
    // Quick keyword pre-filter
    if (!quickFilter(post.title + " " + (post.body ?? ""))) {
      await db.execute(sql`
        UPDATE signal_posts
        SET classified_at = NOW(), intent_type = 'other', confidence = 0.1, is_buying_signal = false
        WHERE id = ${post.id}
      `);
      classified++;
      continue;
    }

    const result = await classifyPost(post);

    if (!result) {
      classified++;
      continue;
    }

    const isBuying   = result.is_buying_signal && result.confidence >= 0.72;
    const intentType = result.intent_type ?? "other";
    const confidence = Math.min(1, Math.max(0, result.confidence ?? 0));
    const company    = result.company_mentioned ?? null;
    const industry   = result.industry_hint    ?? null;
    const budget     = result.budget_hint      ?? null;
    const notes      = result.reasoning        ?? "";

    await db.execute(sql`
      UPDATE signal_posts
      SET classified_at     = NOW(),
          intent_type       = ${intentType},
          confidence        = ${confidence},
          is_buying_signal  = ${isBuying},
          company_mentioned = ${company},
          industry_hint     = ${industry},
          budget_hint       = ${budget},
          classifier_notes  = ${notes}
      WHERE id = ${post.id}
    `);

    classified++;

    if (isBuying && intentType !== "other") {
      await db.execute(sql`
        INSERT INTO signal_entity_queue (signal_post_id, status, intent_type, confidence, queued_at)
        VALUES (${post.id}, 'pending', ${intentType}, ${confidence}, NOW())
        ON CONFLICT (signal_post_id) DO NOTHING
      `);
      queued++;
    }
  }

  logger.info({ classified, queued }, "[SIGNAL CLASSIFIER] Classification batch complete");
  return { classified, queued };
}

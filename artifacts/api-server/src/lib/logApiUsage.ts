import { db } from "./db";
import { apiUsageLog, organizations } from "@workspace/db/schema";
import { and, eq, gte, lt, sum } from "drizzle-orm";
import { logger } from "./logger";
import { sendOrgEmail } from "./sendOrgEmail";

const ANTHROPIC_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-haiku-4-5":  { inputPer1M: 0.80,  outputPer1M: 4.00  },
  "claude-haiku-3-5":  { inputPer1M: 0.80,  outputPer1M: 4.00  },
  "claude-sonnet-4-5": { inputPer1M: 3.00,  outputPer1M: 15.00 },
  "claude-sonnet-4-6": { inputPer1M: 3.00,  outputPer1M: 15.00 },
  "claude-opus-4-5":   { inputPer1M: 15.00, outputPer1M: 75.00 },
};

export const APIFY_COST_PER_CALL  = 0.003; // ~$0.003 per SERP query (10 results)
export const APOLLO_COST_PER_CALL = 0.10;  // $0.10 per Apollo People Match credit

export async function logAnthropicUsage(opts: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  feature: string;
  orgId?: number | null;
}): Promise<void> {
  try {
    const p = ANTHROPIC_PRICING[opts.model] ?? { inputPer1M: 3.00, outputPer1M: 15.00 };
    const costUsd = (opts.inputTokens * p.inputPer1M + opts.outputTokens * p.outputPer1M) / 1_000_000;
    await db.insert(apiUsageLog).values({
      service:      "anthropic",
      model:        opts.model,
      feature:      opts.feature,
      inputTokens:  opts.inputTokens,
      outputTokens: opts.outputTokens,
      apiCalls:     1,
      costUsd,
      orgId: opts.orgId ?? null,
    });
  } catch { /* non-fatal */ }
}

export async function logApifyUsage(opts: {
  feature: string;
  calls: number;
  orgId?: number | null;
}): Promise<void> {
  try {
    await db.insert(apiUsageLog).values({
      service:      "apify",
      feature:      opts.feature,
      inputTokens:  0,
      outputTokens: 0,
      apiCalls:     opts.calls,
      costUsd:      opts.calls * APIFY_COST_PER_CALL,
      orgId: opts.orgId ?? null,
    });
  } catch { /* non-fatal */ }
}

export async function logApolloUsage(opts: {
  feature?: string;
  orgId?: number | null;
} = {}): Promise<void> {
  try {
    await db.insert(apiUsageLog).values({
      service:      "apollo",
      feature:      opts.feature ?? "lead-enrichment",
      inputTokens:  0,
      outputTokens: 0,
      apiCalls:     1,
      costUsd:      APOLLO_COST_PER_CALL,
      orgId: opts.orgId ?? null,
    });
  } catch { /* non-fatal */ }
}

export async function logPageSpeedUsage(opts: {
  feature?: string;
  orgId?: number | null;
} = {}): Promise<void> {
  try {
    await db.insert(apiUsageLog).values({
      service:      "pagespeed",
      feature:      opts.feature ?? "audit",
      inputTokens:  0,
      outputTokens: 0,
      apiCalls:     1,
      costUsd:      0,
      orgId: opts.orgId ?? null,
    });
  } catch { /* non-fatal */ }
}

/**
 * Check every org's AI spend for `targetDate` (defaults to yesterday) against
 * their configured daily limit. Sends an email alert to the org admin if the
 * threshold is exceeded and no alert has been sent for the same calendar day.
 *
 * Returns a summary suitable for logging.
 */
export async function checkAllOrgsAiSpendThresholds(targetDate?: Date): Promise<{
  checked: number;
  alerted: number;
  skipped: number;
}> {
  const date = targetDate ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  })();

  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const orgs = await db
    .select({
      id:                 organizations.id,
      email:              organizations.email,
      name:               organizations.name,
      ownerName:          organizations.ownerName,
      limitUsd:           organizations.aiSpendDailyLimitUsd,
      alertSentAt:        organizations.aiSpendAlertSentAt,
    })
    .from(organizations)
    .where(eq(organizations.isActive, true));

  let checked = 0, alerted = 0, skipped = 0;

  for (const org of orgs) {
    if (!org.limitUsd || org.limitUsd <= 0) { skipped++; continue; }

    // Don't re-alert if we already sent one for this calendar day
    if (org.alertSentAt) {
      const alertDay = new Date(org.alertSentAt);
      alertDay.setUTCHours(0, 0, 0, 0);
      if (alertDay.getTime() === dayStart.getTime()) { skipped++; continue; }
    }

    checked++;

    const spendRows = await db
      .select({ total: sum(apiUsageLog.costUsd) })
      .from(apiUsageLog)
      .where(and(
        eq(apiUsageLog.orgId, org.id),
        gte(apiUsageLog.createdAt, dayStart),
        lt(apiUsageLog.createdAt, dayEnd),
      ));

    const spendUsd = Number(spendRows[0]?.total ?? 0);

    if (spendUsd < org.limitUsd) { skipped++; continue; }

    const dateLabel = dayStart.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const overBy    = (spendUsd - org.limitUsd).toFixed(4);

    const sent = await sendOrgEmail(org.id, {
      to:      org.email,
      toName:  org.ownerName ?? undefined,
      subject: `⚠️ MysaAI — AI spend limit exceeded on ${dateLabel}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <div style="background:linear-gradient(135deg,#1A3D2B,#5C1A8C);padding:20px 24px;border-radius:8px 8px 0 0;">
            <h2 style="color:#fff;margin:0;font-size:18px;">⚠️ AI Spend Alert — ${org.name}</h2>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
            <p style="color:#333;margin:0 0 16px;">Your workspace exceeded its daily AI spend limit on <strong>${dateLabel}</strong>.</p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
              <tr>
                <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;color:#6B7280;">Daily Limit</td>
                <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#111827;">$${org.limitUsd.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#6B7280;">Actual Spend</td>
                <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#DC2626;">$${spendUsd.toFixed(4)}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;background:#FEF2F2;border:1px solid #E5E7EB;font-size:13px;color:#6B7280;">Over By</td>
                <td style="padding:8px 12px;background:#FEF2F2;border:1px solid #E5E7EB;font-size:13px;font-weight:700;color:#DC2626;">$${overBy}</td>
              </tr>
            </table>
            <p style="color:#555;margin:0 0 12px;font-size:13px;">You can adjust your daily limit or review usage in <strong>Settings → AI Models</strong>.</p>
            <p style="color:#9CA3AF;margin:0;font-size:11px;">This alert fires once per day when the threshold is exceeded.</p>
          </div>
        </div>`,
      text: `AI Spend Alert — ${org.name}\n\nYour workspace exceeded its daily AI spend limit on ${dateLabel}.\n\nDaily Limit: $${org.limitUsd.toFixed(2)}\nActual Spend: $${spendUsd.toFixed(4)}\nOver By: $${overBy}\n\nAdjust your daily limit in Settings → AI Models.`,
    });

    if (sent) {
      // Store dayStart (the spend date being alerted) so next day's run
      // compares against the correct date and doesn't skip or double-fire.
      await db
        .update(organizations)
        .set({ aiSpendAlertSentAt: dayStart, updatedAt: new Date() })
        .where(eq(organizations.id, org.id));
      alerted++;
      logger.info({ orgId: org.id, spendUsd, limitUsd: org.limitUsd }, "AI spend alert sent");
    } else {
      logger.warn({ orgId: org.id }, "AI spend alert: email send failed");
      skipped++;
    }
  }

  return { checked, alerted, skipped };
}

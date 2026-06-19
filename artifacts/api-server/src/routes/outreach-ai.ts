import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import {
  outreachEmails,
  leads,
  leadAudits,
  auditRuns,
  auditSignals,
  auditCategories,
  brandingSettings,
  organizations,
} from "@workspace/db/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { resourceLimitGuard } from "../middlewares/planGuard";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { logAnthropicUsage } from "../lib/logApiUsage";
import crypto from "crypto";
import { sendOrgEmail } from "../lib/sendOrgEmail";
import { getAppBaseUrl } from "../lib/app-url";
import { generateAuditPdf } from "../lib/generateAuditPdf";
import { auditScoreHex, auditScoreLabel } from "../lib/utils";

const router = Router();

// ── Email helper ──────────────────────────────────────────────────────────────

function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

const BOOKING_LINK = "https://calendly.com/dreamsdesign-in/consulting";

function sanitiseBody(rawBody: string): string {
  return rawBody
    // Remove em-dash separator patterns like "word — word — word"
    .replace(/\s+—\s+/g, " ")
    // Remove en-dash separators
    .replace(/\s+–\s+/g, " ")
    // Remove "—" at start of lines (used as bullet separators)
    .replace(/^—\s+/gm, "")
    // Clean up any double spaces left behind
    .replace(/  +/g, " ")
    .trim();
}

function buildDeliverableHtml(plainBody: string, fromName = "Dreamsdesign"): string {
  // Sanitise first — remove em-dash separators and strip HTML tags
  const sanitised = sanitiseBody(plainBody);

  // Normalize: if AI returned HTML-formatted text, convert to plain text first
  const normalized = sanitised
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "");

  // Escape HTML entities
  const escaped = normalized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Split into paragraphs (double newline = new para, single = <br>)
  const paragraphs = escaped
    .split(/\n{2,}/)
    .filter(p => p.trim().length > 0)
    .map(p => {
      const line = p.trim().replace(/\n/g, "<br>");
      // Style sign-off lines differently (smaller, muted)
      const isSignoff = /^(best|warm|kind|cheers|regards|sincerely|thanks|thank you|looking forward|krishna|dreamsdesign)/i.test(line);
      if (isSignoff) {
        return `<p style="margin:20px 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#555555;">${line}</p>`;
      }
      return `<p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.8;color:#333333;">${line}</p>`;
    })
    .join("\n");

  // CTA Button block
  const ctaBlock = `
<!-- ── AUDIT REPORT REFERENCE ── -->
<tr>
  <td style="padding:0 36px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:#f7f5ff;border:1px solid #e0d9f8;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;
                    color:#5C1A8C;text-transform:uppercase;letter-spacing:0.6px;">📎 Attached</p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.5;">
            Your personalised <strong>${fromName} Brand Audit Report</strong> — see exactly where you stand and what to fix first.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>

<!-- ── BOOKING BUTTON ── -->
<tr>
  <td style="padding:0 36px 32px;text-align:center;">
    <a href="${BOOKING_LINK}"
      style="display:inline-block;padding:14px 32px;border-radius:50px;
             background:linear-gradient(135deg,#5C1A8C,#7B2FBE);
             font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;
             color:#ffffff;text-decoration:none;letter-spacing:0.2px;
             box-shadow:0 4px 16px rgba(92,26,140,0.30);">
      Book Free 30-Min Growth Call →
    </a>
    <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#aaaaaa;">
      No pitch. No pressure. Just clarity on what's holding your brand back.
    </p>
  </td>
</tr>`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>Message from ${fromName}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    @media only screen and (max-width:620px) {
      .email-wrapper { width:100% !important; padding:12px !important; }
      .email-card   { border-radius:0 !important; }
      .email-body   { padding:28px 20px !important; }
      .email-footer { padding:16px 20px !important; }
      .header-logo  { font-size:20px !important; }
      .header-tag   { display:none !important; }
      .divider-cell { padding:0 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0eff4;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<!-- Preheader (hidden preview text) -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
  A message from the Dreamsdesign team &#8203;&#65279;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;
</div>

<!-- Outer wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
  style="background-color:#f0eff4;min-width:100%;">
  <tr>
    <td align="center" class="email-wrapper" style="padding:40px 16px;">

      <!-- Card -->
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
        class="email-card"
        style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;
               box-shadow:0 4px 24px rgba(92,26,140,0.10);overflow:hidden;">

        <!-- ── HEADER ── -->
        <tr>
          <td style="background:linear-gradient(135deg,#5C1A8C 0%,#7B2FBE 60%,#E91E8C 100%);
                     padding:28px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <span class="header-logo"
                    style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;
                           color:#ffffff;letter-spacing:0.3px;display:block;">
                    ✦ ${fromName}
                  </span>
                  <span class="header-tag"
                    style="font-family:Arial,Helvetica,sans-serif;font-size:12px;
                           color:rgba(255,255,255,0.75);display:block;margin-top:4px;
                           letter-spacing:0.8px;text-transform:uppercase;">
                    With Us Your Growth Is Guaranteed.
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── THIN ACCENT BAR ── -->
        <tr>
          <td style="height:4px;background:linear-gradient(90deg,#E91E8C,#5C1A8C);
                     font-size:0;line-height:0;">&nbsp;</td>
        </tr>

        <!-- ── BODY ── -->
        <tr>
          <td class="email-body" style="padding:36px 36px 24px;">
            ${paragraphs}
          </td>
        </tr>

        ${ctaBlock}

        <!-- ── DIVIDER ── -->
        <tr>
          <td class="divider-cell" style="padding:0 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-top:1px solid #ece8f3;font-size:0;line-height:0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── SIGNATURE BLOCK ── -->
        <tr>
          <td class="email-body" style="padding:20px 36px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <!-- Avatar circle -->
                <td style="vertical-align:top;padding-right:14px;">
                  <div style="width:44px;height:44px;border-radius:50%;
                              background:linear-gradient(135deg,#5C1A8C,#E91E8C);
                              text-align:center;line-height:44px;
                              font-family:Arial,Helvetica,sans-serif;font-size:18px;
                              font-weight:700;color:#ffffff;">K</div>
                </td>
                <!-- Name + title -->
                <td style="vertical-align:top;">
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;
                               font-weight:700;color:#1a1a2e;display:block;">Krish Puranik - Founder CEO</span>
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;
                               color:#5C1A8C;display:block;margin-top:2px;">
                    Your Digital Growth Consultant at Dreamsdesign
                  </span>
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;
                               color:#888888;display:block;margin-top:6px;">
                    🌐 <a href="https://dreamsdesign.in" style="color:#5C1A8C;text-decoration:none;">dreamsdesign.in</a>
                    &nbsp;·&nbsp;
                    ✉ <a href="mailto:krishna@dreamsdesign.in" style="color:#5C1A8C;text-decoration:none;">krishna@dreamsdesign.in</a>
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── FOOTER ── -->
        <tr>
          <td class="email-footer"
            style="background:#faf8fd;border-top:1px solid #ece8f3;
                   padding:16px 36px;text-align:center;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;
                      color:#aaaaaa;line-height:1.6;">
              You received this email because we believe we can help grow your brand.
              <br>© ${new Date().getFullYear()} Dreamsdesign · All rights reserved.
            </p>
          </td>
        </tr>

      </table>
      <!-- /Card -->

    </td>
  </tr>
</table>
<!-- /Outer wrapper -->

</body>
</html>`;
}

function makeMessageId(fromDomain: string): string {
  return `<${crypto.randomUUID()}@${fromDomain}>`;
}

// ── Currency detection by country ────────────────────────────────────────────
function detectCurrency(country: string): { symbol: string; label: string } {
  const c = (country ?? "").toLowerCase();
  if (c.includes("india") || c === "in") return { symbol: "₹", label: "INR" };
  if (c.includes("uae") || c.includes("emirates") || c.includes("dubai") || c === "ae")
    return { symbol: "AED", label: "AED" };
  if (c.includes("saudi") || c.includes("ksa") || c === "sa")
    return { symbol: "SAR", label: "SAR" };
  if (c.includes("united kingdom") || c.includes("uk") || c.includes("britain") || c === "gb")
    return { symbol: "£", label: "GBP" };
  if (
    c.includes("germany") || c.includes("france") || c.includes("italy") ||
    c.includes("spain") || c.includes("netherlands") || c.includes("europe") || c === "eu"
  ) return { symbol: "€", label: "EUR" };
  if (c.includes("australia") || c === "au") return { symbol: "A$", label: "AUD" };
  if (c.includes("singapore") || c === "sg") return { symbol: "S$", label: "SGD" };
  if (c.includes("canada") || c === "ca") return { symbol: "C$", label: "CAD" };
  return { symbol: "$", label: "USD" };
}

// ── Run a full audit for a lead (non-streaming, for AI engine use) ───────────
async function runQuickAudit(lead: typeof leads.$inferSelect): Promise<{
  auditRunId: number;
  signals: { signalId: number; status: string; signalName: string; severity: string; categorySlug: string; explanation?: string }[];
  aiReport: string;
  healthScore: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
} | null> {
  try {
    const allSignals = await db
      .select({ signal: auditSignals, cat: auditCategories })
      .from(auditSignals)
      .innerJoin(auditCategories, eq(auditSignals.categoryId, auditCategories.id));

    const prompt = `You are a brand audit expert for Dreamsdesign, a premium B2B digital marketing and design agency.
Analyze the following company and assign a status and explanation to each brand signal.

Company: ${lead.company}
Website: ${lead.website ?? "unknown"}
LinkedIn: ${lead.linkedInUrl ?? "unknown"}
Industry: ${lead.industry ?? "unknown"}
Country: ${lead.country ?? "unknown"}
Company Size: ${lead.companySize ?? "unknown"}

Signals to evaluate (format: [id] name — severity):
${allSignals.map((s) => `- [${s.signal.id}] ${s.signal.name} — ${s.signal.severity}`).join("\n")}

Return ONLY valid JSON:
{
  "signals": [
    {
      "signalId": number,
      "status": "present" | "missing" | "warning",
      "explanation": "One short sentence explaining the status."
    }
  ],
  "aiReport": "Three paragraphs separated by \\n\\n: (1) Executive Summary. (2) Top 3 Problems with business impact. (3) 30-Day Action Plan."
}`;

    const auditOverrides = await fetchOrgOverrides(lead.orgId ?? 0);
    const msg = await anthropic.messages.create({
      model: getModel("brand_audit_report", auditOverrides),
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (msg.content[0] as { type: string; text: string }).text ?? "";
    void logAnthropicUsage({ model: getModel("brand_audit_report", auditOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "quick_audit", orgId: lead.orgId });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      signals: { signalId: number; status: string; explanation: string }[];
      aiReport: string;
    };

    const signalMap = new Map(allSignals.map((s) => [s.signal.id, s]));
    const enriched = parsed.signals.map((s) => {
      const ref = signalMap.get(s.signalId);
      return {
        signalId: s.signalId,
        status: s.status,
        explanation: s.explanation,
        signalName: ref?.signal.name ?? "",
        severity: ref?.signal.severity ?? "medium",
        categorySlug: ref?.cat.slug ?? "",
        categoryName: ref?.cat.name ?? "",
      };
    });

    const criticalCount = enriched.filter((s) => s.severity === "critical" && s.status === "missing").length;
    const highCount = enriched.filter((s) => s.severity === "high" && s.status === "missing").length;
    const mediumCount = enriched.filter((s) => s.severity === "medium" && s.status === "missing").length;
    const healthScore = Math.max(0, Math.min(100, 100 - criticalCount * 8 - highCount * 4 - mediumCount * 2));

    const [run] = await db.insert(auditRuns).values({
      leadId: lead.id,
      healthScore,
      criticalCount,
      highCount,
      mediumCount,
      signals: enriched,
      aiReport: parsed.aiReport,
    }).returning();

    const existing = await db.select().from(leadAudits).where(eq(leadAudits.leadId, lead.id));
    if (existing.length > 0) {
      await db.update(leadAudits).set({
        signals: enriched, healthScore, criticalCount, highCount, mediumCount, aiReport: parsed.aiReport, updatedAt: new Date(),
      }).where(eq(leadAudits.leadId, lead.id));
    } else {
      await db.insert(leadAudits).values({
        leadId: lead.id, signals: enriched, healthScore, criticalCount, highCount, mediumCount, aiReport: parsed.aiReport,
      });
    }

    return { auditRunId: run.id, signals: enriched, aiReport: parsed.aiReport, healthScore, criticalCount, highCount, mediumCount };
  } catch {
    return null;
  }
}

// ── Generate AI outreach email for a single lead ─────────────────────────────
async function generateOutreachEmail(leadId: number, orgId: number): Promise<{
  id: number; subject: string; body: string;
} | { error: string }> {
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) return { error: "Lead not found" };

  const currency = detectCurrency(lead.country ?? "");

  // Get latest audit or run one
  let auditData: {
    auditRunId: number;
    signals: { signalId: number; status: string; signalName: string; severity: string; categorySlug: string; explanation?: string }[];
    aiReport: string;
    healthScore: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
  } | null = null;

  const [existingAudit] = await db.select().from(leadAudits).where(eq(leadAudits.leadId, leadId));
  const [latestRun] = await db.select().from(auditRuns)
    .where(eq(auditRuns.leadId, leadId))
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);

  if (latestRun && existingAudit) {
    const signals = (existingAudit.signals ?? []) as { signalId: number; status: string; signalName: string; severity: string; categorySlug: string; explanation?: string }[];
    auditData = {
      auditRunId: latestRun.id,
      signals: signals as { signalId: number; status: string; signalName: string; severity: string; categorySlug: string; explanation?: string }[],
      aiReport: existingAudit.aiReport ?? "",
      healthScore: existingAudit.healthScore,
      criticalCount: existingAudit.criticalCount,
      highCount: existingAudit.highCount,
      mediumCount: existingAudit.mediumCount,
    };
  } else {
    auditData = await runQuickAudit(lead);
  }

  if (!auditData) return { error: "Audit failed" };

  // Build a rich intelligence block for the AI
  const missingCritical = auditData.signals
    .filter((s) => s.status === "missing" && s.severity === "critical")
    .slice(0, 3);
  const missingHigh = auditData.signals
    .filter((s) => s.status === "missing" && s.severity === "high")
    .slice(0, 3);
  const warnings = auditData.signals
    .filter((s) => s.status === "warning")
    .slice(0, 4);

  const topIssues = [...missingCritical, ...missingHigh]
    .slice(0, 4)
    .map((s) => `• ${s.signalName}${s.explanation ? " — " + s.explanation : ""}`)
    .join("\n");

  const warningList = warnings
    .map((s) => `• ${s.signalName}${s.explanation ? " — " + s.explanation : ""}`)
    .join("\n");

  // Full AI report (all 3 paragraphs: executive summary, top problems, action plan)
  const fullReport = auditData.aiReport ?? "";
  const reportParts = fullReport.split("\n\n").filter(Boolean);
  const executiveSummary = reportParts[0] ?? "";
  const topProblems = reportParts[1] ?? "";
  const actionPlan = reportParts[2] ?? "";

  const emailPrompt = `You are Krishna Puranik, Founder & CEO of Dreamsdesign (dreamsdesign.in) — a premium B2B digital marketing and AI agency based in India, serving clients across India, UAE, UK, and USA.

You personally looked at ${lead.company}'s brand before sending this email. Now write a short, genuine, human outreach email. This is NOT a mass email blast. It should sound like you personally noticed something specific about their business and decided to reach out.

PROSPECT PROFILE:
Name: ${lead.firstName} ${lead.lastName}
Role: ${lead.designation || "Business Owner"}
Company: ${lead.company}
Website: ${lead.website ?? "not provided"}
Industry: ${lead.industry || "unknown"}
Location: ${lead.country || "unknown"}
Company Size: ${lead.companySize ?? "unknown"}

BRAND AUDIT INTELLIGENCE (from our analysis of ${lead.company}):
Overall Health Score: ${auditData.healthScore}/100
Critical gaps: ${auditData.criticalCount} | High-priority gaps: ${auditData.highCount}

Critical & High Issues Found:
${topIssues || "Multiple significant brand signal gaps detected"}

${warningList ? `Areas that need attention:\n${warningList}\n` : ""}
Executive Summary:
${executiveSummary}

Top Problems with Business Impact:
${topProblems}

What we'd do in 30 days:
${actionPlan}

CURRENCY FOR THIS MARKET: ${currency.symbol} (${currency.label}) — country: ${lead.country}

KRISHNA'S WRITING STYLE (follow strictly):
- Write exactly as Krishna speaks: direct, warm, honest, not corporate
- Short sentences. One thought per sentence. No fluff.
- Start with ${lead.firstName}'s first name. Skip "Dear" or "Hello"
- Lead with ONE specific finding from the audit, not a list of 5 problems
- Sound like someone who genuinely looked at their business, not a pitch machine
- ONE clear ask at the end: book a 30-min growth call
- Mention the attached brand audit report so they have context
- Use the booking link: ${BOOKING_LINK}
- Mention 1 likely competitor dynamic for their industry and location to show you understand their market
- Give a rough revenue/opportunity number in ${currency.symbol} to make the stakes real
- Keep the total body under 160 words. Shorter is better.
- Sign off as: Krishna Puranik, Dreamsdesign

ABSOLUTE RULES — these are non-negotiable:
- NEVER use em-dash separator patterns like "things — immediately — work" or "now — here" or stringing words with dashes between them
- No corporate buzzwords: "leverage", "synergy", "dynamic", "solutions"
- No filler phrases: "I hope this finds you well", "I wanted to reach out", "please don't hesitate"
- No bullet points in the email body — write in natural flowing sentences
- No greetings like "Dear" or "Hi there"
- Do NOT include the booking URL as a raw link in the body text — write it naturally as "book a 30-min call here" and I will add the button separately
- Do NOT write a generic closing like "Best regards" followed by a long signature block — just end with your first name or "Krishna, Dreamsdesign"

WHAT THE EMAIL MUST ACCOMPLISH:
1. Make ${lead.firstName} feel like you specifically looked at their business (because you did)
2. Name the single most damaging gap you found (pick the most impactful one from the audit)
3. Show you understand their competitive landscape (briefly, naturally)
4. Tell them you've attached their full brand audit report
5. Ask them to book a free 30-min growth consulting call

Return ONLY valid JSON (no markdown, no explanation):
{
  "subject": "subject line here — specific to ${lead.company} or the issue found",
  "body": "email body text here with line breaks using \\n\\n between paragraphs"
}`;

  const emailOverrides = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("outreach_email", emailOverrides),
    max_tokens: 2048,
    messages: [{ role: "user", content: emailPrompt }],
  });

  void logAnthropicUsage({ model: getModel("outreach_email", emailOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "outreach", orgId: orgId ?? null });
  const rawText = (msg.content[0] as { type: string; text: string }).text ?? "";
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { error: "AI generation failed" };

  let emailData: { subject: string; body: string };
  try {
    emailData = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
  } catch {
    return { error: "AI response parse failed" };
  }

  // Check if draft already exists for this lead — update it
  const [existingDraft] = await db.select().from(outreachEmails)
    .where(and(eq(outreachEmails.leadId, leadId), eq(outreachEmails.orgId, orgId), eq(outreachEmails.status, "draft")));

  let emailId: number;
  if (existingDraft) {
    const [updated] = await db.update(outreachEmails).set({
      subject: emailData.subject,
      body: emailData.body,
      auditRunId: auditData.auditRunId,
      currency: currency.label,
      updatedAt: new Date(),
    }).where(eq(outreachEmails.id, existingDraft.id)).returning();
    emailId = updated.id;
  } else {
    const [created] = await db.insert(outreachEmails).values({
      leadId,
      orgId,
      auditRunId: auditData.auditRunId,
      toEmail: lead.email,
      toName: `${lead.firstName} ${lead.lastName}`,
      company: lead.company,
      country: lead.country ?? "",
      currency: currency.label,
      subject: emailData.subject,
      body: emailData.body,
      status: "draft",
    }).returning();
    emailId = created.id;
  }

  return { id: emailId, subject: emailData.subject, body: emailData.body };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// List all outreach emails with lead info
router.get("/outreach-ai/emails", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const emails = await db
    .select({
      id: outreachEmails.id,
      leadId: outreachEmails.leadId,
      auditRunId: outreachEmails.auditRunId,
      toEmail: outreachEmails.toEmail,
      toName: outreachEmails.toName,
      company: outreachEmails.company,
      country: outreachEmails.country,
      currency: outreachEmails.currency,
      subject: outreachEmails.subject,
      body: outreachEmails.body,
      status: outreachEmails.status,
      sentAt: outreachEmails.sentAt,
      openedAt: outreachEmails.openedAt,
      trackingId: outreachEmails.trackingId,
      errorMsg: outreachEmails.errorMsg,
      createdAt: outreachEmails.createdAt,
      updatedAt: outreachEmails.updatedAt,
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadDesignation: leads.designation,
      leadWebsite: leads.website,
      leadIndustry: leads.industry,
      leadPhoto: leads.photoUrl,
      leadCompanyLogo: leads.companyLogo,
    })
    .from(outreachEmails)
    .innerJoin(leads, and(eq(outreachEmails.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(outreachEmails.orgId, orgId))
    .orderBy(desc(outreachEmails.updatedAt));
  res.json(emails);
});

// Generate email for a single lead (SSE for live progress)
router.post("/outreach-ai/generate/:leadId", async (req: Request, res: Response): Promise<void> => {
  const leadId = Number(req.params.leadId);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }
  const orgId = req.user!.orgId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send("progress", { message: "Fetching lead profile…" });
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
    if (!lead) { send("error", { message: "Lead not found" }); res.end(); return; }

    send("progress", { message: `Auditing brand for ${lead.company}…` });
    const result = await generateOutreachEmail(leadId, orgId);

    if ("error" in result) {
      send("error", { message: result.error });
    } else {
      send("done", { email: result, message: "Email generated successfully!" });
    }
  } catch (err) {
    send("error", { message: (err as Error).message ?? "Generation failed" });
  }
  res.end();
});

// Bulk generate for all leads (SSE)
router.post("/outreach-ai/generate-all", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const allLeads = await db.select().from(leads).where(eq(leads.orgId, orgId));
    send("progress", { message: `Found ${allLeads.length} leads. Starting generation…`, total: allLeads.length, done: 0 });

    let done = 0;
    for (const lead of allLeads) {
      send("progress", { message: `Generating for ${lead.company} (${done + 1}/${allLeads.length})…`, total: allLeads.length, done });
      const result = await generateOutreachEmail(lead.id, orgId);
      done++;
      if ("error" in result) {
        send("progress", { message: `⚠ ${lead.company}: ${result.error}`, total: allLeads.length, done, leadId: lead.id });
      } else {
        send("progress", { message: `✓ ${lead.company} email generated`, total: allLeads.length, done, leadId: lead.id, emailId: result.id });
      }
    }
    send("done", { message: `All ${allLeads.length} emails generated!`, total: allLeads.length, done });
  } catch (err) {
    send("error", { message: (err as Error).message ?? "Bulk generation failed" });
  }
  res.end();
});

// Update draft (subject + body)
router.patch("/outreach-ai/emails/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const parsed = z.object({
    subject: z.string().optional(),
    body: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed" }); return; }

  const [email] = await db.select().from(outreachEmails).where(and(eq(outreachEmails.id, id), eq(outreachEmails.orgId, orgId)));
  if (!email) { res.status(404).json({ error: "Email not found" }); return; }
  if (email.status !== "draft") { res.status(400).json({ error: "Only drafts can be edited" }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject;
  if (parsed.data.body !== undefined) updates.body = parsed.data.body;

  const [updated] = await db.update(outreachEmails).set(updates).where(eq(outreachEmails.id, id)).returning();
  res.json(updated);
});

// Send email
router.post("/outreach-ai/emails/:id/send", resourceLimitGuard("emails"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const [email] = await db.select().from(outreachEmails).where(and(eq(outreachEmails.id, id), eq(outreachEmails.orgId, orgId)));
  if (!email) { res.status(404).json({ error: "Email not found" }); return; }

  try {
    const trackingId = `oe_${id}_${Date.now()}`;
    const pixelUrl = `${getAppBaseUrl()}/api/track/open/${trackingId}`;
    const htmlWithPixel = buildDeliverableHtml(email.body, "Dreamsdesign")
      + `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0" alt="" />`;
    await sendOrgEmail(orgId, {
      to:      email.toEmail,
      toName:  email.toName ?? undefined,
      bcc:     ["sales@dreamsdesign.co"],
      subject: email.subject,
      html:    htmlWithPixel,
      text:    stripHtmlToPlainText(email.body),
    });

    const [updated] = await db.update(outreachEmails).set({
      status: "sent",
      sentAt: new Date(),
      trackingId,
      errorMsg: null,
      updatedAt: new Date(),
    }).where(eq(outreachEmails.id, id)).returning();

    // Auto-advance lead status: new → contacted
    if (email.leadId) {
      await db.update(leads)
        .set({ status: "enquiry_qualified", lastContactedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(leads.id, email.leadId), eq(leads.status, "new_enquiry")));
    }

    // Increment email usage counter (fire-and-forget)
    void db.update(organizations).set({ emailsUsedThisMonth: sql`emails_used_this_month + 1` }).where(eq(organizations.id, orgId)).execute().catch(() => {});

    res.json(updated);
  } catch (err) {
    const errMsg = (err as Error).message ?? "Send failed";
    const [updated] = await db.update(outreachEmails).set({
      status: "failed",
      errorMsg: errMsg,
      updatedAt: new Date(),
    }).where(eq(outreachEmails.id, id)).returning();
    res.json({ ...updated, sendError: errMsg });
  }
});

// Delete a draft
router.delete("/outreach-ai/emails/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const [email] = await db.select().from(outreachEmails).where(and(eq(outreachEmails.id, id), eq(outreachEmails.orgId, orgId)));
  if (!email) { res.status(404).json({ error: "Email not found" }); return; }

  await db.delete(outreachEmails).where(eq(outreachEmails.id, id));
  res.json({ success: true });
});

// ── Compose helper endpoints ──────────────────────────────────────────────────

// List leads that have at least one audit run (for compose dropdown)
router.get("/outreach-ai/audited-leads", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const rows = await db
    .selectDistinct({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      company: leads.company,
      designation: leads.designation,
      country: leads.country,
      industry: leads.industry,
      website: leads.website,
      photo: leads.photoUrl,
      companyLogo: leads.companyLogo,
      healthScore: leadAudits.healthScore,
      criticalCount: leadAudits.criticalCount,
      highCount: leadAudits.highCount,
      mediumCount: leadAudits.mediumCount,
      aiReport: leadAudits.aiReport,
    })
    .from(leads)
    .innerJoin(leadAudits, eq(leads.id, leadAudits.leadId))
    .where(eq(leads.orgId, orgId))
    .orderBy(desc(leadAudits.healthScore));

  res.json(rows);
});

// Generate HTML brand audit report for attachment
function generateReportHtml(
  lead: typeof leads.$inferSelect,
  audit: { healthScore: number; criticalCount: number; highCount: number; mediumCount: number; aiReport: string; signals: { signalName: string; status: string; severity: string; categorySlug: string; explanation?: string }[] }
): string {
  const scoreColor = auditScoreHex(audit.healthScore);
  const scoreLabel = auditScoreLabel(audit.healthScore);
  const currency = detectCurrency(lead.country ?? "");

  const criticals = audit.signals.filter((s) => s.status === "missing" && s.severity === "critical");
  const highs = audit.signals.filter((s) => s.status === "missing" && s.severity === "high");
  const mediums = audit.signals.filter((s) => s.status === "missing" && s.severity === "medium");

  const signalRow = (s: { signalName: string; severity: string; explanation?: string }, color: string) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #f3e8ff;font-size:13px;">${s.signalName}</td><td style="padding:8px 12px;border-bottom:1px solid #f3e8ff;"><span style="background:${color}20;color:${color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">${s.severity.toUpperCase()}</span></td><td style="padding:8px 12px;border-bottom:1px solid #f3e8ff;font-size:12px;color:#555;">${s.explanation ?? ""}</td></tr>`;

  const paras = (audit.aiReport ?? "").split("\n\n").filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Brand Audit Report — ${lead.company}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background:#faf5ff; color:#1a1a2e; }
  .header { background: linear-gradient(135deg, #5C1A8C 0%, #3D0F60 100%); padding:32px 40px; color:#fff; }
  .logo-line { font-size:11px; letter-spacing:3px; text-transform:uppercase; opacity:0.7; margin-bottom:6px; }
  .report-title { font-size:24px; font-weight:800; margin-bottom:4px; }
  .sub { font-size:13px; opacity:0.8; }
  .body { padding:32px 40px; }
  .score-card { background:#fff; border:2px solid #5C1A8C; border-radius:12px; padding:24px 32px; display:flex; align-items:center; gap:32px; margin-bottom:28px; }
  .score-circle { width:80px; height:80px; border-radius:50%; border:4px solid ${scoreColor}; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0; }
  .score-num { font-size:28px; font-weight:900; color:${scoreColor}; }
  .score-sub { font-size:10px; color:#888; }
  .score-label { font-size:18px; font-weight:700; color:${scoreColor}; margin-bottom:4px; }
  .score-meta { font-size:12px; color:#666; }
  .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700; margin-right:6px; }
  .crit { background:#fee2e2; color:#dc2626; }
  .high { background:#ffedd5; color:#d97706; }
  .med { background:#fef9c3; color:#854d0e; }
  h2 { font-size:16px; font-weight:700; color:#5C1A8C; margin-bottom:16px; border-bottom:2px solid #e9d5ff; padding-bottom:8px; }
  .section { background:#fff; border-radius:10px; padding:24px; margin-bottom:24px; border:1px solid #e9d5ff; }
  table { width:100%; border-collapse:collapse; }
  .ai-para { font-size:13px; line-height:1.7; color:#333; margin-bottom:12px; padding:12px 16px; border-left:3px solid #5C1A8C; background:#faf5ff; border-radius:0 6px 6px 0; }
  .footer { background:#5C1A8C; color:#fff; padding:20px 40px; font-size:11px; display:flex; justify-content:space-between; align-items:center; }
  .cta-box { background:linear-gradient(135deg,#E91E8C,#5C1A8C); color:#fff; padding:20px 24px; border-radius:10px; margin-bottom:24px; text-align:center; }
  .cta-box h3 { font-size:15px; margin-bottom:6px; }
  .cta-box p { font-size:12px; opacity:0.9; margin-bottom:12px; }
  .cta-btn { display:inline-block; background:#fff; color:#5C1A8C; font-weight:700; font-size:13px; padding:10px 24px; border-radius:6px; text-decoration:none; }
</style>
</head>
<body>
<div class="header">
  <div class="logo-line">Dreamsdesign · dreamsdesign.in</div>
  <div class="report-title">Brand Audit Report</div>
  <div class="sub">${lead.company} · Prepared for ${lead.firstName} ${lead.lastName}, ${lead.designation}</div>
</div>

<div class="body">
  <div class="score-card">
    <div class="score-circle">
      <div class="score-num">${audit.healthScore}</div>
      <div class="score-sub">/ 100</div>
    </div>
    <div>
      <div class="score-label">${scoreLabel} Brand Health</div>
      <div class="score-meta">
        <span class="badge crit">${audit.criticalCount} Critical</span>
        <span class="badge high">${audit.highCount} High</span>
        <span class="badge med">${audit.mediumCount} Medium</span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:#666;">
        Industry: ${lead.industry ?? "—"} &nbsp;·&nbsp; Country: ${lead.country ?? "—"} &nbsp;·&nbsp; Currency: ${currency.symbol} (${currency.label})
      </div>
    </div>
  </div>

  ${paras.length > 0 ? `
  <div class="section">
    <h2>AI Audit Summary</h2>
    ${paras.map((p) => `<p class="ai-para">${p.replace(/\n/g, "<br>")}</p>`).join("")}
  </div>` : ""}

  ${(criticals.length + highs.length + mediums.length) > 0 ? `
  <div class="section">
    <h2>Issues Found</h2>
    <table>
      <thead><tr style="background:#faf5ff;">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#5C1A8C;">Signal</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#5C1A8C;">Severity</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#5C1A8C;">Details</th>
      </tr></thead>
      <tbody>
        ${criticals.map((s) => signalRow(s, "#dc2626")).join("")}
        ${highs.map((s) => signalRow(s, "#d97706")).join("")}
        ${mediums.map((s) => signalRow(s, "#854d0e")).join("")}
      </tbody>
    </table>
  </div>` : ""}

  <div class="cta-box">
    <h3>Ready to fix these issues?</h3>
    <p>Book a free 30-minute consultation with Krish Puranik, our Digital Growth Expert, and get a personalised action plan for ${lead.company}.</p>
    <a href="https://dreamsdesign.in/consult" class="cta-btn">Book Free Consultation →</a>
  </div>
</div>

<div class="footer">
  <span>Dreamsdesign · dreamsdesign.in · +91 93777 56660</span>
  <span>Confidential · Prepared for ${lead.company}</span>
</div>
</body>
</html>`;
}

// AI compose endpoint — generates email content for manual compose modal
router.post("/outreach-ai/compose", async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    leadId: z.number(),
    ctaType: z.enum(["consultation", "call", "demo", "report"]).optional(),
    ctaTypes: z.array(z.enum(["consultation", "call", "demo", "report"])).optional(),
    tone: z.enum(["professional", "friendly", "direct", "consultative"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "leadId required" }); return; }

  const { leadId, tone = "professional" } = parsed.data;
  const selectedCtaTypes = parsed.data.ctaTypes?.length
    ? parsed.data.ctaTypes
    : [parsed.data.ctaType ?? "consultation"];
  const orgId = req.user!.orgId;
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [audit] = await db.select().from(leadAudits).where(eq(leadAudits.leadId, leadId));
  const [latestRun] = await db.select().from(auditRuns)
    .where(eq(auditRuns.leadId, leadId))
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);

  const currency = detectCurrency(lead.country ?? "");
  const auditSignalList = audit
    ? (audit.signals as { signalName: string; status: string; severity: string; explanation?: string }[] ?? [])
    : [];
  const criticalProblems = auditSignalList
    .filter((s) => s.status === "missing" && (s.severity === "critical" || s.severity === "high"))
    .slice(0, 4);

  const problemsList = criticalProblems
    .map((s) => `- ${s.signalName}${s.explanation ? `: ${s.explanation}` : ""}`)
    .join("\n");

  const ctaMap: Record<string, string> = {
    consultation: `Close with: "I'd love to show you exactly how we'd fix this. Krish Puranik, our Digital Growth Expert, has a few slots open this week for a free 30-minute strategy consultation — would [day] or [day+2] work for you?"`,
    call: `Close with: "Would you be open to a quick 20-minute call this week to go through what we found? I can share my screen and walk you through the specifics."`,
    demo: `Close with: "I'd love to walk you through a live demo of exactly what an upgraded presence could look like for ${lead.company}. 30 minutes on Zoom — does [day] work for you?"`,
    report: `Close with: "I've prepared a detailed brand audit report for ${lead.company} — I can send it over right now. Just reply and I'll get it across to you today."`,
  };
  const toneMap: Record<string, string> = {
    professional: "Formal, polished tone. Professional industry language. No slang.",
    friendly: "Warm, conversational tone. Approachable, helpful, human.",
    direct: "Concise and to-the-point. No fluff. Lead immediately with the key insight.",
    consultative: "Trusted-advisor tone. Show deep understanding, focus on business impact and ROI.",
  };

  const prompt = `You are a senior business development consultant at Dreamsdesign (dreamsdesign.in), a premium B2B digital marketing and design agency.

Write a personalised outreach email for the compose modal (user will review before sending).

LEAD PROFILE:
Name: ${lead.firstName} ${lead.lastName}
Role: ${lead.designation}
Company: ${lead.company}
Website: ${lead.website ?? "unknown"}
Industry: ${lead.industry}
Country: ${lead.country}
Company Size: ${lead.companySize ?? "unknown"}

BRAND AUDIT RESULTS:
Health Score: ${audit?.healthScore ?? "not audited"}/100
Critical Issues: ${audit?.criticalCount ?? 0}
High Issues: ${audit?.highCount ?? 0}

TOP PROBLEMS FOUND:
${problemsList || "Multiple brand signal gaps detected across digital presence"}

AI AUDIT SUMMARY:
${audit?.aiReport?.split("\n\n")[0] ?? "Brand presence requires significant improvement"}

CURRENCY: Use ${currency.symbol} (${currency.label}) for monetary figures.

EMAIL REQUIREMENTS:
- Tone: ${toneMap[tone] ?? toneMap["professional"]}
- Subject: Specific, problem-focused, ultra-personalised
- Opening: Address ${lead.firstName} by first name. Open with 1 specific problem found.
- Body: Problem → Advantage → Need framework. Under 200 words. Include a concrete ${currency.symbol} cost-of-inaction figure.
- CTA: ${selectedCtaTypes.map((t) => ctaMap[t] ?? ctaMap["consultation"]).join("\n  Also: ")}
- Sign off: Krish Puranik - Founder CEO | Dreamsdesign | dreamsdesign.in | krishna@dreamsdesign.in

Return ONLY valid JSON:
{
  "subject": "email subject line",
  "body": "full email body with \\n for line breaks"
}`;

  const composeOverrides = await fetchOrgOverrides(orgId);
  try {
    const msg = await anthropic.messages.create({
      model: getModel("outreach_email", composeOverrides),
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const rawText = (msg.content[0] as { type: string; text: string }).text ?? "";
    void logAnthropicUsage({ model: getModel("outreach_email", composeOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "outreach_compose", orgId });
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { res.status(500).json({ error: "AI generation failed" }); return; }
    const emailData = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
    res.json({
      subject: emailData.subject,
      body: emailData.body,
      auditRunId: latestRun?.id ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "AI error" });
  }
});

// Quick send — creates a draft record and sends it immediately (used by compose modal)
router.post("/outreach-ai/quick-send", async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    leadId: z.number(),
    toEmail: z.string().email(),
    toName: z.string(),
    company: z.string(),
    country: z.string().optional().default(""),
    currency: z.string().optional().default("USD"),
    subject: z.string(),
    body: z.string(),
    bodyHtml: z.string().optional(),
    cc: z.string().optional().default(""),
    bcc: z.string().optional().default(""),
    attachReport: z.boolean().optional().default(false),
    saveDraft: z.boolean().optional().default(false),
    userAttachments: z.array(z.object({ name: z.string(), content: z.string() })).optional().default([]),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
  const data = parsed.data;
  const orgId = req.user!.orgId;

  // Verify the lead belongs to this org
  const [leadCheck] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, data.leadId), eq(leads.orgId, orgId)));
  if (!leadCheck) { res.status(404).json({ error: "Lead not found" }); return; }

  // Create the draft record
  const [draft] = await db.insert(outreachEmails).values({
    leadId: data.leadId,
    orgId,
    auditRunId: null,
    toEmail: data.toEmail,
    toName: data.toName,
    company: data.company,
    country: data.country,
    currency: data.currency,
    subject: data.subject,
    body: data.body,
    status: data.saveDraft ? "draft" : "draft",
  }).returning();

  if (data.saveDraft) {
    res.json(draft);
    return;
  }

  // Fetch lead + audit for report attachment
  const [lead] = await db.select().from(leads).where(eq(leads.id, data.leadId));
  const [audit] = await db.select().from(leadAudits).where(eq(leadAudits.leadId, data.leadId));
  const [latestRun] = await db.select().from(auditRuns)
    .where(eq(auditRuns.leadId, data.leadId))
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);

  // Build attachments
  const attachments: { name: string; content: string; isBase64?: boolean }[] = [];
  if (data.attachReport && lead && audit) {
    const [brandingRow] = await db.select().from(brandingSettings).where(eq(brandingSettings.orgId, orgId));
    const auditSignalsList = (latestRun?.signals ?? audit.signals ?? []) as {
      signalName: string; status: string; severity: string; categorySlug: string; categoryName?: string; explanation?: string;
    }[];
    const pdfBuffer = await generateAuditPdf({
      lead: {
        firstName:    lead.firstName,
        lastName:     lead.lastName,
        company:      lead.company,
        designation:  lead.designation,
        websiteUrl:   lead.website,
        industry:     lead.industry,
        country:      lead.country,
      },
      audit: {
        healthScore:   audit.healthScore,
        criticalCount: audit.criticalCount,
        highCount:     audit.highCount,
        mediumCount:   audit.mediumCount,
        aiReport:      audit.aiReport ?? "",
        signals:       auditSignalsList,
      },
      branding: brandingRow ?? null,
    });
    attachments.push({
      name:      `BrandAuditReport_${lead.company.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`,
      content:   pdfBuffer.toString("base64"),
      isBase64:  true,
    });
  }

  // Merge user-uploaded attachments (already base64)
  for (const ua of data.userAttachments) {
    attachments.push({ name: ua.name, content: ua.content, isBase64: true });
  }

  // Parse comma-separated CC / BCC strings into recipient arrays
  const parseEmails = (raw: string) =>
    raw.split(",").map(s => s.trim()).filter(Boolean).map(e => ({ email: e }));

  const ccRecipients  = parseEmails(data.cc  ?? "");
  const bccRecipients = [{ email: "sales@dreamsdesign.co" }, ...parseEmails(data.bcc ?? "")];

  try {
    const trackingId = `oe_${draft.id}_${Date.now()}`;
    const pixelUrl2 = `${getAppBaseUrl()}/api/track/open/${trackingId}`;
    const rawHtml = buildDeliverableHtml(data.bodyHtml ?? data.body, "Dreamsdesign");
    const htmlWithPixel2 = rawHtml
      + `<img src="${pixelUrl2}" width="1" height="1" style="display:none;border:0" alt="" />`;
    const convertedAttachments = attachments.map(a => ({
      filename: a.name,
      content:  a.isBase64 ? Buffer.from(a.content, "base64") : Buffer.from(a.content),
    }));
    await sendOrgEmail(orgId, {
      to:          data.toEmail,
      toName:      data.toName ?? undefined,
      cc:          ccRecipients.length  > 0 ? ccRecipients.map(r => r.email)  : undefined,
      bcc:         bccRecipients.map(r => r.email),
      subject:     data.subject,
      html:        htmlWithPixel2,
      text:        stripHtmlToPlainText(data.bodyHtml ?? data.body),
      attachments: convertedAttachments.length > 0 ? convertedAttachments : undefined,
    });

    const [updated] = await db.update(outreachEmails).set({
      status: "sent",
      sentAt: new Date(),
      trackingId,
      auditRunId: latestRun?.id ?? null,
      errorMsg: null,
      updatedAt: new Date(),
    }).where(eq(outreachEmails.id, draft.id)).returning();
    res.json(updated);
  } catch (err) {
    const errMsg = (err as Error).message ?? "Send failed";
    const [updated] = await db.update(outreachEmails).set({
      status: "failed",
      errorMsg: errMsg,
      updatedAt: new Date(),
    }).where(eq(outreachEmails.id, draft.id)).returning();
    res.status(500).json({ ...updated, sendError: errMsg });
  }
});

export default router;

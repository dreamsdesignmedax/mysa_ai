import { logger } from "./logger";
import { db } from "./db";
import {
  whatsappConversations,
  whatsappMessages,
  leads,
  auditRuns,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides, withCache } from "../config/modelRouting";
import { logAnthropicUsage } from "./logApiUsage";
import { sendWhatsAppMessage, getWaSettings, type WaSettings } from "./whatsapp";
import type { WaState } from "@workspace/db/schema";
import { getDreamsdesignKnowledgeBase, getIcpIdentificationPrompt } from "./dreamsdesign-knowledge";

const LANG_NAMES: Record<string, string> = {
  english: "English",
  hindi: "Hindi (Devanagari script)",
  gujarati: "Gujarati (Gujarati script)",
  marathi: "Marathi (Devanagari script)",
};

// ── Allowed state transitions (guardrails) ────────────────────────────────────
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  hook_sent: ["hook_sent", "awaiting_yes", "report_sent"],
  awaiting_yes: ["awaiting_yes", "report_sent", "opted_out"],
  report_sent: ["report_sent", "qualifying", "opted_out"],
  qualifying: ["qualifying", "appointment_pitched", "opted_out"],
  appointment_pitched: ["appointment_pitched", "appointment_booked", "qualifying", "opted_out"],
  appointment_booked: ["appointment_booked"],
  opted_out: ["opted_out"],
};

// ── Deterministic YES / OPT-OUT intent detection ──────────────────────────────
const YES_PATTERNS = /^\s*(yes|yeah|yep|yup|ok|okay|sure|haan|ha|ha ji|ha bhai|bilkul|jarur|hanji|ha ji|ek dam|confirm|send|go ahead|👍|✅|interested)\s*[!.]?\s*$/i;
const OPT_OUT_PATTERNS = /\b(stop|unsubscribe|remove me|opt.?out|don.?t contact|nahi|nai|no thanks|not interested|band karo|band kar|hatao)\b/i;

function detectYesIntent(text: string): "yes" | "optout" | "neutral" {
  const trimmed = text.trim();
  if (OPT_OUT_PATTERNS.test(trimmed)) return "optout";
  if (YES_PATTERNS.test(trimmed)) return "yes";
  return "neutral";
}

function guardTransition(current: string, proposed: string): WaState {
  const allowed = ALLOWED_TRANSITIONS[current] ?? [current];
  if (allowed.includes(proposed)) return proposed as WaState;
  logger.warn({ current, proposed }, "WhatsApp: invalid state transition, keeping current");
  return current as WaState;
}

// ── BANT extraction ───────────────────────────────────────────────────────────
interface BantData {
  budget?: string | null;
  authority?: string | null;
  need?: string | null;
  timeline?: string | null;
  bestFitService?: string | null;
  score?: number;
}

async function extractBant(conversationId: number, orgId?: number): Promise<BantData | null> {
  const msgs = await db
    .select()
    .from(whatsappMessages)
    .where(eq(whatsappMessages.conversationId, conversationId))
    .orderBy(whatsappMessages.sentAt);

  const transcript = msgs.map(m => `${m.direction === "inbound" ? "Prospect" : "Mysa"}: ${m.content}`).join("\n");
  if (transcript.length < 50) return null;

  const bantOverrides = orgId != null ? await fetchOrgOverrides(orgId) : {};
  try {
    const msg = await anthropic.messages.create({
      model: getModel("bantb_scoring", bantOverrides),
      max_tokens: 512,
      messages: [{
        role: "user",
        content: `You are Mysa AI, the Sales Intelligence Brain for Dreamsdesign — a full-service digital agency offering Website Development, Performance Marketing (Meta + Google Ads), SEO, Social Media Management, WhatsApp Marketing Automation, Enterprise AI Implementation, SaaS Product Development, Healthcare Marketing (MedX), Branding, and Marketing Automation & CRM Setup.

Extract BANT qualification data from this WhatsApp sales conversation. Also identify which Dreamsdesign service best matches their need.

Return ONLY valid JSON (no markdown, no explanation) with these exact fields (use null if not mentioned):
{
  "budget": "their stated or implied budget range",
  "authority": "their decision-making role or authority level",
  "need": "specific business pain point or goal — be specific",
  "timeline": "when they want to start or see results",
  "bestFitService": "the single most relevant Dreamsdesign service name",
  "score": 0-100
}

Transcript:
${transcript.slice(-3000)}`,
      }],
    });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    void logAnthropicUsage({ model: getModel("bantb_scoring", bantOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "whatsapp_bant", orgId: orgId ?? null });
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as BantData;
  } catch (e) {
    logger.error({ err: e }, "BANT extraction error");
  }
  return null;
}

// ── Report delivery prompt (used in deterministic YES gate) ──────────────────
function buildReportDeliveryPrompt(
  lead: typeof leads.$inferSelect,
  conv: typeof whatsappConversations.$inferSelect,
  settings: WaSettings,
  auditSummary: string | null,
): string {
  const lang = LANG_NAMES[conv.language] ?? "English";
  const kb = getDreamsdesignKnowledgeBase();
  return `${kb}

═══════════════════════════════════════════════════════════════
  CURRENT TASK: DELIVER THE FREE AUDIT REPORT
═══════════════════════════════════════════════════════════════

The prospect *${lead.firstName}* (${lead.designation} at *${lead.company}*, industry: ${lead.industry}) just said YES to receive their free business audit report. You promised them this in the hook message.

LANGUAGE RULE (CRITICAL): Reply ONLY in ${lang}. Use the correct script (Devanagari for Hindi/Marathi, Gujarati script for Gujarati). Never romanize.

Your task:
1. Acknowledge their YES warmly — they made a great decision
2. Deliver the audit findings below in a WhatsApp-friendly format (use *bold* for emphasis, line breaks between points)
3. Keep it under 200 words
4. End by introducing yourself: "I'm Mysa, Krishna Puranik's AI Sales Advisor at Dreamsdesign" and ask ONE open-ended question about their single biggest business challenge right now

Audit findings for ${lead.company}:
${auditSummary ?? `We found several growth opportunities for ${lead.company} in the ${lead.industry} space — from digital visibility gaps to lead conversion bottlenecks. Most businesses in this space are leaving 40-60% of potential revenue on the table due to lack of a proper digital system.`}

Reply with ONLY the WhatsApp message text — no JSON, no labels, no explanations.`;
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(
  lead: typeof leads.$inferSelect,
  conv: typeof whatsappConversations.$inferSelect,
  settings: WaSettings,
  auditSummary: string | null,
): string {
  const lang = LANG_NAMES[conv.language] ?? "English";
  const consultant = settings.consultantName ?? "Krishna Puranik";
  const bookingLink = settings.bookingUrl ?? "[booking link not configured]";
  const portfolio = settings.portfolioUrl ?? null;
  const caseStudy = settings.caseStudyUrl ?? null;
  const companyProfile = settings.companyProfileUrl ?? null;
  const refs = (settings.referenceSites ?? []).join(", ");
  const meta = conv.metadata as Record<string, unknown>;
  const bant = meta.bant as BantData | undefined;
  const kb = getDreamsdesignKnowledgeBase();

  return `${kb}

═══════════════════════════════════════════════════════════════
  ACTIVE WHATSAPP CONVERSATION CONTEXT
═══════════════════════════════════════════════════════════════

You are currently in a live WhatsApp conversation. Respond as Mysa AI — warm, 
consultative, and knowledgeable — exactly as Krishna Puranik would speak.

PROSPECT: ${lead.firstName} ${lead.lastName}
ROLE: ${lead.designation}
COMPANY: ${lead.company}
INDUSTRY: ${lead.industry}
COUNTRY: ${lead.country}

LANGUAGE RULE (NON-NEGOTIABLE): Respond ONLY in ${lang}. Use the actual script 
(Devanagari for Hindi/Marathi, Gujarati script for Gujarati). Never romanize.

CONVERSATION STATE: ${conv.state}
BANT PROGRESS:
  - Budget: ${bant?.budget ?? "not yet discussed"}
  - Authority: ${bant?.authority ?? "not yet discussed"}
  - Need: ${bant?.need ?? "not yet discussed"}
  - Timeline: ${bant?.timeline ?? "not yet discussed"}

STATE MACHINE (follow this exact flow):
1. hook_sent → awaiting_yes: Hook was sent. Await a YES or positive engagement signal.
2. awaiting_yes → report_sent: On YES/interest, deliver the personalized audit summary.
3. report_sent → qualifying: After the report, ask one open-ended question about their biggest challenge.
4. qualifying: Run a natural BANT discovery conversation. Ask maximum ONE question per message.
5. qualifying → appointment_pitched: Once need + timeline are clear, pitch a strategy call with ${consultant}.
6. appointment_pitched → appointment_booked: Share the booking link and confirm the appointment.

ALLOWED NEXT STATES FROM "${conv.state}": ${(ALLOWED_TRANSITIONS[conv.state] ?? [conv.state]).join(", ")}

CONTENT RESOURCES (share when relevant — never dump all at once):
${portfolio ? `- Portfolio: ${portfolio}` : "- Portfolio: not configured"}
${caseStudy ? `- Case Study: ${caseStudy}` : "- Case Study: not configured"}
${companyProfile ? `- Company Profile: ${companyProfile}` : "- Company Profile: not configured"}
${refs ? `- Reference Sites: ${refs}` : ""}
- Booking Link for ${consultant}: ${bookingLink}

PERSONALIZED AUDIT FINDINGS FOR ${lead.company}:
${auditSummary ?? `No formal audit available yet. Draw from your knowledge of challenges common in the ${lead.industry} industry — digital visibility gaps, lead conversion bottlenecks, and lack of a structured marketing system are the most common issues.`}

ICP IDENTIFICATION (use this during qualifying to personalize your approach):
${getIcpIdentificationPrompt()}

RESPONSE RULES:
- Keep replies under 100 words for qualifying/pitch messages
- Keep replies under 200 words when delivering the audit report
- Use *bold* (single asterisk) for emphasis — this renders in WhatsApp
- End with exactly ONE question or ONE clear CTA — never both
- If prospect says STOP, UNSUBSCRIBE, नहीं, band karo, or similar: set nextState to "opted_out"
- Include the booking link as plain text when pitching the appointment
- Match the energy level of the prospect — mirror their warmth or formality
- When handling objections, use the objection handlers from the knowledge base above

RESPOND ONLY WITH VALID JSON (no markdown fences, no explanations outside the JSON):
{
  "reply": "the WhatsApp message text",
  "nextState": "${conv.state}",
  "detectedLanguage": "english",
  "shouldSendPortfolio": false,
  "shouldSendCaseStudy": false,
  "shouldSendBookingLink": false
}

Valid nextState values: ${Object.keys(ALLOWED_TRANSITIONS).join(", ")}`;
}

async function getAuditSummary(leadId: number): Promise<string | null> {
  try {
    const [latestRun] = await db
      .select({ summary: auditRuns.aiReport, healthScore: auditRuns.healthScore })
      .from(auditRuns)
      .where(eq(auditRuns.leadId, leadId))
      .orderBy(desc(auditRuns.createdAt))
      .limit(1);
    if (!latestRun) return null;
    const scoreStr = latestRun.healthScore != null ? ` (Health Score: ${latestRun.healthScore}/100)` : "";
    return latestRun.summary ? `${latestRun.summary}${scoreStr}` : null;
  } catch {
    return null;
  }
}

interface AiResponse {
  reply: string;
  nextState: WaState;
  detectedLanguage: string;
  shouldSendPortfolio: boolean;
  shouldSendCaseStudy: boolean;
  shouldSendBookingLink: boolean;
}

function parseAiResponse(raw: string, currentState: string): AiResponse {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return {
        reply: typeof parsed.reply === "string" ? parsed.reply : "Thank you for your message!",
        nextState: guardTransition(currentState, parsed.nextState ?? currentState),
        detectedLanguage: typeof parsed.detectedLanguage === "string" ? parsed.detectedLanguage : "english",
        shouldSendPortfolio: Boolean(parsed.shouldSendPortfolio),
        shouldSendCaseStudy: Boolean(parsed.shouldSendCaseStudy),
        shouldSendBookingLink: Boolean(parsed.shouldSendBookingLink),
      };
    } catch { /* fall through */ }
  }
  return {
    reply: "Thank you for your message! We'll get back to you shortly.",
    nextState: currentState as WaState,
    detectedLanguage: "english",
    shouldSendPortfolio: false,
    shouldSendCaseStudy: false,
    shouldSendBookingLink: false,
  };
}

async function buildConversationHistory(conversationId: number) {
  const msgs = await db
    .select()
    .from(whatsappMessages)
    .where(eq(whatsappMessages.conversationId, conversationId))
    .orderBy(whatsappMessages.sentAt);

  return msgs.slice(-20).map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant" as "user" | "assistant",
    content: m.content,
  }));
}

// ── Main AI pipeline ──────────────────────────────────────────────────────────
export async function processInboundMessage(conversationId: number): Promise<void> {
  const [conv] = await db
    .select()
    .from(whatsappConversations)
    .where(eq(whatsappConversations.id, conversationId));
  if (!conv) return;

  const [lead] = await db.select().from(leads).where(eq(leads.id, conv.leadId));
  if (!lead) return;

  const waOverrides = await fetchOrgOverrides(lead.orgId ?? 0);
  const settings = await getWaSettings();
  if (!settings) {
    logger.error("WhatsApp settings not configured — cannot process inbound message");
    return;
  }

  // ── Deterministic pre-AI gate ─────────────────────────────────────────────
  // Get the last inbound message text for intent detection
  const [lastInbound] = await db
    .select()
    .from(whatsappMessages)
    .where(eq(whatsappMessages.conversationId, conversationId))
    .orderBy(desc(whatsappMessages.sentAt))
    .limit(1);

  const lastText = lastInbound?.direction === "inbound" ? lastInbound.content : "";
  const intent = detectYesIntent(lastText);

  // Opt-out: immediately acknowledge and close the conversation
  if (intent === "optout") {
    const optOutReply = "Understood — I've removed you from our list. No more messages from us. Take care! 🙏";
    const [outboundRecord] = await db.insert(whatsappMessages).values({
      conversationId, direction: "outbound", content: optOutReply, waMessageId: null,
    }).returning();
    const sendResult = await sendWhatsAppMessage(settings, conv.waPhoneNumber, optOutReply);
    if (sendResult.waMessageId) {
      await db.update(whatsappMessages).set({ waMessageId: sendResult.waMessageId }).where(eq(whatsappMessages.id, outboundRecord.id));
    }
    await db.update(whatsappConversations).set({ state: "opted_out", updatedAt: new Date() }).where(eq(whatsappConversations.id, conversationId));
    return;
  }

  // YES in hook_sent or awaiting_yes state → deterministically deliver the report
  if (intent === "yes" && (conv.state === "hook_sent" || conv.state === "awaiting_yes")) {
    const auditSummary = await getAuditSummary(lead.id);
    const reportPrompt = buildReportDeliveryPrompt(lead, conv, settings, auditSummary);

    let reportReply = "";
    try {
      const msg = await anthropic.messages.create({
        model: getModel("outreach_email", waOverrides),
        max_tokens: 1024,
        messages: [{ role: "user", content: reportPrompt }],
      });
      reportReply = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
      void logAnthropicUsage({ model: getModel("outreach_email", waOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "whatsapp_report", orgId: lead.orgId });
    } catch (e) {
      logger.error({ err: e }, "Claude error (report delivery)");
    }

    if (!reportReply) {
      reportReply = `Great! Here's a quick overview of what we found for *${lead.company}*:\n\n${auditSummary ?? "Your digital presence has several opportunities for improvement. We'd love to walk you through the details!"}\n\nI'm Mysa, your Dreamsdesign advisor. What's the biggest challenge your business is facing right now?`;
    }

    const [outboundRecord] = await db.insert(whatsappMessages).values({
      conversationId, direction: "outbound", content: reportReply, waMessageId: null,
    }).returning();
    const sendResult = await sendWhatsAppMessage(settings, conv.waPhoneNumber, reportReply);
    if (sendResult.waMessageId) {
      await db.update(whatsappMessages).set({ waMessageId: sendResult.waMessageId }).where(eq(whatsappMessages.id, outboundRecord.id));
    }
    await db.update(whatsappConversations)
      .set({ state: "report_sent", updatedAt: new Date() })
      .where(eq(whatsappConversations.id, conversationId));
    return;
  }

  // ── Normal AI pipeline for all other cases ────────────────────────────────
  const auditSummary = await getAuditSummary(lead.id);
  const history = await buildConversationHistory(conversationId);
  const systemPrompt = buildSystemPrompt(lead, conv, settings, auditSummary);

  let raw = "";
  try {
    const msg = await anthropic.messages.create({
      model: getModel("whatsapp_message", waOverrides),
      max_tokens: 1024,
      system: withCache(systemPrompt),
      messages: history.length > 0 ? history : [{ role: "user", content: "YES" }],
    });
    raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    void logAnthropicUsage({ model: getModel("whatsapp_message", waOverrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "whatsapp_reply", orgId: lead.orgId });
  } catch (e) {
    logger.error({ err: e }, "Claude error in WhatsApp pipeline");
    return;
  }

  const parsed = parseAiResponse(raw, conv.state);

  // Detect language change
  const newLanguage = parsed.detectedLanguage !== conv.language && parsed.detectedLanguage
    ? parsed.detectedLanguage : conv.language;

  // Store outbound message record BEFORE sending (audit completeness)
  const [outboundRecord] = await db.insert(whatsappMessages).values({
    conversationId,
    direction: "outbound",
    content: parsed.reply,
    waMessageId: null,
  }).returning();

  // Send to Meta and update waMessageId on success
  const sendResult = await sendWhatsAppMessage(settings, conv.waPhoneNumber, parsed.reply);
  if (sendResult.waMessageId) {
    await db.update(whatsappMessages)
      .set({ waMessageId: sendResult.waMessageId })
      .where(eq(whatsappMessages.id, outboundRecord.id));
  }

  // Extra content (portfolio, case study, booking link)
  const extraMessages: string[] = [];
  if (parsed.shouldSendPortfolio && settings.portfolioUrl) {
    extraMessages.push(`📁 *Our Portfolio*: ${settings.portfolioUrl}`);
  }
  if (parsed.shouldSendCaseStudy && settings.caseStudyUrl) {
    extraMessages.push(`📊 *Case Study*: ${settings.caseStudyUrl}`);
  }
  if (parsed.shouldSendBookingLink && settings.bookingUrl) {
    extraMessages.push(`📅 *Book a call with ${settings.consultantName ?? "Krishna Puranik"}*: ${settings.bookingUrl}`);
  }

  for (const extra of extraMessages) {
    await new Promise(r => setTimeout(r, 800));
    const [extraRecord] = await db.insert(whatsappMessages).values({
      conversationId,
      direction: "outbound",
      content: extra,
      waMessageId: null,
    }).returning();
    const extraSend = await sendWhatsAppMessage(settings, conv.waPhoneNumber, extra);
    if (extraSend.waMessageId) {
      await db.update(whatsappMessages)
        .set({ waMessageId: extraSend.waMessageId })
        .where(eq(whatsappMessages.id, extraRecord.id));
    }
  }

  // Run BANT extraction in qualifying+ states
  let bantData: BantData | null = null;
  const bantStates = ["qualifying", "appointment_pitched", "appointment_booked"];
  if (bantStates.includes(parsed.nextState)) {
    bantData = await extractBant(conversationId, lead.orgId ?? undefined);
  }

  // Persist updated conversation state
  const existingMeta = (conv.metadata as Record<string, unknown>) ?? {};
  const updatedMeta: Record<string, unknown> = {
    ...existingMeta,
    ...(bantData ? { bant: bantData } : {}),
  };

  await db
    .update(whatsappConversations)
    .set({
      state: parsed.nextState,
      language: newLanguage,
      metadata: updatedMeta,
      updatedAt: new Date(),
    })
    .where(eq(whatsappConversations.id, conversationId));

  // Backfill lead BANT if extracted
  if (bantData) {
    const leadUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (bantData.score != null) leadUpdates.bantScore = bantData.score;
    const { score: _s, ...bantBreakdown } = bantData;
    leadUpdates.bantBreakdown = bantBreakdown;
    await db.update(leads).set(leadUpdates).where(eq(leads.id, lead.id));
  }

  // Update lead status on terminal states
  if (parsed.nextState === "appointment_booked" && lead.status !== "qualified") {
    await db.update(leads).set({ status: "qualified", updatedAt: new Date() }).where(eq(leads.id, lead.id));
  }
}

// ── Language detection ────────────────────────────────────────────────────────
export async function detectLanguage(text: string): Promise<string> {
  try {
    const msg = await anthropic.messages.create({
      model: getModel("whatsapp_message"),
      max_tokens: 64,
      messages: [{
        role: "user",
        content: `Detect the primary language of this text. Reply with ONLY one word: english, hindi, gujarati, or marathi.\n\nText: "${text.slice(0, 300)}"`,
      }],
    });
    const raw = (msg.content[0]?.type === "text" ? msg.content[0].text : "english").toLowerCase().trim();
    void logAnthropicUsage({ model: getModel("whatsapp_message"), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "whatsapp_lang", orgId: null });
    if (["english", "hindi", "gujarati", "marathi"].includes(raw)) return raw;
    return "english";
  } catch {
    return "english";
  }
}

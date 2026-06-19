import { Router, type Request, type Response } from "express";
import { featureGuard } from "../middlewares/planGuard";
import { db } from "../lib/db";
import {
  leads, leadBrainMemory, touchpoints, outreachEmails,
  meetings, appointments, meetingTranscripts,
  whatsappConversations, whatsappMessages,
} from "@workspace/db/schema";
import { eq, desc, and, or } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides, withCache } from "../config/modelRouting";
import { logAnthropicUsage } from "../lib/logApiUsage";

const router = Router();

// ── List all leads with their brain memory status ─────────────────────────────
router.get("/brain/leads", featureGuard("sales_brain"), async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.orgId;
  const allLeads = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      phone: leads.phone,
      whatsapp: leads.whatsapp,
      company: leads.company,
      designation: leads.designation,
      industry: leads.industry,
      country: leads.country,
      city: leads.city,
      website: leads.website,
      bantScore: leads.bantScore,
      status: leads.status,
      photoUrl: leads.photoUrl,
      companyLogo: leads.companyLogo,
      linkedInUrl: leads.linkedInUrl,
      tags: leads.tags,
      notes: leads.notes,
      lastContactedAt: leads.lastContactedAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.orgId, orgId))
    .orderBy(desc(leads.updatedAt));

  const memories = await db.select().from(leadBrainMemory).where(eq(leadBrainMemory.orgId, orgId));
  const memMap = new Map(memories.map(m => [m.leadId, m]));

  const result = allLeads.map(l => ({
    ...l,
    brain: memMap.get(l.id) ?? null,
    hasBrain: memMap.has(l.id),
  }));

  res.json(result);
});

// ── Get full context for one lead ─────────────────────────────────────────────
router.get("/brain/leads/:id/context", featureGuard("sales_brain"), async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [memory] = await db.select().from(leadBrainMemory).where(and(eq(leadBrainMemory.leadId, id), eq(leadBrainMemory.orgId, orgId)));

  // Emails sent via touchpoints (touchpoints scoped transitively via verified lead)
  const emailTouchpoints = await db
    .select()
    .from(touchpoints)
    .where(eq(touchpoints.leadId, id))
    .orderBy(desc(touchpoints.createdAt));

  // Outreach emails
  const sentEmails = await db
    .select()
    .from(outreachEmails)
    .where(and(eq(outreachEmails.leadId, id), eq(outreachEmails.orgId, orgId)))
    .orderBy(desc(outreachEmails.sentAt));

  // Meetings (scoped transitively via verified lead)
  const leadMeetings = await db
    .select()
    .from(meetings)
    .where(eq(meetings.leadId, id))
    .orderBy(desc(meetings.scheduledAt));

  // Appointments
  const leadAppts = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.email, lead.email), eq(appointments.orgId, orgId)))
    .orderBy(desc(appointments.createdAt));

  // WhatsApp conversations
  const waConvs = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.orgId, orgId),
        or(
          eq(whatsappConversations.leadId, id),
          lead.whatsapp ? eq(whatsappConversations.waPhoneNumber, lead.whatsapp) : undefined
        )
      )
    );

  // WhatsApp messages for those conversations
  let waMessages: (typeof whatsappMessages.$inferSelect)[] = [];
  if (waConvs.length > 0) {
    const convIds = waConvs.map(c => c.id);
    const msgs = await Promise.all(
      convIds.map(cid =>
        db.select().from(whatsappMessages).where(eq(whatsappMessages.conversationId, cid)).orderBy(desc(whatsappMessages.sentAt))
      )
    );
    waMessages = msgs.flat();
  }

  // Meeting transcripts — guard or() against empty-array collapse
  const transcriptConditions = [
    ...leadMeetings.map(m => eq(meetingTranscripts.meetingId, m.id)),
    ...leadAppts.map(a => eq(meetingTranscripts.appointmentId, a.id)),
  ];
  const transcripts = transcriptConditions.length > 0
    ? await db.select().from(meetingTranscripts).where(or(...transcriptConditions))
    : [];

  res.json({
    lead,
    memory: memory ?? null,
    context: {
      touchpoints: emailTouchpoints,
      sentEmails,
      meetings: leadMeetings,
      appointments: leadAppts,
      waConversations: waConvs,
      waMessages,
      transcripts,
    },
  });
});

// ── Refresh / generate AI memory for a lead ───────────────────────────────────
router.post("/brain/leads/:id/memory", featureGuard("sales_brain"), async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // Gather all data (scoped to org via lead ownership or direct orgId filter)
  const emailTouchpoints = await db.select().from(touchpoints).where(eq(touchpoints.leadId, id)).orderBy(desc(touchpoints.createdAt));
  const sentEmails = await db.select().from(outreachEmails).where(and(eq(outreachEmails.leadId, id), eq(outreachEmails.orgId, orgId))).orderBy(desc(outreachEmails.sentAt));
  const leadMeetings = await db.select().from(meetings).where(eq(meetings.leadId, id)).orderBy(desc(meetings.scheduledAt));
  const leadAppts = await db.select().from(appointments).where(and(eq(appointments.email, lead.email), eq(appointments.orgId, orgId))).orderBy(desc(appointments.createdAt));
  const waConvs = await db.select().from(whatsappConversations).where(
    and(
      eq(whatsappConversations.orgId, orgId),
      or(
        eq(whatsappConversations.leadId, id),
        lead.whatsapp ? eq(whatsappConversations.waPhoneNumber, lead.whatsapp) : undefined
      )
    )
  );
  let waMessages: (typeof whatsappMessages.$inferSelect)[] = [];
  if (waConvs.length > 0) {
    const msgs = await Promise.all(
      waConvs.map(c => db.select().from(whatsappMessages).where(eq(whatsappMessages.conversationId, c.id)).orderBy(desc(whatsappMessages.sentAt)))
    );
    waMessages = msgs.flat().slice(0, 80);
  }
  const transcriptConditions2 = [
    ...leadMeetings.map(m => eq(meetingTranscripts.meetingId, m.id)),
    ...leadAppts.map(a => eq(meetingTranscripts.appointmentId, a.id)),
  ];
  const transcripts = transcriptConditions2.length > 0
    ? await db.select().from(meetingTranscripts).where(or(...transcriptConditions2))
    : [];

  const [existingMemory] = await db.select().from(leadBrainMemory).where(and(eq(leadBrainMemory.leadId, id), eq(leadBrainMemory.orgId, orgId)));
  const manualNotes = existingMemory?.manualNotes ?? null;

  const contextBlock = buildContextBlock(lead, emailTouchpoints, sentEmails, leadMeetings, leadAppts, waConvs, waMessages, transcripts);
  const overrides = await fetchOrgOverrides(orgId);

  const prompt = `You are Sales Brain — the AI intelligence layer of Mysa AI, a B2B sales platform built for Dreamsdesign agency.

You have been given ALL interaction data for a specific lead. Your job is to build a comprehensive memory profile so you can help close this deal.

${contextBlock}

Return ONLY valid JSON (no markdown):
{
  "aiSummary": "3-4 sentence executive summary: who is this person, where they are in the sales journey, what they need, what's blocking them",
  "dealInsights": "Key deal intelligence: budget signals, decision-making authority, urgency level, objections raised, buying signals seen",
  "nextBestAction": "Single most impactful action to take RIGHT NOW to move this deal forward — be specific",
  "personalityProfile": "Communication style, tone preferences, how to approach this person, what resonates with them based on their messages"
}`;

  const msg = await anthropic.messages.create({
    model: getModel("sales_brain_query", overrides),
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  void logAnthropicUsage({ model: getModel("sales_brain_query", overrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "sales_brain_query", orgId });
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed: Record<string, string> = {};
  try { if (match) parsed = JSON.parse(match[0]); } catch { /* defaults */ }

  const now = new Date();
  let memory: typeof leadBrainMemory.$inferSelect;

  if (existingMemory) {
    const [updated] = await db.update(leadBrainMemory).set({
      aiSummary: parsed.aiSummary ?? null,
      dealInsights: parsed.dealInsights ?? null,
      nextBestAction: parsed.nextBestAction ?? null,
      personalityProfile: parsed.personalityProfile ?? null,
      manualNotes,
      lastSyncAt: now,
      updatedAt: now,
    }).where(and(eq(leadBrainMemory.leadId, id), eq(leadBrainMemory.orgId, orgId))).returning();
    memory = updated;
  } else {
    const [created] = await db.insert(leadBrainMemory).values({
      orgId,
      leadId: id,
      aiSummary: parsed.aiSummary ?? null,
      dealInsights: parsed.dealInsights ?? null,
      nextBestAction: parsed.nextBestAction ?? null,
      personalityProfile: parsed.personalityProfile ?? null,
      manualNotes,
      lastSyncAt: now,
    }).returning();
    memory = created;
  }

  res.json({ memory, raw: parsed });
});

// ── Save manual notes ─────────────────────────────────────────────────────────
router.patch("/brain/leads/:id/notes", featureGuard("sales_brain"), async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const { manualNotes } = req.body as { manualNotes?: string };

  const [existing] = await db.select().from(leadBrainMemory).where(and(eq(leadBrainMemory.leadId, id), eq(leadBrainMemory.orgId, orgId)));
  const now = new Date();

  let memory: typeof leadBrainMemory.$inferSelect;
  if (existing) {
    const [updated] = await db.update(leadBrainMemory).set({ manualNotes: manualNotes ?? null, updatedAt: now }).where(and(eq(leadBrainMemory.leadId, id), eq(leadBrainMemory.orgId, orgId))).returning();
    memory = updated;
  } else {
    const [created] = await db.insert(leadBrainMemory).values({ orgId, leadId: id, manualNotes: manualNotes ?? null }).returning();
    memory = created;
  }

  res.json({ memory });
});

// ── AI Chat with full lead context ────────────────────────────────────────────
router.post("/brain/leads/:id/chat", featureGuard("sales_brain"), async (req: Request, res: Response): Promise<void> => {
  const id    = Number(req.params.id);
  const orgId = req.user!.orgId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { message, history = [] } = req.body as {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!message?.trim()) { res.status(400).json({ error: "Message required" }); return; }

  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, orgId)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [memory] = await db.select().from(leadBrainMemory).where(and(eq(leadBrainMemory.leadId, id), eq(leadBrainMemory.orgId, orgId)));

  // Gather recent interactions for context (lightweight for chat)
  const emailTouchpoints = await db.select().from(touchpoints).where(and(eq(touchpoints.leadId, id))).orderBy(desc(touchpoints.createdAt)).limit(20);
  const sentEmails = await db.select().from(outreachEmails).where(and(eq(outreachEmails.leadId, id), eq(outreachEmails.orgId, orgId))).orderBy(desc(outreachEmails.sentAt)).limit(15);
  const leadMeetings = await db.select().from(meetings).where(eq(meetings.leadId, id)).orderBy(desc(meetings.scheduledAt)).limit(10);
  const leadAppts = await db.select().from(appointments).where(and(eq(appointments.email, lead.email), eq(appointments.orgId, orgId))).orderBy(desc(appointments.createdAt)).limit(5);

  const waConvs = await db.select().from(whatsappConversations).where(
    and(
      eq(whatsappConversations.orgId, orgId),
      or(
        eq(whatsappConversations.leadId, id),
        lead.whatsapp ? eq(whatsappConversations.waPhoneNumber, lead.whatsapp) : undefined
      )
    )
  );
  let waMessages: (typeof whatsappMessages.$inferSelect)[] = [];
  if (waConvs.length > 0) {
    const msgs = await Promise.all(
      waConvs.map(c => db.select().from(whatsappMessages).where(eq(whatsappMessages.conversationId, c.id)).orderBy(desc(whatsappMessages.sentAt)).limit(30))
    );
    waMessages = msgs.flat();
  }

  const transcriptConditions3 = [
    ...leadMeetings.map(m => eq(meetingTranscripts.meetingId, m.id)),
    ...leadAppts.map(a => eq(meetingTranscripts.appointmentId, a.id)),
  ];
  const transcripts = transcriptConditions3.length > 0
    ? await db.select().from(meetingTranscripts).where(or(...transcriptConditions3))
    : [];

  const contextBlock = buildContextBlock(lead, emailTouchpoints, sentEmails, leadMeetings, leadAppts, waConvs, waMessages, transcripts);

  const systemPrompt = `You are Sales Brain — the AI deal-closing intelligence of Mysa AI, Dreamsdesign's B2B sales platform.

You have perfect memory of every interaction with this lead. Use this knowledge to answer any question, draft messages, suggest strategies, and help close the deal.

YOUR KNOWLEDGE BASE FOR THIS LEAD:
${contextBlock}

${memory ? `
AI MEMORY SUMMARY:
${memory.aiSummary ?? ""}

DEAL INSIGHTS:
${memory.dealInsights ?? ""}

NEXT BEST ACTION:
${memory.nextBestAction ?? ""}

PERSONALITY PROFILE:
${memory.personalityProfile ?? ""}

MANUAL NOTES:
${memory.manualNotes ?? "No manual notes yet"}
` : "No memory profile generated yet — answer based on raw data above."}

GUIDELINES:
- Be direct, confident, and actionable
- Reference specific past interactions when relevant ("In your WhatsApp conversation on [date]...")
- Draft actual messages when asked (WhatsApp, email, LinkedIn)
- Identify deal blockers and suggest ways to overcome them
- Krish Puranik is the founder/CEO of Dreamsdesign — speak on his behalf when drafting messages`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-10),
    { role: "user", content: message },
  ];

  const chatOverrides = await fetchOrgOverrides(orgId);
  const response = await anthropic.messages.create({
    model: getModel("sales_brain_query", chatOverrides),
    max_tokens: 1000,
    system: withCache(systemPrompt),
    messages,
  });

  const reply = response.content[0]?.type === "text" ? response.content[0].text : "Sorry, I couldn't generate a response.";
  void logAnthropicUsage({ model: getModel("sales_brain_query", chatOverrides), inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, feature: "sales_brain_chat", orgId });
  res.json({ reply });
});

// ── Context builder helper ────────────────────────────────────────────────────
function buildContextBlock(
  lead: typeof leads.$inferSelect,
  emailTouchpoints: (typeof touchpoints.$inferSelect)[],
  sentEmails: (typeof outreachEmails.$inferSelect)[],
  leadMeetings: (typeof meetings.$inferSelect)[],
  leadAppts: (typeof appointments.$inferSelect)[],
  waConvs: (typeof whatsappConversations.$inferSelect)[],
  waMessages: (typeof whatsappMessages.$inferSelect)[],
  transcripts: (typeof meetingTranscripts.$inferSelect)[]
): string {
  const parts: string[] = [];

  parts.push(`LEAD PROFILE:
Name: ${lead.firstName} ${lead.lastName}
Company: ${lead.company} (${lead.industry})
Designation: ${lead.designation}
Email: ${lead.email}
Phone: ${lead.phone ?? "N/A"} | WhatsApp: ${lead.whatsapp ?? "N/A"}
Location: ${lead.city ?? ""}, ${lead.country}
BANT Score: ${lead.bantScore ?? "Not scored"}/100
Status: ${lead.status}
Tags: ${(lead.tags ?? []).join(", ") || "None"}
Notes: ${lead.notes ?? "None"}
Last Contacted: ${lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString() : "Never"}`);

  if (waMessages.length > 0) {
    const recent = waMessages.slice(0, 50).reverse();
    parts.push(`\nWHATSAPP CONVERSATION (${waMessages.length} messages total, showing ${Math.min(50, waMessages.length)} most recent):
${recent.map(m => `[${new Date(m.sentAt!).toLocaleString()}] ${m.direction === "outbound" ? "US →" : "← LEAD"}: ${m.content}`).join("\n")}`);
  }

  if (emailTouchpoints.length > 0 || sentEmails.length > 0) {
    const allEmails = [
      ...emailTouchpoints.filter(t => t.status === "sent").map(t => ({
        date: t.sentAt ?? t.createdAt,
        subject: t.subject ?? "(no subject)",
        snippet: (t.body ?? "").substring(0, 200),
        type: "sequence",
      })),
      ...sentEmails.map(e => ({
        date: e.sentAt ?? e.createdAt,
        subject: e.subject ?? "(no subject)",
        snippet: (e.body ?? "").substring(0, 200),
        type: "outreach",
      })),
    ].sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime()).slice(0, 20);

    if (allEmails.length > 0) {
      parts.push(`\nEMAILS SENT (${allEmails.length}):
${allEmails.map(e => `[${new Date(e.date!).toLocaleDateString()}] "${e.subject}" — ${e.snippet}`).join("\n")}`);
    }
  }

  if (leadMeetings.length > 0 || leadAppts.length > 0) {
    const allMeetings = [
      ...leadMeetings.map(m => ({
        date: m.scheduledAt,
        label: m.type?.replace(/_/g, " ") ?? "Meeting",
        status: m.status,
        url: m.meetingUrl,
      })),
      ...leadAppts.map(a => ({
        date: new Date(`${a.scheduledDate}T${a.scheduledTime}`),
        label: "Discovery Call",
        status: a.status ?? "scheduled",
        url: a.meetingLink,
      })),
    ].sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());

    parts.push(`\nMEETINGS (${allMeetings.length}):
${allMeetings.map(m => `[${new Date(m.date!).toLocaleDateString()}] ${m.label} — Status: ${m.status}`).join("\n")}`);
  }

  if (transcripts.length > 0) {
    parts.push(`\nMEETING TRANSCRIPTS (${transcripts.length}):
${transcripts.map(t => `--- Transcript (${new Date(t.fetchedAt ?? t.createdAt).toLocaleDateString()}) ---
${t.rawTranscript ? t.rawTranscript.substring(0, 1500) : "(transcript pending)"}
Summary: ${t.summary ?? "Not analyzed yet"}
Action Items: ${t.actionItems ?? "None"}`).join("\n\n")}`);
  }

  return parts.join("\n");
}

export default router;

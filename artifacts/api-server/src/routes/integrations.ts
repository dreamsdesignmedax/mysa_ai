import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { meetingTranscripts, meetings, appointments, leads } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { isGoogleCalendarConnected } from "../lib/google-calendar";
import { syncMeetingToCalendar, syncAppointmentToCalendar } from "../lib/calendar-sync";
import { logger } from "../lib/logger";
import sanitizeHtml from "sanitize-html";

const PROPOSAL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "ul", "ol", "li",
    "strong", "b", "em", "i", "u", "s",
    "table", "thead", "tbody", "tr", "th", "td",
    "blockquote", "pre", "code",
    "div", "span", "section", "article", "header", "footer",
    "a",
  ],
  allowedAttributes: {
    "a": ["href", "title", "target", "rel"],
    "th": ["colspan", "rowspan"],
    "td": ["colspan", "rowspan"],
    "*": ["class", "id", "style"],
  },
  allowedStyles: {
    "*": {
      "color": [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(\d+,\s*\d+,\s*\d+\)$/],
      "background-color": [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(\d+,\s*\d+,\s*\d+\)$/],
      "font-weight": [/^(bold|normal|\d+)$/],
      "font-style": [/^(italic|normal)$/],
      "text-align": [/^(left|center|right|justify)$/],
      "text-decoration": [/^(none|underline|line-through)$/],
      "margin": [/^[\d.]+(px|em|rem|%)(\s+[\d.]+(px|em|rem|%))*$/],
      "padding": [/^[\d.]+(px|em|rem|%)(\s+[\d.]+(px|em|rem|%))*$/],
    },
  },
  allowedSchemes: ["https", "mailto"],
  disallowedTagsMode: "discard",
};

const router = Router();

// ── GOOGLE STATUS (via Replit Connector — no manual OAuth needed) ─────────────
router.get("/integrations/google/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const connected = await isGoogleCalendarConnected();
    res.json({ connected, managedBy: "replit-connector" });
  } catch {
    res.json({ connected: false, managedBy: "replit-connector" });
  }
});

// ── HUBSPOT STATUS (via Replit Connector) ────────────────────────────────────
router.get("/integrations/hubspot/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const { ReplitConnectors } = await import("@replit/connectors-sdk");
    const connectors = new ReplitConnectors();
    const r = await connectors.proxy("hubspot", "/crm/v3/objects/contacts?limit=1");
    res.json({ connected: r.status >= 200 && r.status < 300, managedBy: "replit-connector" });
  } catch {
    res.json({ connected: false, managedBy: "replit-connector" });
  }
});

// ── GOOGLE DISCONNECT (Replit-connector-managed — informs user to revoke in Replit) ──
router.delete("/integrations/google/disconnect", async (_req: Request, res: Response): Promise<void> => {
  res.json({
    ok: false,
    message: "Google Calendar is managed by the Replit connector. To disconnect, revoke access from the Replit Integrations panel.",
    managedBy: "replit-connector",
  });
});

// ── HUBSPOT DISCONNECT (Replit-connector-managed — informs user to revoke in Replit) ──
router.delete("/integrations/hubspot/disconnect", async (_req: Request, res: Response): Promise<void> => {
  res.json({
    ok: false,
    message: "HubSpot is managed by the Replit connector. To disconnect, revoke access from the Replit Integrations panel.",
    managedBy: "replit-connector",
  });
});

// ── GOOGLE SYNC MEETING ───────────────────────────────────────────────────────
router.post("/integrations/sync-meeting/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const [row] = await db.select({ meeting: meetings, lead: leads }).from(meetings).innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId))).where(eq(meetings.id, id));
  if (!row) { res.status(404).json({ error: "Meeting not found" }); return; }

  const eventId = await syncMeetingToCalendar(row.meeting, row.lead);
  if (!eventId) { res.status(400).json({ error: "Google Calendar not connected or sync failed" }); return; }

  if (!row.meeting.googleCalendarEventId) {
    await db.update(meetings).set({ googleCalendarEventId: eventId }).where(eq(meetings.id, id));
  }
  res.json({ ok: true, eventId });
});

// ── GOOGLE SYNC APPOINTMENT ───────────────────────────────────────────────────
router.post("/integrations/sync-appointment/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const [appt] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.orgId, orgId)));
  if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }

  const eventId = await syncAppointmentToCalendar(appt, appt.meetingLink);
  if (!eventId) { res.status(400).json({ error: "Google Calendar not connected or sync failed" }); return; }

  await db.update(appointments).set({ googleCalendarEventId: eventId }).where(eq(appointments.id, id));
  res.json({ ok: true, eventId });
});

// ── GET TRANSCRIPT ────────────────────────────────────────────────────────────
router.get("/transcripts/meeting/:meetingId", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.meetingId);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;
  const [mtg] = await db.select({ id: meetings.id }).from(meetings).innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId))).where(eq(meetings.id, id));
  if (!mtg) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db.select().from(meetingTranscripts).where(eq(meetingTranscripts.meetingId, id));
  res.json(row ?? null);
});

router.get("/transcripts/appointment/:appointmentId", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.appointmentId);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;
  const [appt] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, id), eq(appointments.orgId, orgId)));
  if (!appt) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db.select().from(meetingTranscripts).where(eq(meetingTranscripts.appointmentId, id));
  res.json(row ?? null);
});

// ── SAVE / UPDATE TRANSCRIPT ──────────────────────────────────────────────────
const upsertTranscriptBody = async (
  filter: Parameters<typeof and>[0],
  overrideData: Partial<typeof meetingTranscripts.$inferInsert>,
  rawTranscript: string,
  res: Response
) => {
  const [existing] = await db.select().from(meetingTranscripts).where(filter as import("drizzle-orm").SQL<unknown>);
  if (existing) {
    const [updated] = await db
      .update(meetingTranscripts)
      .set({ rawTranscript, updatedAt: new Date() })
      .where(eq(meetingTranscripts.id, existing.id))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db
      .insert(meetingTranscripts)
      .values({ ...overrideData, rawTranscript, source: "manual" })
      .returning();
    res.json(created);
  }
};

router.post("/transcripts/meeting/:meetingId", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.meetingId);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { rawTranscript } = req.body as { rawTranscript?: string };
  if (!rawTranscript) { res.status(400).json({ error: "rawTranscript required" }); return; }
  const orgId = req.user!.orgId;
  const [mtg] = await db.select({ id: meetings.id }).from(meetings).innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId))).where(eq(meetings.id, id));
  if (!mtg) { res.status(404).json({ error: "Not found" }); return; }
  await upsertTranscriptBody(eq(meetingTranscripts.meetingId, id), { meetingId: id }, rawTranscript, res);
});

router.post("/transcripts/appointment/:appointmentId", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.appointmentId);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { rawTranscript } = req.body as { rawTranscript?: string };
  if (!rawTranscript) { res.status(400).json({ error: "rawTranscript required" }); return; }
  const orgId = req.user!.orgId;
  const [appt] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, id), eq(appointments.orgId, orgId)));
  if (!appt) { res.status(404).json({ error: "Not found" }); return; }
  await upsertTranscriptBody(eq(meetingTranscripts.appointmentId, id), { appointmentId: id }, rawTranscript, res);
});

// ── Helper: verify transcript belongs to org ─────────────────────────────────
async function assertTranscriptOrg(transcriptId: number, orgId: number): Promise<typeof meetingTranscripts.$inferSelect | null> {
  const [row] = await db.select().from(meetingTranscripts).where(eq(meetingTranscripts.id, transcriptId));
  if (!row) return null;
  if (row.meetingId) {
    const [mtg] = await db.select({ id: meetings.id }).from(meetings)
      .innerJoin(leads, and(eq(meetings.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(eq(meetings.id, row.meetingId));
    if (mtg) return row;
  }
  if (row.appointmentId) {
    const [appt] = await db.select({ id: appointments.id }).from(appointments)
      .where(and(eq(appointments.id, row.appointmentId), eq(appointments.orgId, orgId)));
    if (appt) return row;
  }
  return null;
}

// ── AI ANALYZE TRANSCRIPT ─────────────────────────────────────────────────────
router.post("/transcripts/:transcriptId/analyze", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.transcriptId);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const row = await assertTranscriptOrg(id, orgId);
  if (!row) { res.status(404).json({ error: "Transcript not found" }); return; }
  if (!row.rawTranscript) { res.status(400).json({ error: "No transcript text to analyze" }); return; }

  const prompt = `You are an expert B2B sales analyst for Dreamsdesign, a premium design & digital growth agency.

Analyze this sales call transcript and return structured insights:

TRANSCRIPT:
${row.rawTranscript.substring(0, 8000)}

Return ONLY valid JSON (no markdown):
{
  "summary": "3-4 sentence executive summary of what was discussed",
  "actionItems": ["action 1", "action 2", "action 3"],
  "sentiment": "positive|neutral|negative",
  "nextSteps": "specific recommended next steps",
  "painPoints": ["pain 1", "pain 2"],
  "budget": "any budget signals mentioned",
  "timeline": "any timeline mentioned",
  "decisionMaker": "is this person the decision maker?",
  "buyingSignals": ["signal 1", "signal 2"]
}`;

  const overrides = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("sales_brain_query", overrides),
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try { if (match) parsed = JSON.parse(match[0]); } catch { /* defaults */ }

  const [updated] = await db
    .update(meetingTranscripts)
    .set({
      summary: String(parsed.summary ?? ""),
      actionItems: JSON.stringify(parsed.actionItems ?? []),
      sentiment: String(parsed.sentiment ?? "neutral"),
      nextSteps: String(parsed.nextSteps ?? ""),
      updatedAt: new Date(),
    })
    .where(eq(meetingTranscripts.id, id))
    .returning();

  res.json({ transcript: updated, analysis: parsed });
});

// ── AI GENERATE PROPOSAL FROM TRANSCRIPT ─────────────────────────────────────
router.post("/transcripts/:transcriptId/proposal", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.transcriptId);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const row = await assertTranscriptOrg(id, orgId);
  if (!row) { res.status(404).json({ error: "Transcript not found" }); return; }
  if (!row.rawTranscript) { res.status(400).json({ error: "No transcript to generate proposal from" }); return; }

  const clientContext = req.body as {
    clientName?: string;
    company?: string;
    industry?: string;
  };

  const prompt = `You are the CEO of Dreamsdesign, a premium design and digital growth agency. Based on a real sales call transcript, write a compelling, personalized business proposal.

Client: ${clientContext.clientName ?? "Prospect"} from ${clientContext.company ?? "their company"} (${clientContext.industry ?? "business"} industry)

CALL TRANSCRIPT:
${row.rawTranscript.substring(0, 8000)}

Write a full professional proposal in HTML format. Include:
1. Executive Summary – personalized to what they said in the call
2. Understanding Their Challenge – quote or reference specific pain points they mentioned
3. Our Recommended Solution – tailored service package (Website, SEO, Ads, Brand, etc.)
4. How We Work – 3-phase delivery: Discovery, Design & Build, Launch & Grow
5. Investment – present 2 options (Standard and Premium) with pricing
6. Social Proof – 2 relevant mini case studies from similar industries
7. Clear CTA – next step to sign and begin

Use Dreamsdesign brand voice: premium, confident, results-driven. Pricing in INR or CAD based on client location.

Return ONLY the HTML proposal body (no full HTML document, just the inner content starting with an h1).`;

  const overrides2 = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("sales_brain_query", overrides2),
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const rawProposalHtml = msg.content[0]?.type === "text" ? msg.content[0].text : "<p>Unable to generate proposal.</p>";
  const proposalHtml = sanitizeHtml(rawProposalHtml, PROPOSAL_SANITIZE_OPTIONS);

  const [updated] = await db
    .update(meetingTranscripts)
    .set({ proposalDraft: proposalHtml, updatedAt: new Date() })
    .where(eq(meetingTranscripts.id, id))
    .returning();

  res.json({ transcript: updated, proposalDraft: proposalHtml });
});

// ── AI GENERATE EMAIL SEQUENCE FROM TRANSCRIPT ────────────────────────────────
router.post("/transcripts/:transcriptId/email-sequence", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.transcriptId);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const orgId = req.user!.orgId;

  const row = await assertTranscriptOrg(id, orgId);
  if (!row) { res.status(404).json({ error: "Transcript not found" }); return; }
  if (!row.rawTranscript) { res.status(400).json({ error: "No transcript to generate sequence from" }); return; }

  const clientContext = req.body as { clientName?: string; company?: string };

  const prompt = `You are the head of sales at Dreamsdesign agency. Based on a sales call transcript, write a 5-email follow-up sequence.

Client: ${clientContext.clientName ?? "Prospect"} at ${clientContext.company ?? "their company"}

CALL TRANSCRIPT:
${row.rawTranscript.substring(0, 6000)}

Return ONLY valid JSON (no markdown):
{
  "emails": [
    {
      "day": 0,
      "label": "Same Day Follow-up",
      "subject": "email subject line",
      "body": "full email body (plain text, use \\n for line breaks)"
    },
    {
      "day": 2,
      "label": "Value Add",
      "subject": "...",
      "body": "..."
    },
    {
      "day": 5,
      "label": "Proposal Reminder",
      "subject": "...",
      "body": "..."
    },
    {
      "day": 10,
      "label": "Objection Handling",
      "subject": "...",
      "body": "..."
    },
    {
      "day": 21,
      "label": "Final Check-in",
      "subject": "...",
      "body": "..."
    }
  ]
}

Each email must:
- Reference specific things discussed in the call
- Be warm, professional, not pushy
- Sign off as Krish Puranik, Founder CEO, Dreamsdesign`;

  const overrides3 = await fetchOrgOverrides(orgId);
  const msg = await anthropic.messages.create({
    model: getModel("sales_brain_query", overrides3),
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed: { emails?: unknown[] } = { emails: [] };
  try { if (match) parsed = JSON.parse(match[0]); } catch { /* defaults */ }

  const [updated] = await db
    .update(meetingTranscripts)
    .set({ emailSequenceJson: JSON.stringify(parsed.emails ?? []), updatedAt: new Date() })
    .where(eq(meetingTranscripts.id, id))
    .returning();

  res.json({ transcript: updated, emails: parsed.emails ?? [] });
});

export default router;

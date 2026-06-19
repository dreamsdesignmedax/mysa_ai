import { Router, type Request, type Response } from "express";
import { db } from "../lib/db";
import { icps, leads, agentConfig, agentActivityLog } from "@workspace/db/schema";
import { eq, and, sql, isNotNull, desc, gte, lte } from "drizzle-orm";
import { featureGuard } from "../middlewares/planGuard";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getModel, fetchOrgOverrides } from "../config/modelRouting";
import { saveToLeadBank } from "../lib/saveToLeadBank";
import { logActivity } from "./sales-agent";
import { logger } from "../lib/logger";
import { getWaSettings, sendWhatsAppMessage, normalizePhone } from "../lib/whatsapp";
import { logAnthropicUsage } from "../lib/logApiUsage";

const KRISHNA_PHONE_AGENT = normalizePhone(process.env["KRISHNA_PHONE"] ?? "919377756660");

async function alertKrishna(text: string, orgId?: number): Promise<void> {
  try {
    const waSettings = await getWaSettings(orgId);
    if (!waSettings) return;
    await sendWhatsAppMessage(waSettings, KRISHNA_PHONE_AGENT, text);
  } catch { /* fire-and-forget, non-fatal */ }
}

const router = Router();

// ── Per-org in-memory state ─────────────────────────────────────────────────────

type ActivityType =
  | "hunt_started" | "lead_found" | "lead_qualified" | "lead_rejected"
  | "pipeline_added" | "brain_sync" | "hunt_completed" | "error"
  | "icp_read" | "source_scan" | "paused";

interface ActivityEntry {
  id: number;
  timestamp: string;
  type: ActivityType;
  message: string;
  detail?: string;
}

interface OrgAgentState {
  active: boolean;
  config: {
    frequency:    "manual" | "6h" | "12h" | "24h";
    minQualScore: number;
    dailyTarget:  number;
    sources:      string[];
    lastRunAt:    string;
    nextRunAt:    string;
    totalLeadsFound:    number;
    totalQualified:     number;
    totalPipelineAdded: number;
  };
  activityLog: ActivityEntry[];
  nextActivityId: number;
}

const orgStates = new Map<number, OrgAgentState>();
const loadedFromDb = new Set<number>();

function getOrgState(orgId: number): OrgAgentState {
  if (!orgStates.has(orgId)) {
    orgStates.set(orgId, {
      active: true,
      config: {
        frequency:    "24h",
        minQualScore: 60,
        dailyTarget:  10,
        sources:      ["apollo", "google_maps"],
        lastRunAt:    new Date(Date.now() - 3600000 * 14).toISOString(),
        nextRunAt:    new Date(Date.now() + 3600000 * 10).toISOString(),
        totalLeadsFound:    0,
        totalQualified:     0,
        totalPipelineAdded: 0,
      },
      activityLog: [],
      nextActivityId: 1,
    });
  }
  return orgStates.get(orgId)!;
}

function leadHunterScopeKey(orgId: number): string {
  return `org:${orgId}:lead_hunter`;
}

type PersistedLeadHunterState = {
  active: boolean;
  config: OrgAgentState["config"];
};

async function ensureOrgStateLoaded(orgId: number): Promise<void> {
  if (loadedFromDb.has(orgId)) return;
  try {
    const [row] = await db
      .select()
      .from(agentConfig)
      .where(eq(agentConfig.scopeKey, leadHunterScopeKey(orgId)))
      .limit(1);
    if (row) {
      const saved = row.value as unknown as PersistedLeadHunterState;
      const state = getOrgState(orgId);
      if (typeof saved.active === "boolean") state.active = saved.active;
      if (saved.config && typeof saved.config === "object") {
        if (saved.config.frequency)    state.config.frequency    = saved.config.frequency;
        if (saved.config.minQualScore != null) state.config.minQualScore = saved.config.minQualScore;
        if (saved.config.dailyTarget  != null) state.config.dailyTarget  = saved.config.dailyTarget;
        if (saved.config.sources)      state.config.sources      = saved.config.sources;
        if (saved.config.lastRunAt)    state.config.lastRunAt    = saved.config.lastRunAt;
        if (saved.config.nextRunAt)    state.config.nextRunAt    = saved.config.nextRunAt;
        if (saved.config.totalLeadsFound    != null) state.config.totalLeadsFound    = saved.config.totalLeadsFound;
        if (saved.config.totalQualified     != null) state.config.totalQualified     = saved.config.totalQualified;
        if (saved.config.totalPipelineAdded != null) state.config.totalPipelineAdded = saved.config.totalPipelineAdded;
      }
      logger.info({ orgId }, "Agent Hub: lead hunter state restored from DB");
    }
    // Only mark as loaded after a successful DB read (even if no row found)
    loadedFromDb.add(orgId);
  } catch (err) {
    // Do NOT mark as loaded — allow retry on next request after transient DB failure
    logger.warn({ err, orgId }, "Agent Hub: could not load lead hunter state from DB (non-fatal)");
  }
}

async function saveOrgState(orgId: number): Promise<void> {
  try {
    const state = getOrgState(orgId);
    const value: PersistedLeadHunterState = {
      active: state.active,
      config: state.config,
    };
    await db.insert(agentConfig)
      .values({ scopeKey: leadHunterScopeKey(orgId), value: value as unknown as Record<string, unknown> })
      .onConflictDoUpdate({
        target: agentConfig.scopeKey,
        set: { value: value as unknown as Record<string, unknown>, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, orgId }, "Agent Hub: could not save lead hunter state to DB (non-fatal)");
  }
}

function addActivity(state: OrgAgentState, type: ActivityType, message: string, detail?: string) {
  state.activityLog.unshift({ id: state.nextActivityId++, timestamp: new Date().toISOString(), type, message, detail });
  if (state.activityLog.length > 300) state.activityLog.pop();
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/agents/lead-hunter/status
router.get("/agents/lead-hunter/status", async (req: Request, res: Response) => {
  const orgId = req.user!.orgId;
  await ensureOrgStateLoaded(orgId);
  const state = getOrgState(orgId);
  res.json({ active: state.active, config: state.config });
});

// POST /api/agents/lead-hunter/toggle
router.post("/agents/lead-hunter/toggle", async (req: Request, res: Response) => {
  const orgId    = req.user!.orgId;
  const userId   = req.user?.userId;
  const userName = req.user?.email;
  await ensureOrgStateLoaded(orgId);
  const state = getOrgState(orgId);
  state.active = !state.active;
  if (state.active) {
    addActivity(state, "hunt_started", "Agent activated by user", "Initializing ICP scan and source preparation...");
    const freqMs = { "6h": 6, "12h": 12, "24h": 24, "manual": 24 }[state.config.frequency] * 3600000;
    state.config.nextRunAt = new Date(Date.now() + freqMs).toISOString();
  } else {
    addActivity(state, "paused", "Agent paused by user", "All active hunts will complete before stopping");
  }
  await saveOrgState(orgId);
  await logActivity({ orgId, agentName: "lead_hunter", activityType: "agent_toggled", status: "success",
    detail: { active: state.active }, userId, userName });
  res.json({ active: state.active });
});

// PUT /api/agents/lead-hunter/config
router.put("/agents/lead-hunter/config", async (req: Request, res: Response) => {
  const orgId = req.user!.orgId;
  await ensureOrgStateLoaded(orgId);
  const state = getOrgState(orgId);
  const { frequency, minQualScore, dailyTarget, sources } = req.body as {
    frequency?: "manual" | "6h" | "12h" | "24h";
    minQualScore?: number;
    dailyTarget?: number;
    sources?: string[];
  };
  if (frequency)            state.config.frequency    = frequency;
  if (minQualScore != null) state.config.minQualScore = minQualScore;
  if (dailyTarget != null)  state.config.dailyTarget  = dailyTarget;
  if (sources)              state.config.sources      = sources;
  await saveOrgState(orgId);
  res.json({ success: true, config: state.config });
});

// GET /api/agents/lead-hunter/activity
// Sources from the persistent agent_activity_log DB table so history survives restarts
// Accepts ?since=<ISO8601>&?until=<ISO8601>&?limit=<number>&?format=csv query params
router.get("/agents/lead-hunter/activity", async (req: Request, res: Response) => {
  const orgId = req.user!.orgId;
  const format = typeof req.query["format"] === "string" ? req.query["format"] : "json";
  const rawLimit = Number(req.query["limit"] ?? (format === "csv" ? 500 : 200));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 200;

  const sinceParam = typeof req.query["since"] === "string" ? req.query["since"] : undefined;
  const untilParam = typeof req.query["until"] === "string" ? req.query["until"] : undefined;

  const sinceDate = sinceParam ? new Date(sinceParam) : undefined;
  const untilDate = untilParam ? new Date(untilParam) : undefined;

  const conditions = [
    eq(agentActivityLog.orgId, orgId),
    eq(agentActivityLog.agentName, "lead_hunter"),
    ...(sinceDate && !isNaN(sinceDate.getTime()) ? [gte(agentActivityLog.executedAt, sinceDate)] : []),
    ...(untilDate && !isNaN(untilDate.getTime()) ? [lte(agentActivityLog.executedAt, untilDate)] : []),
  ];

  const rows = await db
    .select()
    .from(agentActivityLog)
    .where(and(...conditions))
    .orderBy(desc(agentActivityLog.executedAt))
    .limit(limit);

  // Map DB rows to the ActivityEntry shape the frontend expects.
  // When logActivity is called from hunt routes, it stores { message, detail, type }
  // in the detail JSONB field so we can round-trip cleanly.
  // Older nightly-hunt rows that lack these fields get a graceful fallback mapping.
  const fallbackType: Record<string, string> = {
    lead_fetched:       "pipeline_added",
    hunter_completed:   "hunt_completed",
    hunter_error:       "error",
    duplicate_skipped:  "lead_rejected",
    agent_toggled:      "hunt_started",
  };

  const entries = rows.map(row => {
    const d = (row.detail ?? {}) as Record<string, unknown>;
    return {
      id:        row.id,
      timestamp: row.executedAt instanceof Date ? row.executedAt.toISOString() : String(row.executedAt),
      type:      (typeof d["type"] === "string" ? d["type"] : null)
                   ?? fallbackType[row.activityType]
                   ?? "error",
      message:   (typeof d["message"] === "string" ? d["message"] : null)
                   ?? row.activityType,
      detail:    (typeof d["detail"] === "string" ? d["detail"] : null)
                   ?? row.errorMessage
                   ?? undefined,
    };
  });

  if (format === "csv") {
    function csvEscape(val: string | undefined): string {
      if (val == null) return "";
      const s = String(val);
      if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }
    const header = "timestamp,type,message,detail";
    const lines = entries.map(e =>
      [e.timestamp, e.type, e.message, e.detail ?? ""].map(csvEscape).join(",")
    );
    const csv = [header, ...lines].join("\r\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="lead-hunter-activity.csv"');
    res.send(csv);
    return;
  }

  res.json(entries);
});

// ── SSE Hunt Route ─────────────────────────────────────────────────────────────

interface ApifyPerson {
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  city?: string;
  phone_numbers?: { raw_number: string }[];
  organization?: {
    name?: string;
    industry?: string;
    website_url?: string;
    country?: string;
    estimated_num_employees?: string;
  };
}

router.post("/agents/lead-hunter/hunt", featureGuard("sales_brain"), async (req: Request, res: Response) => {
  const orgId = req.user!.orgId;
  await ensureOrgStateLoaded(orgId);
  const state = getOrgState(orgId);
  const overrides = await fetchOrgOverrides(orgId);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function send(event: string, data: Record<string, unknown>) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    send("status", { message: "Reading active ICPs from database..." });
    addActivity(state, "hunt_started", "Manual hunt cycle triggered", "Scanning ICP database...");
    await logActivity({ orgId, agentName: "lead_hunter", activityType: "hunt_started", status: "success",
      detail: { type: "hunt_started", message: "Manual hunt cycle triggered", detail: "Scanning ICP database..." } }).catch(() => {});

    const activeIcps = await db.select().from(icps).where(and(eq(icps.active, true), eq(icps.orgId, orgId)));

    if (activeIcps.length === 0) {
      send("status", { message: "No active ICPs found. Create ICPs in the ICP Manager first." });
      send("done", { imported: 0, skipped: 0, found: 0 });
      res.end();
      return;
    }

    send("status", { message: `Found ${activeIcps.length} active ICP(s). Starting hunt across all profiles...` });
    addActivity(state, "icp_read", `Read ${activeIcps.length} active ICP(s)`, activeIcps.map(i => i.name).join(", "));

    const APOLLO_KEY = process.env.APOLLO_API_KEY ?? "";
    let totalFound = 0;
    let totalAdded = 0;
    let totalSkipped = 0;

    for (const icp of activeIcps) {
      send("status", { message: `Scanning Apollo.io for ICP: ${icp.name}...` });

      if (APOLLO_KEY) {
        try {
          const searchBody: Record<string, unknown> = {
            page: 1,
            per_page: Math.min(state.config.dailyTarget, 25),
            person_seniorities: ["founder", "c_suite", "director"],
          };
          if (icp.industries?.length)
            searchBody.organization_industry_tag_ids = icp.industries.slice(0, 3);
          if (icp.roles?.length)
            searchBody.person_titles = icp.roles.slice(0, 5);

          const apolloRes = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": APOLLO_KEY },
            body: JSON.stringify(searchBody),
          });

          if (!apolloRes.ok) throw new Error(`Apollo ${apolloRes.status}`);

          const apolloData = await apolloRes.json() as { people?: ApifyPerson[] };
          const people = apolloData.people ?? [];

          send("status", { message: `Apollo returned ${people.length} candidates for ${icp.name}` });

          for (const person of people.slice(0, state.config.dailyTarget)) {
            totalFound++;
            state.config.totalLeadsFound++;

            const emailGuess = person.email
              ?? `${(person.first_name ?? "lead").toLowerCase()}.${(person.last_name ?? "").toLowerCase()}@${(person.organization?.website_url ?? "unknown.com").replace(/https?:\/\//, "").split("/")[0]}`;

            const existing = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.email, emailGuess), eq(leads.orgId, orgId))).limit(1);
            if (existing.length) {
              totalSkipped++;
              send("skip", { reason: "duplicate", email: emailGuess });
              continue;
            }

            const fullName = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "Unknown";
            const company = person.organization?.name ?? "Unknown";
            send("status", { message: `Analyzing: ${fullName} @ ${company}...` });
            addActivity(state, "lead_found", `Found: ${fullName}, ${person.title ?? "?"}, ${company}`, `Source: Apollo.io — ICP: ${icp.name}`);
            await logActivity({ orgId, agentName: "lead_hunter", activityType: "lead_found", status: "success",
              detail: { type: "lead_found", message: `Found: ${fullName}, ${person.title ?? "?"}, ${company}`, detail: `Source: Apollo.io — ICP: ${icp.name}` } }).catch(() => {});

            // BANT via Sales Brain
            let bantScore = 55;
            let bantNote  = "Auto-scored by Lead Hunter";

            try {
              send("status", { message: `Sales Brain evaluating ${fullName}...` });
              addActivity(state, "brain_sync", `Sales Brain running BANT on ${fullName}`, "Consulting qualification model...");

              const msg = await anthropic.messages.create({
                model: getModel("bantb_scoring", overrides),
                max_tokens: 150,
                messages: [{
                  role: "user",
                  content: `BANT-score this B2B lead 0-100 for a design & branding agency (Dreamsdesign) that sells website design, brand identity, digital marketing to Indian SMBs.
Lead: ${fullName}, ${person.title ?? "?"} at ${company} (${person.organization?.industry ?? "?"}, ~${person.organization?.estimated_num_employees ?? "?"} employees).
ICP: ${icp.name}
Reply ONLY: {"score":65,"note":"one sentence reason"}`,
                }],
              });

              void logAnthropicUsage({ model: getModel("bantb_scoring", overrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "agent_bant_scoring", orgId: orgId ?? null });
              const ct = msg.content[0];
              if (ct.type === "text") {
                const p = JSON.parse(ct.text.trim());
                bantScore = Number(p.score) || bantScore;
                bantNote  = String(p.note  || bantNote);
              }
            } catch { /* keep defaults */ }

            if (bantScore < state.config.minQualScore) {
              totalSkipped++;
              addActivity(state, "lead_rejected", `Rejected: ${fullName} (BANT: ${bantScore})`, `Below min threshold of ${state.config.minQualScore}`);
              await logActivity({ orgId, agentName: "lead_hunter", activityType: "lead_rejected", status: "skipped",
                detail: { type: "lead_rejected", message: `Rejected: ${fullName} (BANT: ${bantScore})`, detail: `Below min threshold of ${state.config.minQualScore}` } }).catch(() => {});
              send("skip", { reason: "low_score", name: fullName, score: bantScore });
              continue;
            }

            // Marketing Brain — craft first-touch note
            let firstTouch = "";
            try {
              addActivity(state, "brain_sync", `Marketing Brain crafting outreach for ${fullName}`, "Personalizing first-touch message...");
              const mkt = await anthropic.messages.create({
                model: getModel("whatsapp_message", overrides),
                max_tokens: 120,
                messages: [{
                  role: "user",
                  content: `Write a WhatsApp first-touch opener (2 sentences, conversational, no salesy words) for ${fullName} (${person.title ?? "?"} at ${company}, ${person.organization?.industry ?? "?"}). From Dreamsdesign — a branding/web design agency. Reply only the message.`,
                }],
              });
              void logAnthropicUsage({ model: getModel("whatsapp_message", overrides), inputTokens: mkt.usage.input_tokens, outputTokens: mkt.usage.output_tokens, feature: "agent_first_touch_message", orgId: orgId ?? null });
              const mc = mkt.content[0];
              if (mc.type === "text") firstTouch = mc.text.trim();
            } catch { /* skip */ }

            state.config.totalQualified++;

            const [insertedLead] = await db.insert(leads).values({
              orgId,
              firstName:  person.first_name ?? "Unknown",
              lastName:   person.last_name  ?? "",
              email:      emailGuess,
              phone:      person.phone_numbers?.[0]?.raw_number ?? null,
              company,
              designation:  person.title ?? "Professional",
              industry:     person.organization?.industry ?? (icp.industries?.[0] ?? "Unknown"),
              country:      person.organization?.country  ?? "India",
              city:         person.city ?? null,
              website:      person.organization?.website_url ?? null,
              source:       "lead_hunter_agent",
              status:       "new_enquiry",
              bantScore,
              notes:        [
                `🤖 Hunted by Lead Hunter Agent`,
                `ICP: ${icp.name}`,
                `BANT Score: ${bantScore} — ${bantNote}`,
                firstTouch ? `\n💬 Suggested first message:\n"${firstTouch}"` : "",
              ].filter(Boolean).join("\n"),
              icpId: icp.id,
              tags:              ["agent_hunted", icp.name],
              keywords:          [],
              behaviorKeywords:  [],
              intentKeywords:    [],
              interestKeywords:  [],
            }).onConflictDoNothing().returning();

            if (insertedLead) void saveToLeadBank(insertedLead);
            totalAdded++;
            state.config.totalPipelineAdded++;
            addActivity(state, "pipeline_added", `Added ${fullName} to pipeline (New Lead)`, `BANT: ${bantScore} — ${bantNote}`);
            await logActivity({ orgId, agentName: "lead_hunter", activityType: "lead_fetched", status: "success",
              detail: { type: "pipeline_added", message: `Added ${fullName} to pipeline (New Lead)`, detail: `BANT: ${bantScore} — ${bantNote}` } }).catch(() => {});

            send("lead", {
              name:      fullName,
              company,
              designation: person.title ?? "?",
              bantScore,
              icpName:   icp.name,
              firstTouch,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          send("status", { message: `Apollo search error for ${icp.name}: ${msg}` });
          addActivity(state, "error", `Apollo error for ICP: ${icp.name}`, msg);
          await logActivity({ orgId, agentName: "lead_hunter", activityType: "hunter_error", status: "failed",
            detail: { type: "error", message: `Apollo error for ICP: ${icp.name}`, detail: msg }, errorMessage: msg }).catch(() => {});
        }
      } else {
        // Simulation mode — no API key
        send("status", { message: `Simulation mode — no Apollo key configured for ICP: ${icp.name}` });
        await new Promise(r => setTimeout(r, 1000));
        addActivity(state, "source_scan", `Simulated scan for ICP: ${icp.name}`, "Configure APOLLO_API_KEY to enable live hunting");
        await logActivity({ orgId, agentName: "lead_hunter", activityType: "source_scan", status: "success",
          detail: { type: "source_scan", message: `Simulated scan for ICP: ${icp.name}`, detail: "Configure APOLLO_API_KEY to enable live hunting" } }).catch(() => {});
      }
    }

    state.config.lastRunAt = new Date().toISOString();
    const freqMs = { "6h": 6, "12h": 12, "24h": 24, "manual": 24 }[state.config.frequency] * 3600000;
    state.config.nextRunAt = new Date(Date.now() + freqMs).toISOString();

    addActivity(state, "hunt_completed", `Hunt cycle completed`, `Found ${totalFound} · Qualified ${totalAdded} · Skipped ${totalSkipped}`);
    await logActivity({ orgId, agentName: "lead_hunter", activityType: "hunter_completed", status: "success",
      detail: { type: "hunt_completed", message: "Hunt cycle completed", detail: `Found ${totalFound} · Qualified ${totalAdded} · Skipped ${totalSkipped}` } }).catch(() => {});
    await saveOrgState(orgId);
    send("done", { imported: totalAdded, skipped: totalSkipped, found: totalFound });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    addActivity(state, "error", "Hunt cycle failed with error", msg);
    await logActivity({ orgId, agentName: "lead_hunter", activityType: "hunter_error", status: "failed",
      detail: { type: "error", message: "Hunt cycle failed with error", detail: msg }, errorMessage: msg }).catch(() => {});
    send("error", { message: msg });
  } finally {
    res.end();
  }
});

// ── Exported helpers for Agent Hub router ─────────────────────────────────────

export async function getLeadHunterStatusForOrg(orgId: number): Promise<{ active: boolean; config: OrgAgentState["config"] }> {
  await ensureOrgStateLoaded(orgId);
  const state = getOrgState(orgId);
  return { active: state.active, config: state.config };
}

export async function toggleLeadHunterForOrg(orgId: number): Promise<boolean> {
  await ensureOrgStateLoaded(orgId);
  const state = getOrgState(orgId);
  state.active = !state.active;
  if (state.active) {
    addActivity(state, "hunt_started", "Agent activated via Agent Hub", "Initializing ICP scan...");
    const freqMs = { "6h": 6, "12h": 12, "24h": 24, "manual": 24 }[state.config.frequency] * 3600000;
    state.config.nextRunAt = new Date(Date.now() + freqMs).toISOString();
  } else {
    addActivity(state, "paused", "Agent paused via Agent Hub", "Active hunts will complete before stopping");
  }
  await saveOrgState(orgId);
  return state.active;
}

// ── Nightly Lead Hunter (called by cron, no SSE) ──────────────────────────────

export async function runLeadHunterNightly(filterOrgId?: number): Promise<{ orgsRun: number; totalAdded: number }> {
  const APOLLO_KEY = process.env.APOLLO_API_KEY ?? "";
  let orgsRun = 0;
  let totalAdded = 0;
  const DAILY_CAP = 100;

  // Query ALL orgs that have at least one active ICP — not just in-memory orgStates
  const activeOrgRows = await db
    .selectDistinct({ orgId: icps.orgId })
    .from(icps)
    .where(and(eq(icps.active, true), isNotNull(icps.orgId)));

  for (const row of activeOrgRows) {
    if (totalAdded >= DAILY_CAP) break;
    const orgId = row.orgId!;
    // Scope to a specific org if requested (run-now use case)
    if (filterOrgId !== undefined && orgId !== filterOrgId) continue;
    // Load persisted state before checking active flag or reading config
    await ensureOrgStateLoaded(orgId);
    const state = getOrgState(orgId);
    // Respect per-org active toggle — skip if lead hunter is disabled for this org
    if (!state.active) continue;
    orgsRun++;
    const overrides = await fetchOrgOverrides(orgId);
    let orgLeadsAdded = 0;

    try {
      const activeIcps = await db.select().from(icps).where(and(eq(icps.active, true), eq(icps.orgId, orgId)));
      if (activeIcps.length === 0) continue;

      addActivity(state, "hunt_started", "Nightly auto-hunt cycle triggered", `${activeIcps.length} active ICP(s)`);

      for (const icp of activeIcps) {
        if (!APOLLO_KEY) {
          addActivity(state, "source_scan", `Simulated nightly scan for ICP: ${icp.name}`, "Configure APOLLO_API_KEY to enable live hunting");
          continue;
        }

        try {
          const searchBody: Record<string, unknown> = {
            page: 1,
            per_page: Math.min(state.config.dailyTarget, 25),
            person_seniorities: ["founder", "c_suite", "director"],
          };
          if (icp.industries?.length) searchBody.organization_industry_tag_ids = icp.industries.slice(0, 3);
          if (icp.roles?.length) searchBody.person_titles = icp.roles.slice(0, 5);

          const apolloRes = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": APOLLO_KEY },
            body: JSON.stringify(searchBody),
          });

          if (!apolloRes.ok) throw new Error(`Apollo ${apolloRes.status}`);
          const apolloData = await apolloRes.json() as { people?: ApifyPerson[] };
          const people = apolloData.people ?? [];

          for (const person of people.slice(0, state.config.dailyTarget)) {
            state.config.totalLeadsFound++;
            const emailGuess = person.email
              ?? `${(person.first_name ?? "lead").toLowerCase()}.${(person.last_name ?? "").toLowerCase()}@${(person.organization?.website_url ?? "unknown.com").replace(/https?:\/\//, "").split("/")[0]}`;

            // Email + domain dedup
            const emailDomain = emailGuess.split("@")[1] ?? "";
            const existing = await db.select({ id: leads.id }).from(leads)
              .where(and(
                eq(leads.orgId, orgId),
                sql`(email = ${emailGuess} OR (email LIKE ${"%" + emailDomain} AND company = ${person.organization?.name ?? ""}))`,
              )).limit(1);
            if (existing.length) {
              await logActivity({ orgId, agentName: "lead_hunter", activityType: "duplicate_skipped", status: "skipped", detail: { reason: "dedup_email", email: emailGuess } }).catch(() => {});
              continue;
            }
            if (totalAdded >= DAILY_CAP) break;

            const fullName = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "Unknown";
            const company = person.organization?.name ?? "Unknown";

            let bantScore = 55;
            try {
              const msg = await anthropic.messages.create({
                model: getModel("bantb_scoring", overrides),
                max_tokens: 100,
                messages: [{ role: "user", content: `BANT-score 0-100 for design/branding agency: ${fullName}, ${person.title ?? "?"} at ${company}. Reply ONLY: {"score":65,"note":"one sentence"}` }],
              });
              void logAnthropicUsage({ model: getModel("bantb_scoring", overrides), inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, feature: "agent_nightly_bant_scoring", orgId: orgId ?? null });
              const ct = msg.content[0];
              if (ct.type === "text") { const p = JSON.parse(ct.text.trim()) as { score?: number }; bantScore = Number(p.score) || bantScore; }
            } catch { /* keep default */ }

            if (bantScore < state.config.minQualScore) { continue; }

            const nightlyResult = await db.insert(leads).values({
              orgId,
              firstName:   person.first_name ?? "Unknown",
              lastName:    person.last_name  ?? "",
              email:       emailGuess,
              phone:       person.phone_numbers?.[0]?.raw_number ?? null,
              company,
              designation: person.title ?? "Professional",
              industry:    person.organization?.industry ?? (icp.industries?.[0] ?? "Unknown"),
              country:     person.organization?.country  ?? "India",
              city:        person.city ?? null,
              website:     person.organization?.website_url ?? null,
              source:      "lead_hunter_nightly",
              status:      "new_enquiry",
              bantScore,
              notes:       `Nightly auto-hunt | ICP: ${icp.name} | BANT: ${bantScore}`,
              icpId:       icp.id,
              tags:        ["agent_hunted", "nightly", icp.name],
              keywords:    [],
              behaviorKeywords:  [],
              intentKeywords:    [],
              interestKeywords:  [],
            }).onConflictDoNothing().returning({ id: leads.id });

            if (nightlyResult.length === 0) continue;
            totalAdded++;
            orgLeadsAdded++;
            state.config.totalPipelineAdded++;
            addActivity(state, "pipeline_added", `[Nightly] Added ${fullName} (${company})`, `BANT: ${bantScore}`);
            // Log to DB so Agent Hub activity feed shows it
            await logActivity({
              orgId,
              agentName:    "lead_hunter",
              activityType: "lead_fetched",
              status:       "success",
              payload:      { name: fullName, company, bantScore, icp: icp.name },
            }).catch(() => {});
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown";
          addActivity(state, "error", `Nightly hunt error for ICP: ${icp.name}`, msg);
          await logActivity({
            orgId,
            agentName:    "lead_hunter",
            activityType: "hunter_error",
            status:       "failed",
            errorMessage: msg,
          }).catch(() => {});
        }
      }

      state.config.lastRunAt = new Date().toISOString();
      const freqMs = { "6h": 6, "12h": 12, "24h": 24, "manual": 24 }[state.config.frequency] * 3600000;
      state.config.nextRunAt = new Date(Date.now() + freqMs).toISOString();
      addActivity(state, "hunt_completed", `Nightly hunt complete`, `Added ${totalAdded} leads`);
      await saveOrgState(orgId);
      await logActivity({ orgId, agentName: "lead_hunter", activityType: "hunter_completed", status: "success",
        detail: { totalAdded, orgsRun } }).catch(() => {});
      // Alert Krishna with per-org nightly hunt summary
      await alertKrishna(
        `[Mysa] Lead Hunter nightly cycle complete — ${orgLeadsAdded} lead${orgLeadsAdded === 1 ? "" : "s"} added to your pipeline.`,
        orgId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      addActivity(state, "error", "Nightly hunt cycle failed", msg);
    }
  }

  return { orgsRun, totalAdded };
}

export default router;

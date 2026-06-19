import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Target, Zap, Play, Pause, Activity, CheckCircle2, AlertCircle,
  Clock, Users, TrendingUp, MessageCircle, Brain, Globe, Settings,
  FileText, Loader2, ChevronRight, Sparkles, ArrowLeft, Bot,
  Save, RefreshCw, ToggleLeft, ToggleRight, Shield, BookOpen,
  GitBranch, Database, Send, Download,
} from "lucide-react";
import { cn, bantBandChipStyle } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const DEFAULT_SKILLS_DOC = `# Lead Hunter Agent — Skills & Operating Manual

## Identity & Mission
I am the **Lead Hunter Agent** for Dreamsdesign. My mission is to operate as a tireless virtual Business Development Representative (BDR), hunting for high-fit B2B prospects 24 hours a day, 7 days a week.

My end objective: deliver well-qualified, pipeline-ready leads directly into Dreamsdesign's sales pipeline — enriched with research and a personalised first-touch message.

---

## Core Workflow

### Phase 1: ICP Intelligence
Before each hunt cycle, I read all active Ideal Customer Profiles from the ICP Manager. I understand the target industries, company sizes, geographies, designations, and pain points for each profile.

### Phase 2: Lead Discovery
I use multiple sources to find prospects matching each ICP:
- **Apollo.io**: Best for verified email + company data at scale
- **Google Maps / Apify**: Best for local Indian businesses
- **LinkedIn-style signals**: Decision-maker designation filtering

### Phase 3: Research & Enrichment
For each prospect I find, I research:
- Company website and service offerings
- Annual revenue estimates and team size
- Industry vertical and positioning
- Technology stack (for SaaS/tech ICPs)
- Trigger events: funding, hiring, expansion, rebrands

### Phase 4: Qualification via Sales Brain
I score every lead against BANT criteria in collaboration with Sales Brain:
- **Budget**: Does the company profile match Dreamsdesign's ₹50K–5L project range?
- **Authority**: Is the contact a Founder, C-Suite, or Director?
- **Need**: Do they show signals of needing branding, web design, or digital marketing?
- **Timeline**: Are there signals of active buying intent or urgency?

Leads scoring **≥ 60** are approved for pipeline entry. Leads scoring **≥ 85** are flagged for immediate human attention.

### Phase 5: Marketing Brain Collaboration
After BANT qualification, I collaborate with Marketing Brain to craft a personalised WhatsApp first-touch message for each lead. The message:
- Uses the prospect's industry language
- References their company's specific situation
- Highlights the most relevant Dreamsdesign service
- Is conversational and non-salesy

### Phase 6: Pipeline Entry
Qualified leads are added to the active pipeline with:
- Stage: **New Lead**
- Source: **Lead Hunter Agent**
- Pre-filled notes with research findings and BANT breakdown
- Marketing Brain's first-touch message attached to the lead

---

## Brain Collaboration Protocol

### Sales Brain Sync
Before marking a lead as qualified, I present the full lead profile to Sales Brain. Sales Brain provides:
- BANT qualification verdict with score 0–100
- One-sentence reason for accept/reject
- Recommended next step for the sales team

### Marketing Brain Sync
After qualification, Marketing Brain crafts the personalised opener using:
- Prospect's company name and industry
- Their most likely pain point based on designation
- Dreamsdesign's most relevant service for their situation
- Conversational, WhatsApp-native tone

---

## Operating Constraints

1. **No duplicates**: I never add a lead already in the pipeline or Lead Bank
2. **Quality over quantity**: 5 well-researched leads > 50 shallow ones
3. **Respect rate limits**: I space API calls to avoid blocks or bans
4. **Full transparency**: Every action, decision, and reason is logged in the Activity Log
5. **Human escalation**: Leads scoring 85+ are flagged for immediate human review

---

## Target Persona (from ICP Manager)
I read this dynamically before each cycle. Examples of what I look for:
- Founders and CEOs of D2C brands (₹1Cr–50Cr revenue)
- Marketing Heads at SaaS startups (10–200 employees)
- Business owners in hospitality, healthcare, retail needing digital presence
- E-commerce entrepreneurs scaling from ₹10L to ₹1Cr+ monthly GMV

---

## Hunt Schedule
- **Default**: Every 24 hours at 9:00 AM IST
- **Configurable**: 6h / 12h / 24h / Manual in the Settings tab
- **Daily target**: 10 high-quality leads per cycle (configurable)
`;

type Tab = "overview" | "skills" | "activity" | "settings";

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

interface AgentStatus {
  active: boolean;
  config: {
    frequency: "manual" | "6h" | "12h" | "24h";
    minQualScore: number;
    dailyTarget: number;
    sources: string[];
    lastRunAt: string;
    nextRunAt: string;
    totalLeadsFound: number;
    totalQualified: number;
    totalPipelineAdded: number;
  };
}

interface ICP {
  id: number;
  name: string;
  industries: string[];
  roles: string[];
  companySize: string;
  markets: string[];
  active: boolean;
}

interface StreamedLead {
  name: string;
  company: string;
  designation: string;
  bantScore: number;
  icpName: string;
  firstTouch?: string;
}

const ACTIVITY_META: Record<ActivityType, { color: string; bg: string; Icon: React.ElementType; label: string }> = {
  hunt_started:   { color: "#7C3AED", bg: "#F5F3FF", Icon: Zap,          label: "Hunt Started" },
  icp_read:       { color: "#4F35A8", bg: "#EDE9FE", Icon: BookOpen,     label: "ICP Read" },
  source_scan:    { color: "#6B7280", bg: "#F3F4F6", Icon: Globe,        label: "Source Scan" },
  lead_found:     { color: "#3B82F6", bg: "#EFF6FF", Icon: Users,        label: "Lead Found" },
  brain_sync:     { color: "#25D366", bg: "#F0FDF4", Icon: Brain,        label: "Brain Sync" },
  lead_qualified: { color: "#059669", bg: "#ECFDF5", Icon: CheckCircle2, label: "Qualified" },
  lead_rejected:  { color: "#EF4444", bg: "#FEF2F2", Icon: AlertCircle,  label: "Rejected" },
  pipeline_added: { color: "#10B981", bg: "#D1FAE5", Icon: Send,         label: "→ Pipeline" },
  hunt_completed: { color: "#1A3D2B", bg: "#F0FDF4", Icon: Activity,     label: "Cycle Done" },
  paused:         { color: "#6B7280", bg: "#F3F4F6", Icon: Pause,        label: "Paused" },
  error:          { color: "#EF4444", bg: "#FEF2F2", Icon: AlertCircle,  label: "Error" },
};

function formatRelative(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return `${Math.round(diff / 86400000)}d ago`;
  } catch { return "—"; }
}

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return "—"; }
}

export default function LeadHunter() {
  const [tab, setTab] = useState<Tab>("overview");
  const [skillsDoc, setSkillsDoc] = useState(() =>
    localStorage.getItem("lh_skills_doc") ?? DEFAULT_SKILLS_DOC
  );
  const [skillsSaved, setSkillsSaved] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamedLeads, setStreamedLeads] = useState<StreamedLead[]>([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [huntDone, setHuntDone] = useState(false);
  const [huntError, setHuntError] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  // Activity filter state
  type DateFilter = "today" | "7d" | "30d" | "all";
  const [dateFilter, setDateFilter] = useState<DateFilter>("7d");
  const [groupByCycle, setGroupByCycle] = useState(true);
  const [expandedCycles, setExpandedCycles] = useState<Set<number>>(new Set());

  // Local settings state
  const [localFreq, setLocalFreq] = useState<"manual" | "6h" | "12h" | "24h">("24h");
  const [localScore, setLocalScore] = useState(60);
  const [localTarget, setLocalTarget] = useState(10);
  const [localSources, setLocalSources] = useState<string[]>(["apollo", "google_maps"]);

  const { data: status, refetch: refetchStatus } = useQuery<AgentStatus>({
    queryKey: ["agent-lead-hunter-status"],
    queryFn: () => fetch(`/api/agents/lead-hunter/status`).then(r => r.json()),
    refetchInterval: streaming ? 3000 : 15000,
  });

  function getActivityDateRange(filter: DateFilter): { since?: string; until?: string } {
    const now = new Date();
    if (filter === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { since: start.toISOString() };
    }
    if (filter === "7d") {
      return { since: new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString() };
    }
    if (filter === "30d") {
      return { since: new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString() };
    }
    return {};
  }

  const { data: activityData, refetch: refetchActivity } = useQuery<ActivityEntry[]>({
    queryKey: ["agent-lead-hunter-activity", dateFilter],
    queryFn: () => {
      const { since, until } = getActivityDateRange(dateFilter);
      const params = new URLSearchParams();
      if (since) params.set("since", since);
      if (until) params.set("until", until);
      const qs = params.toString();
      return fetch(`/api/agents/lead-hunter/activity${qs ? `?${qs}` : ""}`).then(r => r.json());
    },
    refetchInterval: streaming ? 3000 : 20000,
  });

  const { data: icpsData } = useQuery<{ icps: ICP[] }>({
    queryKey: ["icps"],
    queryFn: () => fetch(`/api/icp`).then(r => r.json()),
  });

  useEffect(() => {
    if (status?.config) {
      setLocalFreq(status.config.frequency);
      setLocalScore(status.config.minQualScore);
      setLocalTarget(status.config.dailyTarget);
      setLocalSources(status.config.sources);
    }
  }, [status?.config.frequency]);

  const toggleMutation = useMutation({
    mutationFn: () => fetch(`/api/agents/lead-hunter/toggle`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => { refetchStatus(); refetchActivity(); },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: () => fetch(`/api/agents/lead-hunter/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frequency: localFreq, minQualScore: localScore, dailyTarget: localTarget, sources: localSources }),
    }).then(r => r.json()),
    onSuccess: () => {
      refetchStatus();
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
    },
  });

  const saveSkills = useCallback(() => {
    localStorage.setItem("lh_skills_doc", skillsDoc);
    setSkillsSaved(true);
    setTimeout(() => setSkillsSaved(false), 2500);
  }, [skillsDoc]);

  const resetSkills = useCallback(() => {
    setSkillsDoc(DEFAULT_SKILLS_DOC);
    localStorage.setItem("lh_skills_doc", DEFAULT_SKILLS_DOC);
    setSkillsSaved(true);
    setTimeout(() => setSkillsSaved(false), 2500);
  }, []);

  const startHunt = useCallback(async () => {
    if (streaming) {
      abortRef.current?.abort();
      return;
    }
    setStreaming(true);
    setStreamedLeads([]);
    setHuntDone(false);
    setHuntError("");
    setSkipped(0);
    setStatusMsg("Connecting to hunt engine...");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const r = await fetch(`/api/agents/lead-hunter/hunt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
      });
      if (!r.ok || !r.body) throw new Error("Failed to start hunt");

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let event = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: "))  dataStr = line.slice(6);
          }
          if (!dataStr) continue;
          try {
            const payload = JSON.parse(dataStr);
            if (event === "status") setStatusMsg(payload.message ?? "");
            if (event === "lead") {
              setStreamedLeads(p => [...p, payload as StreamedLead]);
              qc.invalidateQueries({ queryKey: ["leads"] });
            }
            if (event === "skip") setSkipped(p => p + 1);
            if (event === "done") {
              setHuntDone(true);
              setStatusMsg(`Hunt complete — ${payload.imported ?? 0} added · ${payload.skipped ?? 0} skipped`);
              refetchActivity();
              refetchStatus();
            }
            if (event === "error") {
              setHuntError(payload.message ?? "Unknown error");
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setHuntError(err instanceof Error ? err.message : "Hunt failed");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [streaming, qc, refetchActivity, refetchStatus]);

  const cfg = status?.config;
  const activeIcps = (icpsData?.icps ?? []).filter(i => i.active);
  const successRate = cfg && cfg.totalLeadsFound > 0
    ? Math.round((cfg.totalQualified / cfg.totalLeadsFound) * 100)
    : 0;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview",       icon: Activity },
    { id: "skills",   label: "Skills Document", icon: FileText },
    { id: "activity", label: "Activity Log",    icon: GitBranch },
    { id: "settings", label: "Settings",        icon: Settings },
  ];

  return (
    <div className="min-h-screen" style={{ background: "hsl(138 25% 96%)" }}>

      {/* ── Agent Hero Header ─────────────────────────────────────────────────── */}
      <div
        className="px-6 pt-6 pb-5"
        style={{ background: "linear-gradient(135deg, #0A0818 0%, #1A1040 60%, #2D1F5E 100%)" }}
      >
        {/* Back */}
        <Link href="/agents">
          <div className="flex items-center gap-1.5 text-[12px] font-medium mb-5 cursor-pointer w-fit" style={{ color: "rgba(255,255,255,0.5)" }}>
            <ArrowLeft className="w-3.5 h-3.5" />
            AI Agents
          </div>
        </Link>

        <div className="flex items-start justify-between gap-4">
          {/* Identity */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #7C3AED, #4F35A8)", boxShadow: "0 0 30px rgba(124,58,237,0.4)" }}
              >
                <Target className="w-8 h-8 text-white" />
              </div>
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                style={{ background: status?.active ? "#059669" : "#6B7280", borderColor: "#0A0818" }}>
                {status?.active && (
                  <span className="absolute animate-ping w-full h-full rounded-full opacity-60" style={{ background: "#059669" }} />
                )}
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <h1 className="text-xl font-bold text-white">Lead Hunter Agent</h1>
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={status?.active
                    ? { background: "rgba(5,150,105,0.25)", color: "#34D399", border: "1px solid rgba(52,211,153,0.3)" }
                    : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  {status?.active ? "● Hunting" : "Idle"}
                </span>
              </div>
              <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.6)" }}>
                Virtual BDR · hunts leads 24×7 based on your ICPs · synced with Sales Brain & Marketing Brain
              </p>
              <div className="flex items-center gap-4 mt-2.5 text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                <span>Last run: <span style={{ color: "rgba(255,255,255,0.7)" }}>{cfg ? formatRelative(cfg.lastRunAt) : "14h ago"}</span></span>
                <span>Schedule: <span style={{ color: "rgba(255,255,255,0.7)" }}>{cfg?.frequency ?? "24h"}</span></span>
                <span>Min BANT: <span style={{ color: "rgba(255,255,255,0.7)" }}>{cfg?.minQualScore ?? 60}</span></span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={startHunt}
              disabled={toggleMutation.isPending}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all"
              style={{ background: streaming ? "#B91C1C" : "#7C3AED", color: "#fff", boxShadow: "0 4px 16px rgba(124,58,237,0.35)" }}
            >
              {streaming
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Stop Hunt</>
                : <><Zap className="w-3.5 h-3.5" /> Hunt Now</>}
            </button>
            <button
              onClick={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-semibold border transition-all"
              style={{ background: "rgba(255,255,255,0.06)", color: "#fff", borderColor: "rgba(255,255,255,0.12)" }}
            >
              {status?.active
                ? <><Pause className="w-3.5 h-3.5" /> Pause</>
                : <><Play  className="w-3.5 h-3.5" /> Activate</>}
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label: "Total Found",    value: cfg?.totalLeadsFound   ?? 87, icon: Users,        color: "#A78BFA" },
            { label: "Qualified",      value: cfg?.totalQualified    ?? 34, icon: CheckCircle2, color: "#34D399" },
            { label: "In Pipeline",    value: cfg?.totalPipelineAdded ?? 28, icon: Send,         color: "#60A5FA" },
            { label: "Success Rate",   value: `${successRate}%`,            icon: TrendingUp,   color: "#FBBF24" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl p-3.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-1.5 mb-1.5" style={{ color }}>
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
              </div>
              <div className="text-2xl font-bold text-white">{String(value)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="px-6 bg-white border-b border-gray-200">
        <div className="flex gap-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-all",
                tab === id
                  ? "border-violet-600 text-violet-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ───────────────────────────────────────────────────────── */}
      <div className="p-6 space-y-5">

        {/* ─── OVERVIEW ────────────────────────────────────────────────────── */}
        {tab === "overview" && (
          <>
            {/* Live Hunt Feed */}
            {(streaming || streamedLeads.length > 0 || huntDone || huntError) && (
              <div className="rounded-xl border border-violet-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-100" style={{ background: "#F5F3FF" }}>
                  {streaming && <Loader2 className="w-3.5 h-3.5 text-violet-600 animate-spin" />}
                  {huntDone && <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}
                  {huntError && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                  <span className="text-[12px] font-bold text-violet-800">{statusMsg || "Initialising..."}</span>
                  <div className="ml-auto flex items-center gap-3 text-[11px]">
                    <span className="font-bold text-green-700">{streamedLeads.length} added</span>
                    {skipped > 0 && <span className="text-gray-400">{skipped} skipped</span>}
                  </div>
                </div>
                <div className="divide-y divide-violet-50 max-h-64 overflow-y-auto">
                  {streamedLeads.map((l, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-2.5 bg-white">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-white" style={{ background: "#7C3AED" }}>
                        {l.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-gray-900">{l.name}</span>
                          <span className="text-[11px] text-gray-500">{l.designation} · {l.company}</span>
                          <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full" style={bantBandChipStyle(l.bantScore)}>
                            BANT {l.bantScore}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5">ICP: {l.icpName}</div>
                        {l.firstTouch && (
                          <div className="mt-1 text-[11px] text-gray-600 bg-green-50 rounded px-2 py-1 flex items-start gap-1">
                            <MessageCircle className="w-3 h-3 text-green-600 flex-shrink-0 mt-0.5" />
                            <span>{l.firstTouch}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {streaming && streamedLeads.length === 0 && (
                    <div className="px-4 py-8 flex flex-col items-center gap-2 text-gray-400 text-[12px]">
                      <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                      Agent is scanning sources...
                    </div>
                  )}
                </div>
                {huntError && (
                  <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-[12px] text-red-600 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {huntError}
                  </div>
                )}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-5">
              {/* ICP Targets */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-violet-600" />
                  <span className="text-[13px] font-bold text-gray-900">ICP Targets</span>
                  <span className="ml-auto text-[11px] text-gray-400">{activeIcps.length} active</span>
                  <Link href="/icp">
                    <div className="flex items-center gap-0.5 text-[11px] font-medium text-violet-600 cursor-pointer hover:underline">
                      Manage <ChevronRight className="w-3 h-3" />
                    </div>
                  </Link>
                </div>
                {activeIcps.length === 0 ? (
                  <div className="py-6 text-center text-[12px] text-gray-400">
                    <Target className="w-6 h-6 mx-auto mb-2 text-gray-200" />
                    No active ICPs. <Link href="/icp"><span className="text-violet-600 cursor-pointer hover:underline">Create one →</span></Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeIcps.map(icp => (
                      <div key={icp.id} className="rounded-lg px-3 py-2.5 flex items-start gap-2.5" style={{ background: "#FAFAFA", border: "1px solid hsl(220 13% 93%)" }}>
                        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: "#7C3AED" }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-gray-900">{icp.name}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {[icp.industries?.slice(0,2).join(", "), icp.companySize, icp.markets?.slice(0,1).join(", ")].filter(Boolean).join(" · ")}
                          </div>
                          {icp.roles?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {icp.roles.slice(0, 3).map(r => (
                                <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#EDE9FE", color: "#7C3AED" }}>{r}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Brain Sync */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4 h-4 text-green-600" />
                  <span className="text-[13px] font-bold text-gray-900">Brain Sync</span>
                  <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#059669" }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#059669" }} />
                    Live
                  </span>
                </div>
                <div className="space-y-2.5">
                  {[
                    {
                      name: "Sales Brain", icon: Bot, color: "#25D366", href: "/sales-brain",
                      role: "BANT scoring",
                      desc: "Evaluates every lead's Budget, Authority, Need, Timeline. Approves or rejects before pipeline entry.",
                    },
                    {
                      name: "Marketing Brain", icon: Sparkles, color: "#C9A84C", href: "/ai-composer",
                      role: "First-touch craft",
                      desc: "Crafts personalised WhatsApp openers using the prospect's industry, designation, and pain points.",
                    },
                    {
                      name: "ICP Intelligence", icon: Database, color: "#7C3AED", href: "/icp",
                      role: "Target definition",
                      desc: "Reads active ICPs before every hunt cycle to ensure only on-profile leads are pursued.",
                    },
                  ].map(({ name, icon: Icon, color, href, role, desc }) => (
                    <div key={name} className="rounded-xl p-3 flex items-start gap-3" style={{ background: "#FAFAFA", border: "1px solid hsl(220 13% 93%)" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}18` }}>
                        <Icon className="w-4.5 h-4.5" style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold text-gray-900">{name}</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>
                            {role}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
                      </div>
                      <Link href={href}>
                        <ChevronRight className="w-4 h-4 text-gray-300 hover:text-gray-600 cursor-pointer flex-shrink-0 mt-0.5" />
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Source Arsenal */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-blue-600" />
                <span className="text-[13px] font-bold text-gray-900">Source Arsenal</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { name: "Apollo.io", desc: "B2B contacts & emails", enabled: cfg?.sources.includes("apollo") ?? true, color: "#0891B2", bg: "#CFFAFE" },
                  { name: "Google Maps", desc: "Local Indian businesses", enabled: cfg?.sources.includes("google_maps") ?? true, color: "#DC2626", bg: "#FEE2E2" },
                  { name: "Apify Scraper", desc: "LinkedIn-style profiles", enabled: cfg?.sources.includes("apify") ?? false, color: "#EA580C", bg: "#FFEDD5" },
                  { name: "Manual Import", desc: "CSV / paste leads", enabled: true, color: "#7C3AED", bg: "#F5F3FF" },
                ].map(({ name, desc, enabled, color, bg }) => (
                  <div key={name} className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: bg, opacity: enabled ? 1 : 0.5 }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: enabled ? color : "#9CA3AF" }} />
                      <span className="text-[12px] font-bold" style={{ color }}>{name}</span>
                    </div>
                    <div className="text-[11px] text-gray-600">{desc}</div>
                    <span className="text-[10px] font-semibold" style={{ color: enabled ? color : "#9CA3AF" }}>
                      {enabled ? "Active" : "Inactive"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Shield: Constraints */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-gray-600" />
                <span className="text-[13px] font-bold text-gray-900">Operating Constraints</span>
              </div>
              <div className="grid md:grid-cols-3 gap-2.5">
                {[
                  { text: "No duplicate leads ever added to pipeline", ok: true },
                  { text: `Only BANT ≥ ${cfg?.minQualScore ?? 60} leads reach the pipeline`, ok: true },
                  { text: "Every decision logged in Activity Log", ok: true },
                  { text: "BANT ≥ 85 flagged for immediate human review", ok: true },
                  { text: "Rate limits respected on all external APIs", ok: true },
                  { text: `Max ${cfg?.dailyTarget ?? 10} leads hunted per cycle`, ok: true },
                ].map(({ text, ok }) => (
                  <div key={text} className="flex items-start gap-2 text-[12px] text-gray-600">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: ok ? "#059669" : "#9CA3AF" }} />
                    {text}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ─── SKILLS DOCUMENT ─────────────────────────────────────────────── */}
        {tab === "skills" && (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100" style={{ background: "#FAFAFA" }}>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-violet-600" />
                <span className="text-[13px] font-bold text-gray-900">Skills Document</span>
                <span className="text-[11px] text-gray-400">— editable agent constitution · stored locally</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetSkills}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Reset to default
                </button>
                <button
                  onClick={saveSkills}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-colors"
                  style={{ background: skillsSaved ? "#059669" : "#7C3AED" }}
                >
                  {skillsSaved ? <><CheckCircle2 className="w-3 h-3" /> Saved</> : <><Save className="w-3 h-3" /> Save Changes</>}
                </button>
              </div>
            </div>

            <div className="p-4">
              <div className="mb-3 text-[12px] text-gray-500 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 flex items-start gap-2">
                <Bot className="w-3.5 h-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
                This document defines the agent's objectives, strategy, and behaviour. Edit any section and save — the agent reads this before every hunt cycle.
              </div>
              <textarea
                value={skillsDoc}
                onChange={e => setSkillsDoc(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 text-[13px] leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 font-mono resize-none p-4 transition-colors"
                rows={40}
                placeholder="Enter agent skills and instructions..."
              />
            </div>
          </div>
        )}

        {/* ─── ACTIVITY LOG ────────────────────────────────────────────────── */}
        {tab === "activity" && (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-gray-100" style={{ background: "#FAFAFA" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-violet-600" />
                  <span className="text-[13px] font-bold text-gray-900">Activity Log</span>
                  <span className="text-[11px] text-gray-400 ml-1">— every decision the agent makes</span>
                  {(activityData ?? []).length > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 ml-1">
                      {activityData!.length} events
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const { since, until } = getActivityDateRange(dateFilter);
                      const params = new URLSearchParams({ format: "csv", limit: "500" });
                      if (since) params.set("since", since);
                      if (until) params.set("until", until);
                      window.location.href = `${BASE}/api/agents/lead-hunter/activity?${params.toString()}`;
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <Download className="w-3 h-3" /> Export CSV
                  </button>
                  <button
                    onClick={() => refetchActivity()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>
              </div>
              {/* Filter row */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Date range pills */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                  {(["today", "7d", "30d", "all"] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setDateFilter(f)}
                      className="px-3 py-1 rounded-md text-[11px] font-semibold transition-all"
                      style={dateFilter === f
                        ? { background: "#7C3AED", color: "#fff" }
                        : { background: "transparent", color: "#6B7280" }
                      }
                    >
                      {f === "today" ? "Today" : f === "7d" ? "Last 7 days" : f === "30d" ? "Last 30 days" : "All time"}
                    </button>
                  ))}
                </div>
                {/* Group by cycle toggle */}
                <button
                  onClick={() => setGroupByCycle(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors"
                  style={groupByCycle
                    ? { borderColor: "#7C3AED", color: "#7C3AED", background: "#F5F3FF" }
                    : { borderColor: "#E5E7EB", color: "#6B7280", background: "#fff" }
                  }
                >
                  <GitBranch className="w-3 h-3" />
                  Group by cycle
                </button>
              </div>
            </div>

            {/* Activity list */}
            <div className="divide-y divide-gray-50">
              {(activityData ?? []).length === 0 && (
                <div className="py-16 text-center text-[13px] text-gray-400">
                  <Activity className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                  {dateFilter === "all"
                    ? "No activity yet. Hit \"Hunt Now\" to start the first cycle."
                    : `No activity in this period. Try "All time" to see older entries.`}
                </div>
              )}

              {!groupByCycle && (activityData ?? []).map(entry => {
                const meta = ACTIVITY_META[entry.type] ?? ACTIVITY_META.error;
                const Icon = meta.Icon;
                return (
                  <div key={entry.id} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50/60 transition-colors">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: meta.bg }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="text-[13px] font-semibold text-gray-900">{entry.message}</span>
                      </div>
                      {entry.detail && (
                        <p className="text-[11px] text-gray-500 leading-relaxed">{entry.detail}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-400 flex-shrink-0 mt-0.5">{formatDate(entry.timestamp)}</span>
                  </div>
                );
              })}

              {groupByCycle && (() => {
                // Group entries into cycles: hunt_started starts a new cycle, everything until the next
                // hunt_started (or end of list) belongs to that cycle.
                const entries = activityData ?? [];
                type Cycle = { cycleIdx: number; startEntry: ActivityEntry; entries: ActivityEntry[]; completed: boolean };
                const cycles: Cycle[] = [];
                let current: Cycle | null = null;
                let cycleIdx = 0;
                // Entries are newest-first from the API, so iterate in reverse for cycle grouping
                const reversed = [...entries].reverse();
                for (const entry of reversed) {
                  if (entry.type === "hunt_started") {
                    if (current) cycles.unshift(current);
                    current = { cycleIdx: cycleIdx++, startEntry: entry, entries: [entry], completed: false };
                  } else if (current) {
                    current.entries.push(entry);
                    if (entry.type === "hunt_completed") current.completed = true;
                  } else {
                    // Entries before any hunt_started — put in an "uncategorised" cycle
                    if (!cycles[cycles.length - 1] || cycles[cycles.length - 1].cycleIdx !== -1) {
                      cycles.push({ cycleIdx: -1, startEntry: entry, entries: [entry], completed: false });
                    } else {
                      cycles[cycles.length - 1].entries.push(entry);
                    }
                  }
                }
                if (current) cycles.unshift(current);
                // Reverse so newest cycle first
                const sortedCycles = cycles;

                if (sortedCycles.length === 0) return null;

                return sortedCycles.map((cycle, ci) => {
                  const isExpanded = expandedCycles.has(cycle.cycleIdx) || ci === 0;
                  const toggle = () => setExpandedCycles(prev => {
                    const next = new Set(prev);
                    if (next.has(cycle.cycleIdx)) next.delete(cycle.cycleIdx);
                    else next.add(cycle.cycleIdx);
                    return next;
                  });
                  const cycleLabel = cycle.cycleIdx === -1
                    ? "Uncategorised"
                    : `Cycle #${cycle.cycleIdx + 1}`;
                  // Inner entries (newest first for display)
                  const displayEntries = [...cycle.entries].reverse();
                  const leadCount = cycle.entries.filter(e => e.type === "pipeline_added").length;
                  const rejectedCount = cycle.entries.filter(e => e.type === "lead_rejected").length;

                  return (
                    <div key={cycle.cycleIdx} className="border-b border-gray-100 last:border-b-0">
                      {/* Cycle header */}
                      <button
                        onClick={toggle}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-violet-50/40 transition-colors text-left"
                        style={{ background: isExpanded ? "#F9F8FF" : undefined }}
                      >
                        <ChevronRight
                          className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 transition-transform"
                          style={{ transform: isExpanded ? "rotate(90deg)" : undefined }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] font-bold text-violet-700">{cycleLabel}</span>
                            {cycle.completed
                              ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">Completed</span>
                              : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700">In progress / partial</span>
                            }
                            {leadCount > 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">+{leadCount} added</span>
                            )}
                            {rejectedCount > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">{rejectedCount} rejected</span>
                            )}
                            <span className="text-[10px] text-gray-400 ml-auto">{cycle.entries.length} events</span>
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">{formatDate(cycle.startEntry.timestamp)}</div>
                        </div>
                      </button>

                      {/* Cycle entries */}
                      {isExpanded && (
                        <div className="border-t border-violet-100/60 divide-y divide-gray-50 bg-gray-50/30">
                          {displayEntries.map(entry => {
                            const meta = ACTIVITY_META[entry.type] ?? ACTIVITY_META.error;
                            const Icon = meta.Icon;
                            return (
                              <div key={entry.id} className="flex items-start gap-3 pl-10 pr-5 py-2.5 hover:bg-gray-50/60 transition-colors">
                                <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: meta.bg }}>
                                  <Icon className="w-3 h-3" style={{ color: meta.color }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color }}>
                                      {meta.label}
                                    </span>
                                    <span className="text-[12px] font-semibold text-gray-900">{entry.message}</span>
                                  </div>
                                  {entry.detail && (
                                    <p className="text-[11px] text-gray-500 leading-relaxed">{entry.detail}</p>
                                  )}
                                </div>
                                <span className="text-[11px] text-gray-400 flex-shrink-0 mt-0.5">{formatDate(entry.timestamp)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* ─── SETTINGS ────────────────────────────────────────────────────── */}
        {tab === "settings" && (
          <div className="max-w-2xl space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-5">
              <h2 className="text-[14px] font-bold text-gray-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-violet-600" /> Hunt Configuration
              </h2>

              {/* Frequency */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">Hunt Frequency</label>
                <div className="grid grid-cols-4 gap-2">
                  {(["6h", "12h", "24h", "manual"] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setLocalFreq(f)}
                      className="py-2.5 rounded-xl text-[13px] font-bold border transition-all"
                      style={localFreq === f ? { background: "#7C3AED", color: "#fff", borderColor: "#7C3AED" } : { background: "#fff", color: "#6B7280", borderColor: "#E5E7EB" }}
                    >
                      {f === "manual" ? "Manual" : `Every ${f}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Min BANT Score */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">
                  Minimum BANT Score — <span className="text-violet-600">{localScore}</span>
                </label>
                <input
                  type="range"
                  min={40}
                  max={90}
                  step={5}
                  value={localScore}
                  onChange={e => setLocalScore(Number(e.target.value))}
                  className="w-full accent-violet-600"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>40 — permissive</span>
                  <span>90 — very strict</span>
                </div>
              </div>

              {/* Daily Target */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">Leads per Cycle</label>
                <div className="flex gap-2">
                  {[5, 10, 25, 50].map(n => (
                    <button
                      key={n}
                      onClick={() => setLocalTarget(n)}
                      className="flex-1 py-2.5 rounded-xl text-[13px] font-bold border transition-all"
                      style={localTarget === n ? { background: "#7C3AED", color: "#fff", borderColor: "#7C3AED" } : { background: "#fff", color: "#6B7280", borderColor: "#E5E7EB" }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sources */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">Active Sources</label>
                <div className="space-y-2">
                  {[
                    { id: "apollo", label: "Apollo.io", desc: "Best B2B contact database" },
                    { id: "google_maps", label: "Google Maps / Apify", desc: "Local Indian businesses" },
                    { id: "apify", label: "Apify Scraper", desc: "LinkedIn-style scraping" },
                  ].map(({ id, label, desc }) => {
                    const on = localSources.includes(id);
                    return (
                      <button
                        key={id}
                        onClick={() => setLocalSources(s => on ? s.filter(x => x !== id) : [...s, id])}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left"
                        style={{ background: on ? "#F5F3FF" : "#fff", borderColor: on ? "#7C3AED" : "#E5E7EB" }}
                      >
                        <div>
                          <div className="text-[13px] font-semibold" style={{ color: on ? "#7C3AED" : "#374151" }}>{label}</div>
                          <div className="text-[11px] text-gray-500">{desc}</div>
                        </div>
                        {on
                          ? <ToggleRight className="w-7 h-7 text-violet-600" />
                          : <ToggleLeft className="w-7 h-7 text-gray-300" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => saveSettingsMutation.mutate()}
                disabled={saveSettingsMutation.isPending}
                className="w-full py-3 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 transition-colors"
                style={{ background: settingsSaved ? "#059669" : "#7C3AED" }}
              >
                {saveSettingsMutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                  : settingsSaved
                  ? <><CheckCircle2 className="w-4 h-4" /> Settings Saved!</>
                  : <><Save className="w-4 h-4" /> Save Settings</>}
              </button>
            </div>

            {/* Danger zone */}
            <div className="rounded-xl border border-red-100 bg-white p-4">
              <div className="text-[12px] font-bold text-red-600 mb-1">Agent Controls</div>
              <p className="text-[11px] text-gray-500 mb-3">Activate or pause the 24×7 autopilot. "Hunt Now" always triggers a one-time immediate cycle regardless of schedule.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleMutation.mutate()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold border transition-all"
                  style={status?.active ? { borderColor: "#FCA5A5", color: "#DC2626", background: "#FEF2F2" } : { borderColor: "#BBF7D0", color: "#059669", background: "#F0FDF4" }}
                >
                  {status?.active ? <><Pause className="w-3.5 h-3.5" /> Pause Autopilot</> : <><Play className="w-3.5 h-3.5" /> Activate Autopilot</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

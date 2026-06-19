import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Bot, Target, TrendingUp, ArrowRight,
  Activity, CheckCircle2, Clock, Users, Sparkles, Zap,
  Radar, RefreshCw, Brain, Mail, Send, BarChart3,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AgentStatus = {
  active: boolean;
  config: {
    lastRunAt: string;
    nextRunAt: string;
    totalLeadsFound: number;
    totalQualified: number;
    totalPipelineAdded: number;
    frequency: string;
  };
};

type OrchestratorStatus = {
  scoutActive: boolean;
  salesActive: boolean;
  followupActive: boolean;
  brainActive: boolean;
  lastScoutRun: string | null;
  lastSalesRun: string | null;
  lastFollowupRun: string | null;
  lastBrainTick: string | null;
  lastReportSent: string | null;
  totalAuditsSent: number;
  totalFollowupsSent: number;
  errors: string[];
};

type PipelineStats = {
  total: number;
  stageCount: Record<string, number>;
};

function formatRelative(iso: string | null | undefined) {
  if (!iso) return "Never";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return `${Math.round(diff / 86400000)}d ago`;
  } catch { return "—"; }
}

const AUTONOMOUS_AGENTS = [
  {
    key: "scout",
    name: "Scout Agent",
    tagline: "Website Recon & Lead Enrichment",
    desc: "Scans every new lead's website to confirm it's live before Sales Agent fires. Checks HTTP status, marks leads as live / down / no website.",
    icon: Radar,
    color: "#3B82F6",
    bg: "#EFF6FF",
    skills: ["Website status check", "HTTP/HTTPS fallback", "Auto-enrichment", "Runs every 30 min"],
    href: "/agents/control",
    activeKey: "scoutActive" as keyof OrchestratorStatus,
    lastRunKey: "lastScoutRun" as keyof OrchestratorStatus,
  },
  {
    key: "sales",
    name: "Sales Agent",
    tagline: "Brand Audit + First-Touch Outreach",
    desc: "Generates a personalised AI brand audit for each live-website lead and sends it via email. Creates HubSpot contact + deal automatically.",
    icon: Brain,
    color: "#7C3AED",
    bg: "#F5F3FF",
    skills: ["Claude AI brand audit", "Brevo email delivery", "HubSpot CRM sync", "Booking link injection"],
    href: "/agents/control",
    activeKey: "salesActive" as keyof OrchestratorStatus,
    lastRunKey: "lastSalesRun" as keyof OrchestratorStatus,
  },
  {
    key: "followup",
    name: "Follow-Up Agent",
    tagline: "D2 · D7 · D10 Outreach Sequences",
    desc: "Tracks every lead in the audit_sent stage and fires Day 2, Day 7, and Day 10 follow-up emails automatically until they reply or book a call.",
    icon: RefreshCw,
    color: "#10B981",
    bg: "#ECFDF5",
    skills: ["3-touch sequence", "Auto-scheduling", "Sequence expiry", "Pipeline stage tracking"],
    href: "/agents/control",
    activeKey: "followupActive" as keyof OrchestratorStatus,
    lastRunKey: "lastFollowupRun" as keyof OrchestratorStatus,
  },
];

export default function Agents() {
  const { data: hunterStatus } = useQuery<AgentStatus>({
    queryKey: ["agent-lead-hunter-status"],
    queryFn: () => fetch(`/api/agents/lead-hunter/status`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 10000,
  });

  const { data: orchStatus } = useQuery<OrchestratorStatus>({
    queryKey: ["orchestrator-status"],
    queryFn: () => fetch(`/api/agents/orchestrator/status`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 15000,
  });

  const { data: pipeline } = useQuery<PipelineStats>({
    queryKey: ["pipeline-stats"],
    queryFn: () => fetch(`/api/agents/pipeline-stats`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  const cfg = hunterStatus?.config;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7C3AED, #4F35A8)" }}>
            <Bot className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">AI Agents</h1>
          {orchStatus?.brainActive && (
            <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              System Online
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 ml-11.5">
          5 autonomous agents running 24×7 — hunting leads, auditing brands, sending outreach, and booking calls for Dreamsdesign.
        </p>
      </div>

      {/* ── Stats bar ── */}
      {orchStatus && pipeline && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Leads", value: pipeline.total, icon: Users, color: "#4F35A8" },
            { label: "Audits Sent", value: orchStatus.totalAuditsSent, icon: Mail, color: "#7C3AED" },
            { label: "Follow-Ups", value: orchStatus.totalFollowupsSent, icon: Send, color: "#10B981" },
            { label: "Calls Booked", value: pipeline.stageCount["call_booked"] ?? 0, icon: BarChart3, color: "#C9A84C" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl p-4 border text-center" style={{ background: "#FAFAFA", borderColor: "hsl(220 13% 91%)" }}>
              <div className="flex items-center justify-center gap-1.5 mb-1" style={{ color }}>
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── ACTIVE AGENTS ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Agents</span>
          <div className="h-px flex-1" style={{ background: "hsl(220 13% 91%)" }} />
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white" style={{ background: "#059669" }}>● 4 Online</span>
        </div>

        {/* Lead Hunter */}
        <div className="mb-4">
          <Link href="/agents/lead-hunter">
            <div
              className="rounded-2xl border overflow-hidden cursor-pointer group transition-all hover:shadow-lg"
              style={{ background: "#ffffff", borderColor: hunterStatus?.active ? "#7C3AED" : "hsl(220 13% 91%)" }}
            >
              <div className="h-1.5 w-full" style={{ background: hunterStatus?.active ? "linear-gradient(90deg, #7C3AED, #4F35A8, #7C3AED)" : "#E5E7EB", backgroundSize: "200% 100%", animation: hunterStatus?.active ? "shimmer 2s linear infinite" : "none" }} />
              <div className="p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3.5">
                    <div className="relative flex-shrink-0">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: "linear-gradient(135deg, #7C3AED 0%, #4F35A8 100%)" }}>
                        <Target className="w-7 h-7 text-white" />
                      </div>
                      {hunterStatus?.active && (
                        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white" style={{ background: "#059669" }}>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#059669" }} />
                          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#059669" }} />
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <h2 className="text-[17px] font-bold text-gray-900">Lead Hunter Agent</h2>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={hunterStatus?.active ? { background: "#D1FAE5", color: "#065F46" } : { background: "#F3F4F6", color: "#6B7280" }}>
                          {hunterStatus?.active ? "● Hunting" : "Idle"}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">Virtual BDR — hunts ICP-matched leads from Apollo, qualifies with BANT scoring</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-violet-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                    Configure <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: "Leads Found", value: cfg?.totalLeadsFound ?? 0, icon: <Users className="w-3.5 h-3.5" />, color: "#7C3AED" },
                    { label: "Qualified", value: cfg?.totalQualified ?? 0, icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "#059669" },
                    { label: "In Pipeline", value: cfg?.totalPipelineAdded ?? 0, icon: <Activity className="w-3.5 h-3.5" />, color: "#4F35A8" },
                  ].map(({ label, value, icon, color }) => (
                    <div key={label} className="rounded-xl p-3" style={{ background: "#FAFAFA", border: "1px solid hsl(220 13% 93%)" }}>
                      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
                        {icon}
                        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
                      </div>
                      <div className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {["ICP-aware hunting", "Apollo.io integration", "BANT scoring", "Anti-duplicate guard", "24×7 autopilot"].map(skill => (
                    <span key={skill} className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: "#F5F3FF", color: "#7C3AED" }}>{skill}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[12px]" style={{ color: "#9CA3AF" }}>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    Last run: <span className="font-medium text-gray-600 ml-0.5">{cfg ? formatRelative(cfg.lastRunAt) : "—"}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" />
                    Schedule: <span className="font-medium text-gray-600 ml-0.5">{cfg?.frequency ?? "24h"}</span>
                  </span>
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* Autonomous agents grid */}
        <div className="grid md:grid-cols-3 gap-4">
          {AUTONOMOUS_AGENTS.map(({ key, name, tagline, desc, icon: Icon, color, bg, skills, href, activeKey, lastRunKey }) => {
            const isActive = orchStatus ? Boolean(orchStatus[activeKey]) : false;
            const lastRun = orchStatus ? (orchStatus[lastRunKey] as string | null) : null;

            return (
              <Link key={key} href={href}>
                <div
                  className="rounded-2xl border overflow-hidden cursor-pointer group transition-all hover:shadow-lg h-full"
                  style={{ background: "#fff", borderColor: isActive ? color + "55" : "hsl(220 13% 91%)" }}
                >
                  <div className="h-1 w-full" style={{ background: isActive ? color : "#E5E7EB" }} />
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                          <Icon className="w-5 h-5" style={{ color }} />
                        </div>
                        <div>
                          <div className="text-[14px] font-bold text-gray-900">{name}</div>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                            style={isActive ? { background: color + "18", color } : { background: "#F3F4F6", color: "#9CA3AF" }}>
                            {isActive ? "● Online" : "Paused"}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-violet-500 transition-colors flex-shrink-0 mt-1" />
                    </div>

                    <div className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color }}>{tagline}</div>
                    <p className="text-[12px] text-gray-500 leading-relaxed mb-3">{desc}</p>

                    <div className="flex flex-wrap gap-1 mb-3">
                      {skills.map(s => (
                        <span key={s} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: bg, color }}>{s}</span>
                      ))}
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-gray-400">
                      <Clock className="w-3 h-3" />
                      Last run: <span className="font-medium text-gray-600 ml-0.5">{formatRelative(lastRun)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── SALES BRAIN ORCHESTRATOR ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sales Brain Orchestrator</span>
          <div className="h-px flex-1" style={{ background: "hsl(220 13% 91%)" }} />
        </div>

        <Link href="/agents/control">
          <div className="rounded-2xl overflow-hidden cursor-pointer group transition-all hover:shadow-xl" style={{ background: "linear-gradient(135deg, #0A0818 0%, #1A1040 100%)", border: "1px solid #2D1F5E" }}>
            <div className="p-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(197,162,76,0.15)" }}>
                    <Sparkles className="w-6 h-6 text-yellow-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[17px] font-bold text-white">Sales Brain</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={orchStatus?.brainActive ? { background: "rgba(16,185,129,0.2)", color: "#34D399" } : { background: "rgba(255,255,255,0.08)", color: "#9CA3AF" }}>
                        {orchStatus?.brainActive ? "● Orchestrating" : "Paused"}
                      </span>
                    </div>
                    <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.55)" }}>
                      Runs every 30 min · Sends daily report at 08:30 AM IST to dreamsdesign.in@gmail.com
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-yellow-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                  Control Room <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Agent network */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {[
                  { label: "Lead Hunter", icon: Target, color: "#7C3AED", activeKey: null, desc: "Finds & qualifies" },
                  { label: "Scout", icon: Radar, color: "#3B82F6", activeKey: "scoutActive", desc: "Checks websites" },
                  { label: "Sales Agent", icon: Brain, color: "#A78BFA", activeKey: "salesActive", desc: "Sends audits" },
                  { label: "Follow-Up", icon: RefreshCw, color: "#34D399", activeKey: "followupActive", desc: "Nurtures pipeline" },
                ].map(({ label, icon: Icon, color, activeKey, desc }) => {
                  const isOn = activeKey ? (orchStatus ? Boolean(orchStatus[activeKey as keyof OrchestratorStatus]) : false) : (hunterStatus?.active ?? false);
                  return (
                    <div key={label} className="rounded-xl p-3 flex flex-col items-center text-center" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${color}22` }}>
                        <Icon className="w-4 h-4" style={{ color }} />
                      </div>
                      <div className="text-[11px] font-bold text-white mb-0.5">{label}</div>
                      <div className="text-[9px] mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>{desc}</div>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={isOn ? { background: "rgba(16,185,129,0.2)", color: "#34D399" } : { background: "rgba(255,255,255,0.08)", color: "#6B7280" }}>
                        {isOn ? "online" : "paused"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Timing row */}
              {orchStatus && (
                <div className="flex flex-wrap gap-4 text-[12px]" style={{ color: "rgba(255,255,255,0.45)" }}>
                  <span>Last tick: <span className="text-white font-medium">{formatRelative(orchStatus.lastBrainTick)}</span></span>
                  <span>Last report: <span className="text-white font-medium">{formatRelative(orchStatus.lastReportSent)}</span></span>
                  <span>Errors: <span style={{ color: orchStatus.errors.length ? "#F87171" : "rgba(255,255,255,0.4)" }}>{orchStatus.errors.length}</span></span>
                </div>
              )}
            </div>
          </div>
        </Link>
      </section>
    </div>
  );
}

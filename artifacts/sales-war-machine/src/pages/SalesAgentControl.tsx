import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Zap, BarChart3, RefreshCw, Mail, Play, Send, AlertCircle,
  CheckCircle2, Clock, XCircle, Eye, Radar, Users, Activity,
  Loader2, TrendingUp, Target, Brain, ChevronRight,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

type Activity = {
  id: number;
  leadId: number | null;
  agentName: string;
  activityType: string;
  channel: string | null;
  status: string;
  errorMessage: string | null;
  executedAt: string;
};

type PipelineStats = {
  total: number;
  stageCount: Record<string, number>;
  statusCount: Record<string, number>;
};

type DailyReport = {
  id: number;
  reportDate: string;
  emailsSent: number;
  callsBooked: number;
  totalLeadsProcessed: number;
  meetingsToday: number;
  sentAt: string;
};

function formatRelative(iso: string | null) {
  if (!iso) return "Never";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return `${Math.round(diff / 86400000)}d ago`;
  } catch { return "—"; }
}

const STAGE_LABELS: Record<string, string> = {
  new: "New", contacted: "Contacted", audit_sent: "Audit Sent",
  engaged: "Engaged", call_booked: "Call Booked",
  show_up_confirmed: "Show Up", no_show: "No Show",
  proposal_sent: "Proposal Sent", won: "Won", lost: "Lost",
};

const STAGE_COLORS: Record<string, string> = {
  new: "#9CA3AF", contacted: "#60A5FA", audit_sent: "#A78BFA",
  engaged: "#34D399", call_booked: "#FBBF24", show_up_confirmed: "#10B981",
  no_show: "#F87171", proposal_sent: "#FB923C", won: "#22C55E", lost: "#EF4444",
};

const AGENT_META = [
  { key: "scout",   label: "Scout Agent",    icon: Radar,  color: "#3B82F6",
    desc: "Checks website status for every new lead — live, down, or no website.", runLabel: "Run Scout" },
  { key: "sales",   label: "Sales Agent",    icon: Brain,  color: "#7C3AED",
    desc: "Generates AI brand audits and sends them to leads via email.", runLabel: "Run Sales Agent" },
  { key: "followup",label: "Follow-Up Agent",icon: RefreshCw, color: "#10B981",
    desc: "Sends Day 2, Day 7, Day 10 follow-ups to leads who haven't replied.", runLabel: "Run Follow-Ups" },
  { key: "brain",   label: "Sales Brain",    icon: Zap,    color: "#C9A84C",
    desc: "Orchestrator — coordinates Scout → Sales → Follow-Up every 30 minutes.", runLabel: "Trigger Brain Tick" },
];

const RUN_ENDPOINTS: Record<string, string> = {
  scout:    "/api/agents/scout/run",
  sales:    "/api/agents/sales/run",
  followup: "/api/agents/followup/run",
  brain:    "/api/agents/orchestrator/tick",
};

export default function SalesAgentControl() {
  const qc = useQueryClient();
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [sendingReport, setSendingReport] = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<OrchestratorStatus>({
    queryKey: ["orchestrator-status"],
    queryFn: () => fetch(`/api/agents/orchestrator/status`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 15000,
  });

  const { data: activities } = useQuery<Activity[]>({
    queryKey: ["agent-activities"],
    queryFn: () => fetch(`/api/agents/activities`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 15000,
  });

  const { data: pipeline } = useQuery<PipelineStats>({
    queryKey: ["pipeline-stats"],
    queryFn: () => fetch(`/api/agents/pipeline-stats`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: reports } = useQuery<DailyReport[]>({
    queryKey: ["agent-reports"],
    queryFn: () => fetch(`/api/agents/reports`, { credentials: "include" }).then(r => r.json()),
  });

  const toggleMutation = useMutation({
    mutationFn: (agent: string) => fetch(`/api/agents/orchestrator/toggle`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orchestrator-status"] }),
  });

  async function runAgent(key: string) {
    setRunningAgent(key);
    setRunResult(null);
    try {
      const res = await fetch(`${RUN_ENDPOINTS[key]}`, { method: "POST", credentials: "include" });
      const data = await res.json() as Record<string, unknown>;
      const nums = Object.entries(data).filter(([k]) => k !== "ok").map(([k, v]) => `${v} ${k}`).join(", ");
      setRunResult(`✓ Done: ${nums || "0 items"}`);
      qc.invalidateQueries({ queryKey: ["orchestrator-status"] });
      qc.invalidateQueries({ queryKey: ["agent-activities"] });
      qc.invalidateQueries({ queryKey: ["pipeline-stats"] });
    } catch {
      setRunResult("✗ Error running agent");
    } finally {
      setRunningAgent(null);
    }
  }

  async function sendReport() {
    setSendingReport(true);
    setReportResult(null);
    try {
      const res = await fetch(`/api/agents/report/send`, { method: "POST", credentials: "include" });
      const data = await res.json() as { ok: boolean; email: string };
      setReportResult(data.ok ? `✓ Report sent to ${data.email}` : "✗ Failed to send report");
      qc.invalidateQueries({ queryKey: ["agent-reports"] });
      qc.invalidateQueries({ queryKey: ["orchestrator-status"] });
    } catch {
      setReportResult("✗ Error sending report");
    } finally {
      setSendingReport(false);
    }
  }

  function isAgentActive(key: string): boolean {
    if (!status) return false;
    if (key === "scout")    return status.scoutActive;
    if (key === "sales")    return status.salesActive;
    if (key === "followup") return status.followupActive;
    if (key === "brain")    return status.brainActive;
    return false;
  }

  function getLastRun(key: string): string | null {
    if (!status) return null;
    if (key === "scout")    return status.lastScoutRun;
    if (key === "sales")    return status.lastSalesRun;
    if (key === "followup") return status.lastFollowupRun;
    if (key === "brain")    return status.lastBrainTick;
    return null;
  }

  const maxStageCount = Math.max(1, ...Object.values(pipeline?.stageCount ?? {}));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#C9A84C,#F59E0B)" }}>
              <Zap className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Agent Control Room</h1>
          </div>
          <p className="text-sm text-gray-500 ml-11.5">Manage, monitor and manually trigger your autonomous AI sales agents.</p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${status.brainActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.brainActive ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
              {status.brainActive ? "Brain Online" : "Brain Paused"}
            </span>
          )}
        </div>
      </div>

      {/* Run result flash */}
      {runResult && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${runResult.startsWith("✓") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {runResult}
        </div>
      )}

      {/* 4 Agent Cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {AGENT_META.map(({ key, label, icon: Icon, color, desc, runLabel }) => {
          const active = isAgentActive(key);
          const lastRun = getLastRun(key);
          const running = runningAgent === key;

          return (
            <div key={key} className="rounded-2xl border p-5" style={{ background: "#fff", borderColor: active ? color + "55" : "hsl(220 13% 91%)" }}>
              {/* Agent header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: active ? color + "18" : "#F3F4F6" }}>
                    <Icon className="w-5 h-5" style={{ color: active ? color : "#9CA3AF" }} />
                  </div>
                  <div>
                    <div className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                      {label}
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                        style={active ? { background: color + "18", color } : { background: "#F3F4F6", color: "#9CA3AF" }}>
                        {active ? "● Online" : "Paused"}
                      </span>
                    </div>
                    <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">{desc}</p>
                  </div>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => toggleMutation.mutate(key)}
                  disabled={statusLoading}
                  className="flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold border transition-all hover:opacity-80"
                  style={active
                    ? { background: color + "15", color, borderColor: color + "40" }
                    : { background: "#F3F4F6", color: "#6B7280", borderColor: "#E5E7EB" }}
                >
                  {active ? "Pause" : "Resume"}
                </button>
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Clock className="w-3.5 h-3.5" />
                  Last run: <span className="font-semibold text-gray-600 ml-0.5">{formatRelative(lastRun)}</span>
                </div>
                {key === "sales" && status && (
                  <div className="text-xs text-gray-500">
                    <span className="font-bold text-gray-800">{status.totalAuditsSent}</span> audits sent
                  </div>
                )}
                {key === "followup" && status && (
                  <div className="text-xs text-gray-500">
                    <span className="font-bold text-gray-800">{status.totalFollowupsSent}</span> follow-ups sent
                  </div>
                )}
              </div>

              {/* Run button */}
              <button
                onClick={() => runAgent(key)}
                disabled={running || !!runningAgent}
                className="w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: running ? "#F3F4F6" : color + "15", color: running ? "#9CA3AF" : color, border: `1px solid ${color}30` }}
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {running ? "Running…" : runLabel}
              </button>
            </div>
          );
        })}
      </div>

      {/* Summary row */}
      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Leads", value: pipeline?.total ?? 0, icon: Users, color: "#4F35A8" },
            { label: "Audits Sent", value: status.totalAuditsSent, icon: Mail, color: "#7C3AED" },
            { label: "Follow-Ups Sent", value: status.totalFollowupsSent, icon: RefreshCw, color: "#10B981" },
            { label: "Reports Sent", value: reports?.length ?? 0, icon: Send, color: "#C9A84C" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl p-4 border text-center" style={{ background: "#FAFAFA", borderColor: "hsl(220 13% 91%)" }}>
              <div className="flex items-center justify-center gap-1.5 mb-1.5" style={{ color }}>
                <Icon className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Pipeline Stage Distribution */}
      {pipeline && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-gray-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Pipeline Funnel</span>
            <div className="h-px flex-1" style={{ background: "hsl(220 13% 91%)" }} />
            <span className="text-xs text-gray-400">{pipeline.total} total leads</span>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(220 13% 91%)" }}>
            {Object.entries(pipeline.stageCount)
              .sort((a, b) => b[1] - a[1])
              .map(([stage, count]) => {
                const pct = Math.round((count / maxStageCount) * 100);
                const color = STAGE_COLORS[stage] ?? "#9CA3AF";
                return (
                  <div key={stage} className="flex items-center gap-4 px-5 py-3 border-b last:border-0" style={{ borderColor: "hsl(220 13% 91%)" }}>
                    <div className="w-28 text-xs font-semibold text-gray-600 flex-shrink-0">{STAGE_LABELS[stage] ?? stage}</div>
                    <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <div className="w-8 text-right text-sm font-bold" style={{ color }}>{count}</div>
                  </div>
                );
              })}
          </div>

          {/* Website status pills */}
          <div className="flex flex-wrap gap-2 mt-3">
            {Object.entries(pipeline.statusCount).map(([status, count]) => (
              <span key={status} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{
                  background: status === "live" ? "#DCFCE7" : status === "down" ? "#FEE2E2" : "#F3F4F6",
                  color:      status === "live" ? "#15803D" : status === "down" ? "#DC2626" : "#6B7280",
                }}>
                <span className="w-1.5 h-1.5 rounded-full"
                  style={{ background: status === "live" ? "#22C55E" : status === "down" ? "#EF4444" : "#9CA3AF" }} />
                {count} {status === "unchecked" ? "unchecked" : status}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Activity Log */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-gray-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Recent Activity Log</span>
          <div className="h-px flex-1" style={{ background: "hsl(220 13% 91%)" }} />
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["agent-activities"] })}
            className="text-xs text-violet-600 font-semibold flex items-center gap-1 hover:text-violet-800"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(220 13% 91%)" }}>
          {!activities || activities.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No activities yet. Run an agent to see logs here.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: "hsl(220 13% 93%)" }}>
              {activities.slice(0, 30).map(a => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex-shrink-0">
                    {a.status === "success"
                      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                      : a.status === "pending"
                      ? <Loader2 className="w-4 h-4 text-yellow-500" />
                      : <XCircle className="w-4 h-4 text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-700"
                        style={{ color: a.agentName === "scout" ? "#3B82F6" : a.agentName === "sales" ? "#7C3AED" : a.agentName === "followup" ? "#10B981" : "#C9A84C" }}>
                        [{a.agentName.toUpperCase()}]
                      </span>
                      <span className="text-xs font-semibold text-gray-800">{a.activityType.replace(/_/g, " ")}</span>
                      {a.channel && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-500">{a.channel}</span>
                      )}
                      {a.leadId && (
                        <span className="text-[10px] text-gray-400">lead #{a.leadId}</span>
                      )}
                    </div>
                    {a.errorMessage && (
                      <p className="text-[11px] text-red-500 mt-0.5 truncate">{a.errorMessage}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-[11px] text-gray-400">{formatRelative(a.executedAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Daily Report */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Send className="w-4 h-4 text-gray-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Daily Report — 08:30 AM IST</span>
          <div className="h-px flex-1" style={{ background: "hsl(220 13% 91%)" }} />
          <button
            onClick={sendReport}
            disabled={sendingReport}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)", color: "#fff" }}
          >
            {sendingReport ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Send Now
          </button>
        </div>

        {reportResult && (
          <div className={`rounded-xl px-4 py-2.5 text-sm font-medium mb-3 ${reportResult.startsWith("✓") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {reportResult}
          </div>
        )}

        {status?.lastReportSent && (
          <div className="text-xs text-gray-400 mb-3 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Last sent: <span className="font-semibold text-gray-600">{formatRelative(status.lastReportSent)}</span>
            <span className="mx-1">·</span>
            Sends automatically every day at 08:30 AM IST to dreamsdesign.in@gmail.com
          </div>
        )}
        {!status?.lastReportSent && (
          <p className="text-xs text-gray-400 mb-3">Sends automatically every day at 08:30 AM IST to dreamsdesign.in@gmail.com · Click "Send Now" to test it.</p>
        )}

        {reports && reports.length > 0 ? (
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(220 13% 91%)" }}>
            {reports.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-center gap-4 px-5 py-3 border-b last:border-0 hover:bg-gray-50" style={{ borderColor: "hsl(220 13% 91%)" }}>
                <div>
                  <div className="text-xs font-bold text-gray-800">{r.reportDate}</div>
                  <div className="text-[11px] text-gray-400">{formatRelative(r.sentAt)}</div>
                </div>
                <div className="flex-1" />
                <div className="flex gap-4 text-xs text-gray-500">
                  <span><span className="font-bold text-gray-800">{r.emailsSent}</span> emails</span>
                  <span><span className="font-bold text-gray-800">{r.callsBooked}</span> calls</span>
                  <span><span className="font-bold text-gray-800">{r.meetingsToday}</span> meetings</span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border p-6 text-center text-sm text-gray-400" style={{ borderColor: "hsl(220 13% 91%)" }}>
            No reports sent yet. Click "Send Now" to send today's report instantly.
          </div>
        )}
      </section>

      {/* Error Log */}
      {status?.errors && status.errors.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Recent Errors ({status.errors.length})</span>
            <div className="h-px flex-1" style={{ background: "hsl(220 13% 91%)" }} />
          </div>
          <div className="rounded-xl border border-red-100 overflow-hidden bg-red-50">
            {status.errors.slice(-10).reverse().map((e, i) => (
              <div key={i} className="flex items-start gap-2 px-4 py-2.5 border-b border-red-100 last:border-0">
                <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                <span className="text-[11px] text-red-700 leading-snug">{e}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

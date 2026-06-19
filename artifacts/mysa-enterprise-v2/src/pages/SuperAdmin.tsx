import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Crown, Users, TrendingUp, DollarSign, Zap, Mail, Activity,
  CheckCircle2, Clock, XCircle, AlertTriangle, Globe, Plus, RefreshCw,
  BarChart3, Building2, Shield, Loader2, ChevronRight, Send,
  Eye, Ban, Trash2, UserPlus, BadgeDollarSign,
  MessageSquarePlus, Bot, Wrench, CheckCheck, Bug, Sparkles,
  Flag, MessageCircle, ChevronDown, ChevronUp, AlertCircle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Summary = {
  totalOrgs: number; activeOrgs: number; trialOrgs: number;
  canceledOrgs: number; pendingInvite: number; totalWaitlist: number;
  totalLeads: number; mrr: number; arr: number;
};

type Org = {
  id: number; name: string; email: string; ownerName: string | null;
  plan: string; subscriptionStatus: string; isActive: boolean; isSuspended: boolean;
  leadsUsedThisMonth: number; emailsUsedThisMonth: number;
  trialEndsAt: string | null; currentPeriodEnd: string | null;
  createdAt: string;
};

type WaitlistEntry = {
  id: number; name: string; email: string; company: string | null;
  role: string | null; location: string | null; phone: string | null;
  message: string | null; approved: boolean; createdAt: string;
};

type DashboardData = {
  summary: Summary;
  planCounts: Record<string, number>;
  stageCount: Record<string, number>;
  signupTrend: Array<{ date: string; count: number }>;
  recentOrgs: Org[];
  pendingWaitlist: WaitlistEntry[];
  recentActivities: Array<{ id: number; agentName: string; activityType: string; status: string; executedAt: string }>;
};

const PLAN_COLORS: Record<string, string> = {
  trial: "#9CA3AF", starter: "#3B82F6", growth: "#7C3AED", pro: "#C9A84C",
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:    { bg: "#D1FAE5", text: "#065F46" },
  trialing:  { bg: "#EDE9FE", text: "#5B21B6" },
  past_due:  { bg: "#FEE2E2", text: "#991B1B" },
  canceled:  { bg: "#F3F4F6", text: "#6B7280" },
};

function fmt(n: number, decimals = 0) { return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
function fmtCurrency(n: number) { return "$" + fmt(n); }
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}
function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

const PLAN_LIMITS: Record<string, { leads: number; emails: number }> = {
  trial: { leads: 50, emails: 100 },
  starter: { leads: 500, emails: 1000 },
  growth: { leads: 2000, emails: 5000 },
  pro: { leads: 99999, emails: 99999 },
};

type Tab = "overview" | "organizations" | "waitlist" | "feedback";

type FeedbackItem = {
  id: number;
  category: string;
  title: string;
  message: string;
  page: string | null;
  email: string | null;
  status: string;
  priority: string;
  aiDiscussion: string | null;
  createdAt: string;
  updatedAt: string;
};

type DiscussMessage = { role: "user" | "assistant"; content: string };

export default function SuperAdmin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [newOrg, setNewOrg] = useState({ email: "", name: "", ownerName: "", plan: "trial", phone: "", website: "" });
  const [saving, setSaving] = useState(false);

  // Feedback state
  const [activeFeedbackId, setActiveFeedbackId] = useState<number | null>(null);
  const [discussInput, setDiscussInput] = useState("");
  const [discussing, setDiscussing] = useState(false);
  const [discussHistory, setDiscussHistory] = useState<DiscussMessage[]>([]);
  const [fixPlan, setFixPlan] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [showDiscuss, setShowDiscuss] = useState(false);
  const [showFix, setShowFix] = useState(false);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["saas-dashboard"],
    queryFn: () => fetch(`/api/saas/dashboard`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: orgs } = useQuery<Org[]>({
    queryKey: ["saas-orgs"],
    queryFn: () => fetch(`/api/saas/organizations`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "organizations",
  });

  const { data: waitlistAll } = useQuery<WaitlistEntry[]>({
    queryKey: ["saas-waitlist"],
    queryFn: () => fetch(`/api/saas/waitlist`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "waitlist",
  });

  const { data: feedbackList, isLoading: feedbackLoading } = useQuery<FeedbackItem[]>({
    queryKey: ["saas-feedback"],
    queryFn: () => fetch(`/api/saas/feedback`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "feedback",
    refetchInterval: tab === "feedback" ? 30000 : false,
  });

  const inviteMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/saas/waitlist/${id}/invite`, { method: "POST", credentials: "include" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saas-dashboard"] }); qc.invalidateQueries({ queryKey: ["saas-waitlist"] }); },
  });

  const suspendMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/saas/organizations/${id}/suspend`, { method: "POST", credentials: "include" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saas-orgs"] }),
  });

  const deleteFeedbackMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/saas/feedback/${id}`, { method: "DELETE", credentials: "include" }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saas-feedback"] });
      if (activeFeedbackId) { setActiveFeedbackId(null); setDiscussHistory([]); setFixPlan(null); }
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      fetch(`/api/saas/feedback/${id}/status`, { method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saas-feedback"] }),
  });

  async function openFeedback(item: FeedbackItem) {
    setActiveFeedbackId(item.id);
    setFixPlan(null);
    setShowDiscuss(false);
    setShowFix(false);
    try {
      const history: DiscussMessage[] = item.aiDiscussion ? JSON.parse(item.aiDiscussion) : [];
      setDiscussHistory(history);
    } catch { setDiscussHistory([]); }
  }

  async function sendDiscussMessage(feedbackId: number) {
    if (!discussInput.trim() && discussHistory.length > 0) return;
    setDiscussing(true);
    try {
      const res = await fetch(`/api/saas/feedback/${feedbackId}/discuss`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage: discussInput.trim() || undefined }),
      });
      const data = await res.json();
      setDiscussHistory(data.history ?? []);
      setDiscussInput("");
    } finally { setDiscussing(false); }
  }

  async function runFix(feedbackId: number) {
    setFixing(true);
    setFixPlan(null);
    try {
      const res = await fetch(`/api/saas/feedback/${feedbackId}/fix`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      setFixPlan(data.plan);
      qc.invalidateQueries({ queryKey: ["saas-feedback"] });
    } finally { setFixing(false); }
  }

  async function createOrg() {
    setSaving(true);
    try {
      await fetch(`/api/saas/organizations`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOrg),
      });
      qc.invalidateQueries({ queryKey: ["saas-orgs"] });
      qc.invalidateQueries({ queryKey: ["saas-dashboard"] });
      setShowOrgModal(false);
      setNewOrg({ email: "", name: "", ownerName: "", plan: "trial", phone: "", website: "" });
    } finally { setSaving(false); }
  }

  const s = data?.summary;
  const maxTrend = Math.max(1, ...(data?.signupTrend?.map(d => d.count) ?? []));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#C9A84C,#F59E0B)" }}>
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                Super Admin
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}>
                  MYSA AI SAAS
                </span>
              </h1>
            </div>
          </div>
          <p className="text-sm text-gray-500 ml-11.5">Full platform control — subscribers, billing, agents, and growth metrics.</p>
        </div>
        <button
          onClick={() => setShowOrgModal(true)}
          className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl text-white transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}
        >
          <Plus className="w-4 h-4" /> Add Organization
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit flex-wrap" style={{ background: "#F3F4F6" }}>
        {(["overview", "organizations", "waitlist", "feedback"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all flex items-center gap-1.5"
            style={tab === t ? { background: "#fff", color: "#4F35A8", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" } : { color: "#6B7280" }}>
            {t === "feedback" && <MessageSquarePlus className="w-3.5 h-3.5" />}
            {t}{t === "waitlist" && data?.summary?.pendingInvite ? ` (${data.summary.pendingInvite})` : ""}
            {t === "feedback" && feedbackList && feedbackList.filter(f => f.status === "new").length > 0 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: "#EF4444" }}>
                {feedbackList.filter(f => f.status === "new").length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Monthly Revenue", value: fmtCurrency(s?.mrr ?? 0), sub: `ARR: ${fmtCurrency(s?.arr ?? 0)}`, icon: DollarSign, color: "#C9A84C", bg: "#FFFBEB" },
              { label: "Active Subscribers", value: fmt(s?.activeOrgs ?? 0), sub: `${fmt(s?.trialOrgs ?? 0)} on trial`, icon: Users, color: "#7C3AED", bg: "#F5F3FF" },
              { label: "Total Organizations", value: fmt(s?.totalOrgs ?? 0), sub: `${fmt(s?.canceledOrgs ?? 0)} churned`, icon: Building2, color: "#3B82F6", bg: "#EFF6FF" },
              { label: "Total Leads (DB)", value: fmt(s?.totalLeads ?? 0), sub: `${fmt(s?.totalWaitlist ?? 0)} waitlist`, icon: BarChart3, color: "#10B981", bg: "#ECFDF5" },
            ].map(({ label, value, sub, icon: Icon, color, bg }) => (
              <div key={label} className="rounded-2xl border p-5" style={{ background: "#fff", borderColor: "hsl(220 13% 91%)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: bg }}>
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 mb-0.5">{value}</div>
                <div className="text-[12px] text-gray-400">{sub}</div>
              </div>
            ))}
          </div>

          {/* Signup Trend */}
          {data?.signupTrend && (
            <div className="rounded-2xl border p-5" style={{ borderColor: "hsl(220 13% 91%)" }}>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-violet-500" />
                <span className="text-sm font-bold text-gray-800">New Organizations — Last 12 Days</span>
              </div>
              <div className="flex items-end gap-2 h-20">
                {data.signupTrend.map(({ date, count }) => (
                  <div key={date} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-md transition-all"
                      style={{
                        height: `${count === 0 ? 4 : Math.max(8, (count / maxTrend) * 72)}px`,
                        background: count > 0 ? "linear-gradient(180deg,#7C3AED,#4F35A8)" : "#F3F4F6",
                      }}
                      title={`${date}: ${count}`}
                    />
                    <span className="text-[9px] text-gray-400">{date.slice(8)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plan Distribution + Recent orgs */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Plan breakdown */}
            <div className="rounded-2xl border p-5" style={{ borderColor: "hsl(220 13% 91%)" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">Plan Distribution</div>
              {Object.entries(data?.planCounts ?? {}).map(([plan, count]) => (
                <div key={plan} className="flex items-center gap-3 mb-3">
                  <div className="w-16 text-xs font-semibold capitalize" style={{ color: PLAN_COLORS[plan] ?? "#9CA3AF" }}>{plan}</div>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${(count / Math.max(1, s?.totalOrgs ?? 1)) * 100}%`,
                      background: PLAN_COLORS[plan] ?? "#9CA3AF",
                    }} />
                  </div>
                  <div className="w-6 text-right text-xs font-bold text-gray-700">{count}</div>
                </div>
              ))}
            </div>

            {/* Pending waitlist */}
            <div className="rounded-2xl border p-5" style={{ borderColor: "hsl(220 13% 91%)" }}>
              <div className="flex items-center justify-between mb-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Pending Invites</div>
                <button onClick={() => setTab("waitlist")} className="text-xs text-violet-600 font-semibold hover:text-violet-800 flex items-center gap-1">
                  View all <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              {data?.pendingWaitlist?.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No pending invites.</p>
              ) : data?.pendingWaitlist?.map(w => (
                <div key={w.id} className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: "hsl(220 13% 93%)" }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-800 truncate">{w.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">{w.email} {w.company && `— ${w.company}`}</div>
                  </div>
                  <button
                    onClick={() => inviteMutation.mutate(w.id)}
                    disabled={inviteMutation.isPending}
                    className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all hover:opacity-90 text-white"
                    style={{ background: "#7C3AED" }}>
                    {inviteMutation.isPending ? "…" : "Invite"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          {data?.recentActivities && (
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(220 13% 91%)" }}>
              <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "hsl(220 13% 91%)" }}>
                <Activity className="w-4 h-4 text-gray-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Recent Agent Activity</span>
              </div>
              {data.recentActivities.map(a => (
                <div key={a.id} className="flex items-center gap-3 px-5 py-2.5 border-b last:border-0 hover:bg-gray-50" style={{ borderColor: "hsl(220 13% 93%)" }}>
                  {a.status === "success" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                  <span className="text-[11px] font-bold" style={{ color: a.agentName === "scout" ? "#3B82F6" : a.agentName === "sales" ? "#7C3AED" : "#10B981" }}>
                    [{a.agentName.toUpperCase()}]
                  </span>
                  <span className="text-xs text-gray-700 flex-1">{a.activityType.replace(/_/g, " ")}</span>
                  <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtRelative(a.executedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── ORGANIZATIONS TAB ── */}
      {tab === "organizations" && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(220 13% 91%)" }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(220 13% 91%)" }}>
            <span className="text-sm font-bold text-gray-800">{orgs?.length ?? 0} Organizations</span>
            <button onClick={() => qc.invalidateQueries({ queryKey: ["saas-orgs"] })} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {!orgs ? (
            <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-violet-500 mx-auto" /></div>
          ) : orgs.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No organizations yet. Add one or invite from the waitlist.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    {["Organization", "Plan", "Status", "Usage", "Trial/Renewal", "Actions"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orgs.map(org => {
                    const lim = PLAN_LIMITS[org.plan] ?? PLAN_LIMITS.trial!;
                    const leadPct = Math.min(100, Math.round((org.leadsUsedThisMonth / lim.leads) * 100));
                    const statusStyle = STATUS_COLORS[org.subscriptionStatus] ?? STATUS_COLORS.canceled!;
                    return (
                      <tr key={org.id} className="border-t hover:bg-gray-50 transition-colors" style={{ borderColor: "hsl(220 13% 93%)" }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {org.isSuspended && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                            <div>
                              <div className="text-xs font-bold text-gray-900">{org.name}</div>
                              <div className="text-[11px] text-gray-400">{org.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full capitalize"
                            style={{ background: (PLAN_COLORS[org.plan] ?? "#9CA3AF") + "18", color: PLAN_COLORS[org.plan] ?? "#9CA3AF" }}>
                            {org.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full capitalize"
                            style={{ background: statusStyle.bg, color: statusStyle.text }}>
                            {org.subscriptionStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-24">
                            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${leadPct}%`, background: leadPct > 80 ? "#EF4444" : "#7C3AED" }} />
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">{org.leadsUsedThisMonth} / {lim.leads === 99999 ? "∞" : lim.leads}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-gray-400">
                          {org.trialEndsAt ? `Trial ends ${fmtDate(org.trialEndsAt)}` : fmtDate(org.currentPeriodEnd)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => suspendMutation.mutate(org.id)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                              title={org.isSuspended ? "Unsuspend" : "Suspend"}>
                              {org.isSuspended ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Ban className="w-3.5 h-3.5 text-amber-500" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── WAITLIST TAB ── */}
      {tab === "waitlist" && (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(220 13% 91%)" }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(220 13% 91%)" }}>
            <span className="text-sm font-bold text-gray-800">{waitlistAll?.length ?? 0} Waitlist Signups</span>
            <span className="text-xs text-gray-400">{waitlistAll?.filter(w => !w.approved).length ?? 0} pending invite</span>
          </div>
          {!waitlistAll ? (
            <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-violet-500 mx-auto" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    {["Name", "Email", "Company", "Role", "Signed Up", "Status", "Action"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {waitlistAll.map(w => (
                    <tr key={w.id} className="border-t hover:bg-gray-50" style={{ borderColor: "hsl(220 13% 93%)" }}>
                      <td className="px-4 py-3 text-xs font-semibold text-gray-900">{w.name}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-500">{w.email}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-500">{w.company ?? "—"}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-500">{w.role ?? "—"}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-400">{fmtDate(w.createdAt)}</td>
                      <td className="px-4 py-3">
                        {w.approved
                          ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Invited ✓</span>
                          : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Pending</span>}
                      </td>
                      <td className="px-4 py-3">
                        {!w.approved && (
                          <button
                            onClick={() => inviteMutation.mutate(w.id)}
                            disabled={inviteMutation.isPending}
                            className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all hover:opacity-90 text-white disabled:opacity-50"
                            style={{ background: "#7C3AED" }}>
                            <UserPlus className="w-3 h-3" />
                            {inviteMutation.isPending ? "Inviting…" : "Invite"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── FEEDBACK CENTER TAB ── */}
      {tab === "feedback" && (
        <div className="space-y-4">
          {/* Stats bar */}
          {feedbackList && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total", value: feedbackList.length, color: "#6B7280", bg: "#F9FAFB" },
                { label: "New", value: feedbackList.filter(f => f.status === "new").length, color: "#EF4444", bg: "#FEF2F2" },
                { label: "Bugs", value: feedbackList.filter(f => f.category === "bug").length, color: "#F59E0B", bg: "#FFFBEB" },
                { label: "Fixed", value: feedbackList.filter(f => f.status === "fixed").length, color: "#10B981", bg: "#ECFDF5" },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className="rounded-xl border px-4 py-3" style={{ background: bg, borderColor: "hsl(220 13% 91%)" }}>
                  <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "#9CA3AF" }}>{label}</div>
                  <div className="text-2xl font-bold" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* List + Detail split */}
          <div className="flex gap-4" style={{ minHeight: 480 }}>
            {/* Feedback list */}
            <div className="flex-shrink-0 rounded-2xl border overflow-hidden" style={{ width: 340, borderColor: "hsl(220 13% 91%)" }}>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "hsl(220 13% 91%)" }}>
                <span className="text-sm font-bold text-gray-800">All Feedback</span>
                <button onClick={() => qc.invalidateQueries({ queryKey: ["saas-feedback"] })} className="text-gray-400 hover:text-gray-600">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {feedbackLoading ? (
                <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-violet-500 mx-auto" /></div>
              ) : !feedbackList || feedbackList.length === 0 ? (
                <div className="p-8 text-center">
                  <MessageSquarePlus className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No feedback yet.</p>
                  <p className="text-xs text-gray-300 mt-1">Users can submit via the "Send Feedback" button in the sidebar.</p>
                </div>
              ) : (
                <div className="overflow-y-auto" style={{ maxHeight: 460 }}>
                  {feedbackList.map(item => {
                    const catColors: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
                      bug: { bg: "#FEF2F2", text: "#DC2626", icon: <Bug className="w-3 h-3" /> },
                      feature: { bg: "#F5F3FF", text: "#7C3AED", icon: <Sparkles className="w-3 h-3" /> },
                      general: { bg: "#EFF6FF", text: "#2563EB", icon: <MessageCircle className="w-3 h-3" /> },
                      complaint: { bg: "#FFFBEB", text: "#D97706", icon: <AlertCircle className="w-3 h-3" /> },
                    };
                    const statusColors: Record<string, string> = {
                      new: "#EF4444", discussing: "#7C3AED", fixing: "#F59E0B", fixed: "#10B981", closed: "#9CA3AF",
                    };
                    const cat = catColors[item.category] ?? catColors.general!;
                    const isActive = activeFeedbackId === item.id;

                    return (
                      <button
                        key={item.id}
                        onClick={() => openFeedback(item)}
                        className="w-full text-left px-4 py-3 border-b transition-colors"
                        style={{
                          borderColor: "hsl(220 13% 93%)",
                          background: isActive ? "#F5F3FF" : "white",
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "#F9FAFB"; }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "white"; }}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center mt-0.5" style={{ background: cat.bg, color: cat.text }}>
                            {cat.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[11px] font-bold truncate" style={{ color: isActive ? "#4F35A8" : "#111827" }}>{item.title}</span>
                              <span className="flex-shrink-0 w-2 h-2 rounded-full" style={{ background: statusColors[item.status] ?? "#9CA3AF" }} />
                            </div>
                            <div className="text-[10px] text-gray-400 truncate">{item.message}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize" style={{ background: cat.bg, color: cat.text }}>{item.category}</span>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize" style={{
                                background: item.priority === "high" ? "#FEF2F2" : item.priority === "medium" ? "#FFFBEB" : "#F0FDF4",
                                color: item.priority === "high" ? "#DC2626" : item.priority === "medium" ? "#D97706" : "#16A34A",
                              }}>{item.priority}</span>
                              <span className="text-[9px] text-gray-300 ml-auto">{fmtRelative(item.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Detail panel */}
            <div className="flex-1 rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(220 13% 91%)" }}>
              {!activeFeedbackId || !feedbackList ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <MessageSquarePlus className="w-10 h-10 text-gray-200 mb-3" />
                  <div className="text-sm font-semibold text-gray-400">Select a feedback item</div>
                  <div className="text-xs text-gray-300 mt-1">Click any item on the left to view details and use AI tools</div>
                </div>
              ) : (() => {
                const item = feedbackList.find(f => f.id === activeFeedbackId);
                if (!item) return null;
                const statusColors: Record<string, string> = {
                  new: "#EF4444", discussing: "#7C3AED", fixing: "#F59E0B", fixed: "#10B981", closed: "#9CA3AF",
                };

                return (
                  <div className="flex flex-col h-full overflow-y-auto">
                    {/* Detail header */}
                    <div className="px-5 py-4 border-b" style={{ borderColor: "hsl(220 13% 91%)" }}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-gray-900 text-sm mb-1">{item.title}</h3>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize" style={{
                              background: item.category === "bug" ? "#FEF2F2" : item.category === "feature" ? "#F5F3FF" : "#EFF6FF",
                              color: item.category === "bug" ? "#DC2626" : item.category === "feature" ? "#7C3AED" : "#2563EB",
                            }}>{item.category}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize" style={{ background: `${statusColors[item.status]}20`, color: statusColors[item.status] }}>{item.status}</span>
                            {item.page && <span className="text-[10px] text-gray-400">📍 {item.page}</span>}
                            {item.email && <span className="text-[10px] text-gray-400">✉️ {item.email}</span>}
                            <span className="text-[10px] text-gray-300">{fmtDate(item.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {item.status !== "fixed" && (
                            <button
                              onClick={() => updateStatusMutation.mutate({ id: item.id, status: "fixed" })}
                              className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg text-white transition-all hover:opacity-90"
                              style={{ background: "#10B981" }}
                            >
                              <CheckCheck className="w-3.5 h-3.5" /> Fixed
                            </button>
                          )}
                          {item.status !== "closed" && (
                            <button
                              onClick={() => updateStatusMutation.mutate({ id: item.id, status: "closed" })}
                              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all hover:bg-gray-50"
                              style={{ color: "#6B7280", borderColor: "hsl(220 13% 91%)" }}
                            >
                              Close
                            </button>
                          )}
                          <button
                            onClick={() => deleteFeedbackMutation.mutate(item.id)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center border transition-all hover:bg-red-50 hover:border-red-200"
                            style={{ borderColor: "hsl(220 13% 91%)" }}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 rounded-xl px-4 py-3">{item.message}</p>
                    </div>

                    {/* AI Action buttons */}
                    <div className="px-5 py-3 flex gap-3 border-b" style={{ borderColor: "hsl(220 13% 91%)" }}>
                      <button
                        onClick={() => { setShowDiscuss(!showDiscuss); setShowFix(false); if (!showDiscuss && discussHistory.length === 0) sendDiscussMessage(item.id); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all"
                        style={{ background: showDiscuss ? "#4F35A8" : "#F5F3FF", color: showDiscuss ? "#fff" : "#4F35A8", border: `1px solid ${showDiscuss ? "#4F35A8" : "#DDD6FE"}` }}
                      >
                        <Bot className="w-4 h-4" />
                        Discuss with AI
                        {showDiscuss ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => { setShowFix(!showFix); setShowDiscuss(false); if (!showFix && !fixPlan) runFix(item.id); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all"
                        style={{ background: showFix ? "#7C3AED" : "#F5F3FF", color: showFix ? "#fff" : "#7C3AED", border: `1px solid ${showFix ? "#7C3AED" : "#DDD6FE"}` }}
                      >
                        <Wrench className="w-4 h-4" />
                        Fix It
                        {fixing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      </button>
                    </div>

                    {/* AI Discuss panel */}
                    {showDiscuss && (
                      <div className="flex-1 flex flex-col" style={{ minHeight: 280 }}>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 280 }}>
                          {discussing && discussHistory.length === 0 && (
                            <div className="flex items-center gap-2 text-sm text-gray-400">
                              <Loader2 className="w-4 h-4 animate-spin text-violet-500" /> Analyzing with AI…
                            </div>
                          )}
                          {discussHistory.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                              {msg.role === "assistant" && (
                                <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mr-2" style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}>
                                  <Bot className="w-3.5 h-3.5 text-white" />
                                </div>
                              )}
                              <div
                                className="max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap"
                                style={msg.role === "user"
                                  ? { background: "#4F35A8", color: "#fff", borderBottomRightRadius: 4 }
                                  : { background: "#F5F3FF", color: "#111827", borderBottomLeftRadius: 4 }}
                              >
                                {msg.content}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="px-4 py-3 border-t flex items-center gap-2" style={{ borderColor: "hsl(220 13% 91%)" }}>
                          <input
                            value={discussInput}
                            onChange={e => setDiscussInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDiscussMessage(item.id); } }}
                            placeholder="Ask a follow-up question…"
                            className="flex-1 text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
                            style={{ borderColor: "hsl(220 13% 88%)" }}
                          />
                          <button
                            onClick={() => sendDiscussMessage(item.id)}
                            disabled={discussing || !discussInput.trim()}
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-all disabled:opacity-50 hover:opacity-90"
                            style={{ background: "#4F35A8" }}
                          >
                            {discussing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Fix It plan */}
                    {showFix && (
                      <div className="flex-1 p-4 overflow-y-auto" style={{ maxHeight: 360 }}>
                        {fixing ? (
                          <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                            <div className="text-sm text-gray-400">Generating implementation plan…</div>
                          </div>
                        ) : fixPlan ? (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <Wrench className="w-4 h-4 text-violet-500" />
                              <span className="text-sm font-bold text-gray-800">Implementation Plan</span>
                            </div>
                            <div className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl p-4 font-mono">
                              {fixPlan}
                            </div>
                            <button
                              onClick={() => runFix(item.id)}
                              className="mt-3 flex items-center gap-1.5 text-xs font-bold text-violet-600 hover:text-violet-800"
                            >
                              <RefreshCw className="w-3.5 h-3.5" /> Regenerate plan
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Add Org Modal */}
      {showOrgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-violet-500" /> Add Organization
            </h2>
            <div className="space-y-3">
              {[
                { key: "email", label: "Email*", type: "email", placeholder: "owner@company.com" },
                { key: "name", label: "Company Name*", type: "text", placeholder: "Acme Digital Agency" },
                { key: "ownerName", label: "Owner Name", type: "text", placeholder: "Jane Smith" },
                { key: "phone", label: "Phone", type: "text", placeholder: "+91 9999999999" },
                { key: "website", label: "Website", type: "text", placeholder: "https://company.com" },
              ].map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">{label}</label>
                  <input type={type} value={(newOrg as Record<string,string>)[key] ?? ""}
                    onChange={e => setNewOrg(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    style={{ borderColor: "hsl(220 13% 88%)" }} />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Plan</label>
                <select value={newOrg.plan} onChange={e => setNewOrg(p => ({ ...p, plan: e.target.value }))}
                  className="w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  style={{ borderColor: "hsl(220 13% 88%)" }}>
                  <option value="trial">Trial (7 days free)</option>
                  <option value="starter">Starter — $49/mo</option>
                  <option value="growth">Growth — $149/mo</option>
                  <option value="pro">Pro — $299/mo</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowOrgModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border text-gray-600 hover:bg-gray-50"
                style={{ borderColor: "hsl(220 13% 88%)" }}>Cancel</button>
              <button onClick={createOrg} disabled={saving || !newOrg.email || !newOrg.name}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {saving ? "Creating…" : "Create Organization"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

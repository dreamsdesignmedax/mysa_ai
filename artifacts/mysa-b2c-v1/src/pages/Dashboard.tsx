import { useState } from "react";
import { useGetDashboardSummary, useGetDashboardActivity, useGetPipelineFunnel } from "@workspace/api-client-react";
import StatCard from "@/components/StatCard";
import { Users, Calendar, FileText, TrendingUp, DollarSign, Award, CheckCircle2, Circle, UserCircle, X, ArrowRight, Zap, CreditCard } from "lucide-react";
import { formatCurrency, formatRelative } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useAuthUser } from "@/contexts/AuthContext";
import { usePlan, planLabel, planBadgeStyle } from "@/hooks/usePlan";

function isProfileIncomplete(user: ReturnType<typeof useAuthUser>): boolean {
  if (!user) return false;
  const hasName = !!(user.firstName?.trim());
  const hasSyntheticEmail = (user.email ?? "").endsWith("@otp.mysa.internal");
  return !hasName || hasSyntheticEmail;
}

function ProfileCompletionBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
      <UserCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-800">Complete your profile</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Add your name and email so your colleagues and clients can reach you.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 self-center">
        <Link
          href="/settings?tab=profile"
          className="flex items-center gap-1 text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900 transition-colors"
        >
          Go to Profile <ArrowRight className="w-3 h-3" />
        </Link>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="p-1 rounded hover:bg-amber-100 text-amber-500 hover:text-amber-700 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

const DAILY_CHECKLIST = [
  { id: "review-new", label: "Review new leads added overnight", category: "leads" },
  { id: "bant-queue", label: "Score all unscored leads in BANT queue", category: "qualify" },
  { id: "send-outreach", label: "Send pending outreach touchpoints", category: "outreach" },
  { id: "meeting-prep", label: "Prep for today's meetings (pre-call brief)", category: "meetings" },
  { id: "follow-proposals", label: "Follow up on proposals sent 3-7 days ago", category: "proposals" },
  { id: "run-audits", label: "Run brand audits for top 2 new leads", category: "audit" },
  { id: "update-pipeline", label: "Update pipeline statuses from yesterday's calls", category: "leads" },
];

function getTodayKey() {
  const d = new Date();
  return `swm-checklist-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function loadChecked(): Set<string> {
  try {
    const raw = localStorage.getItem(getTodayKey());
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: activity = [] } = useGetDashboardActivity();
  const { data: funnel } = useGetPipelineFunnel();
  const { data: planData } = usePlan();
  const [checked, setChecked] = useState<Set<string>>(loadChecked);
  const user = useAuthUser();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const showProfileBanner = !bannerDismissed && isProfileIncomplete(user);

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(getTodayKey(), JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const stageColors: Record<string, string> = {
    New: "#3B82F6", Audited: "#EAB308", Qualified: "#1A7A45",
    Meeting: "#A855F7", Proposal: "#F97316", Closed: "#22C55E",
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-base md:text-lg font-bold text-foreground">Command Center</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Your AI-powered autonomous B2B sales command centre</p>
      </div>

      {/* WHY Banner */}
      <div style={{ background: "#F0FDFA", borderLeft: "3px solid #0D9488", borderRadius: "0 8px 8px 0", padding: "12px 16px" }}>
        <p className="text-xs italic" style={{ color: "#0F766E" }}>
          "We believe every B2B founder deserves a sales engine that works as hard as they do."
        </p>
      </div>

      {/* Profile completion nudge */}
      {showProfileBanner && (
        <ProfileCompletionBanner onDismiss={() => setBannerDismissed(true)} />
      )}

      {/* Plan + Usage card */}
      {planData && (() => {
        const badge = planBadgeStyle(planData.plan);
        const usageItems = [
          { label: "Leads",  used: planData.usage.leads.used,  max: planData.usage.leads.max,  color: "#0D9488" },
          { label: "Audits", used: planData.usage.audits.used, max: planData.usage.audits.max, color: "#7C3AED" },
          { label: "Emails", used: planData.usage.emails.used, max: planData.usage.emails.max, color: "#2563EB" },
        ];
        return (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Monthly Usage</span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: badge.bg, color: badge.text, border: `1px solid ${badge.border}` }}
                >
                  {planLabel(planData.plan)}
                </span>
              </div>
              <Link href="/billing">
                <button className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700">
                  <Zap className="w-3 h-3" /> Upgrade
                </button>
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {usageItems.map(item => {
                const unlimited = item.max === -1;
                const pct = unlimited ? 0 : Math.min(100, Math.round((item.used / item.max) * 100));
                const warn = !unlimited && pct >= 80;
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] font-semibold text-gray-500">{item.label}</span>
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: warn ? "#EF4444" : "#374151" }}>
                        {unlimited ? "∞" : `${item.used}/${item.max}`}
                      </span>
                    </div>
                    {!unlimited && (
                      <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: warn ? "#EF4444" : item.color }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {planData.plan === "trial" && !planData.trialExpired && planData.trialDaysLeft <= 3 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[11px] text-amber-600 font-medium">
                  {planData.trialDaysLeft === 0 ? "Trial ends today" : `${planData.trialDaysLeft} trial day${planData.trialDaysLeft !== 1 ? "s" : ""} left`}
                </span>
                <Link href="/billing">
                  <button className="text-[11px] font-bold px-2.5 py-1 rounded-lg text-white" style={{ background: "#7C3AED" }}>
                    Upgrade now <ArrowRight className="inline w-3 h-3" />
                  </button>
                </Link>
              </div>
            )}
          </div>
        );
      })()}

      {/* KPI Grid — 2 cols mobile, 3 cols desktop */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
        <StatCard label="Leads This Month" value={summary?.totalLeadsThisMonth ?? 0} icon={Users} color="teal" loading={isLoading} trend="New prospects" />
        <StatCard label="Qualified" value={summary?.qualifiedLeads ?? 0} icon={Award} color="green" loading={isLoading} trend="Ready to close" />
        <StatCard label="Meetings This Week" value={summary?.meetingsThisWeek ?? 0} icon={Calendar} color="purple" loading={isLoading} trend="Scheduled" />
        <StatCard label="Pipeline Value" value={formatCurrency(summary?.pipelineValue ?? 0)} icon={DollarSign} color="amber" loading={isLoading} trend="Active proposals" />
        <StatCard label="Proposals Sent" value={summary?.proposalsSent ?? 0} icon={FileText} color="blue" loading={isLoading} trend="This month" />
        <StatCard label="Deals Closed" value={summary?.dealsClosedThisMonth ?? 0} icon={TrendingUp} color="green" loading={isLoading} trend="This month" />
      </div>

      {/* Daily Rhythm Checklist */}
      <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-foreground uppercase tracking-wider">Daily Rhythm Checklist</div>
          <div className="text-[11px] text-muted-foreground">{checked.size}/{DAILY_CHECKLIST.length} done</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {DAILY_CHECKLIST.map((item) => (
            <button
              key={item.id}
              onClick={() => toggleChecked(item.id)}
              className={cn("flex items-center gap-2.5 text-left px-3 py-2.5 md:py-2 rounded border transition-all", checked.has(item.id) ? "border-teal-200 bg-teal-50" : "border-gray-200 hover:border-gray-200/60 hover:bg-gray-50")}
            >
              {checked.has(item.id) ? (
                <CheckCircle2 className="w-4 h-4 md:w-3.5 md:h-3.5 text-teal-600 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 md:w-3.5 md:h-3.5 text-gray-400 flex-shrink-0" />
              )}
              <span className={cn("text-[12px] md:text-[11px] leading-tight", checked.has(item.id) ? "line-through text-gray-400" : "text-gray-700")}>{item.label}</span>
            </button>
          ))}
        </div>
        {checked.size === DAILY_CHECKLIST.length && (
          <div className="mt-3 px-3 py-2 rounded border border-amber-200 bg-amber-50 text-[11px] text-amber-600 text-center">
            🎯 All done! Great sales rhythm today.
          </div>
        )}
      </div>

      {/* Pipeline Funnel + Activity — stack on mobile, side-by-side on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pipeline Funnel */}
        <div className="md:col-span-2 rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
          <div className="text-xs font-semibold text-foreground mb-4 uppercase tracking-wider">Pipeline Funnel</div>
          {funnel?.stages && funnel.stages.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={funnel.stages} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="stage" tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#ffffff", border: "1px solid #E5E7EB", borderRadius: "6px", fontSize: "11px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                  labelStyle={{ color: "#374151" }}
                  itemStyle={{ color: "#111827" }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {funnel.stages.map((entry) => (
                    <Cell key={entry.stage} fill={stageColors[entry.stage] ?? "#1A7A45"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">No pipeline data yet</div>
          )}
        </div>

        {/* Activity Feed */}
        <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
          <div className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider">Recent Activity</div>
          <div className="space-y-2.5 overflow-y-auto max-h-52">
            {activity.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">No recent activity</div>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="flex gap-2.5 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: "#1A7A45" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-700 leading-snug">{item.description}</div>
                    {item.company && <div className="text-muted-foreground text-[10px]">{item.company}</div>}
                    <div className="text-gray-400 text-[10px] mt-0.5">{formatRelative(item.createdAt)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Pipeline stage breakdown */}
      {funnel?.stages && (
        <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
          <div className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider">Stage Breakdown</div>
          <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
            {funnel.stages.map((stage) => (
              <div key={stage.stage} className="text-center">
                <div className="text-lg font-bold" style={{ color: stageColors[stage.stage] ?? "#1A7A45" }}>{stage.count}</div>
                <div className="text-[9px] md:text-[10px] text-muted-foreground capitalize leading-tight">{stage.stage.replace("_", " ")}</div>
                {stage.conversionRate != null && (
                  <div className="text-[10px] text-gray-400">{stage.conversionRate}%</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

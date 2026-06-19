import { useQuery } from "@tanstack/react-query";
import { Activity, Zap, Search, User, DollarSign, Clock, RefreshCw, TrendingUp, FileText, Mail, Users, Database } from "lucide-react";

interface PlatformStats {
  auditsDone:          number;
  reportsGenerated:    number;
  leadsFetched:        number;
  leadBankSize:        number;
  leadsEnrichedViaApi: number;
}

interface UsageSummary {
  totalCostUsd:      number | null;
  totalInputTokens:  number | null;
  totalOutputTokens: number | null;
  totalApiCalls:     number | null;
}
interface ServiceRow {
  service:           string;
  model:             string | null;
  feature:           string;
  totalCalls:        number;
  totalInputTokens:  number;
  totalOutputTokens: number;
  totalCostUsd:      number;
}
interface DailyRow {
  date:         string;
  service:      string;
  totalCostUsd: number;
  totalCalls:   number;
}
interface RecentRow {
  id:           number;
  service:      string;
  model:        string | null;
  feature:      string;
  inputTokens:  number;
  outputTokens: number;
  apiCalls:     number;
  costUsd:      number;
  createdAt:    string;
}
interface ApiUsageData {
  summary:              UsageSummary;
  byServiceAndFeature:  ServiceRow[];
  daily:                DailyRow[];
  recent:               RecentRow[];
  platformStats:        PlatformStats;
}

const SERVICE_META: Record<string, { label: string; color: string; icon: string; unit: string }> = {
  anthropic: { label: "Anthropic AI",       color: "#7C3AED", icon: "🤖", unit: "tokens"   },
  apify:     { label: "Apify Research",     color: "#F97316", icon: "🔍", unit: "SERP calls"},
  apollo:    { label: "Apollo CRM",         color: "#3B82F6", icon: "👤", unit: "lookups"  },
  pagespeed: { label: "Google PageSpeed",   color: "#10B981", icon: "⚡", unit: "checks"   },
};

function fmtCost(n: number | null | undefined, dp = 4): string {
  if (!n) return "$0.0000";
  return `$${Number(n).toFixed(dp)}`;
}
function fmtNum(n: number | null | undefined): string {
  if (!n) return "0";
  return Number(n).toLocaleString();
}

export default function ApiUsage() {
  const { data, isLoading, refetch, isFetching } = useQuery<ApiUsageData>({
    queryKey: ["saas-api-usage"],
    queryFn: () => fetch("/api/saas/api-usage", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60_000,
  });

  // Per-service aggregates
  const serviceAgg: Record<string, { cost: number; calls: number; tokens: number }> = {};
  for (const row of data?.byServiceAndFeature ?? []) {
    if (!serviceAgg[row.service]) serviceAgg[row.service] = { cost: 0, calls: 0, tokens: 0 };
    serviceAgg[row.service]!.cost   += Number(row.totalCostUsd)      || 0;
    serviceAgg[row.service]!.calls  += Number(row.totalCalls)        || 0;
    serviceAgg[row.service]!.tokens += (Number(row.totalInputTokens) || 0) + (Number(row.totalOutputTokens) || 0);
  }

  // Daily chart: group by date, sum all services
  const dailyMap: Record<string, number> = {};
  for (const row of data?.daily ?? []) {
    dailyMap[row.date] = (dailyMap[row.date] || 0) + (Number(row.totalCostUsd) || 0);
  }
  const dailyEntries = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).slice(-30);
  const maxDailyCost = Math.max(...dailyEntries.map(([, v]) => v), 0.0001);

  const totalCost         = Number(data?.summary?.totalCostUsd)      || 0;
  const totalCalls        = Number(data?.summary?.totalApiCalls)      || 0;
  const totalInputTokens  = Number(data?.summary?.totalInputTokens)   || 0;
  const totalOutputTokens = Number(data?.summary?.totalOutputTokens)  || 0;

  // Feature breakdown
  const featureGroups: Record<string, { cost: number; calls: number; services: Set<string> }> = {};
  for (const row of data?.byServiceAndFeature ?? []) {
    if (!featureGroups[row.feature]) featureGroups[row.feature] = { cost: 0, calls: 0, services: new Set() };
    featureGroups[row.feature]!.cost  += Number(row.totalCostUsd) || 0;
    featureGroups[row.feature]!.calls += Number(row.totalCalls)   || 0;
    featureGroups[row.feature]!.services.add(row.service);
  }
  const featureEntries = Object.entries(featureGroups).sort(([, a], [, b]) => b.cost - a.cost);

  // Model tier breakdown (Anthropic only)
  const tierAgg: Record<"FAST" | "SMART", { cost: number; calls: number; inputTokens: number; outputTokens: number }> = {
    FAST:  { cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 },
    SMART: { cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 },
  };
  for (const row of data?.byServiceAndFeature ?? []) {
    if (row.service !== "anthropic" || !row.model) continue;
    const tier: "FAST" | "SMART" = row.model.includes("haiku") ? "FAST" : "SMART";
    tierAgg[tier].cost         += Number(row.totalCostUsd)      || 0;
    tierAgg[tier].calls        += Number(row.totalCalls)        || 0;
    tierAgg[tier].inputTokens  += Number(row.totalInputTokens)  || 0;
    tierAgg[tier].outputTokens += Number(row.totalOutputTokens) || 0;
  }
  const tierTotal = tierAgg.FAST.cost + tierAgg.SMART.cost;

  const summaryCards = [
    {
      title: "Total Spend",
      value: fmtCost(totalCost, 4),
      sub:   `${fmtNum(totalCalls)} total API calls`,
      icon:  DollarSign,
      color: "#111827",
    },
    {
      title: "Anthropic AI",
      value: fmtCost(serviceAgg["anthropic"]?.cost, 4),
      sub:   `${fmtNum(totalInputTokens + totalOutputTokens)} tokens used`,
      icon:  Zap,
      color: "#7C3AED",
    },
    {
      title: "Apify Research",
      value: fmtCost(serviceAgg["apify"]?.cost, 4),
      sub:   `${fmtNum(serviceAgg["apify"]?.calls)} SERP queries`,
      icon:  Search,
      color: "#F97316",
    },
    {
      title: "Apollo CRM",
      value: fmtCost(serviceAgg["apollo"]?.cost, 4),
      sub:   `${fmtNum(serviceAgg["apollo"]?.calls)} lead lookups`,
      icon:  User,
      color: "#3B82F6",
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Usage &amp; Cost</h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time tracking of all integrated APIs and their costs</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <Activity className="w-5 h-5 animate-pulse mr-2" /> Loading usage data…
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {summaryCards.map(card => (
              <div key={card.title} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: card.color + "18" }}>
                    <card.icon className="w-4 h-4" style={{ color: card.color }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-500">{card.title}</span>
                </div>
                <div className="text-xl font-bold text-gray-900 tabular-nums">{card.value}</div>
                <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Platform Activity Stats */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Platform Activity — All Time</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: "Brand Audits Done",
                  value: fmtNum(data?.platformStats?.auditsDone),
                  sub:   "complete audit reports",
                  icon:  FileText,
                  color: "#0F766E",
                  bg:    "#F0FDFA",
                },
                {
                  label: "Outreach Reports",
                  value: fmtNum(data?.platformStats?.reportsGenerated),
                  sub:   "emails generated",
                  icon:  Mail,
                  color: "#7C3AED",
                  bg:    "#F5F3FF",
                },
                {
                  label: "Leads Fetched",
                  value: fmtNum(data?.platformStats?.leadsFetched),
                  sub:   `incl. ${fmtNum(data?.platformStats?.leadBankSize)} in lead bank`,
                  icon:  Users,
                  color: "#1D4ED8",
                  bg:    "#EFF6FF",
                },
                {
                  label: "Leads API Used",
                  value: fmtNum(data?.platformStats?.leadsEnrichedViaApi),
                  sub:   "Apollo enrichment calls",
                  icon:  Database,
                  color: "#B45309",
                  bg:    "#FFFBEB",
                },
              ].map(stat => (
                <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: stat.bg }}>
                    <stat.icon className="w-4.5 h-4.5" style={{ color: stat.color, width: 18, height: 18 }} />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-gray-500 mb-0.5">{stat.label}</div>
                    <div className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">{stat.value}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{stat.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing reference */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-bold text-amber-700 uppercase tracking-wide">Live Pricing Reference</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-amber-800">
              <div><span className="font-semibold">🤖 Claude Sonnet 4.6</span><br />$3/M input · $15/M output</div>
              <div><span className="font-semibold">🤖 Claude Haiku 4.5</span><br />$0.80/M input · $4/M output</div>
              <div><span className="font-semibold">🔍 Apify SERP Scraper</span><br />~$0.003 per query (3 per audit)</div>
              <div><span className="font-semibold">👤 Apollo People Match</span><br />~$0.10 per enrichment credit</div>
            </div>
          </div>

          {/* Daily spend chart */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700">Daily Spend — Last 30 Days</h2>
              {dailyEntries.length > 0 && (
                <span className="ml-auto text-xs text-gray-400">
                  Total: {fmtCost(dailyEntries.reduce((s, [, v]) => s + v, 0), 4)}
                </span>
              )}
            </div>
            {dailyEntries.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-sm text-gray-400">
                No usage recorded yet — run a brand audit or generate outreach to start tracking.
              </div>
            ) : (
              <>
                <div className="flex items-end gap-1 h-32">
                  {dailyEntries.map(([date, cost]) => {
                    const height = (cost / maxDailyCost) * 100;
                    const label  = new Date(date + "T00:00:00").toLocaleDateString("en", { month: "short", day: "numeric" });
                    return (
                      <div key={date} className="flex-1 flex flex-col items-center gap-1 group relative">
                        <div className="relative w-full flex items-end justify-center" style={{ height: 112 }}>
                          <div
                            title={`${label}: ${fmtCost(cost, 4)}`}
                            className="w-full rounded-t cursor-pointer transition-opacity group-hover:opacity-75"
                            style={{ height: `${Math.max(height, 2)}%`, background: "#7C3AED" }}
                          />
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                            {fmtCost(cost, 4)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>{new Date(dailyEntries[0][0] + "T00:00:00").toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
                  <span>{new Date(dailyEntries[dailyEntries.length - 1][0] + "T00:00:00").toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
                </div>
              </>
            )}
          </div>

          {/* Feature breakdown + Service breakdown side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* By feature */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Cost by Feature</h2>
              {featureEntries.length === 0 ? (
                <p className="text-sm text-gray-400">No data yet.</p>
              ) : (
                <div className="space-y-3">
                  {featureEntries.map(([feature, { cost, calls, services }]) => {
                    const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
                    return (
                      <div key={feature}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-700 capitalize">{feature.replace(/-/g, " ")}</span>
                            <span className="text-[10px] text-gray-400">{[...services].map(s => SERVICE_META[s]?.icon ?? s).join(" ")}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-gray-400">{fmtNum(calls)} calls</span>
                            <span className="font-bold text-gray-900 tabular-nums">{fmtCost(cost, 4)}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* By service */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Cost by Service</h2>
              {Object.keys(serviceAgg).length === 0 ? (
                <p className="text-sm text-gray-400">No data yet.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(serviceAgg)
                    .sort(([, a], [, b]) => b.cost - a.cost)
                    .map(([service, { cost, calls, tokens }]) => {
                      const meta = SERVICE_META[service] ?? { label: service, color: "#6B7280", icon: "📡", unit: "calls" };
                      const pct  = totalCost > 0 ? (cost / totalCost) * 100 : 0;
                      return (
                        <div key={service}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-lg leading-none">{meta.icon}</span>
                              <div>
                                <div className="text-xs font-semibold text-gray-800">{meta.label}</div>
                                <div className="text-[10px] text-gray-400">
                                  {fmtNum(service === "anthropic" ? tokens : calls)} {meta.unit}
                                </div>
                              </div>
                            </div>
                            <div className="text-sm font-bold text-gray-900 tabular-nums">{fmtCost(cost, 4)}</div>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Model Tier Breakdown */}
          {tierTotal > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm mb-6">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-violet-500" />
                <h2 className="text-sm font-semibold text-gray-700">Model Tier Breakdown — Anthropic AI</h2>
                <span className="ml-auto text-xs text-gray-400">FAST = Haiku · SMART = Sonnet / Opus</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(["FAST", "SMART"] as const).map(tier => {
                  const d   = tierAgg[tier];
                  const pct = tierTotal > 0 ? (d.cost / tierTotal) * 100 : 0;
                  const color      = tier === "FAST" ? "#0891B2" : "#7C3AED";
                  const bgColor    = tier === "FAST" ? "#ECFEFF" : "#F5F3FF";
                  const modelLabel = tier === "FAST" ? "claude-haiku-4-5 · $0.80/$4 per 1M" : "claude-sonnet-4-5 · $3/$15 per 1M";
                  const avgCost    = d.calls > 0 ? d.cost / d.calls : 0;
                  return (
                    <div key={tier} className="rounded-xl border p-4" style={{ borderColor: color + "30", background: bgColor }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: color + "18" }}>
                            <Zap className="w-3.5 h-3.5" style={{ color }} />
                          </div>
                          <div>
                            <div className="text-xs font-bold" style={{ color }}>{tier} Tier</div>
                            <div className="text-[10px] text-gray-400">{modelLabel}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-gray-900 tabular-nums">{fmtCost(d.cost, 4)}</div>
                          <div className="text-[10px] text-gray-400">{pct.toFixed(1)}% of AI spend</div>
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-white rounded-lg p-2">
                          <div className="text-xs font-bold text-gray-900 tabular-nums">{fmtNum(d.calls)}</div>
                          <div className="text-[10px] text-gray-400">API calls</div>
                        </div>
                        <div className="bg-white rounded-lg p-2">
                          <div className="text-xs font-bold text-gray-900 tabular-nums">{fmtNum(d.inputTokens + d.outputTokens)}</div>
                          <div className="text-[10px] text-gray-400">tokens used</div>
                        </div>
                        <div className="bg-white rounded-lg p-2">
                          <div className="text-xs font-bold text-gray-900 tabular-nums">{fmtCost(avgCost, 4)}</div>
                          <div className="text-[10px] text-gray-400">avg / call</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent API calls table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <Clock className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700">Recent API Calls</h2>
              <span className="ml-auto text-xs text-gray-400">{(data?.recent ?? []).length} most recent</span>
            </div>
            {(data?.recent ?? []).length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">No API calls logged yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-500 font-semibold">
                      <th className="px-4 py-2.5">Service</th>
                      <th className="px-4 py-2.5">Feature</th>
                      <th className="px-4 py-2.5">Model</th>
                      <th className="px-4 py-2.5 text-right">In Tokens</th>
                      <th className="px-4 py-2.5 text-right">Out Tokens</th>
                      <th className="px-4 py-2.5 text-right">Calls</th>
                      <th className="px-4 py-2.5 text-right">Cost</th>
                      <th className="px-4 py-2.5 text-right">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data?.recent ?? []).map(row => {
                      const meta = SERVICE_META[row.service] ?? { label: row.service, color: "#6B7280", icon: "📡", unit: "calls" };
                      return (
                        <tr key={row.id} className="hover:bg-gray-50/60 transition-colors">
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1.5 font-medium text-gray-800">
                              {meta.icon} {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 capitalize">{row.feature.replace(/-/g, " ")}</td>
                          <td className="px-4 py-2.5 text-gray-400 font-mono">{row.model ?? "—"}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{row.inputTokens  > 0 ? fmtNum(row.inputTokens)  : "—"}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{row.outputTokens > 0 ? fmtNum(row.outputTokens) : "—"}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{row.apiCalls}</td>
                          <td className="px-4 py-2.5 text-right font-bold tabular-nums" style={{ color: row.costUsd > 0 ? "#111827" : "#9CA3AF" }}>
                            {row.costUsd > 0 ? fmtCost(row.costUsd, 4) : "Free"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-400">
                            {new Date(row.createdAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                            <br />
                            <span className="text-[10px]">{new Date(row.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
